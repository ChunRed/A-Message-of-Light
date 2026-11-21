"use client";

import React, { useEffect, useState } from "react";

interface SentMailboxNoticeProps {
  mailbox: number;
  onFinished: () => void;
}

/**
 * Post-swipe poetic graphite-pencil confirmation notice:
 * Slowly fades in (900ms) -> stays clearly visible for 3 seconds (3000ms)
 * -> slowly fades out (900ms) -> notifies parent to reset back to blank 3D letter loop.
 */
export function SentMailboxNotice({
  mailbox,
  onFinished,
}: SentMailboxNoticeProps) {
  const [phase, setPhase] = useState<"entering" | "visible" | "leaving">(
    "entering"
  );

  useEffect(() => {
    const fadeInRaf = window.requestAnimationFrame(() => {
      setPhase("visible");
    });

    // Hold visibly for 3 seconds after fade-in settles (~900ms fade-in + 3000ms hold)
    const holdTimer = window.setTimeout(() => {
      setPhase("leaving");
    }, 3900);

    const doneTimer = window.setTimeout(() => {
      onFinished();
    }, 4850);

    return () => {
      window.cancelAnimationFrame(fadeInRaf);
      window.clearTimeout(holdTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onFinished]);

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
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-6"
    >
      <div
        className={`flex max-w-[420px] flex-col items-center text-center transition-all duration-[900ms] ease-in-out ${opacityClass}`}
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
          {/* Slightly rough hand-drawn mailbox dome & slot */}
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
          {/* Tiny 4-point pencil sparkle above mailbox */}
          <path
            d="M36.5 5.2L36.3 10.6M33.8 7.9L39 7.8"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.7"
          />
        </svg>

        {/* Pencil-textured primary message */}
        <p
          className="text-lg font-light tracking-[0.26em] text-[#2B2A28] sm:text-xl"
          style={{
            textShadow: "0.4px 0.4px 0 rgba(43,42,40,0.16)",
          }}
        >
          請到{" "}
          <span className="mx-0.5 inline-block border-b border-dashed border-[#2B2A28]/70 px-1 font-mono text-xl font-normal tracking-[0.12em] text-[#1D1C1A] sm:text-2xl">
            {mailbox}
          </span>{" "}
          號郵筒查看信件
        </p>

        {/* Hand-sketched jittery graphite underline */}
        <svg
          width="240"
          height="14"
          viewBox="0 0 240 14"
          fill="none"
          aria-hidden="true"
          className="mt-2.5 text-[#3A3936]/55"
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

        <span className="mt-3 font-mono text-[10px] tracking-[0.24em] text-[#7A7974]">
          {`POST #${mailbox} // A MESSAGE OF LIGHT`}
        </span>
      </div>
    </div>
  );
}
