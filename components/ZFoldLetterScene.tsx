"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import {
  drawCentered30UnitStrip,
  SETTLED_STRIP_Y_RATIO,
} from "@/lib/grid-sampling";
import {
  buildJittered3DLineSegments,
  createSeededRng,
  drawHandDrawnPostageStamp,
  drawSketchyLine,
  drawWashiPaperTexture,
} from "@/lib/hand-drawn-utils";

export interface TargetPaperRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type LetterSceneMode = "folded" | "transitioning" | "flat" | "sending";

export interface SceneSparkleBurstEvent {
  x: number;
  y: number;
  spreadX: number;
  spreadY: number;
  count: number;
  vxBias: number;
  vyBias: number;
  speedMin?: number;
  speedMax?: number;
  sizeScale?: number;
}

export interface ZFoldSceneHandle {
  /** Composites the user's transparent 2D drawing canvas onto the 3D letter texture */
  syncDrawingCanvas: (drawingCanvas: HTMLCanvasElement | null) => void;
  /** Bakes the stationery + preserved original hand-drawn strokes + lower 30-unit strip onto the 3D letter texture */
  syncSampledStripTo3D: (
    ledValues: number[],
    drawingCanvas: HTMLCanvasElement | null
  ) => void;
  /**
   * Runs Stage 3 & Stage 4 choreography:
   * 0.6s Z-fold half-fold (65 deg) -> 1.8s left/right pendulum showcase (+35/-35 deg, -8 deg pitch)
   * -> press flat & slide into 1px wireframe envelope -> seal -> 0.2s pause -> 0.7s pure vertical upward flight (X = 0)
   */
  startEnvelopeAndSend: (
    onComplete: () => void,
    onEmitSparkles?: (event: SceneSparkleBurstEvent) => void
  ) => void;
  /** Resets the 3D scene & texture back to a fresh blank floating Z-fold letter */
  resetToFreshFolded: () => void;
  /** Starts an interactive pull-up-to-refold gesture from the flat state */
  beginRefoldPull: () => void;
  /** Updates interactive pull-up distance in pixels (positive = pulling up) */
  updateRefoldPull: (pullUpPx: number) => void;
  /** Finishes interactive pull-up gesture (snaps to folded or rebounds to flat) */
  endRefoldPull: () => void;
  /** Smoothly folds the letter back into 3D Z-shape */
  triggerFold: () => void;
  /** Smoothly unfolds the letter into flat 2D drawing alignment */
  triggerUnfold: () => void;
}

interface ZFoldLetterSceneProps {
  dateStamp: string;
  targetBoxRect: TargetPaperRect | null;
  onModeChange: (mode: LetterSceneMode) => void;
}

const UNFOLD_THRESHOLD = 0.62;
const REFOLD_THRESHOLD = 0.72;
const MAX_FOLD_ANGLE = 2.48;
const HALF_FOLD_RAD = THREE.MathUtils.degToRad(65); // Crisp 65° accordion Z-fold showcase
const FLAT_ENVELOPE_FOLD = THREE.MathUtils.degToRad(176.5); // Pressed flat (~180°) packet without z-fighting
const SHOWCASE_SWING_Y = THREE.MathUtils.degToRad(35); // +35° left / -35° right horizontal arc
const SHOWCASE_PITCH_X = THREE.MathUtils.degToRad(8); // -8° downward camera pitch = +8° model X tilt

const TEX_W = 1200;
const TEX_H = 1740;

const SEND_TOTAL_SEC = 4.78;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * Exact smooth pendulum easing: cubic-bezier(0.45, 0, 0.55, 1)
 */
function easePendulum(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.45;
  const x2 = 0.55;
  let u = t;
  for (let i = 0; i < 5; i++) {
    const inv = 1 - u;
    const bx = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
    const dx =
      3 * inv * inv * x1 +
      6 * inv * u * (x2 - x1) +
      3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-5) break;
    u = Math.max(0, Math.min(1, u - (bx - t) / dx));
  }
  // y1 = 0, y2 = 1 -> B_y(u) = 3*(1-u)*u^2 + u^3 = u^2 * (3 - 2*u)
  return u * u * (3 - 2 * u);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Renders the unified high-resolution hand-drawn Muji cotton stationery background
 * (tactile washi paper grain & cotton fibers, hand-ruled jittery square grid,
 * sketchy corner ticks, hand-drawn postage stamp & postmark, and bottom-left title)
 * onto a single 1200x1740 offscreen canvas shared across all 3 UV-mapped Z-fold panels.
 */
function createUnifiedStationeryCanvas(dateStamp: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const rng = createSeededRng(20261120);

  // 1. Handmade cotton / washi paper grain, subtle tonal clouds & organic fibers
  drawWashiPaperTexture(ctx, TEX_W, TEX_H, 20261120);

  const padX = 80;

  // 2. Hand-sketched jittery corner crop marks with tiny dip-pen overshoot
  const cropOpts = {
    stepPx: 10,
    jitterAmp: 1.05,
    lineWidth: 2.1,
    strokeStyle: "rgba(34, 34, 34, 0.34)",
    overshoot: 2.2,
  };
  drawSketchyLine(ctx, 30, 60, 30, 30, rng, cropOpts);
  drawSketchyLine(ctx, 30, 30, 60, 30, rng, cropOpts);
  drawSketchyLine(ctx, TEX_W - 60, 30, TEX_W - 30, 30, rng, cropOpts);
  drawSketchyLine(ctx, TEX_W - 30, 30, TEX_W - 30, 60, rng, cropOpts);
  drawSketchyLine(ctx, 30, TEX_H - 60, 30, TEX_H - 30, rng, cropOpts);
  drawSketchyLine(ctx, 30, TEX_H - 30, 60, TEX_H - 30, rng, cropOpts);
  drawSketchyLine(ctx, TEX_W - 60, TEX_H - 30, TEX_W - 30, TEX_H - 30, rng, cropOpts);
  drawSketchyLine(ctx, TEX_W - 30, TEX_H - 30, TEX_W - 30, TEX_H - 60, rng, cropOpts);

  // 3. Date metadata + subtle hand-ruled graphite underline
  ctx.fillStyle = "#7D7D7A";
  ctx.font = '400 24px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`DATE // ${dateStamp}`, padX, 60);
  drawSketchyLine(ctx, padX, 95, padX + 276, 95, rng, {
    stepPx: 14,
    jitterAmp: 0.9,
    lineWidth: 1.5,
    strokeStyle: "rgba(34, 34, 34, 0.16)",
    overshoot: 2,
  });

  // 4. Hand-drawn perforated postage stamp & organic wavy postmark
  const sx = TEX_W - padX - 90;
  const sy = 40;
  const sw = 90;
  const sh = 110;
  drawHandDrawnPostageStamp(ctx, sx, sy, sw, sh, 2.45, rng);

  // 5. Hand-ruled jittery Muji square graph grid spanning continuously across all 3 panels
  const gridTop = 180;
  const gridBottom = TEX_H - 134;
  const gridStep = 46;
  ctx.save();
  for (let y = gridTop; y <= gridBottom; y += gridStep) {
    drawSketchyLine(ctx, padX, y, TEX_W - padX, y, rng, {
      stepPx: 26,
      jitterAmp: 1.05,
      lineWidth: 1.45,
      strokeStyle: "rgba(34, 34, 34, 0.082)",
      overshoot: 2.4,
    });
  }
  for (let x = padX; x <= TEX_W - padX; x += gridStep) {
    drawSketchyLine(ctx, x, gridTop, x, gridBottom, rng, {
      stepPx: 28,
      jitterAmp: 1.05,
      lineWidth: 1.45,
      strokeStyle: "rgba(34, 34, 34, 0.082)",
      overshoot: 2.4,
    });
  }
  ctx.restore();

  // 6. Front-panel / Bottom-left minimalist title + tiny hand-sketched 4-point star accent
  ctx.fillStyle = "#222222";
  ctx.font = '400 44px "Noto Sans TC", -apple-system, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("一則光的訊息", padX, TEX_H - 72);

  // Tiny hand-drawn 4-point dip-pen sparkle beside title
  const starX = padX + 292;
  const starY = TEX_H - 94;
  drawSketchyLine(ctx, starX, starY - 12, starX, starY + 12, rng, {
    stepPx: 5,
    jitterAmp: 0.7,
    lineWidth: 1.8,
    strokeStyle: "rgba(34, 34, 34, 0.62)",
  });
  drawSketchyLine(ctx, starX - 9, starY, starX + 9, starY, rng, {
    stepPx: 5,
    jitterAmp: 0.7,
    lineWidth: 1.8,
    strokeStyle: "rgba(34, 34, 34, 0.62)",
  });

  ctx.fillStyle = "#8C8C8A";
  ctx.font = '400 18px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillText("A MESSAGE OF LIGHT", padX + 2, TEX_H - 40);

  return canvas;
}

