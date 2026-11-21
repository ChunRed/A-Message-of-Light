"use client";

import React, { useEffect, useRef } from "react";
import { createSeededRng, drawSketchyRect } from "@/lib/hand-drawn-utils";

interface PencilDraftingBoxProps {
  children: React.ReactNode;
  className?: string;
}

const BLEED_PX = 8;

/**
 * Hand-drawn industrial-design pencil drafting frame matching the 30-CH sampling strip:
 * double-pass jittery pencil rectangle with subtle architectural corner overshoots.
 * Uses layout `offsetWidth`/`offsetHeight` (unaffected by entrance CSS scale transforms)
 * so all four edges stay 100% symmetrically aligned with zero clipping.
 */
export function PencilDraftingBox({
  children,
  className = "",
}: PencilDraftingBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawFrame = () => {
      // Read true layout dimensions (immune to CSS `transform: scale(...)` entrance animation!)
      const w = Math.max(1, container.offsetWidth);
      const h = Math.max(1, container.offsetHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      const cw = w + BLEED_PX * 2;
      const ch = h + BLEED_PX * 2;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const rng = createSeededRng(6127);

      // Primary warm cream-gold pencil drafting outline with architectural corner overshoots
      drawSketchyRect(ctx, BLEED_PX + 0.5, BLEED_PX + 0.5, w - 1, h - 1, rng, {
        stepPx: 16,
        jitterAmp: 0.55,
        lineWidth: 1.0,
        strokeStyle: "rgba(243, 217, 139, 0.48)",
        overshoot: 4.8,
      });

      // Secondary ghost chalk pass for authentic double-sketched pencil texture
      drawSketchyRect(
        ctx,
        BLEED_PX + 1.2,
        BLEED_PX + 1.2,
        w - 2.4,
        h - 2.4,
        rng,
        {
          stepPx: 20,
          jitterAmp: 0.75,
          lineWidth: 0.52,
          strokeStyle: "rgba(250, 249, 246, 0.18)",
          overshoot: 2.0,
        }
      );

      // Subtle inner drafting hairline inset cleanly
      drawSketchyRect(
        ctx,
        BLEED_PX + 4.5,
        BLEED_PX + 4.5,
        w - 9,
        h - 9,
        rng,
        {
          stepPx: 26,
          jitterAmp: 0.4,
          lineWidth: 0.45,
          strokeStyle: "rgba(250, 249, 246, 0.085)",
          overshoot: 0,
        }
      );
    };

    drawFrame();
    const ro = new ResizeObserver(drawFrame);
    ro.observe(container);
    window.addEventListener("resize", drawFrame);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", drawFrame);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative box-border ${className}`}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ left: -BLEED_PX, top: -BLEED_PX }}
        className="pointer-events-none absolute z-10"
      />
      <div className="relative z-20 w-full">{children}</div>
    </div>
  );
}
