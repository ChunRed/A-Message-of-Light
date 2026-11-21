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
import {
  GridSamplingOverlay,
  LiveLetterRect,
} from "@/components/GridSamplingOverlay";
import { LetterLibraryView } from "@/components/LetterLibraryView";
import { PencilDraftingBox } from "@/components/PencilDraftingBox";
import { SentMailboxNotice } from "@/components/SentMailboxNotice";
import { SwipeUpSendGuide } from "@/components/SwipeUpSendGuide";
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
  | "awaiting-swipe"
  | "launching"
  | "sent-notice";

type UploadStatusState =
  | { state: "idle" }
  | { state: "uploading"; phase: UploadProgressPhase; mailbox: MailboxNumber }
  | { state: "success"; url: string; mailbox: MailboxNumber }
  | { state: "error"; message: string; canRetry: boolean };

type HistorySnapshot = {
  imageData: ImageData;
  strokeCount: number;
};

const MAX_HISTORY = 5;
const MIN_STROKES_TO_SEND = 2;
const SEND_COOLDOWN_SEC = 30;
const SEND_COOLDOWN_STORAGE_KEY = "light_msg_send_cooldown_until";

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
  const [strokeCount, setStrokeCount] = useState<number>(0);
  const [tooFewStrokesPhase, setTooFewStrokesPhase] = useState<
    "hidden" | "visible" | "fading"
  >("hidden");
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);
  const [showDrawGuide, setShowDrawGuide] = useState<boolean>(false);
  const hasShownGuideOnceRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  // Keep initial value deterministic for SSR/hydration (avoids React #418 timezone mismatch);
  // populated on client mount via requestAnimationFrame.
  const [dateStamp, setDateStamp] = useState<string>("");

  // Measured exact DOM rect of the 2D paper slot so Three.js aligns pixel-for-pixel
  const [paperTargetRect, setPaperTargetRect] =
    useState<TargetPaperRect | null>(null);

  // Post-send pipeline state (Step A snapshot + Quadtree sampling + Swipe-to-send + Sent notice)
  const [savedLetterJpg, setSavedLetterJpg] = useState<string | null>(null);
  const [samplingResult, setSamplingResult] =
    useState<GridSamplingResult | null>(null);
  const [settledStripCenterY, setSettledStripCenterY] = useState<number>(520);
  const [swipeProgress, setSwipeProgress] = useState<number>(0);
  const [sentMailbox, setSentMailbox] = useState<MailboxNumber>(1);
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
  const tooFewFadeTimerRef = useRef<number | null>(null);
  const tooFewHideTimerRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef<number>(0);
  const strokeCountRef = useRef<number>(0);
  const pendingWebpPromiseRef = useRef<Promise<Blob> | null>(null);
  const lastUploadPayloadRef = useRef<{
    blob: Blob;
    mailbox: MailboxNumber;
  } | null>(null);
  const paperBoxRef = useRef<HTMLDivElement | null>(null);
  const paperVisualRef = useRef<HTMLDivElement | null>(null);
  const paperTransformStateRef = useRef<{
    scale: number;
    offsetY: number;
    rafId: number;
  }>({ scale: 1, offsetY: 0, rafId: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 1,
  });

  // 5-Step Undo/Redo ImageData history stack (index 0 = initial blank + up to 5 steps)
  const historyRef = useRef<HistorySnapshot[]>([]);
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

  const checkCanvasHasInk = useCallback((imgData: ImageData): boolean => {
    const data = imgData.data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 4) return true;
    }
    return false;
  }, []);

  const pushHistorySnapshot = useCallback(
    (nextStrokeCount: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;

      const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hasInkNow = checkCanvasHasInk(snap);
      const normalizedCount = hasInkNow ? nextStrokeCount : 0;

      strokeCountRef.current = normalizedCount;
      setStrokeCount(normalizedCount);
      setHasStrokes(hasInkNow);

      const nextStack = historyRef.current.slice(0, historyIndexRef.current + 1);
      nextStack.push({ imageData: snap, strokeCount: normalizedCount });

      while (nextStack.length > MAX_HISTORY + 1) {
        nextStack.shift();
      }

      historyRef.current = nextStack;
      historyIndexRef.current = nextStack.length - 1;
      updateHistoryFlags();
    },
    [checkCanvasHasInk, updateHistoryFlags]
  );

  const handleUndo = useCallback(() => {
    if (postSendStage !== "idle" || historyIndexRef.current <= 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;

    historyIndexRef.current -= 1;
    const targetSnap = historyRef.current[historyIndexRef.current];
    if (targetSnap) {
      ctx.putImageData(targetSnap.imageData, 0, 0);
      const hasInkNow = checkCanvasHasInk(targetSnap.imageData);
      const nextCount = hasInkNow ? targetSnap.strokeCount : 0;
      strokeCountRef.current = nextCount;
      setStrokeCount(nextCount);
      setHasStrokes(hasInkNow);
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
      ctx.putImageData(targetSnap.imageData, 0, 0);
      const hasInkNow = checkCanvasHasInk(targetSnap.imageData);
      const nextCount = hasInkNow ? targetSnap.strokeCount : 0;
      strokeCountRef.current = nextCount;
      setStrokeCount(nextCount);
      setHasStrokes(hasInkNow);
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
        historyRef.current = [
          { imageData: initSnap, strokeCount: strokeCountRef.current },
        ];
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
          const nextCount =
            tool === "brush"
              ? strokeCountRef.current + 1
              : strokeCountRef.current;
          pushHistorySnapshot(nextCount);
        }
      }
      if (e.pointerType !== "mouse") {
        setEraserCursor((prev) => ({ ...prev, visible: false }));
      }
    },
    [pushHistorySnapshot, tool]
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
      strokeCountRef.current = 0;
      setStrokeCount(0);
      setHasStrokes(false);
      pushHistorySnapshot(0);
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

  // Detect `?post=1..6` and populate client-local `dateStamp` safely after hydration
  // (avoids React #418 SSR/client text mismatch across timezones).
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

    const rafId = window.requestAnimationFrame(() => {
      setDateStamp(getFormattedDateStamp());
      applyPostParamFromLocation();
    });
    window.addEventListener("popstate", applyPostParamFromLocation);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("popstate", applyPostParamFromLocation);
    };
  }, []);

  // Synchronized 60fps letter shrink & lift during sampling/confirm-save so the
  // 30-CH Quadtree strip settles cleanly BELOW the letter without obstructing a single stroke!
  const isCompactSamplingLayout =
    postSendStage === "sampling" || postSendStage === "confirm-save";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const computeTargets = () => {
      if (!isCompactSamplingLayout || !paperBoxRef.current) {
        return { targetScale: 1, targetOffsetY: 0, stripCenterY: window.innerHeight * 0.65 };
      }

      const rect = paperBoxRef.current.getBoundingClientRect();
      const vpH = window.innerHeight;
      const vpW = window.innerWidth;
      const isMobile = vpW < 640;

      // Exact vertical budget guaranteeing 0px overlap between:
      // [Top margin] -> [Scaled letter] -> [Leader gap] -> [30-CH strip plate] -> [Gap] -> [Confirm card]
      const confirmCardReserve = isMobile ? 228 : 204;
      const gapStripToCard = isMobile ? 16 : 20;
      const stripHalfBottom = 34; // plateBottom extends ~32px below stripCenterY
      const stripHalfTop = 34; // plateTop extends ~32px above stripCenterY
      const gapLetterToStrip = isMobile ? 20 : 26;
      const topSafeMargin = isMobile ? 12 : 18;

      const totalBelowLetter =
        gapLetterToStrip +
        stripHalfTop +
        stripHalfBottom +
        gapStripToCard +
        confirmCardReserve;

      const availLetterH = Math.max(150, vpH - topSafeMargin - totalBelowLetter);
      const targetScale = Math.min(
        0.72,
        Math.max(0.34, availLetterH / Math.max(1, rect.height))
      );
      const scaledH = rect.height * targetScale;

      const desiredTop =
        topSafeMargin + Math.max(0, (availLetterH - scaledH) * 0.42);
      const desiredCenterY = desiredTop + scaledH * 0.5;
      const origCenterY = rect.top + rect.height * 0.5;
      const targetOffsetY = desiredCenterY - origCenterY;

      const letterBottom = desiredTop + scaledH;
      const maxStripCenterY =
        vpH - confirmCardReserve - gapStripToCard - stripHalfBottom;
      const idealStripCenterY = letterBottom + gapLetterToStrip + stripHalfTop;
      const stripCenterY = Math.min(maxStripCenterY, idealStripCenterY);

      return { targetScale, targetOffsetY, stripCenterY };
    };

    const { targetScale, targetOffsetY, stripCenterY } = computeTargets();
    const tState = paperTransformStateRef.current;
    if (tState.rafId) {
      window.cancelAnimationFrame(tState.rafId);
      tState.rafId = 0;
    }

    const startScale = tState.scale;
    const startOffsetY = tState.offsetY;
    const startMs = performance.now();
    const durationMs = 560;

    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - startMs) / durationMs));
      const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const curScale = startScale + (targetScale - startScale) * ease;
      const curOffsetY = startOffsetY + (targetOffsetY - startOffsetY) * ease;

      tState.scale = curScale;
      tState.offsetY = curOffsetY;

      if (paperVisualRef.current) {
        paperVisualRef.current.style.transform =
          curScale === 1 && Math.abs(curOffsetY) < 0.05
            ? ""
            : `translate3d(0, ${curOffsetY.toFixed(2)}px, 0) scale(${curScale.toFixed(4)})`;
      }
      sceneRef.current?.setPaperDisplayTransform(curScale, curOffsetY);

      if (p < 1) {
        tState.rafId = window.requestAnimationFrame(step);
      } else {
        tState.rafId = 0;
      }
    };

    const initRaf = window.requestAnimationFrame((now) => {
      if (isCompactSamplingLayout) {
        setSettledStripCenterY(stripCenterY);
      }
      step(now);
    });

    const onResize = () => {
      if (!isCompactSamplingLayout) return;
      const next = computeTargets();
      tState.scale = next.targetScale;
      tState.offsetY = next.targetOffsetY;
      if (paperVisualRef.current) {
        paperVisualRef.current.style.transform = `translate3d(0, ${next.targetOffsetY.toFixed(2)}px, 0) scale(${next.targetScale.toFixed(4)})`;
      }
      sceneRef.current?.setPaperDisplayTransform(
        next.targetScale,
        next.targetOffsetY
      );
      setSettledStripCenterY(next.stripCenterY);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(initRaf);
      if (tState.rafId) {
        window.cancelAnimationFrame(tState.rafId);
        tState.rafId = 0;
      }
      window.removeEventListener("resize", onResize);
    };
  }, [isCompactSamplingLayout]);

  const getLiveLetterRect = useCallback((): LiveLetterRect | null => {
    const el = paperVisualRef.current ?? paperBoxRef.current;
    if (!el) return paperTargetRect;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return paperTargetRect;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, [paperTargetRect]);

  // Start 30-second post-send cooldown (persisted to localStorage so refresh respects it)
  const startSendCooldown = useCallback(() => {
    const until = Date.now() + SEND_COOLDOWN_SEC * 1000;
    cooldownUntilRef.current = until;
    setCooldownRemainingSec(SEND_COOLDOWN_SEC);
    try {
      window.localStorage.setItem(SEND_COOLDOWN_STORAGE_KEY, String(until));
    } catch {
      // ignore storage quota / private mode
    }
  }, []);

  // Show gentle fade-in -> hold -> fade-out prompt when user tries to send with < 2 strokes
  const triggerTooFewStrokesHint = useCallback(() => {
    if (tooFewFadeTimerRef.current !== null) {
      window.clearTimeout(tooFewFadeTimerRef.current);
    }
    if (tooFewHideTimerRef.current !== null) {
      window.clearTimeout(tooFewHideTimerRef.current);
    }

    setTooFewStrokesPhase("visible");

    tooFewFadeTimerRef.current = window.setTimeout(() => {
      setTooFewStrokesPhase("fading");
    }, 2300);

    tooFewHideTimerRef.current = window.setTimeout(() => {
      setTooFewStrokesPhase("hidden");
    }, 2950);
  }, []);

  // Hydrate persisted 30-second cooldown safely on mount & tick countdown smoothly
  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncCooldown = () => {
      const remMs = cooldownUntilRef.current - Date.now();
      const remSec = remMs > 0 ? Math.ceil(remMs / 1000) : 0;
      setCooldownRemainingSec((prev) => (prev === remSec ? prev : remSec));
      if (remSec === 0 && cooldownUntilRef.current > 0) {
        cooldownUntilRef.current = 0;
        try {
          window.localStorage.removeItem(SEND_COOLDOWN_STORAGE_KEY);
        } catch {
          // ignore
        }
      }
    };

    const rafId = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(SEND_COOLDOWN_STORAGE_KEY);
        const parsed = stored ? Number(stored) : 0;
        if (Number.isFinite(parsed) && parsed > Date.now()) {
          cooldownUntilRef.current = parsed;
          syncCooldown();
        }
      } catch {
        // ignore
      }
    });

    const intervalId = window.setInterval(syncCooldown, 250);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(intervalId);
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
      if (tooFewFadeTimerRef.current !== null) {
        window.clearTimeout(tooFewFadeTimerRef.current);
        tooFewFadeTimerRef.current = null;
      }
      if (tooFewHideTimerRef.current !== null) {
        window.clearTimeout(tooFewHideTimerRef.current);
        tooFewHideTimerRef.current = null;
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
        const effectiveDate = dateStamp || getFormattedDateStamp();
        const safeStamp = effectiveDate.replace(/\./g, "-");
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
      historyRef.current = [{ imageData: freshSnap, strokeCount: 0 }];
      historyIndexRef.current = 0;
      updateHistoryFlags();
    }

    dissolvePaletteRef.current = [];
    strokeCountRef.current = 0;
    setStrokeCount(0);
    setHasStrokes(false);
    setTooFewStrokesPhase("hidden");
    setSavedLetterJpg(null);
    setSamplingResult(null);
    setSwipeProgress(0);
    setPostSendStage("idle");
    setIsBrushLabOpen(false);
    setShowDrawGuide(false);
    setIsRefoldDragging(false);
    hasShownGuideOnceRef.current = false;

    if (paperVisualRef.current) {
      paperVisualRef.current.style.transform = "";
    }
    paperTransformStateRef.current.scale = 1;
    paperTransformStateRef.current.offsetY = 0;

    sceneRef.current?.resetToFreshFolded();
  }, [updateHistoryFlags]);

  // =========================================================================
  // STAGE 1: PRESS "寄出"
  // - 0ms snapshot high-res original JPG & WebP (0.85)
  // - Background smoothly darkens to matte black #0B0B0D (0.8s)
  // - Letter smoothly scales down & lifts so the 30-CH Quadtree strip settles
  //   cleanly BELOW the paper without blocking any stroke!
  // =========================================================================
  const handleSendLetter = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || postSendStage !== "idle" || sceneMode !== "flat") return;

    // Respect 30-second post-send cooldown
    if (cooldownRemainingSec > 0) return;

    // Require at least 2 drawn strokes before allowing send
    if (!hasStrokes || strokeCount < MIN_STROKES_TO_SEND) {
      setIsBrushLabOpen(false);
      triggerTooFewStrokesHint();
      return;
    }

    setIsBrushLabOpen(false);
    setShowDrawGuide(false);
    setTooFewStrokesPhase("hidden");
    setEraserCursor((prev) => ({ ...prev, visible: false }));

    const { width, height } = canvasSizeRef.current;
    const effectiveDate = dateStamp || getFormattedDateStamp();

    // 0ms: Synchronously composite stationery + original strokes into high-res JPG
    // AND asynchronously prepare `image/webp` (quality 0.85) Blob for direct R2 upload
    try {
      const fullArtworkJpg = exportLetterAsJpg(
        canvas,
        width,
        height,
        effectiveDate
      );
      setSavedLetterJpg(fullArtworkJpg);
      pendingWebpPromiseRef.current = exportLetterAsWebpBlob(
        canvas,
        width,
        height,
        effectiveDate,
        0.85
      );
    } catch (err) {
      console.error("Failed to snapshot pre-sampling letter:", err);
      pendingWebpPromiseRef.current = null;
    }

    // Run Best-First Quadtree detail-richness sampling -> 30-CH [0..255] + feature anchors
    const result = sampleDrawingToGridAnd30Led(canvas, width, height);
    publishLightSequenceToHardware(result.ledValues);

    setSamplingResult(result);
    setPostSendStage("sampling");
  }, [
    cooldownRemainingSec,
    dateStamp,
    hasStrokes,
    postSendStage,
    sceneMode,
    strokeCount,
    triggerTooFewStrokesHint,
  ]);

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
      (paperVisualRef.current ?? paperBoxRef.current)?.getBoundingClientRect() ??
      paperTargetRect;
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
    setSentMailbox(targetMailbox);
    setSwipeProgress(0);
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

    // Wait for strokes & Quadtree overlay to dissolve before beginning 3D Z-fold showcase
    stageTimerRef.current = window.setTimeout(() => {
      // Stop outer perimeter ambient spawner so creases & envelope opening become the starlight source
      sparkleRef.current?.setAmbientActive(false, null);
      setPostSendStage("enveloping");

      sceneRef.current?.startEnvelopeAndSend(
        () => {
          // Stage 4.2: User swiped envelope straight up & it exited ->
          // dissipate sparkles, brighten background to warm cotton paper,
          // and slowly fade in pencil notice ("請到 N 號郵筒查看信件") for 5 seconds!
          sparkleRef.current?.fadeOutAndClear(false);
          setPostSendStage("sent-notice");
        },
        (burst) => {
          sparkleRef.current?.emitBurst({
            ...burst,
            palette: dissolvePaletteRef.current,
          });
        },
        {
          onReadyToSwipe: () => {
            setSwipeProgress(0);
            setPostSendStage("awaiting-swipe");
          },
          onSwipeProgress: (p) => {
            setSwipeProgress(p);
          },
          onSwipeLaunched: () => {
            startSendCooldown();
            setPostSendStage("launching");
          },
        }
      );
    }, 1020);
  }, [paperTargetRect, runDirectR2Upload, selectedMailbox, startSendCooldown]);

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
    postSendStage === "enveloping" ||
    postSendStage === "awaiting-swipe" ||
    postSendStage === "launching";

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
            {/* Transformable Visual Wrapper synchronized 1:1 with 3D letter shrink/lift */}
            <div
              ref={paperVisualRef}
              className="relative h-full w-full"
              style={{ transformOrigin: "center center" }}
            >
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
            </div>

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

            {/* Gentle Fade-In / Fade-Out Prompt when user tries to send with < 2 strokes */}
            {isFlatEditable && tooFewStrokesPhase !== "hidden" && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-5"
              >
                <div
                  className={`sketch-card border border-[#222222]/80 bg-[#FDFCF9]/95 px-5 py-3 text-center backdrop-blur-[2px] transition-all duration-500 ease-in-out ${
                    tooFewStrokesPhase === "visible"
                      ? "translate-y-0 opacity-100"
                      : "-translate-y-1.5 opacity-0"
                  }`}
                >
                  <p className="text-xs font-normal tracking-[0.16em] text-[#222222] sm:text-[13px]">
                    你不可能只有這些想法吧～再多畫一點吧！
                  </p>
                </div>
              </div>
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
                disabled={postSendStage !== "idle" || cooldownRemainingSec > 0}
                title={
                  cooldownRemainingSec > 0
                    ? `寄出冷卻中，請稍候 ${cooldownRemainingSec} 秒`
                    : "寄出信件"
                }
                className="sketch-pill group ml-0.5 inline-flex h-8 items-center gap-1.5 border border-[#222222] bg-[#222222] px-4 text-xs font-normal tracking-[0.16em] text-[#FAF9F6] transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FDFCF9] hover:text-[#222222] active:scale-[0.97] disabled:cursor-not-allowed disabled:border-[#222222]/35 disabled:bg-[#222222]/10 disabled:text-[#222222]/55 disabled:hover:bg-[#222222]/10 disabled:hover:text-[#222222]/55"
              >
                <PaperPlaneIcon
                  size={13}
                  className={
                    cooldownRemainingSec > 0
                      ? "opacity-50"
                      : "transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  }
                />
                {cooldownRemainingSec > 0 ? (
                  <span className="font-mono text-[11px] tabular-nums tracking-[0.1em]">
                    冷卻 {cooldownRemainingSec}s
                  </span>
                ) : (
                  <span>寄出</span>
                )}
              </button>
            </div>
          </div>
        </footer>
      </div>

      {/* ================================================================= */}
      {/* STAGE 2: HAND-DRAWN PENCIL DRAFTING SAVE CONFIRMATION CARD        */}
      {/* Symmetrically aligned with the 30-CH drafting plate above it      */}
      {/* ================================================================= */}
      {postSendStage === "confirm-save" && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="是否要儲存這張信紙？"
          className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-4 sm:bottom-4 sm:px-6"
        >
          <PencilDraftingBox className="animate-muji-modal-in pointer-events-auto w-full max-w-[520px] bg-[#121216]/92 px-4 py-3.5 backdrop-blur-[4px] sm:px-5 sm:py-4">
            <div className="flex w-full flex-col items-center">
              {/* Crisp top eyebrow metadata + clean centered single-line title */}
              <div className="flex w-full items-center justify-between font-mono text-[8.5px] tracking-[0.2em]">
                <span className="text-[#F3D98B]/60">CONFIRM // ARCHIVE</span>
                <span className="text-[#F3D98B]">POST #{selectedMailbox}</span>
              </div>

              <h2 className="mt-1 whitespace-nowrap text-center text-[13.5px] font-normal tracking-[0.22em] text-[#FAF9F6] sm:text-sm">
                是否要儲存這張信紙？
              </h2>

              {/* Mailbox Selector (1 ~ 6) */}
              <div className="mt-2.5 w-full border-y border-dashed border-[#F3D98B]/22 py-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10.5px] font-light tracking-[0.18em] text-[#D8D8D2]">
                    選擇投遞郵筒
                  </span>
                  <span className="font-mono text-[8.5px] tracking-[0.16em] text-[#FAF9F6]/45">
                    MAILBOX 01–06
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="選擇 1 到 6 號郵筒"
                  className="grid w-full grid-cols-6 gap-1.5 sm:gap-2"
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
                        className={`sketch-pill-dark flex h-7.5 w-full items-center justify-center border font-mono text-xs transition-all duration-200 active:scale-95 ${
                          active
                            ? "border-[#F3D98B] bg-[#F3D98B] font-medium text-[#141416]"
                            : "border-[#FAF9F6]/28 bg-transparent text-[#FAF9F6]/80 hover:border-[#F3D98B]/75 hover:text-[#FAF9F6]"
                        }`}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Three Action Buttons: cleanly proportioned & symmetrically padded */}
              <div className="mt-2.5 grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={handleSaveAndProceedToEnvelope}
                  className="sketch-pill-dark inline-flex h-8.5 w-full items-center justify-center gap-1.5 whitespace-nowrap border border-[#F3D98B] bg-[#F3D98B] px-2.5 text-[11px] font-normal tracking-[0.1em] text-[#141416] transition-all duration-250 hover:border-[#FAF9F6] hover:bg-[#FAF9F6] active:scale-[0.98] sm:h-9 sm:text-xs"
                >
                  <DownloadIcon size={13} />
                  <span>儲存信紙 (JPG)</span>
                </button>

                <button
                  type="button"
                  onClick={handleSkipSaveAndProceedToEnvelope}
                  className="sketch-pill-dark inline-flex h-8.5 w-full items-center justify-center gap-1.5 whitespace-nowrap border border-[#FAF9F6]/75 bg-transparent px-2.5 text-[11px] font-normal tracking-[0.1em] text-[#FAF9F6] transition-all duration-250 hover:bg-[#FAF9F6]/12 active:scale-[0.98] sm:h-9 sm:text-xs"
                >
                  <PaperPlaneIcon size={12} />
                  <span>不儲存，直接寄出</span>
                </button>

                <button
                  type="button"
                  onClick={handleReturnToEdit}
                  className="sketch-pill-dark col-span-2 inline-flex h-7.5 w-full items-center justify-center whitespace-nowrap border border-[#FAF9F6]/30 bg-transparent px-3 text-[11px] font-light tracking-[0.16em] text-[#D8D8D2] transition-all duration-250 hover:border-[#FAF9F6]/75 hover:text-[#FAF9F6] active:scale-[0.98] sm:col-span-1 sm:h-9 sm:text-xs"
                >
                  <span>返回修改</span>
                </button>
              </div>
            </div>
          </PencilDraftingBox>
        </div>
      )}

      {/* ================================================================= */}
      {/* FULL-VIEWPORT QUADTREE SAMPLING + LEADER LINES + BELOW-LETTER BAR */}
      {/* Persists during confirm-save so audience sees stroke -> 30-CH     */}
      {/* ================================================================= */}
      {isSamplingOverlayMounted && samplingResult && (
        <div
          className={`pointer-events-none fixed inset-0 z-30 transition-opacity duration-[650ms] ease-out ${
            postSendStage === "dissolving" ? "opacity-0" : "opacity-100"
          }`}
        >
          <GridSamplingOverlay
            samplingResult={samplingResult}
            getLiveLetterRect={getLiveLetterRect}
            settledStripCenterY={settledStripCenterY}
            onComplete={handleSamplingComplete}
          />
        </div>
      )}

      {/* ================================================================= */}
      {/* STAGE 3.5: INTERACTIVE SWIPE-UP-TO-SEND HAND-DRAWN GUIDE UI       */}
      {/* ================================================================= */}
      {postSendStage === "awaiting-swipe" && (
        <SwipeUpSendGuide
          swipeProgress={swipeProgress}
          mailbox={sentMailbox}
        />
      )}

      {/* ================================================================= */}
      {/* STAGE 4.2: POST-SEND PENCIL NOTICE (FADE IN -> 5s HOLD -> FADE)   */}
      {/* ================================================================= */}
      {postSendStage === "sent-notice" && (
        <SentMailboxNotice
          mailbox={sentMailbox}
          onFinished={resetToFreshLoop}
        />
      )}

      {/* ================================================================= */}
      {/* DIRECT-TO-R2 UPLOAD STATUS TOAST (UPLOADING / SUCCESS / ERROR)    */}
      {/* ================================================================= */}
      {uploadStatus.state !== "idle" &&
        activePost === 0 &&
        (postSendStage !== "sent-notice" || uploadStatus.state === "error") && (
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
