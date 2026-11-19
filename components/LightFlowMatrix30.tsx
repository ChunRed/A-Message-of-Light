"use client";

import React, { useEffect, useRef } from "react";
import {
  get30NodeArrayState,
  LIGHT_NODE_COUNT,
  LightFlowEngine,
} from "@/lib/light-flow-engine";

interface LightFlowMatrix30Props {
  engine: LightFlowEngine;
}

export function LightFlowMatrix30({ engine }: LightFlowMatrix30Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveCountElRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let rafId = 0;
    let lastDisplayedWaves = -1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(rect.width));
      cssH = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const drawCrosshair = (cx: number, cy: number, size = 3.5) => {
      ctx.beginPath();
      ctx.moveTo(cx - size, cy);
      ctx.lineTo(cx + size, cy);
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx, cy + size);
      ctx.stroke();
    };

    const renderFrame = (now: number) => {
      // Update active wave badge directly via DOM ref (zero React re-renders)
      const activeWaves = engine.getActivePulseCount(now);
      if (activeWaves !== lastDisplayedWaves && waveCountElRef.current) {
        lastDisplayedWaves = activeWaves;
        waveCountElRef.current.textContent =
          activeWaves > 0 ? `WAVES:${activeWaves}` : "IDLE";
      }

      const nodes = get30NodeArrayState(engine, now);

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clear to crisp white
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, cssW, cssH);

      const padL = 8;
      const padR = 8;
      const padT = 14;
      const padB = 28;

      const plotW = Math.max(30, cssW - padL - padR);
      const plotH = Math.max(40, cssH - padT - padB);
      const colW = plotW / LIGHT_NODE_COUNT;
      const centerY = padT + plotH * 0.5;
      const staffSpan = plotH * 0.72;
      const staffTop = centerY - staffSpan * 0.5;
      const staffBottom = centerY + staffSpan * 0.5;

      // 1. Graphic Score 5-line horizontal staff
      for (let s = -2; s <= 2; s++) {
        const sy = Math.round(centerY + (s * staffSpan) / 4) + 0.5;
        ctx.strokeStyle = s === 0 ? "#D4D4D8" : "#ECECEF";
        ctx.lineWidth = s === 0 ? 0.9 : 0.7;
        ctx.beginPath();
        ctx.moveTo(padL, sy);
        ctx.lineTo(cssW - padR, sy);
        ctx.stroke();
      }

      // 2. 30 vertical channel reference hairlines
      ctx.strokeStyle = "#F2F2F5";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < LIGHT_NODE_COUNT; i++) {
        const cx = Math.round(padL + (i + 0.5) * colW) + 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, padT);
        ctx.lineTo(cx, padT + plotH);
        ctx.stroke();
      }

      // 3. Corner registration crosshairs (+)
      ctx.strokeStyle = "rgba(17, 17, 17, 0.55)";
      ctx.lineWidth = 0.85;
      drawCrosshair(padL + 1, padT + 1, 3.5);
      drawCrosshair(cssW - padR - 1, padT + 1, 3.5);
      drawCrosshair(padL + 1, padT + plotH - 1, 3.5);
      drawCrosshair(cssW - padR - 1, padT + plotH - 1, 3.5);

      // Top micro labels: HEAD / IN and TAIL / OUT
      ctx.font = "600 7.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "#71717A";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText("01 · HEAD / IN", padL + 6, 3);
      ctx.textAlign = "right";
      ctx.fillText("TAIL / OUT · 30", cssW - padR - 6, 3);

      // 4. Pass A: Translucent Density Halos (drawn underneath crisp black geometry)
      for (let i = 0; i < LIGHT_NODE_COUNT; i++) {
        const node = nodes[i];
        if (node.intensity <= 0) continue;

        const cx = padL + (i + 0.5) * colW;
        const { haloScale, haloOpacity } = node.shapeParams;
        const maxHaloR = Math.min(plotH * 0.44, colW * 2.25);
        const haloR = Math.max(colW * 0.25, haloScale * maxHaloR);

        ctx.fillStyle = `rgba(17, 17, 17, ${haloOpacity.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, centerY, haloR, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. Pass B: Crisp black Swiss Geometric elements per node (01..30)
      for (let i = 0; i < LIGHT_NODE_COUNT; i++) {
        const node = nodes[i];
        const cx = padL + (i + 0.5) * colW;

        if (node.intensity <= 0) {
          // Idle state: minimal 2px center black dot
          ctx.fillStyle = "rgba(17, 17, 17, 0.55)";
          ctx.beginPath();
          ctx.arc(cx, centerY, 1.0, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        const {
          ringCount,
          coreScale,
          needleAmplitude,
          barOffsetY,
          barThicknessNorm,
          isDelete,
        } = node.shapeParams;
        const alpha = 0.25 + 0.75 * node.intensity;

        // 5a. Symmetric vertical waveform needle (driven by deltaPrev)
        const needleH = needleAmplitude * (plotH * 0.46);
        if (needleH > 1.5) {
          ctx.strokeStyle = `rgba(17, 17, 17, ${Math.min(1, alpha).toFixed(3)})`;
          ctx.lineWidth = 0.9 + node.intensity * 1.1;
          ctx.beginPath();
          ctx.moveTo(cx, centerY - needleH);
          ctx.lineTo(cx, centerY + needleH);
          ctx.stroke();

          // Sharp precision end-caps when amplitude is pronounced
          if (needleAmplitude > 0.35) {
            const cap = Math.min(colW * 0.26, 2.6);
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.moveTo(cx - cap, centerY - needleH);
            ctx.lineTo(cx + cap, centerY - needleH);
            ctx.moveTo(cx - cap, centerY + needleH);
            ctx.lineTo(cx + cap, centerY + needleH);
            ctx.stroke();
          }
        }

        // 5b. Concentric rings (1..3) & solid black core dot (driven by charLength)
        const maxCoreR = Math.min(colW * 0.38, 4.8);
        const coreR = 1.0 + coreScale * maxCoreR;

        // Rings
        const ringStep = Math.min(colW * 0.3, 4.0) * (0.55 + 0.45 * node.intensity);
        for (let r = 1; r <= ringCount; r++) {
          const radius = coreR + r * Math.max(2.1, ringStep);
          const ringAlpha = Math.max(
            0.12,
            (0.85 - (r - 1) * 0.22) * node.intensity
          );
          ctx.strokeStyle = `rgba(17, 17, 17, ${ringAlpha.toFixed(3)})`;
          ctx.lineWidth = r === 1 ? 0.95 : 0.75;
          ctx.beginPath();
          ctx.arc(cx, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Solid black core dot
        ctx.fillStyle = `rgba(17, 17, 17, ${Math.min(1, 0.4 + 0.6 * node.intensity).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx, centerY, coreR, 0, Math.PI * 2);
        ctx.fill();

        // 5c. Graphic Score horizontal geometric block (driven by velocity & isDelete)
        const barY = centerY - barOffsetY * (staffSpan * 0.5);
        const clampedBarY = Math.max(staffTop + 3, Math.min(staffBottom - 3, barY));
        const barW = Math.max(5.5, colW * 0.76);
        const barH = 1.6 + barThicknessNorm * 4.4;

        if (isDelete) {
          // Deletion event: crisp hollow geometric frame + diagonal X mark
          const boxH = Math.max(5.5, barH + 2.5);
          ctx.strokeStyle = `rgba(17, 17, 17, ${Math.min(1, alpha).toFixed(3)})`;
          ctx.fillStyle = "#FFFFFF";
          ctx.lineWidth = 1.05;
          ctx.fillRect(cx - barW / 2, clampedBarY - boxH / 2, barW, boxH);
          ctx.strokeRect(cx - barW / 2, clampedBarY - boxH / 2, barW, boxH);

          // Inner X cross
          const xPad = 1.2;
          ctx.lineWidth = 0.95;
          ctx.beginPath();
          ctx.moveTo(cx - barW / 2 + xPad, clampedBarY - boxH / 2 + xPad);
          ctx.lineTo(cx + barW / 2 - xPad, clampedBarY + boxH / 2 - xPad);
          ctx.moveTo(cx + barW / 2 - xPad, clampedBarY - boxH / 2 + xPad);
          ctx.lineTo(cx - barW / 2 + xPad, clampedBarY + boxH / 2 - xPad);
          ctx.stroke();
        } else {
          // Solid black horizontal graphic-score block
          ctx.fillStyle = `rgba(17, 17, 17, ${Math.min(1, alpha).toFixed(3)})`;
          ctx.fillRect(cx - barW / 2, clampedBarY - barH / 2, barW, barH);
        }

        // 5d. Subtle channel PWM readout bar at bottom edge of plot
        const pwmH = 2.2;
        ctx.fillStyle = `rgba(17, 17, 17, ${(0.15 + 0.85 * node.intensity).toFixed(3)})`;
        ctx.fillRect(
          cx - colW * 0.34,
          padT + plotH - pwmH,
          colW * 0.68,
          pwmH
        );
      }

      // 6. Bottom channel indices 01..30 & HEAD >>> TAIL direction line
      const numY = padT + plotH + 4;
      const compactLabels = colW < 12;
      const fontSize = compactLabels ? 5.6 : colW < 16 ? 6.8 : 7.5;
      ctx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (let i = 0; i < LIGHT_NODE_COUNT; i++) {
        const cx = padL + (i + 0.5) * colW;
        const idxNum = i + 1;
        const isMajor = idxNum === 1 || idxNum === 30 || idxNum % 5 === 0;
        const active = nodes[i].intensity > 0.15;

        ctx.fillStyle = active
          ? "#111111"
          : isMajor
            ? "#52525B"
            : "#A1A1AA";

        const label = idxNum < 10 ? `0${idxNum}` : `${idxNum}`;
        ctx.fillText(label, cx, numY);
      }

      // HEAD >>> TAIL direction indicator strip along the very bottom
      const dirY = cssH - 8;
      ctx.font = "600 7px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "#52525B";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText("HEAD", padL, dirY);
      ctx.textAlign = "right";
      ctx.fillText("TAIL", cssW - padR, dirY);

      const lineStartX = padL + 26;
      const lineEndX = cssW - padR - 26;
      if (lineEndX > lineStartX + 24) {
        ctx.strokeStyle = "#D4D4D8";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(lineStartX, dirY);
        ctx.lineTo(lineEndX, dirY);
        ctx.stroke();

        // Center >>> chevron badge
        const midX = (lineStartX + lineEndX) / 2;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(midX - 18, dirY - 4, 36, 8);
        ctx.fillStyle = "#111111";
        ctx.textAlign = "center";
        ctx.fillText(">>>", midX, dirY);
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [engine]);

  return (
    <div className="relative flex h-full min-h-0 flex-col border border-[#E5E7EB] bg-white">
      {/* Top engineering bar with chamfered badge & geometric legend */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-[#FAFAFA] px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span className="hud-chamfer-sm inline-block bg-[#111111] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-white">
            30-CH LIGHT FLOW
          </span>
          <span className="hidden font-mono text-[9px] tracking-wider text-neutral-500 sm:inline">
            GRAPHIC SCORE MATRIX
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[8.5px] tracking-wider text-neutral-500">
          <span className="hidden sm:inline">◎LEN</span>
          <span className="hidden sm:inline">●DUR</span>
          <span className="hidden sm:inline">│ΔPREV</span>
          <span className="hidden sm:inline">▬VEL</span>
          <span
            ref={waveCountElRef}
            className="border border-[#D4D4D8] bg-white px-1.5 py-0.5 text-[8.5px] font-semibold tabular-nums text-[#111111]"
          >
            IDLE
          </span>
        </div>
      </div>

      {/* High-DPI 60fps Canvas */}
      <div ref={containerRef} className="relative min-h-0 flex-1 w-full">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          aria-label="30-Node Geometric Light-Flow Matrix"
        />
      </div>
    </div>
  );
}
