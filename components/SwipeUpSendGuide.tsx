"use client";

import React, { useEffect, useRef } from "react";
import { createSeededRng, drawSketchyLine } from "@/lib/hand-drawn-utils";
import { MAILBOX_NUMBERS, MailboxNumber } from "@/lib/image-library-api";
import type { MailboxTargetScreenPoint } from "@/components/ZFoldLetterScene";

interface SwipeUpSendGuideProps {
  /** Current upward swipe progress [0..1] where 1 = launch threshold reached */
  swipeProgress: number;
  /** Currently aimed mailbox (1..5) based on swipe direction, or null when idle */
  targetedMailbox: MailboxNumber | null;
  /** True while the envelope is flying toward the chosen mailbox */
  isLaunching: boolean;
  /** The chosen mailbox once launched */
  launchedMailbox: MailboxNumber | null;
  /** Reports exact screen center coords of the 5 top mailboxes for 3D flight targeting */
  onTargetsMeasured: (targets: MailboxTargetScreenPoint[]) => void;
}

const ARCH_OFFSETS_PX = [12, 4, 0, 4, 12];

/**
 * Step 5: Five hand-drawn illuminated mailboxes (1–5) arched comfortably in the
 * upper viewport + lively ~8fps hand-sketched directional arrow guide. Users swipe
 * upward from the lower sealed envelope toward whichever mailbox (1–5) they want
 * to illuminate; releasing launches the 3D envelope along a curved arc into that mailbox.
 */
