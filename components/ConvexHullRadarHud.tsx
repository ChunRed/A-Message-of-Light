"use client";

import React from "react";
import { Point2D } from "@/lib/keystroke-telemetry";

interface ConvexHullRadarHudProps {
  points: Point2D[];
  hull: Point2D[];
}

export function ConvexHullRadarHud({ points, hull }: ConvexHullRadarHudProps) {
  const S = 180;
  const pad = 18;
  const inner = S - pad * 2;

  const toSvgX = (nx: number) => pad + nx * inner;
  const toSvgY = (ny: number) => pad + (1 - ny) * inner;

  const hullPolyStr = hull
    .map((p) => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`)
    .join(" ");

  const latest = points.length > 0 ? points[points.length - 1] : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col border border-[#E5E7EB] bg-[#FAFAFA]">
      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-2 py-1">
        <span className="hud-chamfer-sm inline-block bg-[#111111] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-white">
          HULL.2D
        </span>
        <span className="font-mono text-[9px] tabular-nums text-neutral-400">
          V:{hull.length}
        </span>
      </div>

      {/* 2D Tracking Radar SVG */}
      <div className="relative flex flex-1 min-h-0 items-center justify-center p-1">
        <svg
          viewBox={`0 0 ${S} ${S}`}
          className="h-full max-h-full w-full max-w-full"
          role="img"
          aria-label="Dynamic convex hull rhythm contour radar"
        >
          {/* Outer chamfered engineering frame (45-degree corners) */}
          <polygon
            points={`${pad + 8},${pad} ${S - pad},${pad} ${S - pad},${S - pad - 8} ${S - pad - 8},${S - pad} ${pad},${S - pad} ${pad},${pad + 8}`}
            fill="#FFFFFF"
            stroke="#D4D4D8"
            strokeWidth="0.95"
          />

          {/* 45-degree corner leader accents */}
          <polyline
            points={`${pad},${pad + 12} ${pad},${pad + 8} ${pad + 8},${pad} ${pad + 12},${pad}`}
            fill="none"
            stroke="#111111"
            strokeWidth="1.2"
          />
          <polyline
            points={`${S - pad},${S - pad - 12} ${S - pad},${S - pad - 8} ${S - pad - 8},${S - pad} ${S - pad - 12},${S - pad}`}
            fill="none"
            stroke="#111111"
            strokeWidth="1.2"
          />

          {/* Center cross axes */}
          <line
            x1={pad}
            y1={S / 2}
            x2={S - pad}
            y2={S / 2}
            stroke="#E5E7EB"
            strokeWidth="0.8"
            strokeDasharray="2 3"
          />
          <line
            x1={S / 2}
            y1={pad}
            x2={S / 2}
            y2={S - pad}
            stroke="#E5E7EB"
            strokeWidth="0.8"
            strokeDasharray="2 3"
          />

          {/* Corner crosshairs (+) */}
          {[
            [pad, pad],
            [S - pad, pad],
            [pad, S - pad],
            [S - pad, S - pad],
          ].map(([cx, cy], i) => (
            <g key={i} stroke="#111111" strokeWidth="0.9" opacity="0.7">
              <line x1={cx - 4} y1={cy} x2={cx + 4} y2={cy} />
              <line x1={cx} y1={cy - 4} x2={cx} y2={cy + 4} />
            </g>
          ))}

          {/* Axis micro labels */}
          <text
            x={S / 2}
            y={S - 5}
            fontSize="6.5"
            fill="#71717A"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            letterSpacing="0.08em"
          >
            NORM.IKI →
          </text>
          <text
            x={7}
            y={S / 2}
            fontSize="6.5"
            fill="#71717A"
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            letterSpacing="0.08em"
            transform={`rotate(-90 7 ${S / 2})`}
          >
            ΔVEL ↑
          </text>

          {/* Dynamic Convex Hull Polygon */}
          {hull.length >= 3 && (
            <polygon
              points={hullPolyStr}
              fill="#111111"
              fillOpacity="0.06"
              stroke="#111111"
              strokeWidth="1.15"
              strokeDasharray="3 2"
            />
          )}
          {hull.length === 2 && (
            <line
              x1={toSvgX(hull[0].x)}
              y1={toSvgY(hull[0].y)}
              x2={toSvgX(hull[1].x)}
              y2={toSvgY(hull[1].y)}
              stroke="#111111"
              strokeWidth="1.15"
              strokeDasharray="3 2"
            />
          )}

          {/* Historical sample points */}
          {points.map((pt, idx) => {
            const isRecent = idx >= points.length - 6;
            const cx = toSvgX(pt.x);
            const cy = toSvgY(pt.y);
            return (
              <circle
                key={pt.eventId}
                cx={cx}
                cy={cy}
                r={isRecent ? 1.8 : 1.3}
                fill={pt.type === "DELETE" ? "#DC2626" : "#111111"}
                opacity={isRecent ? 0.8 : 0.28}
              />
            );
          })}

          {/* Convex Hull Vertex Circles */}
          {hull.map((v) => (
            <circle
              key={`hull-${v.eventId}`}
              cx={toSvgX(v.x)}
              cy={toSvgY(v.y)}
              r="2.6"
              fill="#FFFFFF"
              stroke="#111111"
              strokeWidth="1.1"
            />
          ))}

          {/* Active Tracking Reticle on Latest Point */}
          {latest && (
            <g>
              <line
                x1={toSvgX(latest.x) - 7}
                y1={toSvgY(latest.y)}
                x2={toSvgX(latest.x) + 7}
                y2={toSvgY(latest.y)}
                stroke="#111111"
                strokeWidth="0.95"
              />
              <line
                x1={toSvgX(latest.x)}
                y1={toSvgY(latest.y) - 7}
                x2={toSvgX(latest.x)}
                y2={toSvgY(latest.y) + 7}
                stroke="#111111"
                strokeWidth="0.95"
              />
              <circle
                cx={toSvgX(latest.x)}
                cy={toSvgY(latest.y)}
                r="2.2"
                fill="#111111"
              />
            </g>
          )}

          {/* Empty state */}
          {points.length === 0 && (
            <text
              x={S / 2}
              y={S / 2 + 3}
              fontSize="7.5"
              fill="#A1A1AA"
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              NO DATA
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
