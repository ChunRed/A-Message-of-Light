"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CRAYON_COLORS,
  drawEraserSegment,
  exportLetterAsJpg,
  exportLetterAsWebpBlob,
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
  GridSamplingResult,
  publishLightSequenceToHardware,
  sampleDrawingToGridAnd30Led,
} from "@/lib/grid-sampling";
import {
  MAILBOX_NUMBERS,
  MailboxNumber,
  parseMailboxParam,
  UploadProgressPhase,
  uploadWebpBlobToLibrary,
} from "@/lib/image-library-api";
import {
  BrushLabIcon,
  DownloadIcon,
  EraserIcon,
  PaperPlaneIcon,
  PenTipIcon,
  RedoIcon,
  TrashIcon,
  UndoIcon,
} from "@/components/LetterIcons";
import {
  LetterSceneMode,
  TargetPaperRect,
  ZFoldLetterScene,
  ZFoldSceneHandle,
} from "@/components/ZFoldLetterScene";
import { BrushCustomizerPanel } from "@/components/BrushCustomizerPanel";
import { GridSamplingOverlay } from "@/components/GridSamplingOverlay";
import { LetterLibraryView } from "@/components/LetterLibraryView";
import {
  SparkleColorTriplet,
  SparkleOverlayHandle,
  SparkleParticleOverlay,
} from "@/components/SparkleParticleOverlay";

type ToolMode = "brush" | "eraser";
type ActivePostMode = 0 | MailboxNumber;
type PostSendStage =
  | "idle"
  | "sampling"
  | "confirm-save"
  | "dissolving"
  | "enveloping"
  | "returning";

type UploadStatusState =
  | { state: "idle" }
  | { state: "uploading"; phase: UploadProgressPhase; mailbox: MailboxNumber }
  | { state: "success"; url: string; mailbox: MailboxNumber }
  | { state: "error"; message: string; canRetry: boolean };

const MAX_HISTORY = 5;

