"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CRAYON_COLORS,
  drawEraserSegment,
  exportLetterAsJpg,
  getFormattedDateStamp,
  SIZE_OPTIONS,
} from "@/lib/crayon-brush";
import {
  BRUSH_TYPES,
  BrushParams,
  BrushType,
  DEFAULT_BRUSH_PARAMS,
  drawProceduralSegment,
  ProceduralStrokePoint,
  stampProceduralDab,
} from "@/lib/procedural-brushes";
import {
  BrushLabIcon,
  DownloadIcon,
  EditBackIcon,
  EnvelopeCheckIcon,
  EraserIcon,
  PaperPlaneIcon,
  StampPostmarkDecoration,
  TrashIcon,
} from "@/components/LetterIcons";
import {
  TargetPaperRect,
  ZFoldLetterScene,
} from "@/components/ZFoldLetterScene";
import { BrushCustomizerPanel } from "@/components/BrushCustomizerPanel";

type AppPhase = "zfold" | "handoff" | "workspace";
type ToolMode = "brush" | "eraser";

export function LightMessageLetterApp() {
  const [phase, setPhase] = useState<AppPhase>("zfold");
  const [tool, setTool] = useState<ToolMode>("brush");
  const [colorHex, setColorHex] = useState<string>(CRAYON_COLORS[0].hex);
  // Default to smallest stroke size (index 0)
  const [sizeIdx, setSizeIdx] = useState<number>(0);
  const [brushType, setBrushType] = useState<BrushType>(DEFAULT_BRUSH_PARAMS.type);
  const [noiseSize, setNoiseSize] = useState<number>(DEFAULT_BRUSH_PARAMS.noiseSize);
  const [edgeRoughness, setEdgeRoughness] = useState<number>(
    DEFAULT_BRUSH_PARAMS.edgeRoughness
  );
  const [tiltAngle, setTiltAngle] = useState<number>(DEFAULT_BRUSH_PARAMS.tiltAngle);
  const [randomSeed, setRandomSeed] = useState<number>(
    DEFAULT_BRUSH_PARAMS.randomSeed
  );
  const [isBrushLabOpen, setIsBrushLabOpen] = useState<boolean>(false);

  const [hasStrokes, setHasStrokes] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [isSendingMotion, setIsSendingMotion] = useState<boolean>(false);
  const [downloadedFeedback, setDownloadedFeedback] = useState<boolean>(false);
  const [dateStamp] = useState<string>(() => getFormattedDateStamp());

  // Measured exact DOM rect of the 2D paper sheet so the 3D scene zooms pixel-for-pixel onto it
  const [paperTargetRect, setPaperTargetRect] =
    useState<TargetPaperRect | null>(null);

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

  // Active pointer drawing state refs (zero React re-renders during strokes)
  const isDrawingRef = useRef<boolean>(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<ProceduralStrokePoint | null>(null);
  const stepCounterRef = useRef<number>(0);

  const currentSize = SIZE_OPTIONS[sizeIdx];

  const activeBrushParams: BrushParams = useMemo(
    () => ({
      type: brushType,
      colorHex,
      baseRadius: currentSize.brushRadius,
      noiseSize,
      edgeRoughness,
      tiltAngle,
      randomSeed,
    }),
    [
      brushType,
      colorHex,
      currentSize.brushRadius,
      edgeRoughness,
      noiseSize,
      randomSeed,
      tiltAngle,
    ]
  );

  const currentBrushMeta = useMemo(
    () => BRUSH_TYPES.find((b) => b.id === brushType) ?? BRUSH_TYPES[0],
    [brushType]
  );

  const handleUpdateBrushParams = useCallback((next: Partial<BrushParams>) => {
    if (next.type !== undefined) setBrushType(next.type);
    if (next.noiseSize !== undefined) setNoiseSize(next.noiseSize);
    if (next.edgeRoughness !== undefined) setEdgeRoughness(next.edgeRoughness);
    if (next.tiltAngle !== undefined) setTiltAngle(next.tiltAngle);
    if (next.randomSeed !== undefined) setRandomSeed(next.randomSeed);
  }, []);

  const handleSelectBrushType = useCallback((type: BrushType) => {
    setBrushType(type);
    setTool("brush");
  }, []);

  // Seamless 3D -> 2D handoff (zero bounce/jump)
  const handleSceneUnfolded = useCallback(() => {
    setPhase("handoff");
    window.setTimeout(() => {
      setPhase("workspace");
    }, 320);
  }, []);

  // Always measure paperBoxRef and keep Retina canvas synced (even before unfold so 3D aligns 1:1)
  useEffect(() => {
    const box = paperBoxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;

    const syncBoxAndCanvas = () => {
      const rect = box.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));

      setPaperTargetRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const prev = canvasSizeRef.current;
      if (prev.width === nextW && prev.height === nextH && prev.dpr === dpr) {
        return;
      }

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

    syncBoxAndCanvas();
    const ro = new ResizeObserver(syncBoxAndCanvas);
    ro.observe(box);
    window.addEventListener("resize", syncBoxAndCanvas);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncBoxAndCanvas);
    };
  }, []);

  const getCanvasPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): ProceduralStrokePoint => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return { x: 0, y: 0, pressure: 0.5, timestamp: performance.now() };
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
        timestamp: performance.now(),
      };
    },
    []
  );

  // Pointer event handlers (touch, stylus, mouse)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (phase === "zfold" || isClearing || sealedJpg) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;

      if (isBrushLabOpen) {
        setIsBrushLabOpen(false);
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);

      const pt = getCanvasPoint(e);
      isDrawingRef.current = true;
      activePointerIdRef.current = e.pointerId;
      lastPointRef.current = pt;
      stepCounterRef.current = 0;

      if (tool === "eraser") {
        setEraserCursor({ x: pt.x, y: pt.y, visible: true });
        drawEraserSegment(ctx, pt, pt, currentSize.eraserDiameter);
      } else {
        stampProceduralDab(
          ctx,
          pt.x,
          pt.y,
          0,
          0.25,
          activeBrushParams,
          0,
          pt.pressure
        );
        stepCounterRef.current = 1;
        if (!hasStrokes) setHasStrokes(true);
      }
    },
    [
      activeBrushParams,
      currentSize.eraserDiameter,
      getCanvasPoint,
      hasStrokes,
      isBrushLabOpen,
      isClearing,
      phase,
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

      const nativeEv = e.nativeEvent;
      const coalesced =
        typeof nativeEv.getCoalescedEvents === "function"
          ? nativeEv.getCoalescedEvents()
          : [];

      if (coalesced.length > 1) {
        const rect = canvas.getBoundingClientRect();
        let prev = lastPt;
        for (const cev of coalesced) {
          const nextPt: ProceduralStrokePoint = {
            x: cev.clientX - rect.left,
            y: cev.clientY - rect.top,
            pressure: cev.pressure && cev.pressure > 0 ? cev.pressure : 0.5,
            timestamp: cev.timeStamp || performance.now(),
          };
          if (tool === "eraser") {
            drawEraserSegment(ctx, prev, nextPt, currentSize.eraserDiameter);
          } else {
            stepCounterRef.current = drawProceduralSegment(
              ctx,
              prev,
              nextPt,
              activeBrushParams,
              stepCounterRef.current
            );
          }
          prev = nextPt;
        }
        lastPointRef.current = prev;
      } else {
        if (tool === "eraser") {
          drawEraserSegment(ctx, lastPt, pt, currentSize.eraserDiameter);
        } else {
          stepCounterRef.current = drawProceduralSegment(
            ctx,
            lastPt,
            pt,
            activeBrushParams,
            stepCounterRef.current
          );
        }
        lastPointRef.current = pt;
      }
    },
    [activeBrushParams, currentSize.eraserDiameter, getCanvasPoint, tool]
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
          // ignore
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

  // Send button: subtle fold/lift micro-interaction -> composite offscreen JPG -> open modal
  const handleSendLetter = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isSendingMotion) return;

    setIsBrushLabOpen(false);
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

  const isWorkspaceVisible = phase !== "zfold";

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white text-[#222222]">
      {/* Subtle architectural corner trim ticks */}
      <div
        className="pointer-events-none fixed inset-3 z-0 sm:inset-5"
        aria-hidden="true"
      >
        <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t border-l border-[#DCDCD7]" />
        <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t border-r border-[#DCDCD7]" />
        <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-[#DCDCD7]" />
        <span className="absolute right-0 bottom-0 h-2.5 w-2.5 border-r border-b border-[#DCDCD7]" />
      </div>

      {/* ================================================================= */}
      {/* STAGE 1: THREE.JS 3D Z-FOLD SCENE (SEAMLESS ZOOM ONTO 2D SLOT)    */}
      {/* ================================================================= */}
      {phase !== "workspace" && (
        <ZFoldLetterScene
          dateStamp={dateStamp}
          targetBoxRect={paperTargetRect}
          isFadingOut={phase === "handoff"}
          onUnfolded={handleSceneUnfolded}
        />
      )}

      {/* ================================================================= */}
      {/* STAGE 2 & 3: ALWAYS-MEASURED WORKSPACE (ZERO BOUNCE ON HANDOFF!)  */}
      {/* ================================================================= */}
      <div
        className={`relative z-10 flex h-full w-full flex-col items-center justify-between px-3 pt-3 pb-3 sm:px-6 sm:pt-5 sm:pb-5 ${
          isWorkspaceVisible ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        {/* Top Minimalist Header: Title Left + Prominent Top-Right Brush Customizer Button */}
        <header
          className={`relative z-30 flex w-full max-w-[680px] shrink-0 items-center justify-between border-b border-[#DCDCD7] pb-2.5 transition-opacity duration-350 ${
            isWorkspaceVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Left: Quiet Title & Back-to-3D-Cover */}
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => {
                setIsBrushLabOpen(false);
                setPhase("zfold");
              }}
              title="折回 3D Z 字折疊封面"
              className="text-sm font-normal tracking-[0.22em] text-[#222222] transition-opacity hover:opacity-65 sm:text-[15px]"
            >
              一則光的訊息
            </button>
            <span className="hidden font-mono text-[9.5px] tracking-[0.2em] text-[#8C8C8A] sm:inline">
              A MESSAGE OF LIGHT
            </span>
          </div>

          {/* Top-Right: Prominent Brush Customizer Toggle Button + Floating Panel */}
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => setIsBrushLabOpen((prev) => !prev)}
              aria-label="開啟筆刷調整面板"
              aria-expanded={isBrushLabOpen}
              className={`group inline-flex h-9 items-center gap-2 rounded-full border-[1.5px] border-[#222222] px-3.5 transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] active:scale-95 ${
                isBrushLabOpen
                  ? "bg-white text-[#222222]"
                  : "bg-[#222222] text-[#FAF9F6] hover:bg-[#3A3A38]"
              }`}
            >
              <BrushLabIcon size={16} />
              <span className="text-xs font-normal tracking-[0.14em]">
                筆刷調整
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] ${
                  isBrushLabOpen
                    ? "bg-[#FAF9F6] text-[#222222] border border-[#DCDCD7]"
                    : "bg-[#FAF9F6]/15 text-[#FAF9F6]"
                }`}
              >
                {tool === "eraser" ? "橡皮擦" : currentBrushMeta.label}
              </span>
            </button>

            {/* Floating Brush Customizer Panel anchored neatly at top-right */}
            <BrushCustomizerPanel
              isOpen={isBrushLabOpen}
              onClose={() => setIsBrushLabOpen(false)}
              params={activeBrushParams}
              onChangeParams={handleUpdateBrushParams}
              onSelectBrushType={handleSelectBrushType}
            />
          </div>
        </header>

        {/* Center Letter Paper Canvas Container — NO translate/scale bounce on handoff! */}
        <main className="relative flex min-h-0 w-full max-w-[680px] flex-1 flex-col items-center justify-center py-2.5 sm:py-4">
          <div
            ref={paperBoxRef}
            className={`relative h-full max-h-[680px] w-full overflow-hidden border border-[#222222] bg-[#FAF9F6] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              isWorkspaceVisible ? "opacity-100" : "opacity-0"
            } ${isSendingMotion ? "scale-[0.968] -translate-y-2" : "scale-100"}`}
            style={{
              boxShadow: "0 18px 38px -28px rgba(34, 34, 34, 0.16)",
            }}
          >
            {/* LAYER 1 (BOTTOM): Subtle Grid Stationery Background — untouched by eraser */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
            >
              {/* Ultra-subtle procedural cotton paper grain SVG */}
              <svg className="absolute inset-0 h-full w-full opacity-[0.035]">
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
              <span className="absolute top-3 left-3 h-2.5 w-2.5 border-t border-l border-[#222222]/28" />
              <span className="absolute top-3 right-3 h-2.5 w-2.5 border-t border-r border-[#222222]/28" />
              <span className="absolute bottom-3 left-3 h-2.5 w-2.5 border-b border-l border-[#222222]/28" />
              <span className="absolute right-3 bottom-3 h-2.5 w-2.5 border-r border-b border-[#222222]/28" />

              {/* Top stationery metadata & stamp */}
              <div className="flex items-start justify-between px-6 pt-4 sm:px-9">
                <div className="pt-2 font-mono text-[10px] tracking-[0.2em] text-[#8C8C8A]">
                  DATE // {dateStamp}
                </div>
                <StampPostmarkDecoration className="h-[40px] w-[66px] opacity-80" />
              </div>

              {/* Subtle Muji Square Graph Grid (格子條紋，淡雅不搶眼) */}
              <div
                className="absolute inset-x-6 top-[70px] bottom-[48px] sm:inset-x-9"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(34, 34, 34, 0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 34, 34, 0.055) 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />

              {/* Bottom-left subtle title watermark (aligns with 3D Z-fold front panel title!) */}
              <div className="absolute bottom-3.5 left-6 text-left sm:left-9">
                <div className="text-[11px] font-light tracking-[0.22em] text-[#8C8C8A]/80">
                  一則光的訊息
                </div>
                <div className="font-mono text-[7.5px] tracking-[0.24em] text-[#8C8C8A]/60">
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
              aria-label="一則光的訊息 手繪信紙畫布"
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

        {/* STAGE 3: Rearranged Bottom Control Bar (Bottom-left kept clear of Next.js badge!) */}
        <footer
          className={`relative w-full max-w-[680px] shrink-0 transition-opacity duration-350 ${
            isWorkspaceVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Floating Eraser Size Helper Pill when Eraser Mode is Active */}
          <div
            className={`mb-1.5 flex justify-center transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
              tool === "eraser"
                ? "max-h-8 opacity-100 translate-y-0"
                : "pointer-events-none max-h-0 overflow-hidden opacity-0 translate-y-1"
            }`}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#DCDCD7] bg-[#FAF9F6] px-3 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[#8C8C8A]">
              <span className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-[#222222]" />
              橡皮擦模式 · 點擊上方圓點調整大小 ({currentSize.eraserDiameter}px)
            </span>
          </div>

          {/* Main Fine-Bordered Pill / Wireframe Toolbar */}
          <div className="relative flex flex-wrap items-center justify-between gap-y-2 rounded-2xl border border-[#222222] bg-white px-3 py-2 sm:flex-nowrap sm:rounded-full sm:px-4 sm:py-2">
            {/* Group 1: Stroke / Eraser Size Dots (4 steps, default = smallest) */}
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
                        : "border border-transparent hover:border-[#DCDCD7]"
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
              className="hidden h-5 w-[1px] bg-[#DCDCD7] sm:inline-block"
              aria-hidden="true"
            />

            {/* Group 2: Muji Natural Low-Saturation Palette */}
            <div
              className="flex items-center gap-1.5 sm:gap-2"
              role="group"
              aria-label="畫筆顏色"
            >
              {CRAYON_COLORS.map((c) => {
                const active = tool === "brush" && colorHex === c.hex;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setColorHex(c.hex);
                      setTool("brush");
                    }}
                    title={c.name}
                    aria-label={`顏色：${c.name}`}
                    aria-pressed={active}
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:scale-95 ${
                      active
                        ? "border border-[#222222] bg-[#FAF9F6]"
                        : "border border-transparent hover:border-[#DCDCD7]"
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
              className="hidden h-5 w-[1px] bg-[#DCDCD7] sm:inline-block"
              aria-hidden="true"
            />

            {/* Group 3: Right-aligned Action Cluster (Eraser + Clear + Send) — keeps bottom-left completely clear! */}
            <div className="flex w-full items-center justify-end gap-2 border-t border-[#DCDCD7] pt-2 sm:w-auto sm:border-t-0 sm:pt-0">
              {/* Eraser Toggle */}
              <button
                type="button"
                onClick={() =>
                  setTool((prev) => (prev === "eraser" ? "brush" : "eraser"))
                }
                title={tool === "eraser" ? "切換回畫筆" : "橡皮擦"}
                aria-label="橡皮擦"
                aria-pressed={tool === "eraser"}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] active:scale-95 ${
                  tool === "eraser"
                    ? "border-[#222222] bg-[#222222] text-[#FAF9F6]"
                    : "border-[#DCDCD7] bg-white text-[#222222] hover:border-[#222222]"
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
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DCDCD7] bg-white text-[#222222] transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:border-[#222222] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[#DCDCD7]"
              >
                <TrashIcon size={16} />
              </button>

              {/* Send Pill Button (紙飛機 + 寄出) */}
              <button
                type="button"
                onClick={handleSendLetter}
                disabled={isSendingMotion}
                className="group ml-1 inline-flex h-8 items-center gap-1.5 rounded-full border border-[#222222] bg-[#222222] px-4 text-xs font-normal tracking-[0.2em] text-[#FAF9F6] transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-white hover:text-[#222222] active:scale-[0.97]"
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
            <span className="pointer-events-none absolute top-2.5 left-2.5 h-2 w-2 border-t border-l border-[#DCDCD7]" />
            <span className="pointer-events-none absolute top-2.5 right-2.5 h-2 w-2 border-t border-r border-[#DCDCD7]" />
            <span className="pointer-events-none absolute bottom-2.5 left-2.5 h-2 w-2 border-b border-l border-[#DCDCD7]" />
            <span className="pointer-events-none absolute right-2.5 bottom-2.5 h-2 w-2 border-r border-b border-[#DCDCD7]" />

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
            <div className="mt-4 w-full overflow-hidden border border-[#DCDCD7] bg-[#FAF9F6] p-2">
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
