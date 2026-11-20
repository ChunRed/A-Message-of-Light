"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BRUSH_TYPES,
  BrushParams,
  BrushType,
  drawProceduralSegment,
  ProceduralStrokePoint,
  renderPreviewSCurve,
  stampProceduralDab,
} from "@/lib/procedural-brushes";

interface BrushCustomizerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  params: BrushParams;
  onChangeParams: (next: Partial<BrushParams>) => void;
  onSelectBrushType: (type: BrushType) => void;
  className?: string;
}

export function BrushCustomizerPanel({
  isOpen,
  onClose,
  params,
  onChangeParams,
  onSelectBrushType,
  className = "",
}: BrushCustomizerPanelProps) {
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasUserTestDraw, setHasUserTestDraw] = useState(false);

  // Pointer test-drawing refs inside live preview canvas
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef<ProceduralStrokePoint | null>(null);
  const stepCounterRef = useRef(0);
  const previewDimsRef = useRef({ width: 260, height: 84, dpr: 2 });

  const redrawDemoCurve = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const wrap = previewWrapRef.current;
    if (!canvas || !wrap) return;

    const rect = wrap.getBoundingClientRect();
    const w = Math.max(180, Math.floor(rect.width));
    const h = Math.max(76, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    previewDimsRef.current = { width: w, height: h, dpr };

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderPreviewSCurve(ctx, w, h, params);
    setHasUserTestDraw(false);
  }, [params]);

  // 60fps reactive re-render via requestAnimationFrame whenever any brush param changes
  useEffect(() => {
    if (!isOpen) return;
    const raf = window.requestAnimationFrame(() => {
      redrawDemoCurve();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen, redrawDemoCurve]);

  // Direct trial drawing inside the preview canvas
  const getPreviewPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): ProceduralStrokePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.55,
      timestamp: performance.now(),
    };
  };

  const handlePreviewPointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const canvas = previewCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    e.preventDefault();
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);

    const { width, height, dpr } = previewDimsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear demo S-curve on the first trial stroke so the box is fresh for user testing
    if (!hasUserTestDraw) {
      ctx.clearRect(0, 0, width, height);
      setHasUserTestDraw(true);
    }

    const pt = getPreviewPoint(e);
    isDrawingRef.current = true;
    lastPtRef.current = pt;
    stepCounterRef.current = 0;

    stampProceduralDab(ctx, pt.x, pt.y, 0, 0.3, params, 0, pt.pressure);
  };

  const handlePreviewPointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const lastPt = lastPtRef.current;
    if (!canvas || !ctx || !lastPt) return;

    e.preventDefault();
    const pt = getPreviewPoint(e);
    stepCounterRef.current = drawProceduralSegment(
      ctx,
      lastPt,
      pt,
      params,
      stepCounterRef.current
    );
    lastPtRef.current = pt;
  };

  const handlePreviewPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPtRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const currentMeta =
    BRUSH_TYPES.find((b) => b.id === params.type) ?? BRUSH_TYPES[0];

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="筆刷實驗室 Brush Customizer"
      className={`sketch-card animate-muji-modal-in absolute z-40 w-[min(92vw,320px)] border border-[#222222] bg-[#FDFCF9] p-3.5 text-[#222222] ${
        className || "bottom-full left-1/2 mb-2.5 -translate-x-1/2 sm:left-0 sm:translate-x-0"
      }`}
    >
      {/* Panel Header */}
      <div className="mb-2.5 flex items-center justify-between border-b border-dashed border-[#222222]/20 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-normal tracking-[0.18em] text-[#222222]">
            筆刷實驗室
          </span>
          <span className="font-mono text-[9px] tracking-[0.16em] text-[#8C8C8A]">
            BRUSH LAB
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉筆刷實驗室"
          className="sketch-pill flex h-6 w-6 items-center justify-center border border-[#222222]/30 bg-white text-[#222222] transition-colors hover:border-[#222222]"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.1 2.2C4.2 4.1 6.1 6.2 8 7.9M7.9 2.1C5.9 4.3 4 6.1 2 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* 1. Live 60fps Preview Canvas (Auto S-curve + Interactive Trial Drawing) */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between font-mono text-[9px] tracking-[0.14em] text-[#8C8C8A]">
          <span>LIVE PREVIEW · {currentMeta.enLabel}</span>
          <button
            type="button"
            onClick={redrawDemoCurve}
            className="text-[#8C8C8A] underline decoration-[#DCDCD7] decoration-dashed underline-offset-2 transition-colors hover:text-[#222222]"
          >
            {hasUserTestDraw ? "重繪範例" : "框內可試畫"}
          </button>
        </div>

        <div
          ref={previewWrapRef}
          className="sketch-card relative h-[86px] w-full overflow-hidden border border-[#222222] bg-[#FAF9F6]"
        >
          <canvas
            ref={previewCanvasRef}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={handlePreviewPointerUp}
            onPointerCancel={handlePreviewPointerUp}
            style={{ touchAction: "none" }}
            className="block h-full w-full cursor-crosshair select-none"
            aria-label="即時筆跡預覽與試畫區"
          />
          {/* Subtle tilt angle indicator icon in bottom-right of preview */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-2 bottom-1.5 flex items-center gap-1 font-mono text-[8.5px] text-[#8C8C8A]"
          >
            <span
              className="inline-block h-[1.5px] w-3 bg-[#222222]"
              style={{ transform: `rotate(${params.tiltAngle}deg)` }}
            />
            <span>{params.tiltAngle > 0 ? `+${params.tiltAngle}°` : `${params.tiltAngle}°`}</span>
          </div>
        </div>
      </div>

      {/* 2. 5 Procedural Brush Selector Pills */}
      <div className="mb-3">
        <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="選擇筆種">
          {BRUSH_TYPES.map((brush) => {
            const active = params.type === brush.id;
            return (
              <button
                key={brush.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelectBrushType(brush.id)}
                className={`sketch-card flex flex-col items-center justify-center border py-1.5 transition-all duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] active:scale-95 ${
                  active
                    ? "border-[#222222] bg-[#222222] text-[#FAF9F6]"
                    : "border-[#222222]/25 bg-white text-[#222222] hover:border-[#222222]"
                }`}
              >
                <span className="text-[11px] font-normal tracking-[0.06em]">
                  {brush.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] font-light tracking-[0.08em] text-[#8C8C8A]">
          {currentMeta.hint}
        </p>
      </div>

      {/* 3. Four Fine-Line Parameter Sliders */}
      <div className="space-y-2.5 border-t border-dashed border-[#222222]/20 pt-2.5">
        {/* Noise Size */}
        <SliderRow
          label="噪點大小"
          sub="NOISE"
          valueDisplay={`${params.noiseSize}`}
          min={1}
          max={100}
          value={params.noiseSize}
          onChange={(v) => onChangeParams({ noiseSize: v })}
        />

        {/* Edge Roughness */}
        <SliderRow
          label="毛邊大小"
          sub="EDGE"
          valueDisplay={`${params.edgeRoughness}`}
          min={0}
          max={100}
          value={params.edgeRoughness}
          onChange={(v) => onChangeParams({ edgeRoughness: v })}
        />

        {/* Tilt Angle */}
        <SliderRow
          label="傾斜方向"
          sub="TILT"
          valueDisplay={`${params.tiltAngle > 0 ? `+${params.tiltAngle}` : params.tiltAngle}°`}
          min={-90}
          max={90}
          value={params.tiltAngle}
          onChange={(v) => onChangeParams({ tiltAngle: v })}
        />

        {/* Random Seed (Mulberry32 PRNG) */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-normal tracking-[0.08em] text-[#222222]">
                亂數種子
              </span>
              <span className="font-mono text-[8.5px] tracking-[0.14em] text-[#8C8C8A]">
                SEED
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10.5px] tabular-nums text-[#222222]">
                #{String(params.randomSeed).padStart(4, "0")}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChangeParams({
                    randomSeed: Math.floor(1 + Math.random() * 9999),
                  })
                }
                title="隨機切換種子"
                aria-label="隨機切換亂數種子"
                className="flex h-5 w-5 items-center justify-center rounded-full border border-[#E2E2DE] text-[#222222] transition-colors hover:border-[#222222] active:scale-90"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 4H8.5L7 2.5M10 8H3.5L5 9.5"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={9999}
            step={1}
            value={params.randomSeed}
            onChange={(e) =>
              onChangeParams({ randomSeed: Number(e.target.value) })
            }
            className="muji-slider mt-0.5"
            aria-label="亂數種子數值"
          />
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  sub,
  valueDisplay,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  sub: string;
  valueDisplay: string;
  min: number;
  max: number;
  value: number;
  onChange: (nextVal: number) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-normal tracking-[0.08em] text-[#222222]">
            {label}
          </span>
          <span className="font-mono text-[8.5px] tracking-[0.14em] text-[#8C8C8A]">
            {sub}
          </span>
        </div>
        <span className="font-mono text-[10.5px] tabular-nums text-[#222222]">
          {valueDisplay}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="muji-slider mt-0.5"
        aria-label={label}
      />
    </div>
  );
}
