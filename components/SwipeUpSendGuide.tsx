"use client";

import React, { useEffect, useRef } from "react";
import { createSeededRng, drawSketchyLine } from "@/lib/hand-drawn-utils";

interface SwipeUpSendGuideProps {
  /** Current upward drag progress [0..1] where 1 = launch threshold reached */
  swipeProgress: number;
  mailbox: number;
}

/**
 * Lively hand-drawn crayon & pencil upward arrows + motion ticks rendered at ~8fps
 * boiling-line rhythm above the sealed 3D wireframe envelope, guiding the user
 * to swipe upward to launch the letter.
 */
export function SwipeUpSendGuide({
  swipeProgress,
  mailbox,
}: SwipeUpSendGuideProps) {
  const arrowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef<number>(swipeProgress);

  useEffect(() => {
    progressRef.current = swipeProgress;
  }, [swipeProgress]);

  useEffect(() => {
    const canvas = arrowCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 132;
    const h = 128;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    let rafId = 0;
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
      // Double-pass rough crayon chevron for tactile handmade stroke weight
      for (let pass = 0; pass < 2; pass++) {
        const j = pass * 0.9;
        drawSketchyLine(
          ctx,
          cx - span + (rng() - 0.5) * j,
          cy + span * 0.78 + (rng() - 0.5) * j,
          cx + (rng() - 0.5) * j,
          cy + (rng() - 0.5) * j,
          rng,
          {
            stepPx: 5,
            jitterAmp: 0.85,
            lineWidth: pass === 0 ? width : width * 0.65,
            strokeStyle: strokeColor,
            overshoot: 1.8,
          }
        );
        drawSketchyLine(
          ctx,
          cx + (rng() - 0.5) * j,
          cy + (rng() - 0.5) * j,
          cx + span + (rng() - 0.5) * j,
          cy + span * 0.78 + (rng() - 0.5) * j,
          rng,
          {
            stepPx: 5,
            jitterAmp: 0.85,
            lineWidth: pass === 0 ? width : width * 0.65,
            strokeStyle: strokeColor,
            overshoot: 1.8,
          }
        );
      }
      ctx.restore();
    };

    const render = (now: number) => {
      rafId = window.requestAnimationFrame(render);
      const elapsed = (now - start) / 1000;
      const boil = Math.floor((now - start) / 125);
      const p = progressRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const rng = createSeededRng(5521 + (boil % 4) * 97);
      const cx = w * 0.5;

      // Subtle upward bobbing motion (lifts higher as user swipes up)
      const cycle = (elapsed * 1.15) % 1;
      const pullLift = p * 18;

      // 1. Hand-sketched broken vertical pencil tail shaft
      const shaftBottom = h - 14 - pullLift * 0.4;
      const shaftTop = 28 - pullLift * 0.7;
      const dashCount = 4;
      for (let d = 0; d < dashCount; d++) {
        const segT0 = d / dashCount;
        const segT1 = segT0 + 0.58 / dashCount;
        const y0 = shaftBottom - (shaftBottom - shaftTop) * segT0;
        const y1 = shaftBottom - (shaftBottom - shaftTop) * segT1;
        drawSketchyLine(ctx, cx, y0, cx, y1, rng, {
          stepPx: 6,
          jitterAmp: 0.75,
          lineWidth: 1.5,
          strokeStyle:
            p >= 0.95
              ? "rgba(243, 217, 139, 0.92)"
              : "rgba(250, 249, 246, 0.58)",
        });
      }

      // 2. Three staggered lively floating crayon chevrons rising upward
      for (let k = 0; k < 3; k++) {
        const phase = (cycle + k / 3) % 1;
        const y = h - 22 - phase * (h - 44) - pullLift * 0.55;
        const fadeIn = Math.min(1, phase / 0.22);
        const fadeOut = Math.min(1, (1 - phase) / 0.28);
        const alpha = fadeIn * fadeOut * (0.45 + p * 0.5);
        const span = 11 + k * 2.2;
        const color =
          k === 0 || p >= 0.85 ? "#F3D98B" : "rgba(250, 249, 246, 0.92)";
        drawCrayonArrowhead(cx, y, span, alpha, color, 2.1, rng);
      }

      // 3. Main bold hand-drawn hero arrowhead at the crest
      const heroBob = Math.sin(elapsed * 4.4) * 5.5;
      const heroY = 24 + heroBob - pullLift * 0.65;
      drawCrayonArrowhead(
        cx,
        heroY,
        17,
        0.95,
        p >= 0.9 ? "#FAF9F6" : "#F3D98B",
        2.55,
        rng
      );

      // 4. Lively flanking hand-drawn motion whiskers & tiny 4-point crayon sparks
      const sparkAlpha = 0.52 + 0.35 * Math.sin(elapsed * 5.2);
      ctx.save();
      ctx.globalAlpha = sparkAlpha;
      // Left & right angled motion dashes
      drawSketchyLine(ctx, cx - 28, heroY + 24, cx - 34, heroY + 34, rng, {
        stepPx: 5,
        jitterAmp: 0.6,
        lineWidth: 1.35,
        strokeStyle: "#F3D98B",
      });
      drawSketchyLine(ctx, cx + 28, heroY + 24, cx + 34, heroY + 34, rng, {
        stepPx: 5,
        jitterAmp: 0.6,
        lineWidth: 1.35,
        strokeStyle: "#F3D98B",
      });
      // Tiny hand-drawn 4-point star sparkles flanking the arrow
      const drawMiniStar = (sx: number, sy: number, r: number, col: string) => {
        drawSketchyLine(ctx, sx, sy - r, sx, sy + r, rng, {
          stepPx: 4,
          jitterAmp: 0.35,
          lineWidth: 1.25,
          strokeStyle: col,
        });
        drawSketchyLine(ctx, sx - r * 0.8, sy, sx + r * 0.8, sy, rng, {
          stepPx: 4,
          jitterAmp: 0.35,
          lineWidth: 1.25,
          strokeStyle: col,
        });
      };
      drawMiniStar(cx - 38, heroY + 8, 5.5, "#FAF9F6");
      drawMiniStar(cx + 39, heroY + 14, 4.8, "#F3D98B");
      ctx.restore();
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const isReadyToRelease = swipeProgress >= 0.95;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-between py-10 sm:py-14"
    >
      {/* Top animated hand-drawn crayon/pencil upward arrows above the sealed envelope */}
      <div className="animate-muji-modal-in flex flex-col items-center">
        <canvas ref={arrowCanvasRef} aria-hidden="true" />
        <p
          className={`mt-1 text-sm font-normal tracking-[0.26em] transition-colors duration-200 ${
            isReadyToRelease ? "text-[#F3D98B]" : "text-[#FAF9F6]"
          }`}
        >
          {isReadyToRelease ? "放開即可寄出信件" : "向上滑動寄出信件"}
        </p>
        <span className="mt-1 font-mono text-[9.5px] tracking-[0.22em] text-[#F3D98B]/75">
          {isReadyToRelease
            ? `RELEASE TO LAUNCH · POST #${mailbox}`
            : `SWIPE UP TO SEND · POST #${mailbox}`}
        </span>
      </div>

      {/* Bottom tactile drag-progress pencil rule + subtle hint */}
      <div className="flex flex-col items-center gap-2 px-6">
        <div className="relative h-[5px] w-44 overflow-hidden rounded-full border border-[#FAF9F6]/30 bg-[#FAF9F6]/10">
          <div
            className="h-full bg-[#F3D98B] transition-[width] duration-75"
            style={{ width: `${Math.round(swipeProgress * 100)}%` }}
          />
        </div>
        <p className="text-[11px] font-light tracking-[0.18em] text-[#FAF9F6]/65">
          按住信封向上拖曳或滑動，將光的訊息送往 {mailbox} 號郵筒
        </p>
      </div>
    </div>
  );
}
