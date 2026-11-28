"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  appearance?: "always" | "execute" | "interaction-only";
  size?: "normal" | "compact" | "flexible";
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "error-callback"?: (errorCode?: string | number) => boolean | void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
}

interface TurnstileApi {
  render: (
    container: HTMLElement | string,
    options: TurnstileRenderOptions
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileWidgetHandle {
  /** Whether a site key is configured and Turnstile protection is active */
  isEnabled: () => boolean;
  /**
   * Consumes the pre-verified Turnstile token (or refreshes if expired after 5 min).
   * Does NOT reset mid-animation so Turnstile never pops up while interacting.
   */
  consumeToken: () => Promise<string>;
  /** Resets the widget cleanly between letter cycles */
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey?: string;
  action?: string;
  /** When true, displays the full-screen pre-entry gate before entering the main app */
  isPreEntryGate: boolean;
  /** Invoked once Turnstile verifies the visitor on the pre-entry gate */
  onGateVerified?: () => void;
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptLoadPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileApi(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Turnstile 僅能在瀏覽器環境執行"));
  }
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );

    const handleReady = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        scriptLoadPromise = null;
        reject(new Error("Cloudflare Turnstile 腳本載入後未初始化"));
      }
    };

    const handleError = () => {
      scriptLoadPromise = null;
      reject(new Error("無法載入 Cloudflare Turnstile 安全驗證腳本"));
    };

    if (existing) {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      existing.addEventListener("load", handleReady, { once: true });
      existing.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleReady, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

function formatTurnstileError(errorCode?: string | number): string {
  const code = errorCode !== undefined ? String(errorCode) : "";
  if (code === "110200") {
    return "Turnstile 網域未授權（110200），請於 Cloudflare 後台加入目前網域";
  }
  if (code) {
    return `安全驗證失敗（代碼 ${code}），請重試`;
  }
  return "安全驗證未通過，請重試";
}

export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  TurnstileWidgetProps
>(function TurnstileWidget(
  { siteKey, action = "upload_letter", isPreEntryGate, onGateVerified },
  ref
) {
  const resolvedSiteKey = (
    siteKey ??
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
    ""
  ).trim();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");
  const lastErrorRef = useRef<string | null>(null);
  const onGateVerifiedRef = useRef(onGateVerified);
  onGateVerifiedRef.current = onGateVerified;

  const isAwaitingConsumeRef = useRef(false);
  const waitersRef = useRef<
    Array<{
      resolve: (token: string) => void;
      reject: (err: Error) => void;
      timeoutId: number;
    }>
  >([]);

  const [isInteractive, setIsInteractive] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [showUploadChallenge, setShowUploadChallenge] = useState(false);

  const flushWaitersWithToken = useCallback((token: string) => {
    isAwaitingConsumeRef.current = false;
    setShowUploadChallenge(false);
    const waiters = waitersRef.current.splice(0, waitersRef.current.length);
    for (const w of waiters) {
      window.clearTimeout(w.timeoutId);
      w.resolve(token);
    }
  }, []);

  const flushWaitersWithError = useCallback((message: string) => {
    isAwaitingConsumeRef.current = false;
    setShowUploadChallenge(false);
    const waiters = waitersRef.current.splice(0, waitersRef.current.length);
    for (const w of waiters) {
      window.clearTimeout(w.timeoutId);
      w.reject(new Error(message));
    }
  }, []);

  const resetWidget = useCallback(() => {
    tokenRef.current = "";
    lastErrorRef.current = null;
    setGateError(null);
    setIsInteractive(false);
    setShowUploadChallenge(false);
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // ignore reset error if widget was already removed
      }
    }
  }, []);

  useEffect(() => {
    if (!resolvedSiteKey) {
      onGateVerifiedRef.current?.();
      return;
    }

    let cancelled = false;

    loadTurnstileApi()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        if (widgetIdRef.current) return;

        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: resolvedSiteKey,
          action,
          theme: "light",
          appearance: "interaction-only",
          // Never auto-refresh mid-session so Turnstile cannot interrupt active drawing
          "refresh-expired": "manual",
          callback: (token: string) => {
            tokenRef.current = token;
            lastErrorRef.current = null;
            setGateError(null);
            setIsInteractive(false);
            setShowUploadChallenge(false);
            onGateVerifiedRef.current?.();
            flushWaitersWithToken(token);
          },
          "expired-callback": () => {
            tokenRef.current = "";
          },
          "timeout-callback": () => {
            tokenRef.current = "";
            setIsInteractive(false);
            const msg = "安全驗證逾時，請重新嘗試";
            lastErrorRef.current = msg;
            setGateError(msg);
            flushWaitersWithError(msg);
          },
          "error-callback": (errorCode?: string | number) => {
            const msg = formatTurnstileError(errorCode);
            tokenRef.current = "";
            lastErrorRef.current = msg;
            setGateError(msg);
            setIsInteractive(false);
            flushWaitersWithError(msg);
            return true;
          },
          "before-interactive-callback": () => {
            setIsInteractive(true);
            // Only show an upload-time overlay if consumeToken() is actively waiting
            if (isAwaitingConsumeRef.current) {
              setShowUploadChallenge(true);
            }
          },
          "after-interactive-callback": () => {
            setIsInteractive(false);
            setShowUploadChallenge(false);
          },
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err instanceof Error
            ? err.message
            : "無法載入 Cloudflare Turnstile 安全驗證";
        lastErrorRef.current = msg;
        setGateError(msg);
        flushWaitersWithError(msg);
      });

    return () => {
      cancelled = true;
      flushWaitersWithError("安全驗證元件已卸載");
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup error
        }
      }
      widgetIdRef.current = null;
      tokenRef.current = "";
    };
  }, [
    action,
    flushWaitersWithError,
    flushWaitersWithToken,
    resolvedSiteKey,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      isEnabled: () => Boolean(resolvedSiteKey),
      reset: resetWidget,
      consumeToken: async () => {
        if (!resolvedSiteKey) return "";

        const existingToken =
          tokenRef.current ||
          (widgetIdRef.current && window.turnstile
            ? window.turnstile.getResponse(widgetIdRef.current) || ""
            : "");

        if (existingToken) {
          tokenRef.current = "";
          return existingToken;
        }

        // Token expired (>5 min) or already consumed on retry -> request a fresh one
        if (widgetIdRef.current && window.turnstile) {
          isAwaitingConsumeRef.current = true;
          resetWidget();
        } else if (lastErrorRef.current) {
          throw new Error(lastErrorRef.current);
        }

        isAwaitingConsumeRef.current = true;
        const freshToken = await new Promise<string>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            waitersRef.current = waitersRef.current.filter(
              (w) => w.timeoutId !== timeoutId
            );
            isAwaitingConsumeRef.current = false;
            setShowUploadChallenge(false);
            reject(
              new Error(
                lastErrorRef.current || "等待安全驗證逾時，請重新送出"
              )
            );
          }, 20_000);

          waitersRef.current.push({ resolve, reject, timeoutId });
        });

        tokenRef.current = "";
        return freshToken;
      },
    }),
    [resetWidget, resolvedSiteKey]
  );

  if (!resolvedSiteKey) return null;

  // Keep the exact same <div ref={containerRef} /> mounted across transitions so
  // Cloudflare's iframe never reloads or prompts mid-interaction.
  const wrapperClass = isPreEntryGate
    ? "fixed inset-0 z-[80] flex flex-col items-center justify-center bg-[#FCFBFA] px-5 text-[#222222]"
    : showUploadChallenge
      ? "fixed inset-0 z-[80] flex items-center justify-center bg-[#0B0B0D]/65 px-4 backdrop-blur-[3px]"
      : "pointer-events-none fixed right-0 bottom-0 -z-10 opacity-0";

  return (
    <div className={wrapperClass} aria-live="polite">
      <div
        className={
          isPreEntryGate
            ? "flex w-full max-w-[360px] flex-col items-center gap-4 text-center"
            : showUploadChallenge
              ? "sketch-card pointer-events-auto flex flex-col items-center gap-3 border border-[#222222] bg-[#FDFCF9] px-5 py-4 shadow-lg"
              : ""
        }
      >
        {isPreEntryGate && (
          <>
            <div className="flex flex-col items-center gap-1.5">
              <p className="font-mono text-[10px] tracking-[0.26em] text-[#8C8C8A]">
                A MESSAGE OF LIGHT
              </p>
              <h1 className="text-base font-normal tracking-[0.28em] text-[#222222]">
                一則光的訊息
              </h1>
            </div>

            {!gateError && (
              <div className="flex items-center gap-2 text-xs tracking-[0.16em] text-[#666664]">
                <span
                  aria-hidden="true"
                  className="animate-dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#222222]/60"
                />
                <span>
                  {isInteractive
                    ? "請先完成安全驗證以展開信紙"
                    : "正在確認安全連線⋯"}
                </span>
              </div>
            )}
          </>
        )}

        {!isPreEntryGate && showUploadChallenge && (
          <p className="text-xs tracking-[0.16em] text-[#222222]">
            驗證已過期，請完成確認以寄出信件
          </p>
        )}

        <div ref={containerRef} className="min-h-[1px]" />

        {isPreEntryGate && gateError && (
          <div className="flex flex-col items-center gap-2.5">
            <p className="text-xs tracking-[0.08em] text-[#DF7A5E]">
              {gateError}
            </p>
            <button
              type="button"
              onClick={resetWidget}
              className="sketch-pill inline-flex h-8 items-center justify-center border border-[#222222] bg-[#222222] px-4 text-xs tracking-[0.16em] text-[#FAF9F6] transition-colors hover:bg-[#FDFCF9] hover:text-[#222222]"
            >
              重新驗證
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
