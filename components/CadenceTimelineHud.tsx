"use client";

import React from "react";
import { clamp, TelemetryEvent } from "@/lib/keystroke-telemetry";

interface CadenceTimelineHudProps {
  events: TelemetryEvent[];
}

const MAX_SLOTS = 40;

/**
 * Converts IKI (ms) into normalized cadence height [0.06 .. 1.0].
 * Shorter IKI -> higher audio-like peak; hesitation pause (>800ms) -> low trough.
 */
function ikiToCadenceHeight(ikiMs: number | null): number {
  if (ikiMs === null) return 0.35;
  // Log mapping: 50ms -> ~0.95, 200ms -> ~0.65, 500ms -> ~0.38, 1200ms+ -> ~0.08
  const norm = 1 - Math.log1p(Math.max(ikiMs - 30, 0)) / Math.log1p(1400);
  return clamp(norm, 0.07, 0.98);
}

export function CadenceTimelineHud({ events }: CadenceTimelineHudProps) {
  const recent = events.slice(-MAX_SLOTS);

  // SVG logical coordinate system
  const W = 400;
  const H = 170;
  const padL = 22;
  const padR = 14;
  const padT = 18;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const baselineY = padT + innerH;

  const slotStep = innerW / MAX_SLOTS;
  const barW = Math.max(3, slotStep * 0.56);

  // Align recent events to the right edge as they stream in (or left-to-right up to 40)
  const startSlot = 0;

  const points: {
    x: number;
    y: number;
    barH: number;
    ev: TelemetryEvent;
  }[] = recent.map((ev, idx) => {
    const slotIdx = startSlot + idx;
    const cx = padL + (slotIdx + 0.5) * slotStep;
    const hNorm = ikiToCadenceHeight(ev.ikiMs);
    const barH = hNorm * innerH;
    const y = baselineY - barH;
    return { x: cx, y, barH, ev };
  });

  const polylineStr = points
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const latest = points.length > 0 ? points[points.length - 1] : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col border border-[#E5E7EB] bg-[#FAFAFA]">
      {/* Chamfered top-left engineering title tag */}
      <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span className="hud-chamfer-sm inline-block bg-[#111111] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-white">
            CADENCE
          </span>
          <span className="font-mono text-[9px] tracking-wider text-neutral-500">
            LAST {MAX_SLOTS} EV
          </span>
        </div>
        <span className="font-mono text-[9px] tabular-nums text-neutral-400">
          {recent.length}/{MAX_SLOTS}
        </span>
      </div>

      {/* SVG Canvas */}
      <div className="relative flex-1 min-h-0 w-full p-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="Audio-like keystroke cadence timeline"
        >
          {/* Subtle horizontal guide lines */}
          {[0.25, 0.5, 0.75].map((ratio) => {
            const gy = padT + innerH * ratio;
            return (
              <line
                key={ratio}
                x1={padL}
                y1={gy}
                x2={W - padR}
                y2={gy}
                stroke="#E5E7EB"
                strokeWidth="0.7"
                strokeDasharray="2 3"
              />
            );
          })}

          {/* Baseline */}
          <line
            x1={padL}
            y1={baselineY}
            x2={W - padR}
            y2={baselineY}
            stroke="#111111"
            strokeWidth="0.9"
          />

          {/* Y-axis scale micro ticks */}
          <text
            x={padL - 4}
            y={padT + 4}
            fontSize="7"
            fill="#71717A"
            textAnchor="end"
            fontFamily="ui-monospace, monospace"
          >
            HI
          </text>
          <text
            x={padL - 4}
            y={baselineY}
            fontSize="7"
            fill="#71717A"
            textAnchor="end"
            fontFamily="ui-monospace, monospace"
          >
            LO
          </text>

          {/* Corner crosshairs (+) */}
          {[
            [padL, padT],
            [W - padR, padT],
            [padL, baselineY],
            [W - padR, baselineY],
          ].map(([cx, cy], i) => (
            <g key={i} stroke="#111111" strokeWidth="0.8" opacity="0.65">
              <line x1={cx - 3.5} y1={cy} x2={cx + 3.5} y2={cy} />
              <line x1={cx} y1={cy - 3.5} x2={cx} y2={cy + 3.5} />
            </g>
          ))}

          {/* Audio-like equalizer vertical bars */}
          {points.map((p, idx) => {
            const isDelete = p.ev.type === "DELETE";
            const isCompose = p.ev.type === "COMPOSE";
            const isLast = idx === points.length - 1;
            const fill = isDelete
              ? "#FCA5A5"
              : isLast
                ? "#111111"
                : isCompose
                  ? "#A1A1AA"
                  : "#D4D4D8";
            return (
              <g key={p.ev.id}>
                <rect
                  x={p.x - barW / 2}
                  y={p.y}
                  width={barW}
                  height={Math.max(2, p.barH)}
                  fill={fill}
                />
                {/* Special marker for DELETE events */}
                {isDelete && (
                  <g stroke="#DC2626" strokeWidth="1.2">
                    <line
                      x1={p.x - 2.8}
                      y1={p.y - 6.5}
                      x2={p.x + 2.8}
                      y2={p.y - 1}
                    />
                    <line
                      x1={p.x - 2.8}
                      y1={p.y - 1}
                      x2={p.x + 2.8}
                      y2={p.y - 6.5}
                    />
                  </g>
                )}
                {/* Special marker for IME COMPOSE events */}
                {isCompose && (
                  <circle
                    cx={p.x}
                    cy={p.y - 3.5}
                    r="2.2"
                    fill="#FFFFFF"
                    stroke="#111111"
                    strokeWidth="1"
                  />
                )}
              </g>
            );
          })}

          {/* Overlaid Cadence Polyline */}
          {points.length >= 2 && (
            <polyline
              points={polylineStr}
              fill="none"
              stroke="#111111"
              strokeWidth="1.25"
              strokeLinejoin="miter"
            />
          )}

          {/* Latest data point tracking crosshair reticle */}
          {latest && (
            <g>
              <line
                x1={latest.x}
                y1={padT}
                x2={latest.x}
                y2={baselineY}
                stroke="#111111"
                strokeWidth="0.6"
                strokeDasharray="2 2"
                opacity="0.45"
              />
              <g stroke="#111111" strokeWidth="1">
                <line
                  x1={latest.x - 6}
                  y1={latest.y}
                  x2={latest.x + 6}
                  y2={latest.y}
                />
                <line
                  x1={latest.x}
                  y1={latest.y - 6}
                  x2={latest.x}
                  y2={latest.y + 6}
                />
              </g>
              <circle cx={latest.x} cy={latest.y} r="2.3" fill="#111111" />
            </g>
          )}

          {/* Empty state prompt */}
          {points.length === 0 && (
            <text
              x={W / 2}
              y={H / 2 + 3}
              fontSize="9"
              fill="#A1A1AA"
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
              letterSpacing="0.12em"
            >
              AWAITING KEYSTROKE STREAM...
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
