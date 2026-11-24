"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface SentMailboxNoticeProps {
  mailbox: number;
  onFinished: () => void;
}

/**
 * Step 6: Post-swipe poetic completion & on-site guidance screen.
 * Transitions from dark telemetry void into a soft warm-white halo, displays
 * the target mailbox guidance + emotional subtitle + POST ID, and provides an
 * understated bottom button ("再寫一則光的訊息") to reset back to the 3D Z-Fold letter.
 */
export function SentMailboxNotice({
  mailbox,
  onFinished,
}: SentMailboxNoticeProps) {
  const [phase, setPhase] = useState<"entering" | "visible" | "leaving">(
    "entering"
  );
  const [showRestartAction, setShowRestartAction] = useState<boolean>(false);
  const leaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const fadeInRaf = window.requestAnimationFrame(() => {
      setPhase("visible");
    });

    const restartBtnTimer = window.setTimeout(() => {
      setShowRestartAction(true);
    }, 620);

    return () => {
      window.cancelAnimationFrame(fadeInRaf);
      window.clearTimeout(restartBtnTimer);
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
    };
  }, []);

  const handleRestartExperience = useCallback(() => {
    if (phase === "leaving") return;
    setPhase("leaving");
    leaveTimerRef.current = window.setTimeout(() => {
      onFinished();
    }, 560);
  }, [onFinished, phase]);

  const opacityClass =
    phase === "visible"
      ? "opacity-100 translate-y-0"
      : phase === "entering"
        ? "opacity-0 translate-y-2"
        : "opacity-0 -translate-y-1.5";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center px-6"
    >
      {/* Soft warm-white radial glow halo transitioning softly from dark void */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 transition-opacity duration-[1100ms] ease-out ${
          phase === "visible" ? "opacity-100" : "opacity-0"
        }`}
        style={{
          background:
            "radial-gradient(circle at 50% 47%, rgba(255, 246, 224, 0.85) 0%, rgba(253, 250, 242, 0.45) 42%, rgba(252, 251, 250, 0) 76%)",
        }}
      />

      <div
        className={`relative z-10 flex max-w-[460px] flex-col items-center text-center transition-all duration-[850ms] ease-in-out ${opacityClass}`}
      >
        {/* Delicate hand-sketched graphite pencil mailbox glyph */}
        <svg
          width="46"
          height="42"
          viewBox="0 0 46 42"
          fill="none"
          aria-hidden="true"
          className="mb-4 text-[#343330]"
        >
          <path
            d="M11.5 34.5C11.2 26.2 11.7 19.8 11.4 15.2C11.3 8.8 16.4 5.6 22.9 5.5C29.4 5.4 34.8 9.1 34.6 15.4C34.4 21.1 34.8 27.6 34.4 34.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeDasharray="0.5 0"
          />
          <path
            d="M8.5 34.8C17.2 34.4 28.4 35.1 37.5 34.6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M16.5 16.4C20.5 16 25.4 16.5 29.6 16.1"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>

        {/* Primary mailbox guidance headline */}
        <p
          className="text-lg font-light tracking-[0.26em] text-[#2B2A28] sm:text-xl"
          style={{
            textShadow: "0.4px 0.4px 0 rgba(43,42,40,0.16)",
          }}
        >
          請到{" "}
          <span className="mx-0.5 inline-block border-b-[1.5px] border-dashed border-[#2B2A28]/80 px-1.5 font-mono text-2xl font-normal tracking-[0.12em] text-[#1D1C1A] sm:text-[28px]">
            {mailbox}
          </span>{" "}
          號郵筒查看信件
        </p>

        {/* Emotional subtitle placed below headline and above divider */}
        <p className="mt-3 text-xs font-light leading-relaxed tracking-[0.18em] text-[#5B5955] sm:text-[13.5px]">
          你的筆跡已化為光芒，正於鹽水郵局旁閃爍
        </p>

        {/* Hand-sketched jittery graphite divider */}
        <svg
          width="240"
          height="14"
          viewBox="0 0 240 14"
          fill="none"
          aria-hidden="true"
          className="mt-3 text-[#3A3936]/55"
        >
          <path
            d="M8 7.2C44 5.9 82 8.4 121 6.7C160 5.4 198 7.9 232 6.4"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
          />
          <path
            d="M28 10.2C76 9.5 138 11 212 9.7"
            stroke="currentColor"
            strokeWidth="0.75"
            strokeLinecap="round"
            opacity="0.55"
          />
        </svg>

        {/* Bottom English identifier */}
        <span className="mt-3 font-mono text-[10px] tracking-[0.24em] text-[#7A7974]">
          {`POST #${mailbox} // A MESSAGE OF LIGHT`}
        </span>
      </div>

      {/* Understated bottom restart experience button in lower whitespace */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-9 z-10 flex justify-center px-6 transition-all duration-700 ease-out sm:bottom-12 ${
          phase === "visible" && showRestartAction
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={handleRestartExperience}
          className="pointer-events-auto group inline-flex items-center gap-2 border-b border-dashed border-[#2B2A28]/35 px-2 pb-1 text-xs font-light tracking-[0.22em] text-[#6B6A66] transition-all duration-300 hover:border-[#222222]/80 hover:text-[#222222] active:scale-[0.98]"
        >
          <span>再寫一則光的訊息</span>
        </button>
      </div>
    </div>
  );
}
