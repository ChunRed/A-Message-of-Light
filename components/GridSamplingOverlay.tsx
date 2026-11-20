"use client";

import React, { useEffect, useRef } from "react";
import {
  drawCentered30UnitStrip,
  GridSamplingResult,
  LED_CHANNEL_COUNT,
  SETTLED_STRIP_Y_RATIO,
} from "@/lib/grid-sampling";
import {
  createSeededRng,
  drawSketchyLine,
  drawSketchyRect,
} from "@/lib/hand-drawn-utils";

interface GridSamplingOverlayProps {
  samplingResult: GridSamplingResult;
  onComplete: () => void;
}

const TOTAL_DURATION_MS = 2620;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function GridSamplingOverlay({
  samplingResult,
  onComplete,
}: GridSamplingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 1;
    let h = 1;
    let dpr = 1;
    let finished = false;

    const syncCanvasSize = () => {
      const rect = parent.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      if (finished) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawCentered30UnitStrip(
          ctx,
          samplingResult.ledValues,
          w,
          h,
          LED_CHANNEL_COUNT,
          1,
          SETTLED_STRIP_Y_RATIO
        );
      }
    };

    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(parent);

    const { activeCells, gridRect, ledValues } = samplingResult;
    const startTime = performance.now();
    let rafId = 0;

    const render = (now: number) => {
      const elapsed = now - startTime;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Phase A1 (0ms -> 1050ms): Vertical scanline sweeps left -> right across stationery grid
      const scanP = easeInOutQuad(clamp01(elapsed / 1050));
      const scanX = gridRect.x + scanP * gridRect.w;

      // Grid quantization micro-telemetry fades cleanly (960ms -> 1640ms)
      // while the user's ORIGINAL hand-drawn strokes remain 100% visible underneath!
      const telemetryFadeOut = easeInOutQuad(clamp01((elapsed - 960) / 680));
      const telemetryAlpha = 1 - telemetryFadeOut;

      // Phase A2 (520ms -> 1680ms): 30-unit horizontal strip materializes sequentially at center
      const stripRevealP = easeOutCubic(clamp01((elapsed - 520) / 1160));
      const revealCount = stripRevealP * LED_CHANNEL_COUNT;

      // Phase A3 (1720ms -> 2520ms): Translate entire 30-unit strip smoothly down to comparison slot
      const moveDownP = easeInOutCubic(clamp01((elapsed - 1720) / 800));
      const currentYRatio = 0.5 + (SETTLED_STRIP_Y_RATIO - 0.5) * moveDownP;
      const stripCenterY = h * currentYRatio;

      // Convergence hairlines pulse briefly from active cells toward strip center (640ms -> 1580ms)
      const convergeIn = clamp01((elapsed - 640) / 320);
      const convergeOut = 1 - clamp01((elapsed - 1180) / 420);
      const convergeAlpha = convergeIn * convergeOut * 0.28;

      const stripPadX = Math.max(20, w * 0.072);
      const stripW = w - stripPadX * 2;

      // 1. Draw quantized grid cell micro-telemetry boxes & matrix bars (fades out so strokes stay pure)
      if (telemetryAlpha > 0.01) {
        const boilStep = Math.floor(elapsed / 120);
        const scanRng = createSeededRng(7001 + boilStep * 19);

        ctx.save();
        for (let i = 0; i < activeCells.length; i++) {
          const cell = activeCells[i];
          const cellMidX = cell.x + cell.w * 0.5;
          if (cellMidX > scanX + 4) continue;

          const appear = clamp01((scanX - cellMidX + 18) / 42);
          const cellAlpha = appear * telemetryAlpha;
          if (cellAlpha <= 0.01) continue;

          // Subtle hand-sketched quantized cell hairline box
          const cellRng = createSeededRng(cell.col * 97 + cell.row * 31 + (boilStep % 3) * 13);
          drawSketchyRect(ctx, cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2, cellRng, {
            stepPx: 10,
            jitterAmp: 0.45,
            lineWidth: 0.78,
            strokeStyle: `rgba(34, 34, 34, ${(0.25 * cellAlpha).toFixed(3)})`,
          });

          // Micro-telemetry matrix vertical bars inside the quantized grid cell
          const barCount = 4;
          const innerPad = 3.5;
          const usableW = Math.max(4, cell.w - innerPad * 2);
          const barStep = usableW / barCount;
          const maxBarH = Math.max(3, cell.h - 10);

          ctx.fillStyle = `rgba(34, 34, 34, ${(0.18 + cell.density * 0.48) * cellAlpha})`;
          for (let b = 0; b < barCount; b++) {
            const mod =
              0.45 +
              0.55 * Math.abs(Math.sin(cell.col * 7 + cell.row * 13 + b * 3.1));
            const bh = Math.max(1.5, maxBarH * cell.density * mod);
            const bx = cell.x + innerPad + b * barStep;
            const by = cell.y + cell.h - 3 - bh;
            ctx.fillRect(bx, by, Math.max(1.2, barStep * 0.52), bh);
          }

          if (cell.density > 0.22 && cell.w >= 20) {
            ctx.fillStyle = `rgba(34, 34, 34, ${(0.55 * cellAlpha).toFixed(3)})`;
            ctx.font = '400 5.5px "IBM Plex Mono", ui-monospace, monospace';
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const code = String(Math.round(cell.density * 99)).padStart(2, "0");
            ctx.fillText(code, cell.x + 2.5, cell.y + 2);
          }

          // Subtle convergence hairline from cell to its corresponding 30-CH bucket
          if (convergeAlpha > 0.01 && cell.density > 0.16) {
            const targetX =
              stripPadX +
              ((cell.channelIndex + 0.5) / LED_CHANNEL_COUNT) * stripW;
            ctx.strokeStyle = `rgba(34, 34, 34, ${(convergeAlpha * cell.density).toFixed(3)})`;
            ctx.lineWidth = 0.65;
            ctx.beginPath();
            ctx.moveTo(cellMidX, cell.y + cell.h * 0.5);
            ctx.lineTo(targetX, stripCenterY);
            ctx.stroke();
          }
        }

        // Hand-sketched 1px vertical sweep scanline
        if (elapsed < 1280) {
          const scanFade = 1 - clamp01((elapsed - 960) / 320);
          drawSketchyLine(
            ctx,
            Math.round(scanX) + 0.5,
            gridRect.y - 6,
            Math.round(scanX) + 0.5,
            gridRect.y + gridRect.h + 6,
            scanRng,
            {
              stepPx: 14,
              jitterAmp: 0.75,
              lineWidth: 1.05,
              strokeStyle: `rgba(34, 34, 34, ${(0.68 * scanFade).toFixed(3)})`,
            }
          );

          const activeCh = Math.min(
            LED_CHANNEL_COUNT,
            Math.max(1, Math.ceil(scanP * LED_CHANNEL_COUNT))
          );
          ctx.fillStyle = `rgba(34, 34, 34, ${(0.72 * scanFade).toFixed(3)})`;
          ctx.font = '400 8.5px "IBM Plex Mono", ui-monospace, monospace';
          ctx.textBaseline = "bottom";
          ctx.textAlign = scanP > 0.78 ? "right" : "left";
          const tx = scanP > 0.78 ? scanX - 5 : scanX + 5;
          ctx.fillText(
            `SCAN // CH.${String(activeCh).padStart(2, "0")}`,
            tx,
            gridRect.y - 8
          );
        }
        ctx.restore();
      }

      // 2. Draw the 30-unit horizontal grayscale strip (forms at center -> translates smoothly downward)
      if (revealCount > 0) {
        drawCentered30UnitStrip(
          ctx,
          ledValues,
          w,
          h,
          revealCount,
          1,
          currentYRatio
        );
      }

      if (elapsed >= TOTAL_DURATION_MS) {
        if (!finished) {
          finished = true;
          // Ensure exact crisp settled frame remains visible during Step B save confirmation
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          drawCentered30UnitStrip(
            ctx,
            ledValues,
            w,
            h,
            LED_CHANNEL_COUNT,
            1,
            SETTLED_STRIP_Y_RATIO
          );
          onCompleteRef.current();
        }
        return;
      }

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [samplingResult]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-30 block h-full w-full"
      aria-hidden="true"
    />
  );
}
