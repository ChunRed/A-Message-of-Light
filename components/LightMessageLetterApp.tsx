"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CRAYON_COLORS,
  drawCrayonSegment,
  drawEraserSegment,
  exportLetterAsJpg,
  getFormattedDateStamp,
  SIZE_OPTIONS,
  stampCrayonDab,
  StrokePoint,
} from "@/lib/crayon-brush";
import {
  DownloadIcon,
  EditBackIcon,
  EnvelopeCheckIcon,
  EraserIcon,
  PaperPlaneIcon,
  StampPostmarkDecoration,
  TrashIcon,
} from "@/components/LetterIcons";

type AppPhase = "landing" | "unfolding" | "workspace";
type ToolMode = "crayon" | "eraser";

export function LightMessageLetterApp() {
  const [phase, setPhase] = useState<AppPhase>("landing");
  const [tool, setTool] = useState<ToolMode>("crayon");
  const [colorHex, setColorHex] = useState<string>(CRAYON_COLORS[0].hex);
  const [sizeIdx, setSizeIdx] = useState<number>(1);
  const [hasStrokes, setHasStrokes] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [isSendingMotion, setIsSendingMotion] = useState<boolean>(false);
  const [downloadedFeedback, setDownloadedFeedback] = useState<boolean>(false);
  const [dateStamp] = useState<string>(() => getFormattedDateStamp());

  // Exported sealed letter JPG modal
  const [sealedJpg, setSealedJpg] = useState<string | null>(null);

  // Eraser dashed circle cursor state (coordinates relative to letter sheet)
  const [eraserCursor, setEraserCursor] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });

  // Canvas & container refs
  const paperBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 1,
  });

  // Active pointer drawing state refs (avoid React re-renders during strokes)
  const isDrawingRef = useRef<boolean>(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<StrokePoint | null>(null);

  const currentSize = SIZE_OPTIONS[sizeIdx];

  // Unfold envelope transition: 3D flap rotateX -> scale & reveal workspace
  const handleUnfoldEnvelope = useCallback(() => {
    if (phase !== "landing") return;
    setPhase("unfolding");
    window.setTimeout(() => {
      setPhase("workspace");
    }, 640);
  }, [phase]);

  // Setup & preserve Retina canvas on mount and resize
  useEffect(() => {
    if (phase !== "workspace") return;
    const box = paperBoxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;

    const syncCanvasSize = () => {
      const rect = box.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      const prev = canvasSizeRef.current;
      if (prev.width === nextW && prev.height === nextH && prev.dpr === dpr) {
        return;
      }

      // Preserve existing drawing bitmap across resize/orientation change
      let snapshot: HTMLCanvasElement | null = null;
      if (canvas.width > 0 && canvas.height > 0 && prev.width > 0) {
        snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        const sCtx = snapshot.getContext("2d");
        sCtx?.drawImage(canvas, 0, 0);
      }

      canvas.width = Math.round(nextW * dpr);
      canvas.height = Math.round(nextH * dpr);
      canvas.style.width = `${nextW}px`;
      canvas.style.height = `${nextH}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (snapshot) {
          ctx.drawImage(
            snapshot,
            0,
            0,
            snapshot.width,
            snapshot.height,
            0,
            0,
            nextW,
            nextH
          );
        }
      }

      canvasSizeRef.current = { width: nextW, height: nextH, dpr };
    };

    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(box);

    return () => {
      ro.disconnect();
    };
  }, [phase]);

  // Helper to get pointer coordinates relative to the canvas CSS box
  const getCanvasPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, pressure: 0.5 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
      };
    },
    []
  );

  // Pointer event handlers (touch, stylus, mouse)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (isClearing || sealedJpg) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);

      const pt = getCanvasPoint(e);
      isDrawingRef.current = true;
      activePointerIdRef.current = e.pointerId;
      lastPointRef.current = pt;

      if (tool === "eraser") {
        setEraserCursor({ x: pt.x, y: pt.y, visible: true });
        drawEraserSegment(ctx, pt, pt, currentSize.eraserDiameter);
      } else {
        stampCrayonDab(
          ctx,
          pt.x,
          pt.y,
          currentSize.brushRadius,
          colorHex,
          pt.pressure
        );
        if (!hasStrokes) setHasStrokes(true);
      }
    },
    [
      colorHex,
      currentSize.brushRadius,
      currentSize.eraserDiameter,
      getCanvasPoint,
      hasStrokes,
      isClearing,
      sealedJpg,
      tool,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pt = getCanvasPoint(e);

      if (tool === "eraser") {
        setEraserCursor({ x: pt.x, y: pt.y, visible: true });
      }

      if (!isDrawingRef.current || activePointerIdRef.current !== e.pointerId) {
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const lastPt = lastPointRef.current;
      if (!canvas || !ctx || !lastPt) return;

      e.preventDefault();

      // Use coalesced events when available for ultra-smooth fast curves
      const nativeEv = e.nativeEvent;
      const coalesced =
        typeof nativeEv.getCoalescedEvents === "function"
          ? nativeEv.getCoalescedEvents()
          : [];

      if (coalesced.length > 1) {
        const rect = canvas.getBoundingClientRect();
        let prev = lastPt;
        for (const cev of coalesced) {
          const nextPt: StrokePoint = {
            x: cev.clientX - rect.left,
            y: cev.clientY - rect.top,
            pressure: cev.pressure && cev.pressure > 0 ? cev.pressure : 0.5,
          };
          if (tool === "eraser") {
            drawEraserSegment(ctx, prev, nextPt, currentSize.eraserDiameter);
          } else {
            drawCrayonSegment(
              ctx,
              prev,
              nextPt,
              currentSize.brushRadius,
              colorHex
            );
          }
          prev = nextPt;
        }
        lastPointRef.current = prev;
      } else {
        if (tool === "eraser") {
          drawEraserSegment(ctx, lastPt, pt, currentSize.eraserDiameter);
        } else {
          drawCrayonSegment(
            ctx,
            lastPt,
            pt,
            currentSize.brushRadius,
            colorHex
          );
        }
        lastPointRef.current = pt;
      }
    },
    [
      colorHex,
      currentSize.brushRadius,
      currentSize.eraserDiameter,
      getCanvasPoint,
      tool,
    ]
  );

  const endPointerStroke = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current === e.pointerId) {
        isDrawingRef.current = false;
        activePointerIdRef.current = null;
        lastPointRef.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore if capture already released
        }
      }
      if (e.pointerType !== "mouse") {
        setEraserCursor((prev) => ({ ...prev, visible: false }));
      }
    },
    []
  );

  // Clear canvas with serene horizontal sweep & dissolve animation
  const handleClearAll = useCallback(() => {
    if (isClearing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsClearing(true);
    window.setTimeout(() => {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        const { dpr } = canvasSizeRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      setHasStrokes(false);
    }, 220);

    window.setTimeout(() => {
      setIsClearing(false);
    }, 480);
  }, [isClearing]);

  // Send button: subtle fold/lift micro-interaction -> composite offscreen JPG -> open sealed modal
  const handleSendLetter = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isSendingMotion) return;

    setIsSendingMotion(true);
    setDownloadedFeedback(false);

    window.setTimeout(() => {
      try {
        const { width, height } = canvasSizeRef.current;
        const jpgDataUrl = exportLetterAsJpg(canvas, width, height, dateStamp);
        setSealedJpg(jpgDataUrl);
      } catch (err) {
        console.error("Failed to composite letter JPG:", err);
      } finally {
        setIsSendingMotion(false);
      }
    }, 260);
  }, [dateStamp, isSendingMotion]);

  // Direct browser download as 一則光的訊息.jpg
  const handleDownloadJpg = useCallback(() => {
    if (!sealedJpg) return;
    const link = document.createElement("a");
    link.href = sealedJpg;
    link.download = "一則光的訊息.jpg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadedFeedback(true);
    window.setTimeout(() => setDownloadedFeedback(false), 2200);
  }, [sealedJpg]);

  // Return to workspace preserving 100% of existing artwork
  const handleReturnToDraw = useCallback(() => {
    setSealedJpg(null);
  }, []);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white text-[#222222]">
      {/* Subtle architectural background corner trim ticks */}
      <div
        className="pointer-events-none fixed inset-3 z-0 sm:inset-5"
        aria-hidden="true"
      >
        <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t border-l border-[#E2E2DE]" />
        <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t border-r border-[#E2E2DE]" />
        <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-[#E2E2DE]" />
        <span className="absolute right-0 bottom-0 h-2.5 w-2.5 border-r border-b border-[#E2E2DE]" />
      </div>

      {/* ================================================================= */}
      {/* STAGE 1: LANDING & UNFOLDING — FOLDED BLANK ENVELOPE / LETTER     */}
      {/* ================================================================= */}
      {phase !== "workspace" && (
        <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
          {/* Quiet top monospace header */}
          <div className="pointer-events-none absolute top-7 right-7 left-7 flex items-center justify-between font-mono text-[10px] tracking-[0.22em] text-[#8C8C8A] sm:top-9 sm:right-10 sm:left-10">
            <span>NO. 001</span>
            <span>{dateStamp}</span>
          </div>

          {/* Clickable 3D Folded Envelope Card */}
          <button
            type="button"
            onClick={handleUnfoldEnvelope}
            aria-label="點擊展開信紙"
            className={`group envelope-scene relative flex flex-col items-center focus:outline-none ${
              phase === "unfolding"
                ? "pointer-events-none"
                : "cursor-pointer"
            }`}
          >
            {/* Floating envelope container */}
            <div
              className={`relative w-[min(86vw,380px)] aspect-[1.46/1] transition-all duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                phase === "unfolding"
                  ? "scale-110 -translate-y-4 opacity-0"
                  : "animate-float-gentle group-hover:-translate-y-1.5 group-hover:-rotate-[0.45deg] group-active:scale-[0.985]"
              }`}
            >
              {/* Inner rising letter sheet visible as the 3D flap opens */}
              <div
                className={`absolute inset-x-3 top-2 bottom-2 border border-[#E2E2DE] bg-white transition-all duration-600 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                  phase === "unfolding"
                    ? "-translate-y-12 scale-[1.03]"
                    : "translate-y-0"
                }`}
              />

              {/* Main envelope card body */}
              <div className="relative h-full w-full overflow-hidden border border-[#222222] bg-[#FAF9F6]">
                {/* Subtle diagonal lower fold creases */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 380 260"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line
                    x1="0"
                    y1="260"
                    x2="145"
                    y2="142"
                    stroke="#E2E2DE"
                    strokeWidth="1"
                  />
                  <line
                    x1="380"
                    y1="260"
                    x2="235"
                    y2="142"
                    stroke="#E2E2DE"
                    strokeWidth="1"
                  />
                  <line
                    x1="145"
                    y1="142"
                    x2="235"
                    y2="142"
                    stroke="#E2E2DE"
                    strokeWidth="1"
                  />
                </svg>

                {/* Top-right stamp & wavy postmark decoration */}
                <div className="pointer-events-none absolute top-3.5 right-3.5 opacity-80">
                  <StampPostmarkDecoration className="h-[38px] w-[62px]" />
                </div>

                {/* Top-left subtle postal index */}
                <div className="pointer-events-none absolute top-4 left-4 text-left font-mono text-[9px] tracking-[0.2em] text-[#8C8C8A]">
                  <div>AIR MAIL</div>
                  <div className="mt-0.5 text-[8px] opacity-75">LIGHT.MSG</div>
                </div>

                {/* Centered Title */}
                <div className="relative z-10 flex h-full w-full flex-col items-center justify-center pt-5">
                  <h1 className="text-[22px] font-light tracking-[0.28em] text-[#222222] sm:text-2xl">
                    一則光的訊息
                  </h1>
                  <p className="mt-2 font-mono text-[9.5px] tracking-[0.26em] text-[#8C8C8A]">
                    A MESSAGE OF LIGHT
                  </p>
                </div>

                {/* Subtle bottom calibrated dot row */}
                <div className="pointer-events-none absolute right-0 bottom-3 left-0 flex items-center justify-center gap-1.5 opacity-45">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <span
                      key={i}
                      className={`inline-block rounded-full bg-[#222222] ${
                        i === 3 ? "h-1 w-1" : "h-0.5 w-0.5"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* 3D Animated Top Envelope Flap */}
              <div
                className={`envelope-flap pointer-events-none absolute inset-x-0 top-0 z-20 h-[54%] ${
                  phase === "unfolding" ? "envelope-flap-open" : ""
                }`}
              >
                <svg
                  className="h-full w-full overflow-visible"
                  viewBox="0 0 380 140"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M0.5 0.5 L190 124 L379.5 0.5"
                    fill="#FAF9F6"
                    fillOpacity="0.92"
                    stroke="#222222"
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                  {/* Minimalist paper seal dot at flap tip */}
                  <circle
                    cx="190"
                    cy="124"
                    r="4"
                    fill="#FAF9F6"
                    stroke="#222222"
                    strokeWidth="1"
                  />
                  <circle cx="190" cy="124" r="1.2" fill="#222222" />
                </svg>
              </div>
            </div>

            {/* Ethereal Soft Elliptical Floor Shadow (Ref 2) */}
            <div
              aria-hidden="true"
              className={`mt-8 h-3.5 w-[min(64vw,260px)] rounded-full transition-opacity duration-500 ${
                phase === "unfolding"
                  ? "opacity-0"
                  : "animate-shadow-breathe"
              }`}
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(34,34,34,0.11) 0%, rgba(34,34,34,0.03) 55%, rgba(34,34,34,0) 78%)",
              }}
            />

            {/* Minimalist Breathing Prompt */}
            <div
              className={`mt-7 flex items-center gap-2.5 rounded-full border border-[#E2E2DE] bg-white px-4 py-1.5 transition-all duration-400 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] group-hover:border-[#222222] ${
                phase === "unfolding" ? "opacity-0 translate-y-2" : "opacity-100"
              }`}
            >
              <span className="animate-dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#222222]" />
              <span className="text-xs font-light tracking-[0.2em] text-[#222222]">
                點擊展開信紙
              </span>
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                className="text-[#8C8C8A] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-[#222222]"
                aria-hidden="true"
              >
                <path
                  d="M2.5 7H11.5M11.5 7L8 3.5M11.5 7L8 10.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </button>

          {/* Subtle footer colophon */}
          <div className="pointer-events-none absolute bottom-7 font-mono text-[9px] tracking-[0.26em] text-[#8C8C8A]/80">
            FOLDED BLANK STATIONERY · TAP TO BEGIN
          </div>
        </main>
      )}

      {/* ================================================================= */}
      {/* STAGE 2 & 3: WORKSPACE — CRAYON LETTER CANVAS & BOTTOM PILL BAR   */}
      {/* ================================================================= */}
      {phase === "workspace" && (
        <div className="relative z-10 flex h-full w-full flex-col items-center justify-between px-3 pt-3 pb-3 sm:px-6 sm:pt-5 sm:pb-5">
          {/* Top Minimalist Header with Animated Line-Growth Rule */}
          <header className="animate-muji-fade-up relative flex w-full max-w-[680px] shrink-0 items-center justify-between pb-2.5">
            <div className="flex items-baseline gap-2.5">
              <button
                type="button"
                onClick={() => setPhase("landing")}
                title="折回信封封面"
                className="text-sm font-normal tracking-[0.22em] text-[#222222] transition-opacity hover:opacity-65 sm:text-[15px]"
              >
                一則光的訊息
              </button>
              <span className="hidden font-mono text-[9.5px] tracking-[0.22em] text-[#8C8C8A] sm:inline">
                A MESSAGE OF LIGHT
              </span>
            </div>

            {/* Pill Status Indicator (Aeonik Fono wireframe inspired) */}
            <div className="flex items-center gap-2 rounded-full border border-[#E2E2DE] bg-[#FAF9F6] px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-[#222222]">
              <span
                className="inline-block h-2 w-2 rounded-full transition-colors duration-200"
                style={{
                  backgroundColor: tool === "eraser" ? "transparent" : colorHex,
                  border:
                    tool === "eraser"
                      ? "1px dashed #222222"
                      : "1px solid rgba(34,34,34,0.18)",
                }}
              />
              <span>
                {tool === "eraser"
                  ? `ERASER · ${currentSize.eraserDiameter}px`
                  : `CRAYON · ${currentSize.label}`}
              </span>
              <span className="hidden text-[#8C8C8A] sm:inline">
                / {dateStamp}
              </span>
            </div>

            {/* Animated SVG line-growth bottom border */}
            <svg
              className="pointer-events-none absolute right-0 bottom-0 left-0 h-[1px] w-full overflow-visible"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="0.5"
                x2="100%"
                y2="0.5"
                stroke="#E2E2DE"
                strokeWidth="1"
                className="animate-draw-line"
                style={{ ["--dash-len" as string]: 800 }}
              />
            </svg>
          </header>

          {/* Center Letter Paper Canvas Container */}
          <main className="relative flex min-h-0 w-full max-w-[680px] flex-1 flex-col items-center justify-center py-2.5 sm:py-4">
            <div
              ref={paperBoxRef}
              className={`animate-muji-fade-up relative h-full max-h-[680px] w-full overflow-hidden bg-[#FAF9F6] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                isSendingMotion ? "scale-[0.968] -translate-y-2" : "scale-100"
              }`}
              style={{
                boxShadow: "0 18px 38px -28px rgba(34, 34, 34, 0.22)",
              }}
            >
              {/* Animated SVG perimeter line-growth border (1px crisp charcoal/warm gray) */}
              <svg
                className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  x="0.5"
                  y="0.5"
                  width="999"
                  height="999"
                  fill="none"
                  stroke="#222222"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                  className="animate-draw-line"
                  style={{ ["--dash-len" as string]: 4000 }}
                />
              </svg>

              {/* LAYER 1 (BOTTOM): Stationery Background — untouched by eraser */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
              >
                {/* Ultra-subtle procedural cotton paper grain SVG */}
                <svg className="absolute inset-0 h-full w-full opacity-[0.04]">
                  <filter id="muji-paper-grain">
                    <feTurbulence
                      type="fractalNoise"
                      baseFrequency="0.82"
                      numOctaves="3"
                      stitchTiles="stitch"
                    />
                  </filter>
                  <rect
                    width="100%"
                    height="100%"
                    filter="url(#muji-paper-grain)"
                  />
                </svg>

                {/* Minimalist inner crop marks */}
                <span className="absolute top-3 left-3 h-2.5 w-2.5 border-t border-l border-[#222222]/30" />
                <span className="absolute top-3 right-3 h-2.5 w-2.5 border-t border-r border-[#222222]/30" />
                <span className="absolute bottom-3 left-3 h-2.5 w-2.5 border-b border-l border-[#222222]/30" />
                <span className="absolute right-3 bottom-3 h-2.5 w-2.5 border-r border-b border-[#222222]/30" />

                {/* Top stationery metadata & stamp */}
                <div className="flex items-start justify-between px-6 pt-5 sm:px-10">
                  <div className="pt-2 font-mono text-[10px] tracking-[0.2em] text-[#8C8C8A]">
                    DATE // {dateStamp}
                  </div>
                  <StampPostmarkDecoration className="h-[42px] w-[68px] opacity-85" />
                </div>

                {/* Fine horizontal stationery writing guidelines (#E7E6E2) */}
                <div
                  className="absolute inset-x-6 top-[78px] bottom-[46px] sm:inset-x-10"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, #E7E6E2 0px, #E7E6E2 1px, transparent 1px, transparent 34px)",
                  }}
                />

                {/* Quiet empty-canvas invitation hint */}
                {!hasStrokes && (
                  <div className="absolute inset-0 flex items-center justify-center px-6">
                    <p className="text-center text-xs font-light tracking-[0.24em] text-[#8C8C8A]/70">
                      以蠟筆在信紙上寫下或畫出一則光的訊息
                    </p>
                  </div>
                )}

                {/* Bottom-right subtle watermark */}
                <div className="absolute right-6 bottom-3.5 text-right sm:right-10">
                  <div className="text-[10.5px] font-light tracking-[0.22em] text-[#8C8C8A]/85">
                    一則光的訊息
                  </div>
                  <div className="font-mono text-[7.5px] tracking-[0.24em] text-[#8C8C8A]/65">
                    A MESSAGE OF LIGHT
                  </div>
                </div>
              </div>

              {/* LAYER 2 (TOP): Transparent Retina Drawing Canvas */}
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPointerStroke}
                onPointerCancel={endPointerStroke}
                onPointerLeave={() =>
                  setEraserCursor((prev) => ({ ...prev, visible: false }))
                }
                style={{ touchAction: "none" }}
                className={`relative z-10 block h-full w-full select-none transition-opacity duration-200 ${
                  tool === "eraser" ? "cursor-none" : "cursor-crosshair"
                } ${isClearing ? "opacity-0" : "opacity-100"}`}
                aria-label="一則光的訊息 蠟筆手繪信紙畫布"
              />

              {/* Eraser Dynamic Dashed-Circle Cursor Overlay */}
              {tool === "eraser" && eraserCursor.visible && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-20 rounded-full border border-dashed border-[#222222]/85 bg-white/25"
                  style={{
                    width: `${currentSize.eraserDiameter}px`,
                    height: `${currentSize.eraserDiameter}px`,
                    left: `${eraserCursor.x}px`,
                    top: `${eraserCursor.y}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              )}

              {/* Clear All Light-Veil Sweep Overlay */}
              {isClearing && (
                <div
                  aria-hidden="true"
                  className="animate-clear-sweep pointer-events-none absolute inset-0 z-30"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(250,249,246,0) 0%, rgba(250,249,246,0.94) 45%, rgba(255,255,255,0.98) 55%, rgba(250,249,246,0) 100%)",
                  }}
                />
              )}
            </div>
          </main>

          {/* STAGE 3: Bottom Minimalist Muji Wireframe Control Bar */}
          <footer
            className="animate-muji-fade-up relative w-full max-w-[680px] shrink-0"
            style={{ animationDelay: "120ms" }}
          >
            {/* Floating Eraser Size Helper Pill when Eraser Mode is Active */}
            <div
              className={`mb-1.5 flex justify-center transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                tool === "eraser"
                  ? "max-h-8 opacity-100 translate-y-0"
                  : "pointer-events-none max-h-0 overflow-hidden opacity-0 translate-y-1"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E2DE] bg-[#FAF9F6] px-3 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[#8C8C8A]">
                <span className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-[#222222]" />
                橡皮擦模式 · 點擊左側圓點調整大小 ({currentSize.eraserDiameter}px)
              </span>
            </div>

            {/* Main Fine-Bordered Pill / Wireframe Toolbar */}
            <div className="relative flex flex-wrap items-center justify-between gap-y-2 rounded-2xl border border-[#222222] bg-white px-3 py-2 sm:flex-nowrap sm:rounded-full sm:px-4 sm:py-2">
              {/* Group 1: Stroke / Eraser Size Dots (4 steps) */}
              <div
                className="flex items-center gap-1.5"
                role="group"
                aria-label={tool === "eraser" ? "橡皮擦大小" : "筆跡粗細"}
              >
                {SIZE_OPTIONS.map((opt, idx) => {
                  const active = sizeIdx === idx;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSizeIdx(idx)}
                      title={
                        tool === "eraser"
                          ? `橡皮擦 ${opt.eraserDiameter}px`
                          : `筆跡粗細：${opt.label}`
                      }
                      aria-label={
                        tool === "eraser"
                          ? `橡皮擦 ${opt.label}`
                          : `筆跡粗細 ${opt.label}`
                      }
                      aria-pressed={active}
                      className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:scale-105 active:scale-95 ${
                        active
                          ? tool === "eraser"
                            ? "border border-dashed border-[#222222] bg-[#FAF9F6]"
                            : "border border-[#222222] bg-[#FAF9F6]"
                          : "border border-transparent hover:border-[#E2E2DE]"
                      }`}
                    >
                      <span
                        className="rounded-full transition-transform duration-200"
                        style={{
                          width: `${opt.dotPx}px`,
                          height: `${opt.dotPx}px`,
                          backgroundColor:
                            tool === "eraser" ? "transparent" : "#222222",
                          border:
                            tool === "eraser"
                              ? "1.2px dashed #222222"
                              : "none",
                        }}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Hairline vertical divider */}
              <span
                className="hidden h-5 w-[1px] bg-[#E2E2DE] sm:inline-block"
                aria-hidden="true"
              />

              {/* Group 2: Muji Natural Low-Saturation Crayon Palette */}
              <div
                className="flex items-center gap-1.5 sm:gap-2"
                role="group"
                aria-label="蠟筆顏色"
              >
                {CRAYON_COLORS.map((c) => {
                  const active = tool === "crayon" && colorHex === c.hex;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setColorHex(c.hex);
                        setTool("crayon");
                      }}
                      title={c.name}
                      aria-label={`顏色：${c.name}`}
                      aria-pressed={active}
                      className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:scale-95 ${
                        active
                          ? "border border-[#222222] bg-[#FAF9F6]"
                          : "border border-transparent hover:border-[#E2E2DE]"
                      }`}
                    >
                      <span
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: c.hex }}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Hairline vertical divider */}
              <span
                className="hidden h-5 w-[1px] bg-[#E2E2DE] sm:inline-block"
                aria-hidden="true"
              />

              {/* Group 3: Eraser, Clear All, and Send Pill Button */}
              <div className="flex w-full items-center justify-between gap-2 border-t border-[#E2E2DE] pt-2 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
                <div className="flex items-center gap-1.5">
                  {/* Eraser Toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      setTool((prev) =>
                        prev === "eraser" ? "crayon" : "eraser"
                      )
                    }
                    title={tool === "eraser" ? "切換回蠟筆" : "橡皮擦"}
                    aria-label="橡皮擦"
                    aria-pressed={tool === "eraser"}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] active:scale-95 ${
                      tool === "eraser"
                        ? "border-[#222222] bg-[#222222] text-[#FAF9F6]"
                        : "border-[#E2E2DE] bg-white text-[#222222] hover:border-[#222222]"
                    }`}
                  >
                    <EraserIcon size={16} />
                  </button>

                  {/* Clear All */}
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={!hasStrokes || isClearing}
                    title="全部清除"
                    aria-label="全部清除"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E2DE] bg-white text-[#222222] transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:border-[#222222] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[#E2E2DE]"
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>

                {/* Send Pill Button (紙飛機 + 寄出) */}
                <button
                  type="button"
                  onClick={handleSendLetter}
                  disabled={isSendingMotion}
                  className="group inline-flex h-8 items-center gap-1.5 rounded-full border border-[#222222] bg-[#222222] px-4 text-xs font-normal tracking-[0.2em] text-[#FAF9F6] transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-white hover:text-[#222222] active:scale-[0.97]"
                >
                  <PaperPlaneIcon
                    size={14}
                    className="transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                  <span>寄出</span>
                </button>
              </div>
            </div>
          </footer>
        </div>
      )}

      {/* ================================================================= */}
      {/* STAGE 4: SEALED LETTER NOTIFICATION & JPG EXPORT MODAL            */}
      {/* ================================================================= */}
      {sealedJpg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="光的訊息已封存"
          onClick={handleReturnToDraw}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#FAF9F6]/80 px-4 py-6 backdrop-blur-[3px] transition-opacity"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-muji-modal-in relative flex max-h-[90dvh] w-full max-w-[440px] flex-col items-center border border-[#222222] bg-white px-5 py-6 sm:px-7 sm:py-7"
            style={{
              boxShadow: "0 20px 44px -30px rgba(34, 34, 34, 0.25)",
            }}
          >
            {/* Corner crop marks inside modal */}
            <span className="pointer-events-none absolute top-2.5 left-2.5 h-2 w-2 border-t border-l border-[#E2E2DE]" />
            <span className="pointer-events-none absolute top-2.5 right-2.5 h-2 w-2 border-t border-r border-[#E2E2DE]" />
            <span className="pointer-events-none absolute bottom-2.5 left-2.5 h-2 w-2 border-b border-l border-[#E2E2DE]" />
            <span className="pointer-events-none absolute right-2.5 bottom-2.5 h-2 w-2 border-r border-b border-[#E2E2DE]" />

            {/* Top Monoline Envelope-Check Icon */}
            <div className="text-[#222222]">
              <EnvelopeCheckIcon size={30} />
            </div>

            <h2 className="mt-2.5 text-base font-normal tracking-[0.24em] text-[#222222]">
              光的訊息已封存
            </h2>
            <p className="mt-1 font-mono text-[9.5px] tracking-[0.2em] text-[#8C8C8A]">
              SEALED · {dateStamp} · JPG READY
            </p>

            {/* Letter Thumbnail Preview */}
            <div className="mt-4 w-full overflow-hidden border border-[#E2E2DE] bg-[#FAF9F6] p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sealedJpg}
                alt="一則光的訊息信紙預覽"
                className="mx-auto max-h-[44dvh] w-auto max-w-full object-contain"
              />
            </div>

            <p className="mt-2.5 font-mono text-[9px] tracking-[0.12em] text-[#8C8C8A]">
              點擊下載保存，或於手機長按信紙圖片存入相簿
            </p>

            {/* Modal Action Pill Buttons */}
            <div className="mt-5 flex w-full flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={handleDownloadJpg}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-[#222222] bg-[#222222] px-4 text-xs font-normal tracking-[0.18em] text-[#FAF9F6] transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#3A3A38] active:scale-[0.98]"
              >
                <DownloadIcon size={15} />
                <span>
                  {downloadedFeedback ? "已開始下載 ✓" : "下載信件（JPG）"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleReturnToDraw}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-[#222222] bg-white px-4 text-xs font-normal tracking-[0.18em] text-[#222222] transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FAF9F6] active:scale-[0.98]"
              >
                <EditBackIcon size={14} />
                <span>返回繼續作畫</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