export function SwipeUpSendGuide({
  swipeProgress,
  targetedMailbox,
  isLaunching,
  launchedMailbox,
  onTargetsMeasured,
}: SwipeUpSendGuideProps) {
  const arrowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mailboxRefs = useRef<Array<HTMLDivElement | null>>([]);
  const progressRef = useRef<number>(swipeProgress);
  const targetedRef = useRef<MailboxNumber | null>(targetedMailbox);
  const onTargetsMeasuredRef = useRef(onTargetsMeasured);

  useEffect(() => {
    progressRef.current = swipeProgress;
  }, [swipeProgress]);

  useEffect(() => {
    targetedRef.current = targetedMailbox;
  }, [targetedMailbox]);

  useEffect(() => {
    onTargetsMeasuredRef.current = onTargetsMeasured;
  }, [onTargetsMeasured]);

  // Measure live pixel center of all 5 mailbox targets so Three.js flies accurately into each slot
  useEffect(() => {
    const measure = () => {
      const measured: MailboxTargetScreenPoint[] = [];
      for (let i = 0; i < MAILBOX_NUMBERS.length; i++) {
        const el = mailboxRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          measured.push({
            mailbox: MAILBOX_NUMBERS[i],
            screenX: rect.left + rect.width * 0.5,
            screenY: rect.top + rect.height * 0.52,
          });
        }
      }
      if (measured.length === MAILBOX_NUMBERS.length) {
        onTargetsMeasuredRef.current(measured);
      }
    };

    const rafId = window.requestAnimationFrame(measure);
    const settleTimer = window.setTimeout(measure, 360);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Lively hand-sketched directional crayon chevron indicator (tilts toward aimed mailbox 1..5)
  useEffect(() => {
    const canvas = arrowCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 110;
    const h = 68;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    let rafId = 0;
    let smoothedTilt = 0;
    const start = performance.now();

    const drawCrayonArrowhead = (
      cx: number,
      cy: number,
      span: number,
      alpha: number,
      strokeColor: string,
      width: number,
      rng: () => number
    ) => {
      if (alpha <= 0.02) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let pass = 0; pass < 2; pass++) {
        const j = pass * 0.85;
        drawSketchyLine(
          ctx,
          cx - span + (rng() - 0.5) * j,
          cy + span * 0.76 + (rng() - 0.5) * j,
          cx + (rng() - 0.5) * j,
          cy + (rng() - 0.5) * j,
          rng,
          {
            stepPx: 5,
            jitterAmp: 0.8,
            lineWidth: pass === 0 ? width : width * 0.62,
            strokeStyle: strokeColor,
            overshoot: 1.5,
          }
        );
        drawSketchyLine(
          ctx,
          cx + (rng() - 0.5) * j,
          cy + (rng() - 0.5) * j,
          cx + span + (rng() - 0.5) * j,
          cy + span * 0.76 + (rng() - 0.5) * j,
          rng,
          {
            stepPx: 5,
            jitterAmp: 0.8,
            lineWidth: pass === 0 ? width : width * 0.62,
            strokeStyle: strokeColor,
            overshoot: 1.5,
          }
        );
      }
      ctx.restore();
    };

    const render = (now: number) => {
      rafId = window.requestAnimationFrame(render);
      const elapsed = (now - start) / 1000;
      const boil = Math.floor((now - start) / 130);
      const p = progressRef.current;
      const mb = targetedRef.current;

      // Tilt smoothly toward targeted mailbox (-0.46 rad for #1 .. 0 for #3 .. +0.46 rad for #5)
      const targetTilt = mb !== null ? ((mb - 3) / 2) * 0.46 : 0;
      smoothedTilt += (targetTilt - smoothedTilt) * 0.18;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const rng = createSeededRng(5521 + (boil % 4) * 97);
      const cx = w * 0.5;
      const pivotY = h * 0.84;

      ctx.save();
      ctx.translate(cx, pivotY);
      ctx.rotate(smoothedTilt);
      ctx.translate(-cx, -pivotY);

      const cycle = (elapsed * 1.15) % 1;
      const pullLift = p * 10;

      // Staggered floating crayon chevrons rising upward
      for (let k = 0; k < 2; k++) {
        const phase = (cycle + k / 2) % 1;
        const y = h - 14 - phase * (h - 28) - pullLift * 0.45;
        const fadeIn = Math.min(1, phase / 0.24);
        const fadeOut = Math.min(1, (1 - phase) / 0.3);
        const alpha = fadeIn * fadeOut * (0.45 + p * 0.5);
        const color =
          k === 0 || mb !== null ? "#F3D98B" : "rgba(250, 249, 246, 0.9)";
        drawCrayonArrowhead(cx, y, 9.5 + k * 2.2, alpha, color, 1.85, rng);
      }

      // Main hero crayon arrowhead
      const heroBob = Math.sin(elapsed * 4.4) * 3.6;
      const heroY = 15 + heroBob - pullLift * 0.5;
      drawCrayonArrowhead(
        cx,
        heroY,
        13.5,
        0.95,
        p >= 0.9 ? "#FAF9F6" : "#F3D98B",
        2.25,
        rng
      );

      ctx.restore();
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const activeMailbox = isLaunching ? launchedMailbox : targetedMailbox;
  const isReadyToRelease = swipeProgress >= 0.92 && targetedMailbox !== null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-between pt-[11.5vh] pb-6 sm:pt-[10.5vh] sm:pb-8"
    >
      {/* UPPER-MID: Five hand-drawn illuminated mailboxes (1..5) lowered comfortably from top edge */}
      <div className="animate-muji-modal-in flex w-full max-w-[470px] flex-col items-center px-3.5 sm:px-4">
        <div
          role="list"
          aria-label="現場 1 至 5 號郵筒投遞目標"
          className="grid w-full grid-cols-5 items-start gap-2 sm:gap-3"
        >
          {MAILBOX_NUMBERS.map((num, idx) => {
            const isTargeted = activeMailbox === num;
            const isDimmed =
              (isLaunching && launchedMailbox !== num) ||
              (!isLaunching && activeMailbox !== null && activeMailbox !== num);
            const archY = ARCH_OFFSETS_PX[idx] ?? 0;

            return (
              <div
                key={num}
                role="listitem"
                ref={(el) => {
                  mailboxRefs.current[idx] = el;
                }}
                style={{
                  transform: `translateY(${
                    archY + (isLaunching && isTargeted ? -12 : isTargeted ? -10 : 0)
                  }px) scale(${
                    isLaunching && isTargeted
                      ? 1.34
                      : isTargeted
                        ? 1.26
                        : isDimmed
                          ? 0.88
                          : 1
                  })`,
                }}
                className={`sketch-card-dark relative flex flex-col items-center justify-center border px-1.5 py-2.5 transition-all duration-250 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] sm:py-3 ${
                  isTargeted
                    ? isLaunching
                      ? "z-20 border-[1.5px] border-[#F3D98B] bg-[#F3D98B]/30 text-[#FAF9F6] shadow-[0_0_40px_rgba(243,217,139,0.75)]"
                      : "z-20 border-[1.5px] border-[#F3D98B] bg-[#F3D98B]/20 text-[#F3D98B] shadow-[0_0_28px_rgba(243,217,139,0.52)]"
                    : isDimmed
                      ? "z-0 border-[#FAF9F6]/16 bg-[#121216]/65 text-[#FAF9F6]/38"
                      : "z-10 border-[#FAF9F6]/32 bg-[#121216]/82 text-[#FAF9F6]/85"
                }`}
              >
                {/* Minimalist hand-sketched mailbox dome icon */}
                <svg
                  width="26"
                  height="24"
                  viewBox="0 0 36 32"
                  fill="none"
                  aria-hidden="true"
                  className="mb-1 sm:h-[26px] sm:w-[28px]"
                >
                  <path
                    d="M9 27C8.8 20.5 9.1 15.5 8.9 12C8.8 7 12.8 4.4 18 4.3C23.2 4.2 27.3 7.2 27.1 12.1C27 16.5 27.3 21.5 27 27"
                    stroke="currentColor"
                    strokeWidth={isTargeted ? "1.65" : "1.35"}
                    strokeLinecap="round"
                  />
                  <path
                    d="M6.5 27.2C13.4 26.9 22.4 27.5 29.5 27.1"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M13 13C16.2 12.7 19.8 13.1 23 12.8"
                    stroke="currentColor"
                    strokeWidth={isTargeted ? "1.8" : "1.45"}
                    strokeLinecap="round"
                  />
                </svg>

                <span className="font-mono text-xs font-medium tracking-[0.08em] sm:text-sm">
                  {num}
                </span>
                <span className="font-mono text-[8px] tracking-[0.14em] opacity-65">
                  POST
                </span>
              </div>
            );
          })}
        </div>

        {/* Directional Prompt + Compact Hand-Drawn Aiming Chevron */}
        <div
          className={`mt-4 flex flex-col items-center text-center transition-opacity duration-300 ${
            isLaunching ? "opacity-80" : "opacity-100"
          }`}
        >
          {!isLaunching && (
            <canvas ref={arrowCanvasRef} aria-hidden="true" className="-mb-1" />
          )}
          <p
            className={`text-sm font-normal tracking-[0.22em] transition-colors duration-200 sm:text-[15px] ${
              isTargetedHighlight(activeMailbox, isReadyToRelease, isLaunching)
                ? "text-[#F3D98B]"
                : "text-[#FAF9F6]"
            }`}
          >
            {isLaunching && launchedMailbox !== null
              ? `光訊正飛往 ${launchedMailbox} 號郵筒⋯`
              : isReadyToRelease && targetedMailbox !== null
                ? `放開寄往 ${targetedMailbox} 號郵筒`
                : targetedMailbox !== null
                  ? `朝 ${targetedMailbox} 號郵筒方向滑動`
                  : "向想投遞的郵筒方向滑動寄出"}
          </p>
          <span className="mt-1 font-mono text-[9.5px] tracking-[0.22em] text-[#F3D98B]/75">
            {isLaunching && launchedMailbox !== null
              ? `LAUNCHING TO POST #${launchedMailbox}`
              : targetedMailbox !== null
                ? `SWIPE UP TO SEND · POST #${targetedMailbox}`
                : "SWIPE TOWARD MAILBOX 01–05"}
          </span>
        </div>
      </div>

      {/* BOTTOM: Tactile swipe-progress rule + clear directional instruction */}
      <div
        className={`flex flex-col items-center gap-2 px-6 transition-opacity duration-300 ${
          isLaunching ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="relative h-[5px] w-44 overflow-hidden rounded-full border border-[#FAF9F6]/30 bg-[#FAF9F6]/10">
          <div
            className="h-full bg-[#F3D98B] transition-[width] duration-75"
            style={{ width: `${Math.round(swipeProgress * 100)}%` }}
          />
        </div>
        <p className="text-center text-xs font-light tracking-[0.16em] text-[#FAF9F6]/75">
          {targetedMailbox !== null
            ? `放開信封，讓光訊飛往 ${targetedMailbox} 號郵筒`
            : "按住信封往上方 1–5 號郵筒方向滑動，即可投遞"}
        </p>
      </div>
    </div>
  );
}

function isTargetedHighlight(
  activeMailbox: MailboxNumber | null,
  isReadyToRelease: boolean,
  isLaunching: boolean
): boolean {
  return isLaunching || isReadyToRelease || activeMailbox !== null;
}