/**
 * Generates a tactile hand-drawn cotton illustration texture for the front pocket of the 3D envelope.
 */
function createEnvelopeFrontTexture(dateStamp: string): THREE.CanvasTexture {
  const w = 1024;
  const h = 630;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const rng = createSeededRng(88421);
    drawWashiPaperTexture(ctx, w, h, 88421);

    // Hand-sketched jittery diagonal envelope pocket seams
    const seamOpts = {
      stepPx: 18,
      jitterAmp: 1.4,
      lineWidth: 2.3,
      strokeStyle: "rgba(34, 34, 34, 0.2)",
      doublePass: true,
    };
    drawSketchyLine(ctx, 4, h - 2, w * 0.42, h * 0.44, rng, seamOpts);
    drawSketchyLine(ctx, w * 0.42, h * 0.44, w * 0.58, h * 0.44, rng, seamOpts);
    drawSketchyLine(ctx, w * 0.58, h * 0.44, w - 4, h - 2, rng, seamOpts);

    // Minimalist bottom center title & serial
    ctx.fillStyle = "#222222";
    ctx.font = '300 32px "Noto Sans TC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("一 則 光 的 訊 息", w / 2, h * 0.71);

    // Subtle hand-ruled accent rule under title
    drawSketchyLine(ctx, w * 0.36, h * 0.77, w * 0.64, h * 0.77, rng, {
      stepPx: 16,
      jitterAmp: 1.0,
      lineWidth: 1.4,
      strokeStyle: "rgba(34, 34, 34, 0.22)",
    });

    ctx.fillStyle = "#7D7D7A";
    ctx.font = '400 16px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(`LIGHT.MSG // ${dateStamp}`, w / 2, h * 0.84);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createUvSlicedPlane(
  width: number,
  height: number,
  vMin: number,
  vMax: number
): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(width, height);
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const origV = uv.getY(i);
    uv.setY(i, vMin + origV * (vMax - vMin));
  }
  uv.needsUpdate = true;
  return geom;
}

function createFlatShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.08,
      size / 2,
      size / 2,
      size * 0.48
    );
    grad.addColorStop(0, "rgba(34, 34, 34, 0.095)");
    grad.addColorStop(0.6, "rgba(34, 34, 34, 0.048)");
    grad.addColorStop(1, "rgba(34, 34, 34, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export const ZFoldLetterScene = forwardRef<
  ZFoldSceneHandle,
  ZFoldLetterSceneProps
>(function ZFoldLetterScene({ dateStamp, targetBoxRect, onModeChange }, ref) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [uiProgress, setUiProgress] = useState<number>(0);
  const [isDraggingPull, setIsDraggingPull] = useState<boolean>(false);
  const [sceneMode, setSceneMode] = useState<LetterSceneMode>("folded");

  const targetRectRef = useRef<TargetPaperRect | null>(targetBoxRect);
  useEffect(() => {
    targetRectRef.current = targetBoxRect;
  }, [targetBoxRect]);

  const onModeChangeRef = useRef(onModeChange);
  useEffect(() => {
    onModeChangeRef.current = onModeChange;
  }, [onModeChange]);

  const texturePipelineRef = useRef<{
    baseCanvas: HTMLCanvasElement | null;
    compositeCanvas: HTMLCanvasElement | null;
    texture: THREE.CanvasTexture | null;
  }>({
    baseCanvas: null,
    compositeCanvas: null,
    texture: null,
  });

  // Continuous 60fps state machine (normal Z-fold + Stage 3/4 Envelope & Send choreography)
  const stateRef = useRef({
    targetProgress: 0,
    currentProgress: 0,
    targetRotY: -0.34,
    targetRotX: 0.08,
    currentRotY: -0.34,
    currentRotX: 0.08,
    isPointerDown: false,
    isExternalRefoldDrag: false,
    gestureMode: "none" as "none" | "orbit" | "pull",
    pointerStartX: 0,
    pointerStartY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    startProgress: 0,
    isAutoAnimating: false,
    lastEmittedMode: "folded" as LetterSceneMode,
    // Stage 3 & 4 Envelope + Sending Flight state
    isSendingSequence: false,
    sendStartMs: 0,
    sendCompleteFired: false,
    onSendComplete: null as (() => void) | null,
    onEmitSparkles: null as ((event: SceneSparkleBurstEvent) => void) | null,
    lastSparkleEmitMs: 0,
    // Gentle entrance fade-in when resetting to a brand-new blank loop
    introFadeStartMs: 0,
  });

  const syncDrawingCanvas = useCallback(
    (drawingCanvas: HTMLCanvasElement | null) => {
      const { baseCanvas, compositeCanvas, texture } =
        texturePipelineRef.current;
      if (!baseCanvas || !compositeCanvas || !texture) return;

      const ctx = compositeCanvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, TEX_W, TEX_H);
      ctx.drawImage(baseCanvas, 0, 0, TEX_W, TEX_H);
      if (drawingCanvas && drawingCanvas.width > 0 && drawingCanvas.height > 0) {
        ctx.drawImage(drawingCanvas, 0, 0, TEX_W, TEX_H);
      }
      texture.needsUpdate = true;
    },
    []
  );

  const syncSampledStripTo3D = useCallback(
    (ledValues: number[], drawingCanvas: HTMLCanvasElement | null) => {
      const { baseCanvas, compositeCanvas, texture } =
        texturePipelineRef.current;
      if (!baseCanvas || !compositeCanvas || !texture) return;

      const ctx = compositeCanvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, TEX_W, TEX_H);
      // 1. Stationery background
      ctx.drawImage(baseCanvas, 0, 0, TEX_W, TEX_H);
      // 2. Preserved original hand-drawn strokes
      if (drawingCanvas && drawingCanvas.width > 0 && drawingCanvas.height > 0) {
        ctx.drawImage(drawingCanvas, 0, 0, TEX_W, TEX_H);
      }
      // 3. Lower 30-unit horizontal grayscale strip at SETTLED_STRIP_Y_RATIO
      drawCentered30UnitStrip(
        ctx,
        ledValues,
        TEX_W,
        TEX_H,
        30,
        1,
        SETTLED_STRIP_Y_RATIO
      );
      texture.needsUpdate = true;
    },
    []
  );

  const emitModeIfChanged = useCallback((nextMode: LetterSceneMode) => {
    const st = stateRef.current;
    if (st.lastEmittedMode !== nextMode) {
      st.lastEmittedMode = nextMode;
      setSceneMode(nextMode);
      onModeChangeRef.current(nextMode);
    }
  }, []);

  const triggerUnfold = useCallback(() => {
    const st = stateRef.current;
    if (st.isSendingSequence) return;
    st.isPointerDown = false;
    st.isExternalRefoldDrag = false;
    st.gestureMode = "none";
    st.isAutoAnimating = true;
    st.targetProgress = 1;
    st.targetRotX = 0;
    st.targetRotY = 0;
    emitModeIfChanged("transitioning");
  }, [emitModeIfChanged]);

  const triggerFold = useCallback(() => {
    const st = stateRef.current;
    if (st.isSendingSequence) return;
    st.isPointerDown = false;
    st.isExternalRefoldDrag = false;
    st.gestureMode = "none";
    st.isAutoAnimating = true;
    st.targetProgress = 0;
    st.targetRotY = -0.34;
    st.targetRotX = 0.08;
    emitModeIfChanged("transitioning");
  }, [emitModeIfChanged]);

  useImperativeHandle(
    ref,
    () => ({
      syncDrawingCanvas,
      syncSampledStripTo3D,
      startEnvelopeAndSend: (
        onComplete: () => void,
        onEmitSparkles?: (event: SceneSparkleBurstEvent) => void
      ) => {
        const st = stateRef.current;
        st.isSendingSequence = true;
        st.sendStartMs = performance.now();
        st.lastSparkleEmitMs = 0;
        st.sendCompleteFired = false;
        st.onSendComplete = onComplete;
        st.onEmitSparkles = onEmitSparkles ?? null;
        st.isPointerDown = false;
        st.isExternalRefoldDrag = false;
        st.isAutoAnimating = false;
        emitModeIfChanged("sending");
      },
      resetToFreshFolded: () => {
        const st = stateRef.current;
        st.isSendingSequence = false;
        st.sendCompleteFired = false;
        st.onSendComplete = null;
        st.onEmitSparkles = null;
        st.lastSparkleEmitMs = 0;
        st.isPointerDown = false;
        st.isExternalRefoldDrag = false;
        st.isAutoAnimating = false;
        st.targetProgress = 0;
        st.currentProgress = 0;
        st.targetRotY = -0.34;
        st.targetRotX = 0.08;
        st.currentRotY = -0.34;
        st.currentRotX = 0.08;
        st.introFadeStartMs = performance.now();
        setUiProgress(0);
        syncDrawingCanvas(null);
        emitModeIfChanged("folded");
      },
      beginRefoldPull: () => {
        const st = stateRef.current;
        if (st.isSendingSequence) return;
        st.isExternalRefoldDrag = true;
        st.isAutoAnimating = false;
        st.targetRotY = -0.34;
        st.targetRotX = 0.08;
      },
      updateRefoldPull: (pullUpPx: number) => {
        const st = stateRef.current;
        if (!st.isExternalRefoldDrag || st.isSendingSequence) return;
        const clamped = Math.max(0, pullUpPx);
        const nextP = clamp01(1 - clamped / 220);
        st.targetProgress = nextP;
        if (nextP < 0.995) {
          emitModeIfChanged("transitioning");
        }
      },
      endRefoldPull: () => {
        const st = stateRef.current;
        if (!st.isExternalRefoldDrag || st.isSendingSequence) return;
        st.isExternalRefoldDrag = false;
        st.isAutoAnimating = true;
        if (st.targetProgress <= REFOLD_THRESHOLD) {
          st.targetProgress = 0;
          st.targetRotY = -0.34;
          st.targetRotX = 0.08;
          emitModeIfChanged("transitioning");
        } else {
          st.targetProgress = 1;
          st.targetRotX = 0;
          st.targetRotY = 0;
        }
      },
      triggerFold,
      triggerUnfold,
    }),
    [
      emitModeIfChanged,
      syncDrawingCanvas,
      syncSampledStripTo3D,
      triggerFold,
      triggerUnfold,
    ]
  );

  // Build Three.js Z-Fold Letter + 3D Wireframe Envelope + Dashed Flight Trajectory
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const fovDeg = 22;
    const fovRad = THREE.MathUtils.degToRad(fovDeg);

    const camera = new THREE.PerspectiveCamera(fovDeg, width / height, 0.1, 100);
    camera.position.set(0, 0, 12);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const baseCanvas = createUnifiedStationeryCanvas(dateStamp);
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = TEX_W;
    compositeCanvas.height = TEX_H;
    const compCtx = compositeCanvas.getContext("2d");
    compCtx?.drawImage(baseCanvas, 0, 0, TEX_W, TEX_H);

    const sharedTexture = new THREE.CanvasTexture(compositeCanvas);
    sharedTexture.colorSpace = THREE.SRGBColorSpace;
    sharedTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    sharedTexture.minFilter = THREE.LinearMipmapLinearFilter;
    sharedTexture.magFilter = THREE.LinearFilter;
    sharedTexture.generateMipmaps = true;
    sharedTexture.needsUpdate = true;

    texturePipelineRef.current = {
      baseCanvas,
      compositeCanvas,
      texture: sharedTexture,
    };

    const panelW = 2.6;
    const panelH = 1.48;
    const totalUnfoldedH = panelH * 3;

    const topGeom = createUvSlicedPlane(panelW, panelH, 2 / 3, 1);
    const midGeom = createUvSlicedPlane(panelW, panelH, 1 / 3, 2 / 3);
    const botGeom = createUvSlicedPlane(panelW, panelH, 0, 1 / 3);

    const frontMat = new THREE.MeshBasicMaterial({
      map: sharedTexture,
      side: THREE.FrontSide,
      transparent: true,
      opacity: 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const backPaperMat = new THREE.MeshBasicMaterial({
      color: 0xf2f1ec,
      side: THREE.BackSide,
      transparent: true,
      opacity: 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const outerLineMat = new THREE.LineBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 1,
    });
    const creaseLineMat = new THREE.LineBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 1,
    });

    const disposableGeoms: THREE.BufferGeometry[] = [topGeom, midGeom, botGeom];
    const disposableMats: THREE.Material[] = [
      frontMat,
      backPaperMat,
      outerLineMat,
      creaseLineMat,
    ];

    const buildPanelMesh = (
      geom: THREE.PlaneGeometry,
      hasTopCrease: boolean,
      hasBottomCrease: boolean,
      edgeSeed: number
    ): THREE.Group => {
      const group = new THREE.Group();
      const frontMesh = new THREE.Mesh(geom, frontMat);
      const backMesh = new THREE.Mesh(geom, backPaperMat);
      backMesh.position.z = -0.003;

      const hw = panelW / 2;
      const hh = panelH / 2;

      const rawOuterPts: number[] = [
        -hw, -hh, 0, -hw, hh, 0,
        hw, -hh, 0, hw, hh, 0,
      ];
      const rawCreasePts: number[] = [];

      if (hasTopCrease) rawCreasePts.push(-hw, hh, 0, hw, hh, 0);
      else rawOuterPts.push(-hw, hh, 0, hw, hh, 0);

      if (hasBottomCrease) rawCreasePts.push(-hw, -hh, 0, hw, -hh, 0);
      else rawOuterPts.push(-hw, -hh, 0, hw, -hh, 0);

      // Subdivided hand-drawn jittered 3D wireframe outline
      const outerPts = buildJittered3DLineSegments(
        rawOuterPts,
        0.13,
        0.0075,
        edgeSeed
      );
      const outerGeom = new THREE.BufferGeometry();
      outerGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(outerPts, 3)
      );
      disposableGeoms.push(outerGeom);

      const outerFront = new THREE.LineSegments(outerGeom, outerLineMat);
      const outerBack = new THREE.LineSegments(outerGeom, outerLineMat);
      outerFront.position.z = 0.004;
      outerBack.position.z = -0.005;
      group.add(frontMesh, backMesh, outerFront, outerBack);

      if (rawCreasePts.length > 0) {
        const creasePts = buildJittered3DLineSegments(
          rawCreasePts,
          0.14,
          0.006,
          edgeSeed + 77
        );
        const creaseGeom = new THREE.BufferGeometry();
        creaseGeom.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(creasePts, 3)
        );
        disposableGeoms.push(creaseGeom);

        const creaseFront = new THREE.LineSegments(creaseGeom, creaseLineMat);
        const creaseBack = new THREE.LineSegments(creaseGeom, creaseLineMat);
        creaseFront.position.z = 0.004;
        creaseBack.position.z = -0.005;
        group.add(creaseFront, creaseBack);
      }

      return group;
    };

    // --- Z-FOLD LETTER GROUP ---
    const letterRoot = new THREE.Group();
    scene.add(letterRoot);

    const midGroup = new THREE.Group();
    midGroup.add(buildPanelMesh(midGeom, true, true, 101));
    letterRoot.add(midGroup);

    const topHinge = new THREE.Group();
    topHinge.position.set(0, panelH / 2, 0);
    const topPanel = buildPanelMesh(topGeom, false, true, 202);
    topPanel.position.set(0, panelH / 2, 0);
    topHinge.add(topPanel);
    midGroup.add(topHinge);

    const botHinge = new THREE.Group();
    botHinge.position.set(0, -panelH / 2, 0);
    const botPanel = buildPanelMesh(botGeom, true, false, 303);
    botPanel.position.set(0, -panelH / 2, 0);
    botHinge.add(botPanel);
    midGroup.add(botHinge);

    // --- 3D WIREFRAME ENVELOPE GROUP (STAGE 3 & 4) ---
    const envGroup = new THREE.Group();
    envGroup.visible = false;
    scene.add(envGroup);

    const envW = 3.04;
    const envH = 1.88;
    const flapH = 1.12;

    const envFrontTex = createEnvelopeFrontTexture(dateStamp);
    const envPlaneGeom = new THREE.PlaneGeometry(envW, envH);
    const ehw = envW / 2;
    const ehh = envH / 2;
    const rawEnvRect = [
      -ehw, -ehh, 0, ehw, -ehh, 0,
      ehw, -ehh, 0, ehw, ehh, 0,
      ehw, ehh, 0, -ehw, ehh, 0,
      -ehw, ehh, 0, -ehw, -ehh, 0,
    ];
    const jitteredEnvEdges = buildJittered3DLineSegments(
      rawEnvRect,
      0.14,
      0.0085,
      404
    );
    const envEdgeGeom = new THREE.BufferGeometry();
    envEdgeGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(jitteredEnvEdges, 3)
    );
    disposableGeoms.push(envPlaneGeom, envEdgeGeom);

    const envBackMat = new THREE.MeshBasicMaterial({
      color: 0xf1f0ea,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const envFrontMat = new THREE.MeshBasicMaterial({
      map: envFrontTex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const envLineMat = new THREE.LineBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0,
    });
    const envFlapMat = new THREE.MeshBasicMaterial({
      color: 0xfaf9f6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const sealDotMat = new THREE.MeshBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0,
    });
    disposableMats.push(
      envBackMat,
      envFrontMat,
      envLineMat,
      envFlapMat,
      sealDotMat
    );

    // Back wall of envelope pocket (letter glides IN FRONT of this)
    const envBackMesh = new THREE.Mesh(envPlaneGeom, envBackMat);
    envBackMesh.position.z = -0.18;
    const envBackEdges = new THREE.LineSegments(envEdgeGeom, envLineMat);
    envBackEdges.position.z = -0.175;
    envGroup.add(envBackMesh, envBackEdges);

    // Front wall of envelope pocket (letter glides BEHIND this -> real 3D pocket occlusion!)
    const envFrontMesh = new THREE.Mesh(envPlaneGeom, envFrontMat);
    envFrontMesh.position.z = 0.18;
    const envFrontEdges = new THREE.LineSegments(envEdgeGeom, envLineMat);
    envFrontEdges.position.z = 0.186;
    envGroup.add(envFrontMesh, envFrontEdges);

    // Triangular top sealing flap hinged at top edge of envelope
    const flapShape = new THREE.Shape();
    flapShape.moveTo(-envW / 2, 0);
    flapShape.lineTo(envW / 2, 0);
    flapShape.lineTo(0, flapH);
    flapShape.closePath();

    const flapGeom = new THREE.ShapeGeometry(flapShape);
    const rawFlapEdges = [
      -envW / 2, 0, 0,
      envW / 2, 0, 0,
      envW / 2, 0, 0,
      0, flapH, 0,
      0, flapH, 0,
      -envW / 2, 0, 0,
    ];
    const jitteredFlapEdges = buildJittered3DLineSegments(
      rawFlapEdges,
      0.13,
      0.0085,
      505
    );
    const flapEdgeGeom = new THREE.BufferGeometry();
    flapEdgeGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(jitteredFlapEdges, 3)
    );
    const sealDotGeom = new THREE.CircleGeometry(0.055, 11);
    disposableGeoms.push(flapGeom, flapEdgeGeom, sealDotGeom);

    const envFlapHinge = new THREE.Group();
    envFlapHinge.position.set(0, envH / 2, -0.17);
    const flapMesh = new THREE.Mesh(flapGeom, envFlapMat);
    const flapEdgesFront = new THREE.LineSegments(flapEdgeGeom, envLineMat);
    const flapEdgesBack = new THREE.LineSegments(flapEdgeGeom, envLineMat);
    flapEdgesFront.position.z = 0.005;
    flapEdgesBack.position.z = -0.005;

    const sealDot = new THREE.Mesh(sealDotGeom, sealDotMat);
    sealDot.position.set(0, flapH - 0.04, -0.008);
    sealDot.rotation.y = Math.PI; // Faces viewer once flap swings +PI down!

    envFlapHinge.add(flapMesh, flapEdgesFront, flapEdgesBack, sealDot);
    envGroup.add(envFlapHinge);

    // --- STRICT VERTICAL CENTER DASHED TRAJECTORY LINE (STAGE C: X = 0) ---
    const verticalLineMaxLen = 18;
    const verticalLineSegments = 120;
    const verticalPts: THREE.Vector3[] = [];
    for (let i = 0; i <= verticalLineSegments; i++) {
      const t = i / verticalLineSegments;
      verticalPts.push(
        new THREE.Vector3(0, -0.35 + t * verticalLineMaxLen, -0.08)
      );
    }
    const arcGeom = new THREE.BufferGeometry().setFromPoints(verticalPts);
    disposableGeoms.push(arcGeom);
    const arcMat = new THREE.LineDashedMaterial({
      color: 0xd8d8d0,
      dashSize: 0.14,
      gapSize: 0.11,
      transparent: true,
      opacity: 0,
    });
    disposableMats.push(arcMat);
    const flightArcLine = new THREE.Line(arcGeom, arcMat);
    flightArcLine.computeLineDistances();
    flightArcLine.visible = false;
    scene.add(flightArcLine);

    // Reusable vectors for live 3D -> 2D viewport sparkle emission
    const projTmpA = new THREE.Vector3();
    const projTmpB = new THREE.Vector3();
    const projectWorldToViewport = (worldPos: THREE.Vector3) => {
      projTmpB.copy(worldPos).project(camera);
      return {
        x: (projTmpB.x * 0.5 + 0.5) * vpW,
        y: (-projTmpB.y * 0.5 + 0.5) * vpH,
      };
    };

    // --- FLAT ELLIPTICAL GROUND SHADOW ---
    const shadowTex = createFlatShadowTexture();
    const shadowGeom = new THREE.PlaneGeometry(2.75, 0.36);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    disposableGeoms.push(shadowGeom);
    disposableMats.push(shadowMat);
    const shadowMesh = new THREE.Mesh(shadowGeom, shadowMat);
    shadowMesh.position.set(0, -1.04, -0.35);
    scene.add(shadowMesh);

    let vpW = width;
    let vpH = height;

    const handleResize = () => {
      if (!container) return;
      vpW = Math.max(1, container.clientWidth);
      vpH = Math.max(1, container.clientHeight);
      camera.aspect = vpW / vpH;
      camera.updateProjectionMatrix();
      renderer.setSize(vpW, vpH);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    let rafId = 0;
    let lastUiRounded = -1;
    const startClock = performance.now();

    const animate = (now: number) => {
      rafId = window.requestAnimationFrame(animate);
      const st = stateRef.current;
      const elapsed = (now - startClock) / 1000;
      const tanHalfFov = Math.tan(fovRad / 2);
      const aspect = Math.max(0.35, vpW / Math.max(1, vpH));

      // Compute exact target 2D letter projection parameters
      const box = targetRectRef.current;
      let zFlatTarget = 12;
      let flatCenterX = 0;
      let flatCenterY = 0;
      let flatScaleX = 1;

      if (box && box.width > 10 && box.height > 10 && vpW > 10 && vpH > 10) {
        zFlatTarget = (totalUnfoldedH * vpH) / (2 * box.height * tanHalfFov);
        const visHAtTarget = 2 * zFlatTarget * tanHalfFov;
        const visWAtTarget = visHAtTarget * aspect;

        const boxCenterX = box.left + box.width / 2;
        const boxCenterY = box.top + box.height / 2;
        const ndcX = (boxCenterX / vpW) * 2 - 1;
        const ndcY = 1 - (boxCenterY / vpH) * 2;

        flatCenterX = ndcX * (visWAtTarget / 2);
        flatCenterY = ndcY * (visHAtTarget / 2);

        const targetWorldW = (box.width / vpW) * visWAtTarget;
        flatScaleX = targetWorldW / panelW;
      }

      // =======================================================================
      // BRANCH A: STAGE 3 (65° Z-FOLD -> LEFT/RIGHT PENDULUM SHOWCASE -> PRESS FLAT
      //           -> 1PX WIREFRAME ENVELOPE + SEAL) & STAGE 4 (PURE VERTICAL FLIGHT)
      // =======================================================================
      if (st.isSendingSequence) {
        if (st.sendCompleteFired) {
          envGroup.visible = false;
          flightArcLine.visible = false;
          letterRoot.visible = false;
          shadowMat.opacity = 0;
          renderer.render(scene, camera);
          return;
        }

        const sElapsed = (now - st.sendStartMs) / 1000;

        // Dynamic camera distance comfortably framing both the 3D Z-fold showcase and envelope stage
        const envStageW = envW * 1.48;
        const envStageH = envH * 2.55;
        const zEnvForW = envStageW / 0.72 / (2 * tanHalfFov * aspect);
        const zEnvForH = envStageH / 0.72 / (2 * tanHalfFov);
        const zEnvStage = Math.max(zEnvForW, zEnvForH);

        const visHAtEnv = 2 * zEnvStage * tanHalfFov;
        const topEdgeY = visHAtEnv * 0.5;
        const envBaseY = -0.38;
        const exitY = topEdgeY + envH * 0.95;
        const showcaseY = 0.08;
        const letterLiftedY = envBaseY + 2.02;

        // ---------------------------------------------------------------------
        // ACTION A (0.00s -> 0.60s): Accordion 3-panel Z half-fold to 65°
        // ---------------------------------------------------------------------
        const actionAP = easeInOutCubic(clamp01(sElapsed / 0.6));

        // ---------------------------------------------------------------------
        // ACTION B (0.60s -> 2.40s, total 1.80s): Smooth pendulum horizontal arc
        //   B1 (0.60s -> 1.12s): Swing LEFT to +35° with -8° downward viewing pitch
        //   B2 (1.12s -> 1.84s): Sweep smoothly across center to RIGHT -35°
        //   B3 (1.84s -> 2.40s): Return to 0° front-center & press flat (~180°)
        // ---------------------------------------------------------------------
        const b1 = easePendulum(clamp01((sElapsed - 0.6) / 0.52));
        const b2 = easePendulum(clamp01((sElapsed - 1.12) / 0.72));
        const b3 = easePendulum(clamp01((sElapsed - 1.84) / 0.56));

        let foldAngle = actionAP * HALF_FOLD_RAD;
        let showcaseRotY = 0;
        let showcaseRotX = 0;

        if (sElapsed >= 0.6 && sElapsed < 1.12) {
          foldAngle = HALF_FOLD_RAD;
          showcaseRotY = SHOWCASE_SWING_Y * b1;
          showcaseRotX = SHOWCASE_PITCH_X * b1;
        } else if (sElapsed >= 1.12 && sElapsed < 1.84) {
          foldAngle = HALF_FOLD_RAD;
          showcaseRotY = SHOWCASE_SWING_Y * (1 - 2 * b2);
          showcaseRotX = SHOWCASE_PITCH_X;
        } else if (sElapsed >= 1.84) {
          foldAngle =
            HALF_FOLD_RAD + (FLAT_ENVELOPE_FOLD - HALF_FOLD_RAD) * b3;
          showcaseRotY = -SHOWCASE_SWING_Y * (1 - b3);
          showcaseRotX = SHOWCASE_PITCH_X * (1 - b3);
        }

        // ---------------------------------------------------------------------
        // ACTION C (2.15s -> 3.85s): Wireframe envelope appears -> letter glides
        //   smoothly into pocket -> top triangular flap folds down 0° -> 180°
        // ---------------------------------------------------------------------
        const envInP = easeOutCubic(clamp01((sElapsed - 2.15) / 0.55));
        const insertP = easeInOutCubic(clamp01((sElapsed - 2.58) / 0.66));
        const sealP = easeInOutCubic(clamp01((sElapsed - 3.2) / 0.65));

        // ---------------------------------------------------------------------
        // STAGE 4 (3.85s -> 4.05s pause 0.2s -> 4.05s -> 4.75s pure vertical flight 0.7s)
        // ---------------------------------------------------------------------
        const flyP = easeInCubic(clamp01((sElapsed - 4.05) / 0.7));
        const arcDrawP = easeOutCubic(clamp01((sElapsed - 3.78) / 0.52));

        // Smooth camera pullback during Action A from flat writing zoom to 3D showcase framing
        camera.position.z = zFlatTarget + (zEnvStage - zFlatTarget) * actionAP;
        camera.position.set(0, 0, camera.position.z);
        camera.lookAt(0, 0, 0);

        // Apply accordion Z-fold hinge angles
        midGroup.rotation.x = -foldAngle;
        topHinge.rotation.x = foldAngle;
        botHinge.rotation.x = foldAngle;

        // Hide ground shadow against dark backdrop
        shadowMat.opacity = 0;

        // Letter position & scale:
        // flat slot -> showcase center -> lifted above envelope mouth -> tucked inside pocket
        const lX = flatCenterX * (1 - actionAP);
        const yAfterA = flatCenterY * (1 - actionAP) + showcaseY * actionAP;
        const yAfterLift = yAfterA + (letterLiftedY - yAfterA) * b3;
        const lY = yAfterLift + (envBaseY - yAfterLift) * insertP;

        const scaleXAfterA = flatScaleX + (1.0 - flatScaleX) * actionAP;
        const lScaleX = scaleXAfterA + (0.94 - scaleXAfterA) * b3;
        const lScaleY = 1 - 0.06 * b3;
        const lScaleZ = 1 - 0.78 * insertP;

        // Envelope visibility & fade-out during vertical exit
        envGroup.visible = envInP > 0.005;
        const envFadeOut = 1 - clamp01((flyP - 0.36) / 0.64);
        const envAlpha = envInP * envFadeOut;

        // Hide letter cleanly behind front pocket wall once inserted & flap closes
        const letterAlpha = insertP > 0.9 ? Math.max(0, 1 - sealP * 2.4) : 1;
        frontMat.opacity = letterAlpha;
        backPaperMat.opacity = letterAlpha;
        outerLineMat.opacity = letterAlpha;
        creaseLineMat.opacity = (0.08 + 0.92 * actionAP) * letterAlpha;
        letterRoot.visible = letterAlpha > 0.01;

        if (flyP > 0) {
          // Stage 4: Strictly straight vertical upward ascent (X displacement strictly 0!)
          const flyY = envBaseY + (exitY - envBaseY) * flyP;
          const flyScale = 1 - 0.24 * flyP;
          envGroup.position.set(0, flyY, 0);
          envGroup.scale.set(flyScale, flyScale, flyScale);
          envGroup.rotation.set(0, 0, 0);
        } else {
          const eScale = 0.9 + 0.1 * envInP;
          envGroup.position.set(0, envBaseY, 0);
          envGroup.scale.set(eScale, eScale, eScale);
          envGroup.rotation.set(0, 0, 0);
        }

        // Apply letter 3D showcase & insertion transform
        letterRoot.position.set(lX, lY, 0);
        letterRoot.scale.set(lScaleX, lScaleY, lScaleZ);
        letterRoot.rotation.set(showcaseRotX, showcaseRotY, 0);

        // Animate triangular sealing flap (0° open upward -> 180° sealed downward)
        envFlapHinge.rotation.x = sealP * Math.PI;
        envFlapHinge.position.z = -0.17 + 0.36 * sealP;

        envBackMat.opacity = envAlpha;
        envFrontMat.opacity = envAlpha;
        envLineMat.opacity = envAlpha;
        envFlapMat.opacity = envAlpha;
        sealDotMat.opacity = envAlpha * clamp01((sealP - 0.52) * 2.1);

        // Subtle vertical center dashed guide line (strictly X = 0)
        flightArcLine.visible = arcDrawP > 0.01 && envFadeOut > 0.01;
        if (flightArcLine.visible) {
          const desiredLen = Math.min(
            verticalLineMaxLen,
            (exitY - envBaseY) * arcDrawP
          );
          const drawVerts = Math.max(
            2,
            Math.min(
              verticalPts.length,
              Math.ceil((desiredLen / verticalLineMaxLen) * verticalPts.length)
            )
          );
          arcGeom.setDrawRange(0, drawVerts);
          arcMat.opacity = 0.44 * envFadeOut;
        }

        // ---------------------------------------------------------------------
        // CONTINUOUS SPARKLE EMISSION FROM CREASES, ENVELOPE MOUTH & FLIGHT TAIL
        // ---------------------------------------------------------------------
        if (st.onEmitSparkles) {
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld();

          const emitIntervalMs =
            sElapsed < 2.4 ? 190 : sElapsed < 3.84 ? 165 : 115;

          if (now - st.lastSparkleEmitMs >= emitIntervalMs) {
            st.lastSparkleEmitMs = now;

            if (sElapsed >= 0.05 && sElapsed < 2.4) {
              // Emit well-spaced hand-drawn sparkles from Z-fold creases while folding & swinging
              topHinge.getWorldPosition(projTmpA);
              const topScreen = projectWorldToViewport(projTmpA);
              botHinge.getWorldPosition(projTmpA);
              const botScreen = projectWorldToViewport(projTmpA);

              const creaseSpreadX = Math.min(135, vpW * 0.17);
              st.onEmitSparkles({
                x: topScreen.x,
                y: topScreen.y,
                spreadX: creaseSpreadX,
                spreadY: 16,
                count: 1,
                vxBias: showcaseRotY * 32,
                vyBias: -36,
                speedMin: 34,
                speedMax: 88,
                sizeScale: 1.0,
              });
              st.onEmitSparkles({
                x: botScreen.x,
                y: botScreen.y,
                spreadX: creaseSpreadX,
                spreadY: 16,
                count: 1,
                vxBias: -showcaseRotY * 28,
                vyBias: -28,
                speedMin: 32,
                speedMax: 84,
                sizeScale: 0.96,
              });
            } else if (sElapsed >= 2.4 && sElapsed < 3.84) {
              // Emit well-spaced hand-drawn sparkles billowing from the open envelope mouth until sealed
              const mouthOpenFactor = 1 - clamp01((sealP - 0.35) / 0.65);
              if (mouthOpenFactor > 0.08) {
                projTmpA.set(0, envBaseY + envH * 0.46, 0.12);
                const mouthScreen = projectWorldToViewport(projTmpA);
                const burstCount = mouthOpenFactor > 0.5 ? 2 : 1;
                st.onEmitSparkles({
                  x: mouthScreen.x,
                  y: mouthScreen.y,
                  spreadX: Math.min(135, vpW * 0.18),
                  spreadY: 18,
                  count: burstCount,
                  vxBias: 0,
                  vyBias: -74,
                  speedMin: 42,
                  speedMax: 118,
                  sizeScale: 1.05,
                });
              }
            } else if (sElapsed >= 4.05 && sElapsed < 4.72 && envFadeOut > 0.08) {
              // Crisp trailing hand-drawn stars behind the vertically ascending sealed envelope
              const flyY = envBaseY + (exitY - envBaseY) * flyP;
              const flyScale = 1 - 0.24 * flyP;
              projTmpA.set(0, flyY - envH * 0.45 * flyScale, 0);
              const tailScreen = projectWorldToViewport(projTmpA);
              st.onEmitSparkles({
                x: tailScreen.x,
                y: tailScreen.y,
                spreadX: 54,
                spreadY: 12,
                count: 1,
                vxBias: 0,
                vyBias: 24,
                speedMin: 16,
                speedMax: 52,
                sizeScale: 0.92,
              });
            }
          }
        }

        renderer.render(scene, camera);

        if (sElapsed >= SEND_TOTAL_SEC && !st.sendCompleteFired) {
          st.sendCompleteFired = true;
          envGroup.visible = false;
          flightArcLine.visible = false;
          letterRoot.visible = false;
          renderer.render(scene, camera);
          st.onSendComplete?.();
        }
        return;
      }

      // =======================================================================
      // BRANCH B: NORMAL Z-FOLD INSPECTION & BIDIRECTIONAL UNFOLD / RE-FOLD
      // =======================================================================
      envGroup.visible = false;
      flightArcLine.visible = false;
      letterRoot.visible = true;

      // Gentle fade-in after a full reset loop
      const introAlpha =
        st.introFadeStartMs > 0
          ? easeOutCubic(clamp01((now - st.introFadeStartMs) / 620))
          : 1;
      frontMat.opacity = introAlpha;
      backPaperMat.opacity = introAlpha;
      outerLineMat.opacity = introAlpha;

      const progressLerp =
        st.isPointerDown || st.isExternalRefoldDrag
          ? 0.25
          : st.isAutoAnimating
            ? 0.095
            : 0.13;
      st.currentProgress +=
        (st.targetProgress - st.currentProgress) * progressLerp;
      if (Math.abs(st.targetProgress - st.currentProgress) < 0.0005) {
        st.currentProgress = st.targetProgress;
      }

      const p = st.currentProgress;

      const unfoldPhase = easeInOutCubic(clamp01(p / 0.72));
      const zoomPhase = easeInOutCubic(clamp01((p - 0.28) / 0.72));

      const rotRemain = 1 - unfoldPhase;
      st.currentRotY += (st.targetRotY * rotRemain - st.currentRotY) * 0.14;
      st.currentRotX += (st.targetRotX * rotRemain - st.currentRotX) * 0.14;

      const foldAngle = (1 - unfoldPhase) * MAX_FOLD_ANGLE;
      midGroup.rotation.x = -foldAngle;
      topHinge.rotation.x = foldAngle;
      botHinge.rotation.x = foldAngle;

      // Soften interior fold-crease lines gracefully as letter flattens (1.0 -> 0.08)
      creaseLineMat.opacity =
        (0.08 + 0.92 * Math.pow(1 - unfoldPhase, 1.35)) * introAlpha;

      // Scale initial 3D Z-fold letter to occupy 85%–90% (~87%) of viewport width/height
      // while preserving crisp 5%–7.5% safe margins around all four edges without clipping.
      const foldedProjW = 2.754; // Exact projected width at default rotY = -0.34
      const foldedProjH = 1.88; // Exact projected height at default rotX = 0.08
      const targetViewportFill = 0.872;
      const zForW =
        0.08 + foldedProjW / targetViewportFill / (2 * tanHalfFov * aspect);
      const zForH =
        0.44 + foldedProjH / targetViewportFill / (2 * tanHalfFov);
      const zFolded = Math.max(zForW, zForH);

      const idleBob = Math.sin(elapsed * 1.35) * 0.024 * (1 - unfoldPhase);

      letterRoot.position.x = flatCenterX * zoomPhase;
      letterRoot.position.y =
        (idleBob + 0.082) * (1 - zoomPhase) + flatCenterY * zoomPhase;
      letterRoot.position.z = 0;
      letterRoot.scale.set(1 + (flatScaleX - 1) * zoomPhase, 1, 1);
      letterRoot.rotation.set(st.currentRotX, st.currentRotY, 0);

      camera.position.set(0, 0, zFolded + (zFlatTarget - zFolded) * zoomPhase);
      camera.lookAt(0, 0, 0);

      shadowMat.opacity = Math.max(
        0,
        0.85 * (1 - unfoldPhase * 1.35) * introAlpha
      );
      const shadowScale = 1 - idleBob * 0.85;
      shadowMesh.scale.set(shadowScale, shadowScale, 1);

      renderer.render(scene, camera);

      const pct = Math.round(p * 100);
      if (pct !== lastUiRounded) {
        lastUiRounded = pct;
        setUiProgress(pct);
      }

      // Bidirectional state machine snap: reliably restore "flat" OR "folded" every cycle
      if (
        !st.isPointerDown &&
        !st.isExternalRefoldDrag &&
        st.targetProgress === 1 &&
        p >= 0.995 &&
        Math.abs(st.currentRotY) < 0.015 &&
        Math.abs(st.currentRotX) < 0.015
      ) {
        st.currentProgress = 1;
        st.currentRotY = 0;
        st.currentRotX = 0;
        st.isAutoAnimating = false;
        emitModeIfChanged("flat");
      } else if (
        !st.isPointerDown &&
        !st.isExternalRefoldDrag &&
        st.targetProgress === 0 &&
        p <= 0.015
      ) {
        st.currentProgress = 0;
        st.isAutoAnimating = false;
        emitModeIfChanged("folded");
      }
    };

    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      disposableGeoms.forEach((g) => g.dispose());
      disposableMats.forEach((m) => m.dispose());
      sharedTexture.dispose();
      envFrontTex.dispose();
      shadowTex.dispose();
      renderer.dispose();
      texturePipelineRef.current = {
        baseCanvas: null,
        compositeCanvas: null,
        texture: null,
      };
    };
  }, [dateStamp, emitModeIfChanged]);

  // Pointer interactions when folded: Orbit/Tilt OR Pull-down to Unfold
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, forcePull = false) => {
      const st = stateRef.current;
      if (st.lastEmittedMode === "flat" || st.isSendingSequence) return;

      e.currentTarget.setPointerCapture(e.pointerId);
      st.isExternalRefoldDrag = false;
      st.isPointerDown = true;
      st.isAutoAnimating = false;
      st.gestureMode = forcePull ? "pull" : "none";
      st.pointerStartX = e.clientX;
      st.pointerStartY = e.clientY;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;
      st.startProgress = st.targetProgress;
      if (forcePull) {
        setIsDraggingPull(true);
      }
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = stateRef.current;
      if (!st.isPointerDown || st.isSendingSequence) return;

      const totalDx = e.clientX - st.pointerStartX;
      const totalDy = e.clientY - st.pointerStartY;
      const stepDx = e.clientX - st.lastPointerX;
      const stepDy = e.clientY - st.lastPointerY;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;

      if (st.gestureMode === "none" && Math.hypot(totalDx, totalDy) > 8) {
        if (totalDy > 10 && Math.abs(totalDy) > Math.abs(totalDx) * 1.2) {
          st.gestureMode = "pull";
          setIsDraggingPull(true);
          emitModeIfChanged("transitioning");
        } else {
          st.gestureMode = "orbit";
        }
      }

      if (st.gestureMode === "pull") {
        const nextP = clamp01(st.startProgress + totalDy / 210);
        st.targetProgress = nextP;
        if (nextP > 0.02) {
          emitModeIfChanged("transitioning");
        }
        st.targetRotY = Math.max(
          -0.6,
          Math.min(0.6, st.targetRotY + stepDx * 0.002)
        );
      } else if (st.gestureMode === "orbit") {
        st.targetRotY = Math.max(
          -0.95,
          Math.min(0.95, st.targetRotY + stepDx * 0.0075)
        );
        st.targetRotX = Math.max(
          -0.48,
          Math.min(0.55, st.targetRotX + stepDy * 0.0065)
        );
      }
    },
    [emitModeIfChanged]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = stateRef.current;
      if (!st.isPointerDown) return;

      st.isPointerDown = false;
      st.isExternalRefoldDrag = false;
      setIsDraggingPull(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (st.gestureMode === "pull") {
        st.isAutoAnimating = true;
        if (st.targetProgress >= UNFOLD_THRESHOLD) {
          st.targetProgress = 1;
          st.targetRotX = 0;
          st.targetRotY = 0;
        } else {
          st.targetProgress = 0;
        }
      }

      st.gestureMode = "none";
    },
    []
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const st = stateRef.current;
      if (st.lastEmittedMode === "flat" || st.isSendingSequence) return;

      st.isExternalRefoldDrag = false;
      const delta = e.deltaY * 0.0016;
      const nextP = clamp01(st.targetProgress + delta);
      st.targetProgress = nextP;
      if (nextP > 0.02) {
        emitModeIfChanged("transitioning");
      }

      if (nextP >= UNFOLD_THRESHOLD) {
        st.isAutoAnimating = true;
        st.targetProgress = 1;
        st.targetRotX = 0;
        st.targetRotY = 0;
      }
    },
    [emitModeIfChanged]
  );

  const isFoldedUI = sceneMode === "folded" || sceneMode === "transitioning";
  const chromeOpacity = isFoldedUI ? Math.max(0, 1 - uiProgress / 42) : 0;

  return (
    <div
      onWheel={handleWheel}
      className={`fixed inset-0 ${
        sceneMode === "sending"
          ? "z-30 pointer-events-none"
          : isFoldedUI
            ? "z-20 pointer-events-auto"
            : "z-10 pointer-events-none"
      }`}
    >
      {/* Persistent Full-Viewport 3D Canvas */}
      <div
        ref={mountRef}
        onPointerDown={(e) => handlePointerDown(e, false)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: "none" }}
        className={`absolute inset-0 h-full w-full select-none ${
          isFoldedUI
            ? isDraggingPull
              ? "cursor-grabbing pointer-events-auto"
              : "cursor-grab pointer-events-auto"
            : "pointer-events-none"
        }`}
        aria-label="3D Z 字折疊空白信紙，可旋轉檢視或向下拉動展開"
      />

      {/* Quiet desktop flanking captions when folded */}
      <div
        aria-hidden="true"
        style={{ opacity: chromeOpacity }}
        className="pointer-events-none absolute inset-x-10 top-1/2 hidden -translate-y-1/2 items-center justify-between transition-opacity duration-150 md:flex"
      >
        <span className="text-lg font-normal tracking-[0.22em] text-[#222222]">
          寫一則光的訊息
        </span>
        <span className="font-mono text-xs tracking-[0.2em] text-[#222222]">
          a message of light
        </span>
      </div>

      {/* Top Monospace Header when folded */}
      <div
        style={{ opacity: chromeOpacity }}
        className="pointer-events-none absolute top-5 right-5 left-5 flex items-center justify-between font-mono text-[10px] tracking-[0.22em] text-[#8C8C8A] transition-opacity duration-150 sm:top-7 sm:right-10 sm:left-10"
      >
        <span>NO. 001 // Z-FOLD</span>
        <span className="hidden md:inline">
          DRAG TO ORBIT · PULL DOWN TO UNFOLD
        </span>
        <span>{dateStamp}</span>
      </div>

      {/* Bottom Pull-to-Open Indicator when folded */}
      {isFoldedUI && (
        <div
          style={{
            opacity: Math.max(0, 1 - Math.max(0, uiProgress - 45) / 35),
          }}
          className="pointer-events-none absolute right-0 bottom-7 left-0 flex flex-col items-center gap-2.5 px-5 transition-opacity duration-150 sm:bottom-9"
        >
          <div className="sketch-progress relative h-[4px] w-44 border border-[#222222]/25 bg-[#FAF9F6]">
            <span
              aria-hidden="true"
              className="absolute -top-1 bottom-0 h-2.5 w-[1px] bg-[#8C8C8A]"
              style={{ left: `${UNFOLD_THRESHOLD * 100}%` }}
            />
            <div
              className="h-full bg-[#222222] transition-[width] duration-75"
              style={{ width: `${uiProgress}%` }}
            />
          </div>

          <div
            onPointerDown={(e) => handlePointerDown(e, true)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: "none" }}
            className="pointer-events-auto flex items-center gap-2"
          >
            <button
              type="button"
              onClick={triggerUnfold}
              className="sketch-pill group inline-flex items-center gap-2.5 border border-[#222222] bg-[#FDFCF9] px-4 py-1.5 transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FAF9F6] active:scale-[0.97]"
            >
              <svg
                width="12"
                height="14"
                viewBox="0 0 12 14"
                fill="none"
                className="text-[#222222] transition-transform duration-300 group-hover:translate-y-0.5"
                aria-hidden="true"
              >
                <path
                  d="M6.2 1.4C5.8 4.8 6.3 8.4 6 11.9M6 11.9C4.7 10.7 3.7 9.5 2.4 8.6M6 11.9C7.3 10.6 8.3 9.7 9.6 8.4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="font-mono text-[10.5px] tracking-[0.2em] text-[#222222]">
                PULL TO OPEN
              </span>
              <span className="font-mono text-[10px] tabular-nums text-[#8C8C8A]">
                {String(uiProgress).padStart(2, "0")}%
              </span>
            </button>
          </div>

          <p className="font-sans text-[11px] font-light tracking-[0.2em] text-[#8C8C8A]">
            向下拉動信紙展開書寫，或拖曳旋轉檢視
          </p>
        </div>
      )}
    </div>
  );
});
