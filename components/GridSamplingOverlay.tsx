"use client";

import React, { useEffect, useRef } from "react";
import {
  drawIndustrialSketch30Strip,
  GridSamplingResult,
  LED_CHANNEL_COUNT,
  QUADTREE_MAX_DEPTH,
} from "@/lib/grid-sampling";
import {
  createSeededRng,
  drawSketchyLine,
  drawSketchyRect,
} from "@/lib/hand-drawn-utils";

export interface LiveLetterRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GridSamplingOverlayProps {
  samplingResult: GridSamplingResult;
  /** Reads the live (shrunk & lifted) letter DOM rect every frame for 0px drift */
  getLiveLetterRect: () => LiveLetterRect | null;
  /** Target Y coordinate cleanly below the letter and above the confirmation card */
  settledStripCenterY: number;
  onComplete: () => void;
}

const TOTAL_DURATION_MS = 2680;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Draws a jittery hand-sketched polyline along a sequence of control points,
 * clipping smoothly to `progress` [0..1] for progressive callout line drawing.
 */
function drawProgressiveSketchyPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  progress: number,
  rng: () => number,
  opts: {
    stepPx: number;
    jitterAmp: number;
    lineWidth: number;
    strokeStyle: string;
  }
): void {
  if (pts.length < 2 || progress <= 0.005) return;

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen < 0.5) return;

  let remaining = totalLen * clamp01(progress);
  for (let i = 0; i < segLens.length && remaining > 0.25; i++) {
    const segLen = segLens[i];
    if (segLen < 0.25) continue;
    const frac = Math.min(1, remaining / segLen);
    const x1 = pts[i].x;
    const y1 = pts[i].y;
    const x2 = x1 + (pts[i + 1].x - x1) * frac;
    const y2 = y1 + (pts[i + 1].y - y1) * frac;

    drawSketchyLine(ctx, x1, y1, x2, y2, rng, {
      stepPx: opts.stepPx,
      jitterAmp: opts.jitterAmp,
      lineWidth: opts.lineWidth,
      strokeStyle: opts.strokeStyle,
    });
    remaining -= segLen;
  }
}

