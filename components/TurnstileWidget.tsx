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
   * Resolves with a fresh single-use Turnstile token, waiting if verification
   * is still in flight, then schedules a reset for the next upload.
   */
  consumeToken: () => Promise<string>;
  /** Resets the widget to fetch a brand-new token */
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey?: string;
  action?: string;
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
    return "Turnstile 網域未授權（110200），請於 Cloudflare 後台加入目前測試網域（如 localhost）";
  }
  if (code) {
    return `安全驗證失敗（代碼 ${code}），請重試`;
  }
  return "安全驗證未通過，請重試";
}

export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  TurnstileWidgetProps
>(function TurnstileWidget({ siteKey, action = "upload_letter" }, ref) {
  const resolvedSiteKey = (
    siteKey ??
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
    ""
  ).trim();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");
  const lastErrorRef = useRef<string | null>(null);
  const waitersRef = useRef<
    Array<{
      resolve: (token: string) => void;
      reject: (err: Error) => void;
      timeoutId: number;
    }>
  >([]);

  const [isInteractive, setIsInteractive] = useState(false);

  const flushWaitersWithToken = useCallback((token: string) => {
    const waiters = waitersRef.current.splice(0, waitersRef.current.length);
    for (const w of waiters) {
      window.clearTimeout(w.timeoutId);
      w.resolve(token);
    }
  }, []);

  const flushWaitersWithError = useCallback((message: string) => {
    const waiters = waitersRef.current.splice(0, waitersRef.current.length);
    for (const w of waiters) {
      window.clearTimeout(w.timeoutId);
      w.reject(new Error(message));
    }
  }, []);

  const resetWidget = useCallback(() => {
    tokenRef.current = "";
    lastErrorRef.current = null;
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // ignore reset error if widget was already removed
      }
    }
  }, []);

  useEffect(() => {
    if (!resolvedSiteKey) return;
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
          "refresh-expired": "auto",
          callback: (token: string) => {
            tokenRef.current = token;
            lastErrorRef.current = null;
            setIsInteractive(false);
            flushWaitersWithToken(token);
          },
          "expired-callback": () => {
            tokenRef.current = "";
          },
          "timeout-callback": () => {
            tokenRef.current = "";
            setIsInteractive(false);
            flushWaitersWithError("安全驗證逾時，請重試");
          },
          "error-callback": (errorCode?: string | number) => {
            const msg = formatTurnstileError(errorCode);
            tokenRef.current = "";
            lastErrorRef.current = msg;
            setIsInteractive(false);
            flushWaitersWithError(msg);
            return true;
          },
          "before-interactive-callback": () => {
            setIsInteractive(true);
          },
          "after-interactive-callback": () => {
            setIsInteractive(false);
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
          // Schedule widget reset so the next send gets a fresh single-use token
          window.setTimeout(() => {
            resetWidget();
          }, 0);
          return existingToken;
        }

        if (lastErrorRef.current && widgetIdRef.current && window.turnstile) {
          // Retry once automatically when a prior attempt errored
          resetWidget();
        } else if (lastErrorRef.current && !widgetIdRef.current) {
          throw new Error(lastErrorRef.current);
        }

        const freshToken = await new Promise<string>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            waitersRef.current = waitersRef.current.filter(
              (w) => w.timeoutId !== timeoutId
            );
            reject(
              new Error(
                lastErrorRef.current || "等待安全驗證逾時，請重新送出"
              )
            );
          }, 15_000);

          waitersRef.current.push({ resolve, reject, timeoutId });
        });

        tokenRef.current = "";
        window.setTimeout(() => {
          resetWidget();
        }, 0);
        return freshToken;
      },
    }),
    [resetWidget, resolvedSiteKey]
  );

  if (!resolvedSiteKey) return null;

  return (
    <div
      className={
        isInteractive
          ? "fixed inset-0 z-[70] flex items-center justify-center bg-[#0B0B0D]/65 px-4 backdrop-blur-[3px]"
          : "pointer-events-none fixed right-3 bottom-3 z-[60]"
      }
      aria-live="polite"
    >
      <div
        className={
          isInteractive
            ? "sketch-card pointer-events-auto flex flex-col items-center gap-3 border border-[#222222] bg-[#FDFCF9] px-5 py-4 shadow-lg"
            : ""
        }
      >
        {isInteractive && (
          <p className="text-xs tracking-[0.16em] text-[#222222]">
            請完成安全驗證以寄出這則光的訊息
          </p>
        )}
        <div ref={containerRef} />
      </div>
    </div>
  );
});