export function LightMessageLetterApp() {
  const [sceneMode, setSceneMode] = useState<LetterSceneMode>("folded");
  const [postSendStage, setPostSendStage] = useState<PostSendStage>("idle");
  const [tool, setTool] = useState<ToolMode>("brush");
  const [colorHex, setColorHex] = useState<string>(CRAYON_COLORS[0].hex);
  const [sizeIdx, setSizeIdx] = useState<number>(0); // default smallest
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
  const [showDrawGuide, setShowDrawGuide] = useState<boolean>(false);
  const hasShownGuideOnceRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [dateStamp] = useState<string>(() => getFormattedDateStamp());

  // Measured exact DOM rect of the 2D paper slot so Three.js aligns pixel-for-pixel
  const [paperTargetRect, setPaperTargetRect] =
    useState<TargetPaperRect | null>(null);

  // Post-send pipeline state (Step A snapshot + grid sampling result)
  const [savedLetterJpg, setSavedLetterJpg] = useState<string | null>(null);
  const [samplingResult, setSamplingResult] =
    useState<GridSamplingResult | null>(null);
  const [isRefoldDragging, setIsRefoldDragging] = useState<boolean>(false);

  // Cloud R2 upload status, Mailbox (1..6) selection, & URL `?post` mode (default 0 = send home)
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxNumber>(1);
  const [activePost, setActivePost] = useState<ActivePostMode>(0);
  const [libraryRefreshSignal, setLibraryRefreshSignal] = useState<number>(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatusState>({
    state: "idle",
  });

  // Eraser dashed circle cursor state
  const [eraserCursor, setEraserCursor] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });

  // Refs
  const sceneRef = useRef<ZFoldSceneHandle | null>(null);
  const sparkleRef = useRef<SparkleOverlayHandle | null>(null);
  const dissolvePaletteRef = useRef<SparkleColorTriplet[]>([]);
  const stageTimerRef = useRef<number | null>(null);
  const uploadToastTimerRef = useRef<number | null>(null);
  const pendingWebpPromiseRef = useRef<Promise<Blob> | null>(null);
  const lastUploadPayloadRef = useRef<{
    blob: Blob;
    mailbox: MailboxNumber;
  } | null>(null);
  const paperBoxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 1,
  });

  // 5-Step Undo/Redo ImageData history stack (index 0 = initial blank + up to 5 steps)
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef<number>(-1);

  // Active pointer drawing state refs
  const isDrawingRef = useRef<boolean>(false);
  const strokeModifiedRef = useRef<boolean>(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointRef = useRef<ProceduralStrokePoint | null>(null);
  const stepCounterRef = useRef<number>(0);

  // Bottom small circle pull-up-to-refold gesture refs
  const refoldDragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startY: 0,
    moved: false,
  });

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

  const updateHistoryFlags = useCallback(() => {
    const idx = historyIndexRef.current;
    const len = historyRef.current.length;
    setCanUndo(idx > 0);
    setCanRedo(idx >= 0 && idx < len - 1);
  }, []);

  const pushHistorySnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;

    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const nextStack = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextStack.push(snap);

    while (nextStack.length > MAX_HISTORY + 1) {
      nextStack.shift();
    }

    historyRef.current = nextStack;
    historyIndexRef.current = nextStack.length - 1;
    updateHistoryFlags();
  }, [updateHistoryFlags]);

  const checkCanvasHasInk = useCallback((imgData: ImageData): boolean => {
    const data = imgData.data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 4) return true;
    }
    return false;
  }, []);

  const handleUndo = useCallback(() => {
    if (postSendStage !== "idle" || historyIndexRef.current <= 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;

    historyIndexRef.current -= 1;
    const targetSnap = historyRef.current[historyIndexRef.current];
    if (targetSnap) {
      ctx.putImageData(targetSnap, 0, 0);
      setHasStrokes(checkCanvasHasInk(targetSnap));
    }
    updateHistoryFlags();
  }, [checkCanvasHasInk, postSendStage, updateHistoryFlags]);

  const handleRedo = useCallback(() => {
    if (
      postSendStage !== "idle" ||
      historyIndexRef.current >= historyRef.current.length - 1
    ) {
      return;
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;

    historyIndexRef.current += 1;
    const targetSnap = historyRef.current[historyIndexRef.current];
    if (targetSnap) {
      ctx.putImageData(targetSnap, 0, 0);
      setHasStrokes(checkCanvasHasInk(targetSnap));
    }
    updateHistoryFlags();
  }, [checkCanvasHasInk, postSendStage, updateHistoryFlags]);

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

  const handleSceneModeChange = useCallback((nextMode: LetterSceneMode) => {
    setSceneMode(nextMode);
    if (nextMode === "flat") {
      sceneRef.current?.syncDrawingCanvas(null);
      if (!hasShownGuideOnceRef.current) {
        hasShownGuideOnceRef.current = true;
        setShowDrawGuide(true);
      }
    } else if (nextMode === "folded") {
      setIsBrushLabOpen(false);
      setShowDrawGuide(false);
    }
  }, []);

  // Measure paperBoxRef and maintain Retina drawing canvas
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

      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
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

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
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

        const initSnap = ctx.getImageData(0, 0, canvas.width, canvas.height);
        historyRef.current = [initSnap];
        historyIndexRef.current = 0;
        updateHistoryFlags();
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
  }, [updateHistoryFlags]);

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

  // Pointer drawing handlers (locked automatically whenever postSendStage !== "idle")
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (sceneMode !== "flat" || postSendStage !== "idle" || isClearing) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;

      if (isBrushLabOpen) setIsBrushLabOpen(false);
      if (showDrawGuide) setShowDrawGuide(false);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx) return;

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);

      const pt = getCanvasPoint(e);
      isDrawingRef.current = true;
      strokeModifiedRef.current = true;
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
      postSendStage,
      sceneMode,
      showDrawGuide,
      tool,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pt = getCanvasPoint(e);

      if (tool === "eraser" && sceneMode === "flat" && postSendStage === "idle") {
        setEraserCursor({ x: pt.x, y: pt.y, visible: true });
      }

      if (!isDrawingRef.current || activePointerIdRef.current !== e.pointerId) {
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
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
    [
      activeBrushParams,
      currentSize.eraserDiameter,
      getCanvasPoint,
      postSendStage,
      sceneMode,
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
          // ignore
        }

        if (strokeModifiedRef.current) {
          strokeModifiedRef.current = false;
          pushHistorySnapshot();
        }
      }
      if (e.pointerType !== "mouse") {
        setEraserCursor((prev) => ({ ...prev, visible: false }));
      }
    },
    [pushHistorySnapshot]
  );

  // Bottom small circle pull-up-to-refold handlers
  const handleRefoldPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (sceneMode !== "flat" || postSendStage !== "idle") return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsBrushLabOpen(false);
      setShowDrawGuide(false);
      setEraserCursor((prev) => ({ ...prev, visible: false }));
      setIsRefoldDragging(true);

      sceneRef.current?.syncDrawingCanvas(canvasRef.current);
      sceneRef.current?.beginRefoldPull();

      refoldDragRef.current = {
        active: true,
        pointerId: e.pointerId,
        startY: e.clientY,
        moved: false,
      };
    },
    [postSendStage, sceneMode]
  );

  const handleRefoldPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = refoldDragRef.current;
      if (!drag.active || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      const pullUpPx = drag.startY - e.clientY;
      if (Math.abs(pullUpPx) > 6) drag.moved = true;
      sceneRef.current?.updateRefoldPull(Math.max(0, pullUpPx));
    },
    []
  );

  const handleRefoldPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = refoldDragRef.current;
      if (!drag.active || drag.pointerId !== e.pointerId) return;
      drag.active = false;
      drag.pointerId = null;
      setIsRefoldDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (!drag.moved) {
        sceneRef.current?.syncDrawingCanvas(canvasRef.current);
        sceneRef.current?.triggerFold();
      } else {
        sceneRef.current?.endRefoldPull();
      }
    },
    []
  );

  const handleRefoldLostCapture = useCallback(() => {
    const drag = refoldDragRef.current;
    if (!drag.active) return;
    drag.active = false;
    drag.pointerId = null;
    setIsRefoldDragging(false);
    sceneRef.current?.endRefoldPull();
  }, []);

  // Clear All with sweep animation & history snapshot
  const handleClearAll = useCallback(() => {
    if (postSendStage !== "idle" || isClearing || !hasStrokes) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsClearing(true);
    window.setTimeout(() => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        const { dpr } = canvasSizeRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      setHasStrokes(false);
      pushHistorySnapshot();
    }, 220);

    window.setTimeout(() => {
      setIsClearing(false);
    }, 480);
  }, [hasStrokes, isClearing, postSendStage, pushHistorySnapshot]);

  // Return to the default send-letter home page (`post = 0`)
  const returnToSendHome = useCallback(() => {
    setActivePost(0);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("post");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, []);

  const handleWriteForMailbox = useCallback(
    (mailbox: MailboxNumber) => {
      setSelectedMailbox(mailbox);
      returnToSendHome();
    },
    [returnToSendHome]
  );

  // Detect `?post=1..6` on initial load & browser history navigation.
  // Default (missing, `?post=0`, or invalid) stays strictly at `post = 0` (send-letter home page).
  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyPostParamFromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const parsed = parseMailboxParam(params.get("post"));
      if (parsed !== null) {
        setSelectedMailbox(parsed);
        setActivePost(parsed);
      } else {
        setActivePost(0);
      }
    };

    const rafId = window.requestAnimationFrame(applyPostParamFromLocation);
    window.addEventListener("popstate", applyPostParamFromLocation);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("popstate", applyPostParamFromLocation);
    };
  }, []);

  // Cleanup any pending choreography / toast timers on unmount
  useEffect(() => {
    return () => {
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      if (uploadToastTimerRef.current !== null) {
        window.clearTimeout(uploadToastTimerRef.current);
        uploadToastTimerRef.current = null;
      }
    };
  }, []);

  // =========================================================================
  // DIRECT-TO-R2 WEBP UPLOAD + SUPABASE DB PERSISTENCE (WITH MAILBOX 1..6)
  // Binary WebP Blob uploads directly from browser -> Cloudflare R2 (never via Node)
  // =========================================================================
  const runDirectR2Upload = useCallback(
    async (blob: Blob, mailbox: MailboxNumber) => {
      if (uploadToastTimerRef.current !== null) {
        window.clearTimeout(uploadToastTimerRef.current);
        uploadToastTimerRef.current = null;
      }

      lastUploadPayloadRef.current = { blob, mailbox };
      setUploadStatus({
        state: "uploading",
        phase: "requesting-url",
        mailbox,
      });

      try {
        const safeStamp = dateStamp.replace(/\./g, "-");
        const savedRow = await uploadWebpBlobToLibrary(
          blob,
          mailbox,
          `light-message-post${mailbox}-${safeStamp}.webp`,
          (phase) => {
            setUploadStatus({ state: "uploading", phase, mailbox });
          }
        );

        lastUploadPayloadRef.current = null;
        setLibraryRefreshSignal((n) => n + 1);
        setUploadStatus({ state: "success", url: savedRow.url, mailbox });

        uploadToastTimerRef.current = window.setTimeout(() => {
          setUploadStatus((prev) =>
            prev.state === "success" ? { state: "idle" } : prev
          );
        }, 5500);
      } catch (err) {
        console.error("[Light-msg Upload Error]", err);
        setUploadStatus({
          state: "error",
          message:
            err instanceof Error ? err.message : "圖片上傳失敗，請檢查網路或重試",
          canRetry: true,
        });
      }
    },
    [dateStamp]
  );

  const handleRetryUpload = useCallback(() => {
    const payload = lastUploadPayloadRef.current;
    if (!payload) return;
    void runDirectR2Upload(payload.blob, payload.mailbox);
  }, [runDirectR2Upload]);

  // =========================================================================
  // STAGE 4.2: RESET LOOP BACK TO FRESH 85%–90% BLANK 3D Z-FOLD LETTER
  // =========================================================================
  const resetToFreshLoop = useCallback(() => {
    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      const { dpr } = canvasSizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const freshSnap = ctx.getImageData(0, 0, canvas.width, canvas.height);
      historyRef.current = [freshSnap];
      historyIndexRef.current = 0;
      updateHistoryFlags();
    }

    dissolvePaletteRef.current = [];
    setHasStrokes(false);
    setSavedLetterJpg(null);
    setSamplingResult(null);
    setPostSendStage("idle");
    setIsBrushLabOpen(false);
    setShowDrawGuide(false);
    setIsRefoldDragging(false);
    hasShownGuideOnceRef.current = false;

    sceneRef.current?.resetToFreshFolded();
  }, [updateHistoryFlags]);

  // =========================================================================
  // STAGE 1: PRESS "寄出"
  // - 0ms snapshot high-res original JPG
  // - Background smoothly darkens to matte black #0B0B0D (0.8s)
  // - Grid scan & 30-CH strip translates down while original strokes stay 100% visible
  //   (Sparkles & glow activate ONLY after user confirms save/skip in Stage 2)
  // =========================================================================
  const handleSendLetter = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || postSendStage !== "idle" || sceneMode !== "flat") return;

    setIsBrushLabOpen(false);
    setShowDrawGuide(false);
    setEraserCursor((prev) => ({ ...prev, visible: false }));

    const { width, height } = canvasSizeRef.current;

    // 0ms: Synchronously composite stationery + original strokes into high-res JPG
    // AND asynchronously prepare `image/webp` (quality 0.85) Blob for direct R2 upload
    try {
      const fullArtworkJpg = exportLetterAsJpg(canvas, width, height, dateStamp);
      setSavedLetterJpg(fullArtworkJpg);
      pendingWebpPromiseRef.current = exportLetterAsWebpBlob(
        canvas,
        width,
        height,
        dateStamp,
        0.85
      );
    } catch (err) {
      console.error("Failed to snapshot pre-sampling letter:", err);
      pendingWebpPromiseRef.current = null;
    }

    // Quantize stationery grid cells & compute 30-CH [0..255] LED brightness sequence
    const result = sampleDrawingToGridAnd30Led(canvas, width, height);
    publishLightSequenceToHardware(result.ledValues);

    setSamplingResult(result);
    setPostSendStage("sampling");
  }, [dateStamp, postSendStage, sceneMode]);

  // =========================================================================
  // STAGE 1 -> STAGE 2: 30-UNIT STRIP SETTLED -> SHOW MINIMALIST 3-BUTTON CARD
  // =========================================================================
  const handleSamplingComplete = useCallback(() => {
    setPostSendStage("confirm-save");
  }, []);

  // =========================================================================
  // STAGE 2 ACTION 3: "返回修改"
  // Aborts send flow, restores white background, clears temporary strip,
  // preserves 100% of user's strokes & Undo/Redo history, and re-shows bottom toolbar!
  // =========================================================================
  const handleReturnToEdit = useCallback(() => {
    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    sparkleRef.current?.fadeOutAndClear(true);
    pendingWebpPromiseRef.current = null;
    setSamplingResult(null);
    setSavedLetterJpg(null);
    setPostSendStage("idle");
  }, []);

  // =========================================================================
  // STAGE 3 & STAGE 4 (SPARKLES, GLOW & RAYS START HERE AFTER SAVE CONFIRMATION):
  // 1) Upload WebP (0.85) directly to Cloudflare R2 & save record to Supabase
  // 2) Dissolve hand-drawn strokes into color-matched crayon starbursts + fade strip
  // 3) 3D 65° Z-fold half-fold -> Left/Right pendulum showcase -> Press flat
  //    -> Slide into 1px wireframe envelope & seal -> Pure vertical upward flight
  // 4) After envelope exits -> brighten bg back to white & reset loop
  // =========================================================================
  const startStage3DissolveAndSend = useCallback(() => {
    const canvas = canvasRef.current;
    const liveRect =
      paperBoxRef.current?.getBoundingClientRect() ?? paperTargetRect;
    const normalizedRect =
      liveRect && liveRect.width > 10 && liveRect.height > 10
        ? {
            left: liveRect.left,
            top: liveRect.top,
            width: liveRect.width,
            height: liveRect.height,
          }
        : null;

    // 0. Kick off direct-to-R2 WebP upload & Supabase DB save in parallel with animation
    const targetMailbox = selectedMailbox;
    const webpPromise = pendingWebpPromiseRef.current;
    pendingWebpPromiseRef.current = null;
    if (webpPromise) {
      webpPromise
        .then((blob) => runDirectR2Upload(blob, targetMailbox))
        .catch((err) => {
          console.error("Failed to generate WebP blob:", err);
          setUploadStatus({
            state: "error",
            message:
              err instanceof Error ? err.message : "圖片轉換為 WebP 失敗",
            canRetry: false,
          });
        });
    }

    // 1. Activate hand-drawn ambient stars & transform strokes into color-matched motifs
    sparkleRef.current?.setAmbientActive(true, normalizedRect);

    if (canvas && normalizedRect) {
      const palette =
        sparkleRef.current?.spawnDissolveFromCanvas(canvas, normalizedRect) ?? [];
      dissolvePaletteRef.current = palette;
    } else {
      dissolvePaletteRef.current = [];
    }

    // Keep 3D letter clean blank stationery as the strokes lift off into stardust
    sceneRef.current?.syncDrawingCanvas(null);
    setPostSendStage("dissolving");

    if (stageTimerRef.current !== null) {
      window.clearTimeout(stageTimerRef.current);
    }

    // Wait for strokes & strip to dissolve into stardust before beginning 3D Z-fold showcase
    stageTimerRef.current = window.setTimeout(() => {
      // Stop outer perimeter ambient spawner so creases & envelope opening become the starlight source
      sparkleRef.current?.setAmbientActive(false, null);
      setPostSendStage("enveloping");

      sceneRef.current?.startEnvelopeAndSend(
        () => {
          // Stage 4.2: Envelope exited straight up -> gently dissipate sparkles & brighten bg back to white
          sparkleRef.current?.fadeOutAndClear(false);
          setPostSendStage("returning");

          stageTimerRef.current = window.setTimeout(() => {
            resetToFreshLoop();
          }, 760);
        },
        (burst) => {
          sparkleRef.current?.emitBurst({
            ...burst,
            palette: dissolvePaletteRef.current,
          });
        }
      );
    }, 1020);
  }, [paperTargetRect, resetToFreshLoop, runDirectR2Upload, selectedMailbox]);

  // Stage 2 Action 1: Download full hand-drawn letter JPG -> immediately launch Stage 3
  const handleSaveAndProceedToEnvelope = useCallback(() => {
    if (savedLetterJpg) {
      const link = document.createElement("a");
      link.href = savedLetterJpg;
      link.download = "一則光的訊息.jpg";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    startStage3DissolveAndSend();
  }, [savedLetterJpg, startStage3DissolveAndSend]);

  // Stage 2 Action 2: Skip saving -> immediately launch Stage 3
  const handleSkipSaveAndProceedToEnvelope = useCallback(() => {
    startStage3DissolveAndSend();
  }, [startStage3DissolveAndSend]);

  const isFlatEditable = sceneMode === "flat" && postSendStage === "idle";
  const isSamplingOverlayMounted =
    postSendStage === "sampling" ||
    postSendStage === "confirm-save" ||
    postSendStage === "dissolving";
  const isDarkAtmosphere =
    postSendStage === "sampling" ||
    postSendStage === "confirm-save" ||
    postSendStage === "dissolving" ||
    postSendStage === "enveloping";

  return (
    <div
      className={`relative flex h-[100dvh] w-full flex-col overflow-hidden transition-colors duration-[800ms] ease-in-out ${
        isDarkAtmosphere
          ? "bg-[#0B0B0D] text-[#FAF9F6]"
          : "bg-[#FCFBFA] text-[#222222]"
      }`}
    >
      {/* Subtle full-screen paper / black-cardstock organic grain overlay */}
      <div
        aria-hidden="true"
        className={`paper-grain-overlay pointer-events-none fixed inset-0 z-0 transition-opacity duration-[800ms] ${
          isDarkAtmosphere ? "opacity-[0.07]" : "opacity-[0.045]"
        }`}
      />

      {/* Subtle hand-drawn corner trim ticks */}
      <div
        className="pointer-events-none fixed inset-3 z-0 sm:inset-5"
        aria-hidden="true"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`absolute top-0 left-0 transition-colors duration-[800ms] ${
            isDarkAtmosphere ? "text-[#FAF9F6]/25" : "text-[#222222]/25"
          }`}
        >
          <path
            d="M1.5 12.5C1.3 8.2 1.8 4.4 1.6 1.5C5.2 1.7 8.8 1.2 12.5 1.6"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`absolute top-0 right-0 transition-colors duration-[800ms] ${
            isDarkAtmosphere ? "text-[#FAF9F6]/25" : "text-[#222222]/25"
          }`}
        >
          <path
            d="M1.5 1.6C5.1 1.3 8.9 1.8 12.4 1.5C12.2 5.2 12.7 8.9 12.5 12.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`absolute bottom-0 left-0 transition-colors duration-[800ms] ${
            isDarkAtmosphere ? "text-[#FAF9F6]/25" : "text-[#222222]/25"
          }`}
        >
          <path
            d="M1.6 1.5C1.8 5.2 1.3 8.8 1.5 12.4C5.1 12.2 8.8 12.7 12.5 12.4"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className={`absolute right-0 bottom-0 transition-colors duration-[800ms] ${
            isDarkAtmosphere ? "text-[#FAF9F6]/25" : "text-[#222222]/25"
          }`}
        >
          <path
            d="M12.4 1.5C12.7 5.2 12.2 8.8 12.5 12.4C8.9 12.7 5.2 12.2 1.5 12.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* ================================================================= */}
      {/* FULL-VIEWPORT HAND-DRAWN LUMINOUS SPARKLE & GLOW PARTICLE LAYER   */}
      {/* ================================================================= */}
      <SparkleParticleOverlay ref={sparkleRef} />

      {/* ================================================================= */}
      {/* CONTINUOUS 3D Z-FOLD LETTER + WIREFRAME ENVELOPE + FLIGHT SCENE   */}
      {/* ================================================================= */}
      <ZFoldLetterScene
        ref={sceneRef}
        dateStamp={dateStamp}
        targetBoxRect={paperTargetRect}
        onModeChange={handleSceneModeChange}
      />

      {/* ================================================================= */}
      {/* 2D DRAWING OVERLAY + STAGE 1 SAMPLING + INTEGRATED BOTTOM BAR     */}
      {/* ================================================================= */}
      <div className="pointer-events-none relative z-20 flex h-full w-full flex-col items-center justify-between px-3 pt-3 pb-3 sm:px-6 sm:pt-4 sm:pb-5">
        {/* Minimalist Top Bar (locks & fades cleanly during post-send choreography) */}
        <header
          className={`flex w-full max-w-[680px] shrink-0 items-center justify-between gap-2 pb-2 transition-opacity duration-300 ${
            isFlatEditable
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-normal tracking-[0.22em] text-[#222222]">
              一則光的訊息
            </span>
            <span className="hidden font-mono text-[9.5px] tracking-[0.2em] text-[#8C8C8A] sm:inline">
              A MESSAGE OF LIGHT
            </span>
          </div>
          <span className="font-mono text-[10px] tracking-[0.18em] text-[#8C8C8A]">
            {tool === "eraser"
              ? `ERASER · ${currentSize.eraserDiameter}px`
              : `${currentBrushMeta.enLabel} · #${String(randomSeed).padStart(4, "0")}`}
          </span>
        </header>

        {/* Center Paper Slot (exact pixel target for 3D flattened letter & Stage 1 scan) */}
        <main className="relative flex min-h-0 w-full max-w-[620px] flex-1 flex-col items-center justify-center pt-1 pb-6 sm:pb-7">
          <div ref={paperBoxRef} className="relative h-full max-h-[640px] w-full">
            {/* Purely Transparent 2D Retina Drawing Canvas */}
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointerStroke}
              onPointerCancel={endPointerStroke}
              onPointerLeave={() =>
                setEraserCursor((prev) => ({ ...prev, visible: false }))
              }
              style={{
                touchAction: "none",
                opacity: isFlatEditable
                  ? isClearing
                    ? 0
                    : 1
                  : postSendStage === "sampling" ||
                      postSendStage === "confirm-save"
                    ? 1
                    : 0,
              }}
              className={`relative z-10 block h-full w-full select-none ${
                isFlatEditable ? "pointer-events-auto" : "pointer-events-none"
              } ${tool === "eraser" ? "cursor-none" : "cursor-crosshair"} ${
                postSendStage === "dissolving"
                  ? "transition-opacity duration-[920ms] ease-out"
                  : isClearing
                    ? "transition-opacity duration-200"
                    : ""
              }`}
              aria-label="一則光的訊息 手繪信紙畫布"
            />

            {/* STAGE 1 & STAGE 2: Grid Quantization Scan & Lower 30-Unit Strip (fades cleanly on Stage 3 dissolve) */}
            {isSamplingOverlayMounted && samplingResult && (
              <div
                className={`pointer-events-none absolute inset-0 z-30 transition-opacity duration-[650ms] ease-out ${
                  postSendStage === "dissolving" ? "opacity-0" : "opacity-100"
                }`}
              >
                <GridSamplingOverlay
                  samplingResult={samplingResult}
                  onComplete={handleSamplingComplete}
                />
              </div>
            )}

            {/* Eraser Dynamic Dashed-Circle Cursor Overlay */}
            {isFlatEditable && tool === "eraser" && eraserCursor.visible && (
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

            {/* Gentle Floating Guide Card after Unfolding */}
            {isFlatEditable && showDrawGuide && !hasStrokes && (
              <div className="pointer-events-none absolute inset-0 z-25 flex items-center justify-center px-5">
                <div className="sketch-card animate-muji-modal-in pointer-events-auto flex max-w-[270px] flex-col items-center border border-[#222222] bg-[#FDFCF9]/95 px-5 py-4 text-center backdrop-blur-[2px]">
                  <div className="sketch-pill flex h-8 w-8 items-center justify-center border border-[#222222]/30 bg-[#FAF9F6] text-[#222222]">
                    <PenTipIcon size={15} />
                  </div>
                  <p className="mt-2.5 text-xs font-normal tracking-[0.2em] text-[#222222]">
                    隨意留言或自由繪畫
                  </p>
                  <p className="mt-1.5 text-[10.5px] font-light leading-relaxed tracking-[0.08em] text-[#8C8C8A]">
                    直接落筆即可在信紙上創作，下方可自由切換筆刷與顏色
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDrawGuide(false)}
                    className="sketch-pill mt-3 border border-[#222222] bg-white px-4 py-1 font-mono text-[10px] tracking-[0.16em] text-[#222222] transition-colors hover:bg-[#222222] hover:text-[#FAF9F6]"
                  >
                    開始書寫
                  </button>
                </div>
              </div>
            )}

            {/* Bottom-Center Small Circle Pull-Up-to-Re-fold Handle */}
            <button
              type="button"
              onPointerDown={handleRefoldPointerDown}
              onPointerMove={handleRefoldPointerMove}
              onPointerUp={handleRefoldPointerUp}
              onPointerCancel={handleRefoldPointerUp}
              onLostPointerCapture={handleRefoldLostCapture}
              style={{ touchAction: "none" }}
              title="按住向上拉動折回 3D Z 字信紙"
              aria-label="向上拉動折回 Z 字信紙"
              className={`sketch-pill group absolute -bottom-5 left-1/2 z-30 flex h-7 w-7 -translate-x-1/2 items-center justify-center border border-[#222222] bg-[#FDFCF9] text-[#222222] transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FAF9F6] active:scale-90 ${
                isFlatEditable || isRefoldDragging
                  ? "pointer-events-auto cursor-grab opacity-100 active:cursor-grabbing"
                  : "pointer-events-none opacity-0"
              }`}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                className="transition-transform duration-200 group-hover:-translate-y-0.5"
                aria-hidden="true"
              >
                <path
                  d="M2.1 6.3C3.1 5.2 4.1 4.4 5 3.3C6 4.4 7 5.3 7.9 6.2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </main>

        {/* =============================================================== */}
        {/* INTEGRATED BOTTOM CONTROL BAR (locks & hides during send flow)  */}
        {/* =============================================================== */}
        <footer
          className={`relative z-30 w-full max-w-[680px] shrink-0 transition-opacity duration-300 ${
            isFlatEditable
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
        >
          <BrushCustomizerPanel
            isOpen={isBrushLabOpen && isFlatEditable}
            onClose={() => setIsBrushLabOpen(false)}
            params={activeBrushParams}
            onChangeParams={handleUpdateBrushParams}
            onSelectBrushType={handleSelectBrushType}
          />

          <div className="sketch-box relative flex flex-col gap-2 border border-[#222222] bg-[#FDFCF9]/95 px-3 py-2 sm:px-3.5 sm:py-2.5">
            {/* ROW 1: [Pen/Eraser Segmented Toggle] + [Brush Customizer] + [4 Size Dots] */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  role="group"
                  aria-label="切換畫筆或橡皮擦"
                  className="sketch-pill relative flex h-8 w-[74px] items-center border border-[#222222] bg-[#FAF9F6] p-0.5"
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute top-0.5 left-0.5 h-[26px] w-[34px] rounded-full bg-[#222222] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                      tool === "eraser" ? "translate-x-[34px]" : "translate-x-0"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setTool("brush")}
                    aria-label="畫筆模式"
                    aria-pressed={tool === "brush"}
                    className={`relative z-10 flex h-full w-1/2 items-center justify-center rounded-full transition-colors duration-200 ${
                      tool === "brush" ? "text-[#FAF9F6]" : "text-[#222222]"
                    }`}
                  >
                    <PenTipIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTool("eraser")}
                    aria-label="橡皮擦模式"
                    aria-pressed={tool === "eraser"}
                    className={`relative z-10 flex h-full w-1/2 items-center justify-center rounded-full transition-colors duration-200 ${
                      tool === "eraser" ? "text-[#FAF9F6]" : "text-[#222222]"
                    }`}
                  >
                    <EraserIcon size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsBrushLabOpen((prev) => !prev)}
                  aria-label="筆刷調整"
                  aria-expanded={isBrushLabOpen}
                  className={`sketch-pill inline-flex h-8 items-center gap-1.5 border px-2.5 text-[11px] font-normal tracking-[0.08em] transition-all duration-200 active:scale-95 ${
                    isBrushLabOpen
                      ? "border-[#222222] bg-[#222222] text-[#FAF9F6]"
                      : "border-[#222222] bg-white text-[#222222] hover:bg-[#FAF9F6]"
                  }`}
                >
                  <BrushLabIcon size={14} />
                  <span>{currentBrushMeta.label}</span>
                </button>
              </div>

              <div
                className="flex items-center gap-1"
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
                      className={`flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 active:scale-95 ${
                        active
                          ? tool === "eraser"
                            ? "border border-dashed border-[#222222] bg-[#FAF9F6]"
                            : "border border-[#222222] bg-[#FAF9F6]"
                          : "border border-transparent hover:border-[#DCDCD7]"
                      }`}
                    >
                      <span
                        className="rounded-full"
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
            </div>

            <div className="sketch-divider" aria-hidden="true" />

            {/* ROW 2: 11 Curated Muji Natural Low-Saturation Color Dots */}
            <div
              className="flex w-full items-center justify-between gap-0.5 sm:gap-1"
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
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-200 hover:-translate-y-0.5 active:scale-95 sm:h-7 sm:w-7 ${
                      active
                        ? "border border-[#222222] bg-[#FAF9F6]"
                        : "border border-transparent hover:border-[#DCDCD7]"
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full sm:h-4 sm:w-4"
                      style={{ backgroundColor: c.hex }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="sketch-divider" aria-hidden="true" />

            {/* ROW 3: Undo / Redo / Clear / Send */}
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                title="返回上一步（最多 5 步）"
                aria-label="返回上一步"
                className="sketch-pill flex h-8 w-8 items-center justify-center border border-[#222222]/25 bg-white text-[#222222] transition-all duration-200 hover:border-[#222222] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#222222]/25"
              >
                <UndoIcon size={15} />
              </button>

              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                title="下一步"
                aria-label="下一步"
                className="sketch-pill flex h-8 w-8 items-center justify-center border border-[#222222]/25 bg-white text-[#222222] transition-all duration-200 hover:border-[#222222] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#222222]/25"
              >
                <RedoIcon size={15} />
              </button>

              <button
                type="button"
                onClick={handleClearAll}
                disabled={!hasStrokes || isClearing}
                title="全部清除"
                aria-label="全部清除"
                className="sketch-pill flex h-8 w-8 items-center justify-center border border-[#222222]/25 bg-white text-[#222222] transition-all duration-200 hover:border-[#222222] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#222222]/25"
              >
                <TrashIcon size={15} />
              </button>

              <button
                type="button"
                onClick={handleSendLetter}
                disabled={postSendStage !== "idle"}
                className="sketch-pill group ml-0.5 inline-flex h-8 items-center gap-1.5 border border-[#222222] bg-[#222222] px-4 text-xs font-normal tracking-[0.18em] text-[#FAF9F6] transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FDFCF9] hover:text-[#222222] active:scale-[0.97]"
              >
                <PaperPlaneIcon
                  size={13}
                  className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
                <span>寄出</span>
              </button>
            </div>
          </div>
        </footer>
      </div>

      {/* ================================================================= */}
      {/* STAGE 2: MINIMALIST 1PX HIGH-CONTRAST SAVE CONFIRMATION CARD      */}
      {/* Pure title + 3 buttons (Save JPG / Direct Send / Return to Edit)  */}
      {/* ================================================================= */}
      {postSendStage === "confirm-save" && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="是否要儲存這張信紙？"
          className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 sm:bottom-5 sm:px-6"
        >
          <div className="sketch-card-dark animate-muji-modal-in pointer-events-auto relative flex w-full max-w-[560px] flex-col items-center border border-[#FAF9F6]/80 bg-[#121215]/95 px-5 py-4 backdrop-blur-[4px] sm:px-6 sm:py-5">
            {/* Subtle hand-drawn corner ticks */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="pointer-events-none absolute top-2 left-2 text-[#F3D98B]/50"
              aria-hidden="true"
            >
              <path
                d="M1.5 8.5C1.3 5.5 1.7 3 1.5 1.5C3.8 1.6 6.2 1.3 8.5 1.5"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="pointer-events-none absolute top-2 right-2 text-[#F3D98B]/50"
              aria-hidden="true"
            >
              <path
                d="M1.5 1.5C3.8 1.3 6.2 1.7 8.5 1.5C8.3 3.8 8.7 6.2 8.5 8.5"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="pointer-events-none absolute bottom-2 left-2 text-[#F3D98B]/50"
              aria-hidden="true"
            >
              <path
                d="M1.5 1.5C1.7 3.8 1.3 6.2 1.5 8.5C3.8 8.3 6.2 8.7 8.5 8.5"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="pointer-events-none absolute right-2 bottom-2 text-[#F3D98B]/50"
              aria-hidden="true"
            >
              <path
                d="M8.5 1.5C8.7 3.8 8.3 6.2 8.5 8.5C6.2 8.7 3.8 8.3 1.5 8.5"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>

            <h2 className="text-sm font-normal tracking-[0.24em] text-[#FAF9F6]">
              是否要儲存這張信紙？
            </h2>

            {/* Mailbox Selector (1 ~ 6) */}
            <div className="mt-3.5 w-full border-y border-[#FAF9F6]/15 py-2.5">
              <div className="mb-2 flex items-center justify-between px-0.5">
                <span className="text-[11px] font-light tracking-[0.18em] text-[#D8D8D2]">
                  選擇投遞郵筒
                </span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-[#F3D98B]">
                  POST #{selectedMailbox}
                </span>
              </div>
              <div
                role="group"
                aria-label="選擇 1 到 6 號郵筒"
                className="grid grid-cols-6 gap-1.5"
              >
                {MAILBOX_NUMBERS.map((num) => {
                  const active = selectedMailbox === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setSelectedMailbox(num)}
                      aria-pressed={active}
                      aria-label={`郵筒 ${num}`}
                      className={`sketch-pill-dark flex h-8 items-center justify-center border font-mono text-xs transition-all duration-200 active:scale-95 ${
                        active
                          ? "border-[#F3D98B] bg-[#F3D98B] font-medium text-[#141416]"
                          : "border-[#FAF9F6]/30 bg-transparent text-[#FAF9F6]/80 hover:border-[#FAF9F6]/80 hover:text-[#FAF9F6]"
                      }`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Three Action Buttons: Save JPG / Send Directly / Return to Edit */}
            <div className="mt-3.5 flex w-full flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSaveAndProceedToEnvelope}
                className="sketch-pill-dark inline-flex h-9 flex-1 items-center justify-center gap-2 border border-[#F3D98B] bg-[#F3D98B] px-4 text-xs font-normal tracking-[0.14em] text-[#141416] transition-all duration-250 hover:bg-[#FAF9F6] hover:border-[#FAF9F6] active:scale-[0.98]"
              >
                <DownloadIcon size={14} />
                <span>儲存信紙（JPG）</span>
              </button>

              <button
                type="button"
                onClick={handleSkipSaveAndProceedToEnvelope}
                className="sketch-pill-dark inline-flex h-9 flex-1 items-center justify-center gap-2 border border-[#FAF9F6]/85 bg-transparent px-4 text-xs font-normal tracking-[0.14em] text-[#FAF9F6] transition-all duration-250 hover:bg-[#FAF9F6]/12 active:scale-[0.98]"
              >
                <PaperPlaneIcon size={13} />
                <span>不儲存，直接寄出</span>
              </button>

              <button
                type="button"
                onClick={handleReturnToEdit}
                className="sketch-pill-dark inline-flex h-9 items-center justify-center border border-[#FAF9F6]/35 bg-transparent px-4 text-xs font-light tracking-[0.14em] text-[#D8D8D2] transition-all duration-250 hover:border-[#FAF9F6]/80 hover:text-[#FAF9F6] active:scale-[0.98]"
              >
                <span>返回修改</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* DIRECT-TO-R2 UPLOAD STATUS TOAST (UPLOADING / SUCCESS / ERROR)    */}
      {/* ================================================================= */}
      {uploadStatus.state !== "idle" && activePost === 0 && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-3 sm:top-5"
        >
          <div
            className={`animate-muji-modal-in pointer-events-auto flex max-w-[94vw] flex-wrap items-center justify-center gap-2 border px-3.5 py-2 text-xs transition-colors duration-300 ${
              isDarkAtmosphere
                ? "sketch-card-dark border-[#FAF9F6]/70 bg-[#121215]/95 text-[#FAF9F6]"
                : "sketch-card border-[#222222] bg-[#FDFCF9]/95 text-[#222222]"
            }`}
          >
            {uploadStatus.state === "uploading" && (
              <>
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent" />
                <span className="tracking-[0.12em]">
                  {uploadStatus.phase === "requesting-url"
                    ? `正在準備郵筒 #${uploadStatus.mailbox} 上傳連結…`
                    : uploadStatus.phase === "uploading-r2"
                      ? `正在直傳 WebP 至郵筒 #${uploadStatus.mailbox}…`
                      : `正在收錄至郵筒 #${uploadStatus.mailbox}…`}
                </span>
              </>
            )}

            {uploadStatus.state === "success" && (
              <>
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    isDarkAtmosphere ? "bg-[#F3D98B]" : "bg-[#222222]"
                  }`}
                />
                <span className="tracking-[0.12em]">
                  已成功投入郵筒 #{uploadStatus.mailbox}
                </span>
              </>
            )}

            {uploadStatus.state === "error" && (
              <>
                <span className="max-w-[210px] truncate tracking-[0.08em] text-[#DF7A5E] sm:max-w-[300px]">
                  上傳失敗：{uploadStatus.message}
                </span>
                {uploadStatus.canRetry && (
                  <button
                    type="button"
                    onClick={handleRetryUpload}
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10.5px] tracking-[0.12em] transition-colors ${
                      isDarkAtmosphere
                        ? "border-[#FAF9F6]/75 text-[#FAF9F6] hover:bg-[#FAF9F6] hover:text-[#121215]"
                        : "border-[#222222] text-[#222222] hover:bg-[#222222] hover:text-[#FAF9F6]"
                    }`}
                  >
                    重試
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setUploadStatus({ state: "idle" })}
                  aria-label="關閉錯誤提示"
                  className="ml-0.5 shrink-0 opacity-65 transition-opacity hover:opacity-100"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SINGLE-MAILBOX GALLERY VIEW (ONLY WHEN `?post=1..6`, NEVER AT 0)  */}
      {/* ================================================================= */}
      {activePost !== 0 && (
        <LetterLibraryView
          mailbox={activePost}
          onWriteForMailbox={handleWriteForMailbox}
          onClose={returnToSendHome}
          refreshSignal={libraryRefreshSignal}
        />
      )}
    </div>
  );
}