export function GridSamplingOverlay({
  samplingResult,
  getLiveLetterRect,
  settledStripCenterY,
  onComplete,
}: GridSamplingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  const getRectRef = useRef(getLiveLetterRect);
  const stripYRef = useRef(settledStripCenterY);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    getRectRef.current = getLiveLetterRect;
  }, [getLiveLetterRect]);

  useEffect(() => {
    stripYRef.current = settledStripCenterY;
  }, [settledStripCenterY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let vpW = window.innerWidth;
    let vpH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    let finished = false;

    const syncViewportSize = () => {
      vpW = Math.max(1, window.innerWidth);
      vpH = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2.25);

      canvas.width = Math.round(vpW * dpr);
      canvas.height = Math.round(vpH * dpr);
      canvas.style.width = `${vpW}px`;
      canvas.style.height = `${vpH}px`;
    };

    syncViewportSize();
    window.addEventListener("resize", syncViewportSize);

    const {
      quadtreeLeaves,
      channelLinks,
      ledValues,
      normGridRect,
      maxDepthReached,
    } = samplingResult;

    // Select ONLY the top 8 most complex / detail-rich channels for subtle leader lines
    // so the drawing stays the visual hero and lines never clutter the composition.
    const topLeaderLinks = channelLinks
      .filter((l) => l.hasFeature && l.value > 0)
      .sort((a, b) => {
        const scoreA =
          a.detailScore * 0.52 +
          (a.value / 255) * 0.34 +
          (a.leafDepth / QUADTREE_MAX_DEPTH) * 0.14;
        const scoreB =
          b.detailScore * 0.52 +
          (b.value / 255) * 0.34 +
          (b.leafDepth / QUADTREE_MAX_DEPTH) * 0.14;
        return scoreB - scoreA;
      })
      .slice(0, 8)
      .sort((a, b) => a.channelIndex - b.channelIndex);

    const startTime = performance.now();
    let rafId = 0;

    const render = (now: number) => {
      rafId = window.requestAnimationFrame(render);
      const elapsed = now - startTime;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vpW, vpH);

      const letterRect = getRectRef.current();
      if (!letterRect || letterRect.width < 20 || letterRect.height < 20) {
        return;
      }

      // Gentle ~7fps hand-drawn pencil "boiling line" rhythm so every line feels alive & handmade
      const boilStep = Math.floor(elapsed / 145);

      const lx = letterRect.left;
      const ly = letterRect.top;
      const lw = letterRect.width;
      const lh = letterRect.height;
      const letterBottom = ly + lh;

      // Phase 1 (120ms -> 1420ms): Quadtree depth-by-depth bloom over the letter's strokes
      const qtGlobalP = clamp01((elapsed - 120) / 1300);

      // Phase 2 (760ms -> 1700ms): 30-CH strip reveals left -> right
      const stripRevealP = easeOutCubic(clamp01((elapsed - 760) / 940));
      const revealCount = stripRevealP * LED_CHANNEL_COUNT;

      // Phase 3 (1520ms -> 2360ms): 30-CH strip glides smoothly to its dedicated slot BELOW the letter
      // Strictly respects `stripYRef.current` so the strip plate NEVER overlaps the bottom confirm card!
      const moveDownP = easeInOutCubic(clamp01((elapsed - 1520) / 840));
      const targetStripY = stripYRef.current;
      const startStripY = Math.min(targetStripY, letterBottom + 36);
      const currentStripY = startStripY + (targetStripY - startStripY) * moveDownP;

      // Phase 4 (1850ms -> 2620ms): Leader lines draw from Quadtree stroke features -> 30-CH strip
      const leaderP = easeInOutCubic(clamp01((elapsed - 1850) / 760));

      // Match the bottom confirmation card's horizontal geometry (px-4 sm:px-6, max-w-[520px])
      // so the 30-CH drafting plate and confirmation box align vertically on left & right edges!
      const horizPad = vpW < 640 ? 16 : 24;
      const targetPlateW = Math.min(520, Math.max(240, vpW - horizPad * 2));
      const stripW = targetPlateW / 1.048; // plateW = stripW + 2 * (stripW * 0.024)
      const stripBlockH = Math.max(15, Math.min(21, vpH * 0.025));
      const stripCenterX = vpW * 0.5;

      // =====================================================================
      // 1. PERSISTENT INDUSTRIAL-SKETCH QUADTREE OVERLAY ON THE LETTER SHEET
      //    (Refined & softly translucent so the user's strokes stay primary)
      // =====================================================================
      if (qtGlobalP > 0.005) {
        const frameRng = createSeededRng(8101 + (boilStep % 3) * 41);

        // Outer architectural sampling frame with corner overshoot hairlines
        const gx = lx + normGridRect.nx * lw;
        const gy = ly + normGridRect.ny * lh;
        const gw = normGridRect.nw * lw;
        const gh = normGridRect.nh * lh;

        const frameAlpha = easeOutCubic(clamp01(qtGlobalP * 2.8));
        drawSketchyRect(ctx, gx, gy, gw, gh, frameRng, {
          stepPx: 18,
          jitterAmp: 0.55,
          lineWidth: 0.78,
          strokeStyle: `rgba(34, 34, 34, ${(0.2 * frameAlpha).toFixed(3)})`,
          overshoot: 4.5,
        });

        // Subtle industrial-sketch header tag right above the Quadtree frame
        ctx.save();
        ctx.font = '400 7.5px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillStyle = `rgba(34, 34, 34, ${(0.4 * frameAlpha).toFixed(3)})`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          `QT-SUBDIV // DEPTH 0–${Math.max(1, maxDepthReached)} · ${quadtreeLeaves.length} NODES`,
          gx + 2,
          gy - 4
        );
        ctx.restore();

        // Draw each Quadtree leaf cell progressively by depth (depth 1 -> 5)
        for (let i = 0; i < quadtreeLeaves.length; i++) {
          const leaf = quadtreeLeaves[i];
          const depthThreshold =
            (Math.max(0, leaf.depth - 1) / Math.max(1, QUADTREE_MAX_DEPTH)) *
            0.72;
          const cellReveal = easeOutCubic(
            clamp01((qtGlobalP - depthThreshold) / 0.28)
          );
          if (cellReveal <= 0.01) continue;

          const cx = lx + leaf.nx * lw;
          const cy = ly + leaf.ny * lh;
          const cw = leaf.nw * lw;
          const ch = leaf.nh * lh;
          if (cw < 2 || ch < 2) continue;

          const cellRng = createSeededRng(
            leaf.id * 131 + (boilStep % 3) * 29
          );

          // Delicate translucent graphite pencil boxes so the drawing remains hero
          const strokeAlpha = leaf.hasInk
            ? (0.12 +
                (leaf.depth / QUADTREE_MAX_DEPTH) * 0.22 +
                leaf.detailScore * 0.1) *
              cellReveal
            : 0.072 * cellReveal;
          const strokeWidth = leaf.hasInk
            ? 0.55 + (leaf.depth / QUADTREE_MAX_DEPTH) * 0.28
            : 0.48;

          drawSketchyRect(ctx, cx, cy, cw, ch, cellRng, {
            stepPx: Math.max(6, Math.min(cw, ch) * 0.55),
            jitterAmp: leaf.hasInk ? 0.42 : 0.32,
            lineWidth: strokeWidth,
            strokeStyle: `rgba(34, 34, 34, ${Math.min(0.42, strokeAlpha).toFixed(3)})`,
            overshoot: leaf.hasInk && cw > 12 ? 1.4 : 0.5,
          });

          // Whisper-soft warm pencil highlight inside high-detail deep leaves
          if (leaf.hasInk && leaf.detailScore > 0.24 && cw >= 8 && ch >= 8) {
            ctx.save();
            ctx.fillStyle = `rgba(214, 174, 92, ${(0.03 + leaf.detailScore * 0.065) * cellReveal})`;
            ctx.fillRect(cx + 0.8, cy + 0.8, cw - 1.6, ch - 1.6);

            // Corner diagonal pencil tick marks (drafting emphasis)
            const tick = Math.min(4.0, cw * 0.26, ch * 0.26);
            ctx.strokeStyle = `rgba(34, 34, 34, ${(0.17 * cellReveal).toFixed(3)})`;
            ctx.lineWidth = 0.55;
            ctx.beginPath();
            ctx.moveTo(cx + 1.5, cy + tick + 1.5);
            ctx.lineTo(cx + tick + 1.5, cy + 1.5);
            ctx.moveTo(cx + cw - tick - 1.5, cy + ch - 1.5);
            ctx.lineTo(cx + cw - 1.5, cy + ch - tick - 1.5);
            ctx.stroke();
            ctx.restore();
          }

          // Micro depth notation on medium-sized active leaves
          if (leaf.hasInk && cw >= 28 && ch >= 18) {
            ctx.save();
            ctx.font = '400 5.8px "IBM Plex Mono", ui-monospace, monospace';
            ctx.fillStyle = `rgba(34, 34, 34, ${(0.28 * cellReveal).toFixed(3)})`;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(`D${leaf.depth}`, cx + 2.5, cy + 2);
            ctx.restore();
          }
        }
      }

      // =====================================================================
      // 2. INDUSTRIAL-DESIGN SKETCH 30-CH STRIP (CLEANLY BELOW THE LETTER!)
      // =====================================================================
      const stripGeom = drawIndustrialSketch30Strip(
        ctx,
        ledValues,
        stripCenterX,
        currentStripY,
        stripW,
        stripBlockH,
        revealCount,
        stripRevealP > 0 ? 1 : 0,
        boilStep,
        "dark-cardstock"
      );

      // =====================================================================
      // 3. SUBTLE HAND-DRAWN 45° LEADER LINES (TOP 8 MOST COMPLEX FEATURES)
      // =====================================================================
      if (leaderP > 0.005 && topLeaderLinks.length > 0) {
        // Soft traveling highlight pulse across the 8 linked channels once settled
        const pulseIdx = finished
          ? (elapsed * 0.0018) % topLeaderLinks.length
          : -10;

        for (let idx = 0; idx < topLeaderLinks.length; idx++) {
          const link = topLeaderLinks[idx];
          const chIndex = link.channelIndex;

          // Stagger each leader line gently left-to-right
          const staggerDelay =
            (idx / Math.max(1, topLeaderLinks.length)) * 0.36;
          const localP = easeOutCubic(
            clamp01((leaderP - staggerDelay) / (1 - staggerDelay))
          );
          if (localP <= 0.01) continue;

          const ax = lx + link.anchorNx * lw;
          const ay = ly + link.anchorNy * lh;
          const targetAnchor = stripGeom.getChannelTopAnchor(chIndex);
          const tx = targetAnchor.x;
          const ty = targetAnchor.y;

          const richness = link.value / 255;
          const pulseDist = Math.abs(idx - pulseIdx);
          const pulseBoost = pulseDist < 1.35 ? (1 - pulseDist / 1.35) * 0.14 : 0;

          const linkRng = createSeededRng(
            9401 + chIndex * 73 + (boilStep % 3) * 37
          );

          // Build a clean 45°-chamfered path (ZERO 90° right-angle bends!):
          // Vertical drop -> exact 45° diagonal (|dx| == |dy|) -> short vertical stub into channel tick
          const dx = tx - ax;
          const absDx = Math.abs(dx);
          const totalVert = Math.max(8, ty - ay);
          const stubLen = Math.min(8, Math.max(4, (ty - letterBottom) * 0.24));
          const maxDiagVert = Math.max(0, totalVert - stubLen - 6);

          const pathPts: Array<{ x: number; y: number }> = [
            { x: ax, y: ay + 2.8 },
          ];

          if (absDx <= 2.2) {
            pathPts.push({ x: tx, y: ty });
          } else if (absDx <= maxDiagVert) {
            // True 45° chamfered turn: diagonal vertical run === horizontal run (absDx)
            const yDiagEnd = ty - stubLen;
            const yDiagStart = yDiagEnd - absDx;
            if (yDiagStart > ay + 5) {
              pathPts.push({ x: ax, y: yDiagStart });
            }
            pathPts.push({ x: tx, y: yDiagEnd });
            pathPts.push({ x: tx, y: ty });
          } else {
            // Wide horizontal span: start a 45° diagonal downward as far as vertical budget allows,
            // then angle softly into the stub without any 90° bend
            const yMid = Math.max(ay + 5, letterBottom + 3);
            const diagSpan = Math.min(absDx * 0.65, Math.max(4, ty - stubLen - yMid));
            const dir = dx >= 0 ? 1 : -1;
            pathPts.push({ x: ax, y: yMid });
            pathPts.push({ x: ax + dir * diagSpan, y: yMid + diagSpan });
            pathPts.push({ x: tx, y: ty - stubLen * 0.5 });
            pathPts.push({ x: tx, y: ty });
          }

          // A. Delicate graphite target ring on the sampled stroke feature
          ctx.save();
          const dotR = 2.0 + richness * 0.9;
          ctx.strokeStyle = `rgba(34, 34, 34, ${(0.38 + pulseBoost * 0.25).toFixed(3)})`;
          ctx.lineWidth = 0.72;
          ctx.beginPath();
          ctx.arc(ax, ay, dotR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = `rgba(214, 174, 92, ${(0.48 + pulseBoost * 0.3).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(ax, ay, 1.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // B. Clip pass 1: inside the warm paper (whisper-thin graphite pencil line)
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, vpW, letterBottom);
          ctx.clip();
          drawProgressiveSketchyPolyline(ctx, pathPts, localP, linkRng, {
            stepPx: 12,
            jitterAmp: 0.38,
            lineWidth: 0.56,
            strokeStyle: `rgba(34, 34, 34, ${(0.14 + richness * 0.1 + pulseBoost * 0.16).toFixed(3)})`,
          });
          ctx.restore();

          // C. Clip pass 2: below the paper in dark void (delicate faded warm-gold/chalk line)
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, letterBottom, vpW, Math.max(1, vpH - letterBottom));
          ctx.clip();
          const chalkAlpha = Math.min(
            0.46,
            0.16 + richness * 0.16 + pulseBoost
          );
          drawProgressiveSketchyPolyline(ctx, pathPts, localP, linkRng, {
            stepPx: 10,
            jitterAmp: 0.42,
            lineWidth: 0.65 + pulseBoost * 0.25,
            strokeStyle: `rgba(243, 217, 139, ${chalkAlpha.toFixed(3)})`,
          });

          // Tiny subtle chalk endpoint dot on the channel rail
          if (localP > 0.92) {
            ctx.fillStyle = `rgba(243, 217, 139, ${Math.min(0.62, chalkAlpha + 0.12).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(tx, ty, 1.3 + pulseBoost * 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      if (elapsed >= TOTAL_DURATION_MS && !finished) {
        finished = true;
        onCompleteRef.current();
      }
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", syncViewportSize);
    };
  }, [samplingResult]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-30 block h-full w-full"
      aria-hidden="true"
    />
  );
}
