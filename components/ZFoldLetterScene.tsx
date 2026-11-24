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
import { getFormattedDateStamp } from "@/lib/crayon-brush";
import {
  buildJittered3DLineSegments,
  createSeededRng,
  drawHandDrawnPostageStamp,
  drawSketchyLine,
  drawWashiPaperTexture,
} from "@/lib/hand-drawn-utils";
import {
  eraseIntroDecalSegment,
  IntroEraserCursorState,
  LETTER_TEX_H,
  LETTER_TEX_W,
  renderIntroPaperDecalCanvas,
  sampleIntroEraserTrajectory,
} from "@/lib/paper-decal";
import { drawYanshuiPerimeterMotifs } from "@/lib/yanshui-illustration";
import type { MailboxNumber } from "@/lib/image-library-api";

export type { IntroEraserCursorState };

export interface MailboxTargetScreenPoint {
  mailbox: MailboxNumber;
  screenX: number;
  screenY: number;
}

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
   * -> press flat & slide into 1px wireframe envelope -> seal -> WAIT FOR USER SWIPE UP
   * -> pure vertical upward flight (X = 0)
   */
  startEnvelopeAndSend: (
    onComplete: () => void,
    onEmitSparkles?: (event: SceneSparkleBurstEvent) => void,
    callbacks?: {
      onEnvelopeSealed?: () => void;
      onReadyToSwipe?: () => void;
      onSwipeLaunched?: (chosenMailbox: MailboxNumber) => void;
      onSwipeProgress?: (
        progress: number,
        targetedMailbox: MailboxNumber | null
      ) => void;
    }
  ) => void;
  /** Updates live screen coordinates of the 6 top mailboxes for directional swipe targeting */
  setMailboxScreenTargets: (targets: MailboxTargetScreenPoint[]) => void;
  /** Runs the 1.2s back-and-forth rubber-eraser animation over the intro paper decal */
  playIntroEraserAnimation: (callbacks?: {
    onCursorUpdate?: (cursor: IntroEraserCursorState) => void;
    onComplete?: () => void;
  }) => void;
  /** Cancels any active intro eraser animation cleanly */
  cancelIntroEraserAnimation: () => void;
  /** Synchronizes 3D flat letter scale & Y offset with 2D sampling layout (0px drift) */
  setPaperDisplayTransform: (scale: number, offsetY: number) => void;
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

const TEX_W = LETTER_TEX_W;
const TEX_H = LETTER_TEX_H;

const SEAL_COMPLETE_SEC = 5.68;
const SWIPE_LAUNCH_THRESHOLD_PX = 82;
const LAUNCH_DURATION_MS = 780;
const INTRO_ERASER_DURATION_MS = 2250;
const NO_SIDE_HERE_IG_URL =
  "https://www.instagram.com/no.side.here?evlk=MWtjank1NTFuZ2Fu";

function normalizeAngleRad(rad: number): number {
  return ((((rad + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function computeFallbackMailboxTargets(
  vpW: number,
  vpH: number
): MailboxTargetScreenPoint[] {
  const rowW = Math.min(470, Math.max(260, vpW - 28));
  const left = (vpW - rowW) * 0.5;
  const baseY =
    vpW < 640 ? Math.max(118, vpH * 0.165) : Math.max(122, vpH * 0.16);
  return ([1, 2, 3, 4, 5] as MailboxNumber[]).map((mailbox, idx) => {
    const t = idx / 4;
    const archDrop = Math.pow((t - 0.5) * 2, 2) * 12;
    return {
      mailbox,
      screenX: left + ((idx + 0.5) / 5) * rowW,
      screenY: baseY + archDrop,
    };
  });
}

function resolveTargetedMailbox(
  startX: number,
  startY: number,
  curX: number,
  curY: number,
  vpW: number,
  vpH: number,
  targets: MailboxTargetScreenPoint[]
): MailboxNumber | null {
  const dragUp = Math.max(0, startY - curY);
  const dragX = curX - startX;
  if (dragUp < 12 && Math.abs(dragX) < 16) return null;

  const list =
    targets.length === 5 ? targets : computeFallbackMailboxTargets(vpW, vpH);
  const minX = list[0].screenX;
  const maxX = list[list.length - 1].screenX;
  const rowCenterX = (minX + maxX) * 0.5;
  const rowHalfSpan = Math.max(80, (maxX - minX) * 0.5);
  const avgRowY = list.reduce((acc, item) => acc + item.screenY, 0) / list.length;

  // Directional cone from swipe vector (dx, -dragUp)
  const raySlope = Math.max(-1.25, Math.min(1.25, dragX / Math.max(48, dragUp)));
  const aimNorm = Math.max(-1, Math.min(1, raySlope / 0.82));
  const rayAimX = rowCenterX + aimNorm * rowHalfSpan;

  // Smoothly blend toward direct finger X when dragging close to the mailbox row
  const proximity = clamp01(
    (startY - curY) / Math.max(120, startY - avgRowY)
  );
  const effectiveAimX =
    rayAimX * (1 - proximity * 0.52) + curX * (proximity * 0.52);

  let bestMailbox: MailboxNumber = list[0].mailbox;
  let bestDist = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i].screenX - effectiveAimX);
    if (d < bestDist) {
      bestDist = d;
      bestMailbox = list[i].mailbox;
    }
  }
  return bestMailbox;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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

  // 6. Front-panel / Bottom-left minimalist title
  ctx.fillStyle = "#222222";
  ctx.font = '400 44px "Noto Sans TC", -apple-system, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("一則光的訊息", padX, TEX_H - 72);

  ctx.fillStyle = "#8C8C8A";
  ctx.font = '400 18px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillText("A MESSAGE OF LIGHT", padX + 2, TEX_H - 40);

  return canvas;
}

/**
 * Renders the backside cotton-stationery credits canvas ("No Side Here" + official Logo + IG handle)
 * mapped onto the outer back face of the folded Z-fold letter (visible when spun 180°).
 */
function paintBackCreditsCanvas(
  canvas: HTMLCanvasElement,
  logoImg: HTMLImageElement | null
): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rng = createSeededRng(20261224);
  drawWashiPaperTexture(ctx, w, h, 20261224);

  // Subtle warm cotton back-paper tint
  ctx.fillStyle = "rgba(235, 233, 226, 0.22)";
  ctx.fillRect(0, 0, w, h);

  // Delicate hand-sketched corner ticks matching front stationery
  const cropOpts = {
    stepPx: 10,
    jitterAmp: 0.9,
    lineWidth: 1.8,
    strokeStyle: "rgba(34, 34, 34, 0.26)",
    overshoot: 2,
  };
  drawSketchyLine(ctx, 28, 56, 28, 28, rng, cropOpts);
  drawSketchyLine(ctx, 28, 28, 56, 28, rng, cropOpts);
  drawSketchyLine(ctx, w - 56, 28, w - 28, 28, rng, cropOpts);
  drawSketchyLine(ctx, w - 28, 28, w - 28, 56, rng, cropOpts);
  drawSketchyLine(ctx, 28, h - 56, 28, h - 28, rng, cropOpts);
  drawSketchyLine(ctx, 28, h - 28, 56, h - 28, rng, cropOpts);
  drawSketchyLine(ctx, w - 56, h - 28, w - 28, h - 28, rng, cropOpts);
  drawSketchyLine(ctx, w - 28, h - 28, w - 28, h - 56, rng, cropOpts);

  const cx = w * 0.5;

  // 1. Official "No Side Here" Logo tinted cleanly in charcoal ink (#222222)
  const logoSize = 152;
  const logoX = cx - logoSize * 0.5;
  const logoY = 82;

  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    const tint = document.createElement("canvas");
    tint.width = logoSize;
    tint.height = logoSize;
    const tCtx = tint.getContext("2d");
    if (tCtx) {
      tCtx.drawImage(logoImg, 0, 0, logoSize, logoSize);
      tCtx.globalCompositeOperation = "source-in";
      tCtx.fillStyle = "#222222";
      tCtx.fillRect(0, 0, logoSize, logoSize);
      ctx.drawImage(tint, logoX, logoY);
    }
  } else {
    // Crisp fallback matching the exact architectural geometry until PNG finishes loading
    ctx.save();
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 10;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.beginPath();
    ctx.moveTo(logoX + logoSize * 0.19, logoY + logoSize * 0.66);
    ctx.lineTo(logoX + logoSize * 0.19, logoY + logoSize * 0.06);
    ctx.lineTo(logoX + logoSize * 0.81, logoY + logoSize * 0.06);
    ctx.lineTo(logoX + logoSize * 0.81, logoY + logoSize * 0.66);
    ctx.lineTo(logoX + logoSize * 0.27, logoY + logoSize * 0.96);
    ctx.stroke();
    ctx.restore();
  }

  // 2. Editorial Team Credit Typography
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#8C8C8A";
  ctx.font = '400 15px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillText("CREATED BY", cx, 282);

  ctx.fillStyle = "#222222";
  ctx.font = '400 44px "Noto Sans TC", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText("No Side Here", cx, 336);

  drawSketchyLine(ctx, cx - 132, 376, cx + 132, 376, rng, {
    stepPx: 14,
    jitterAmp: 0.75,
    lineWidth: 1.35,
    strokeStyle: "rgba(34, 34, 34, 0.2)",
  });

  // 3. Instagram Icon + @no.side.here Pill (aligned at y = 456 -> local 3D y = -0.415)
  const pillW = 306;
  const pillH = 62;
  const pillX = cx - pillW * 0.5;
  const pillY = 425;
  const pillCy = pillY + pillH * 0.5;

  ctx.save();
  ctx.fillStyle = "rgba(253, 252, 249, 0.86)";
  ctx.strokeStyle = "rgba(34, 34, 34, 0.68)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, pillH * 0.5);
  ctx.fill();
  ctx.stroke();

  // Minimalist Instagram Camera Icon on left inside pill
  const igX = pillX + 38;
  const igY = pillCy;
  const igS = 26;
  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.roundRect(igX - igS * 0.5, igY - igS * 0.5, igS, igS, 7);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(igX, igY, 6.2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#222222";
  ctx.beginPath();
  ctx.arc(igX + 7.2, igY - 7.2, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Instagram Handle Text
  ctx.fillStyle = "#222222";
  ctx.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("@no.side.here", igX + 26, pillCy + 1);
  ctx.restore();
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
  const backIgLinkRef = useRef<HTMLAnchorElement | null>(null);
  const pullArrowHintRef = useRef<HTMLDivElement | null>(null);
  const turnArrowHintRef = useRef<HTMLDivElement | null>(null);
  const [uiProgress, setUiProgress] = useState<number>(0);
  const [isDraggingPull, setIsDraggingPull] = useState<boolean>(false);
  const [isAwaitingSwipe, setIsAwaitingSwipe] = useState<boolean>(false);
  const [isSwipeDragging, setIsSwipeDragging] = useState<boolean>(false);
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
    illustrationCanvas: HTMLCanvasElement | null;
    has3DIllustration: boolean;
    introDecalCanvas: HTMLCanvasElement | null;
    hasIntroDecal: boolean;
    lastDrawingCanvas: HTMLCanvasElement | null;
    compositeCanvas: HTMLCanvasElement | null;
    texture: THREE.CanvasTexture | null;
  }>({
    baseCanvas: null,
    illustrationCanvas: null,
    has3DIllustration: false,
    introDecalCanvas: null,
    hasIntroDecal: true,
    lastDrawingCanvas: null,
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
    // Auto eraser animation over intro paper decal (stop-motion ~11fps, 2.25s)
    introEraserActive: false,
    introEraserStartMs: 0,
    introEraserLastFrame: -1,
    introEraserLastP: 0,
    introEraserLastX: 0,
    introEraserLastY: 0,
    introEraserWasErasing: false,
    introEraserStepSeed: 1,
    onIntroEraserCursor: null as ((cursor: IntroEraserCursorState) => void) | null,
    onIntroEraserComplete: null as (() => void) | null,
    // Stage 3 & 4 Envelope + Interactive Swipe-Up Send state
    isSendingSequence: false,
    sendSubPhase: "folding" as "folding" | "awaiting-swipe" | "launching",
    sendStartMs: 0,
    envelopeSealedFired: false,
    sendCompleteFired: false,
    onSendComplete: null as (() => void) | null,
    onEmitSparkles: null as ((event: SceneSparkleBurstEvent) => void) | null,
    onEnvelopeSealed: null as (() => void) | null,
    onReadyToSwipe: null as (() => void) | null,
    onSwipeLaunched: null as ((chosenMailbox: MailboxNumber) => void) | null,
    onSwipeProgress: null as
      | ((progress: number, targetedMailbox: MailboxNumber | null) => void)
      | null,
    lastSparkleEmitMs: 0,
    // Interactive 5-mailbox directional swipe-up physics
    mailboxScreenTargets: [] as MailboxTargetScreenPoint[],
    currentEnvBaseY: -1.15,
    swipePointerActive: false,
    swipeStartX: 0,
    swipeStartY: 0,
    swipeLastY: 0,
    swipeLastMs: 0,
    swipeDragPx: 0,
    swipeDragX: 0,
    swipeVelocityY: 0,
    swipeVisualOffset: 0,
    swipeVisualOffsetX: 0,
    swipeVisualRotZ: 0,
    targetedMailbox: null as MailboxNumber | null,
    launchStartMs: 0,
    launchStartWorldX: 0,
    launchStartWorldY: -1.15,
    launchStartRotZ: 0,
    launchTargetMailbox: 3 as MailboxNumber,
    launchImpactSparkleFired: false,
    // Synchronized sampling shrink/lift transform for flat paper
    paperDisplayScale: 1,
    paperDisplayOffsetY: 0,
    // Gentle entrance fade-in when resetting to a brand-new blank loop
    introFadeStartMs: 0,
    // 3D unfold stroke-reveal & ~7 FPS boiling-line tracking
    lastIllusP: -1,
    lastIllusBoilStep: -1,
  });

  const recompositeFrontTexture = useCallback(() => {
    const pipe = texturePipelineRef.current;
    const st = stateRef.current;
    if (!pipe.baseCanvas || !pipe.compositeCanvas || !pipe.texture) return;

    const ctx = pipe.compositeCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.drawImage(pipe.baseCanvas, 0, 0, TEX_W, TEX_H);
    if (
      pipe.illustrationCanvas &&
      pipe.has3DIllustration &&
      !st.isSendingSequence &&
      st.lastEmittedMode !== "flat"
    ) {
      ctx.drawImage(pipe.illustrationCanvas, 0, 0, TEX_W, TEX_H);
    }
    if (pipe.hasIntroDecal && pipe.introDecalCanvas) {
      ctx.drawImage(pipe.introDecalCanvas, 0, 0, TEX_W, TEX_H);
    }
    if (
      pipe.lastDrawingCanvas &&
      pipe.lastDrawingCanvas.width > 0 &&
      pipe.lastDrawingCanvas.height > 0
    ) {
      ctx.drawImage(pipe.lastDrawingCanvas, 0, 0, TEX_W, TEX_H);
    }
    pipe.texture.needsUpdate = true;
  }, []);

  const syncDrawingCanvas = useCallback(
    (drawingCanvas: HTMLCanvasElement | null) => {
      texturePipelineRef.current.lastDrawingCanvas = drawingCanvas;
      recompositeFrontTexture();
    },
    [recompositeFrontTexture]
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
      if (st.lastEmittedMode === "flat" && nextMode !== "flat") {
        st.lastIllusP = -1;
        st.lastIllusBoilStep = -1;
      }
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
    // Take the shortest angular path back to front-facing 0° regardless of full 360° spins
    st.currentRotY = normalizeAngleRad(st.currentRotY);
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
        onEmitSparkles?: (event: SceneSparkleBurstEvent) => void,
        callbacks?: {
          onEnvelopeSealed?: () => void;
          onReadyToSwipe?: () => void;
          onSwipeLaunched?: (chosenMailbox: MailboxNumber) => void;
          onSwipeProgress?: (
            progress: number,
            targetedMailbox: MailboxNumber | null
          ) => void;
        }
      ) => {
        const st = stateRef.current;
        st.introEraserActive = false;
        st.onIntroEraserCursor = null;
        st.onIntroEraserComplete = null;
        st.isSendingSequence = true;
        st.sendSubPhase = "folding";
        st.sendStartMs = performance.now();
        st.lastSparkleEmitMs = 0;
        st.envelopeSealedFired = false;
        st.sendCompleteFired = false;
        st.onSendComplete = onComplete;
        st.onEmitSparkles = onEmitSparkles ?? null;
        st.onEnvelopeSealed = callbacks?.onEnvelopeSealed ?? null;
        st.onReadyToSwipe = callbacks?.onReadyToSwipe ?? null;
        st.onSwipeLaunched = callbacks?.onSwipeLaunched ?? null;
        st.onSwipeProgress = callbacks?.onSwipeProgress ?? null;
        st.swipePointerActive = false;
        st.swipeStartX = 0;
        st.swipeDragPx = 0;
        st.swipeDragX = 0;
        st.swipeVelocityY = 0;
        st.swipeVisualOffset = 0;
        st.swipeVisualOffsetX = 0;
        st.swipeVisualRotZ = 0;
        st.targetedMailbox = null;
        st.launchImpactSparkleFired = false;
        st.isPointerDown = false;
        st.isExternalRefoldDrag = false;
        st.isAutoAnimating = false;
        setIsAwaitingSwipe(false);
        setIsSwipeDragging(false);
        emitModeIfChanged("sending");
      },
      setMailboxScreenTargets: (targets: MailboxTargetScreenPoint[]) => {
        stateRef.current.mailboxScreenTargets = targets;
      },
      playIntroEraserAnimation: (callbacks) => {
        const st = stateRef.current;
        const pipe = texturePipelineRef.current;
        if (!pipe.introDecalCanvas || !pipe.hasIntroDecal) {
          callbacks?.onComplete?.();
          return;
        }
        st.introEraserActive = true;
        st.introEraserStartMs = performance.now();
        st.introEraserLastFrame = -1;
        st.introEraserLastP = 0;
        st.introEraserLastX = 0;
        st.introEraserLastY = 0;
        st.introEraserWasErasing = false;
        st.introEraserStepSeed = 1;
        st.onIntroEraserCursor = callbacks?.onCursorUpdate ?? null;
        st.onIntroEraserComplete = callbacks?.onComplete ?? null;
      },
      cancelIntroEraserAnimation: () => {
        const st = stateRef.current;
        st.introEraserActive = false;
        st.onIntroEraserCursor?.({
          u: 0.5,
          v: 0.5,
          diameterNorm: 0.08,
          opacity: 0,
          isErasing: false,
          visible: false,
        });
        st.onIntroEraserCursor = null;
        st.onIntroEraserComplete = null;
      },
      setPaperDisplayTransform: (scale: number, offsetY: number) => {
        const st = stateRef.current;
        st.paperDisplayScale = scale;
        st.paperDisplayOffsetY = offsetY;
      },
      resetToFreshFolded: () => {
        const st = stateRef.current;
        const pipe = texturePipelineRef.current;
        st.introEraserActive = false;
        st.onIntroEraserCursor = null;
        st.onIntroEraserComplete = null;
        st.isSendingSequence = false;
        st.sendSubPhase = "folding";
        st.envelopeSealedFired = false;
        st.sendCompleteFired = false;
        st.onSendComplete = null;
        st.onEmitSparkles = null;
        st.onEnvelopeSealed = null;
        st.onReadyToSwipe = null;
        st.onSwipeLaunched = null;
        st.onSwipeProgress = null;
        st.swipePointerActive = false;
        st.swipeStartX = 0;
        st.swipeDragPx = 0;
        st.swipeDragX = 0;
        st.swipeVelocityY = 0;
        st.swipeVisualOffset = 0;
        st.swipeVisualOffsetX = 0;
        st.swipeVisualRotZ = 0;
        st.targetedMailbox = null;
        st.launchImpactSparkleFired = false;
        st.paperDisplayScale = 1;
        st.paperDisplayOffsetY = 0;
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
        st.lastIllusP = -1;
        st.lastIllusBoilStep = -1;
        setIsAwaitingSwipe(false);
        setIsSwipeDragging(false);
        setUiProgress(0);
        if (pipe.illustrationCanvas) {
          pipe.illustrationCanvas.getContext("2d")?.clearRect(0, 0, TEX_W, TEX_H);
          pipe.has3DIllustration = false;
        }
        pipe.lastDrawingCanvas = null;
        if (pipe.introDecalCanvas) {
          renderIntroPaperDecalCanvas(pipe.introDecalCanvas);
          pipe.hasIntroDecal = true;
        }
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

    const resolvedDateStamp = getFormattedDateStamp();
    const baseCanvas = createUnifiedStationeryCanvas(resolvedDateStamp);
    const illustrationCanvas = document.createElement("canvas");
    illustrationCanvas.width = TEX_W;
    illustrationCanvas.height = TEX_H;

    const introDecalCanvas = document.createElement("canvas");
    introDecalCanvas.width = TEX_W;
    introDecalCanvas.height = TEX_H;
    renderIntroPaperDecalCanvas(introDecalCanvas);

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = TEX_W;
    compositeCanvas.height = TEX_H;
    const compCtx = compositeCanvas.getContext("2d");
    compCtx?.drawImage(baseCanvas, 0, 0, TEX_W, TEX_H);
    compCtx?.drawImage(introDecalCanvas, 0, 0, TEX_W, TEX_H);

    const sharedTexture = new THREE.CanvasTexture(compositeCanvas);
    sharedTexture.colorSpace = THREE.SRGBColorSpace;
    sharedTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    sharedTexture.minFilter = THREE.LinearMipmapLinearFilter;
    sharedTexture.magFilter = THREE.LinearFilter;
    sharedTexture.generateMipmaps = true;
    sharedTexture.needsUpdate = true;

    texturePipelineRef.current = {
      baseCanvas,
      illustrationCanvas,
      has3DIllustration: false,
      introDecalCanvas,
      hasIntroDecal: true,
      lastDrawingCanvas: null,
      compositeCanvas,
      texture: sharedTexture,
    };

    let disposed = false;

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

    const backCreditsCanvas = document.createElement("canvas");
    backCreditsCanvas.width = 1024;
    backCreditsCanvas.height = 584;
    paintBackCreditsCanvas(backCreditsCanvas, null);

    const backCreditsTexture = new THREE.CanvasTexture(backCreditsCanvas);
    backCreditsTexture.colorSpace = THREE.SRGBColorSpace;
    backCreditsTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    backCreditsTexture.minFilter = THREE.LinearMipmapLinearFilter;
    backCreditsTexture.magFilter = THREE.LinearFilter;
    backCreditsTexture.generateMipmaps = true;
    backCreditsTexture.needsUpdate = true;

    const backCreditsMat = new THREE.MeshBasicMaterial({
      map: backCreditsTexture,
      side: THREE.FrontSide,
      transparent: true,
      opacity: 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const backLogoImg = new Image();
    backLogoImg.crossOrigin = "anonymous";
    backLogoImg.onload = () => {
      if (disposed) return;
      paintBackCreditsCanvas(backCreditsCanvas, backLogoImg);
      backCreditsTexture.needsUpdate = true;
    };
    backLogoImg.src = "/images/no-side-here-logo.png";

    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          if (disposed) return;
          paintBackCreditsCanvas(backCreditsCanvas, backLogoImg);
          backCreditsTexture.needsUpdate = true;
          const pipe = texturePipelineRef.current;
          const st = stateRef.current;
          if (
            pipe.introDecalCanvas &&
            pipe.hasIntroDecal &&
            !st.introEraserActive &&
            !st.isSendingSequence
          ) {
            renderIntroPaperDecalCanvas(pipe.introDecalCanvas);
            recompositeFrontTexture();
          }
        })
        .catch(() => {
          // ignore font readiness rejections
        });
    }

    const topBackPlaneGeom = new THREE.PlaneGeometry(panelW, panelH);

    const disposableGeoms: THREE.BufferGeometry[] = [
      topGeom,
      midGeom,
      botGeom,
      topBackPlaneGeom,
    ];
    const disposableMats: THREE.Material[] = [
      frontMat,
      backPaperMat,
      backCreditsMat,
      outerLineMat,
      creaseLineMat,
    ];

    const buildPanelMesh = (
      geom: THREE.PlaneGeometry,
      hasTopCrease: boolean,
      hasBottomCrease: boolean,
      edgeSeed: number,
      useCreditsBack = false
    ): THREE.Group => {
      const group = new THREE.Group();
      const frontMesh = new THREE.Mesh(geom, frontMat);
      const backMesh = useCreditsBack
        ? new THREE.Mesh(topBackPlaneGeom, backCreditsMat)
        : new THREE.Mesh(geom, backPaperMat);
      if (useCreditsBack) {
        // Flip 180° around Y so FrontSide faces -Z cleanly WITHOUT mirroring the logo/text!
        backMesh.rotation.y = Math.PI;
      }
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
    const topPanel = buildPanelMesh(topGeom, false, true, 202, true);
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

    const envFrontTex = createEnvelopeFrontTexture(resolvedDateStamp);
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

      // Compute exact target 2D letter projection parameters (incorporating synchronized sampling shrink/lift!)
      const box = targetRectRef.current;
      let zFlatTarget = 12;
      let flatCenterX = 0;
      let flatCenterY = 0;
      let flatScaleX = 1;

      if (box && box.width > 10 && box.height > 10 && vpW > 10 && vpH > 10) {
        const effScale = Math.max(0.35, st.paperDisplayScale);
        const effW = box.width * effScale;
        const effH = box.height * effScale;

        zFlatTarget = (totalUnfoldedH * vpH) / (2 * effH * tanHalfFov);
        const visHAtTarget = 2 * zFlatTarget * tanHalfFov;
        const visWAtTarget = visHAtTarget * aspect;

        const boxCenterX = box.left + box.width / 2;
        const boxCenterY = box.top + box.height / 2 + st.paperDisplayOffsetY;
        const ndcX = (boxCenterX / vpW) * 2 - 1;
        const ndcY = 1 - (boxCenterY / vpH) * 2;

        flatCenterX = ndcX * (visWAtTarget / 2);
        flatCenterY = ndcY * (visHAtTarget / 2);

        const targetWorldW = (effW / vpW) * visWAtTarget;
        flatScaleX = targetWorldW / panelW;
      }

      // =======================================================================
      // BRANCH A: STAGE 3 (65° Z-FOLD -> LEFT/RIGHT PENDULUM SHOWCASE -> PRESS FLAT
      //           -> 1PX WIREFRAME ENVELOPE + SEAL) & STAGE 4 (PURE VERTICAL FLIGHT)
      // =======================================================================
      if (st.isSendingSequence) {
        if (backIgLinkRef.current) {
          backIgLinkRef.current.style.opacity = "0";
          backIgLinkRef.current.style.pointerEvents = "none";
        }
        if (pullArrowHintRef.current) {
          pullArrowHintRef.current.style.opacity = "0";
        }
        if (turnArrowHintRef.current) {
          turnArrowHintRef.current.style.opacity = "0";
        }
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
        const visWAtEnv = visHAtEnv * aspect;
        const topEdgeY = visHAtEnv * 0.5;
        // Rest the sealed envelope comfortably in the lower viewport (~69–71% down)
        // so there is a wide, intuitive swipe runway up to the 5 mailboxes above!
        const envBaseY = Math.max(
          -(visHAtEnv * 0.5 - envH * 0.62 - 0.55),
          -visHAtEnv * 0.195
        );
        st.currentEnvBaseY = envBaseY;
        const exitY = topEdgeY + envH * 0.95;
        const showcaseY = 0.02;
        const letterLiftedY = envBaseY + 2.02;

        const getTargetMailboxWorld = (mb: MailboxNumber) => {
          const list =
            st.mailboxScreenTargets.length === 5
              ? st.mailboxScreenTargets
              : computeFallbackMailboxTargets(vpW, vpH);
          const found = list.find((t) => t.mailbox === mb) ?? list[2];
          const ndcX = (found.screenX / Math.max(1, vpW)) * 2 - 1;
          const ndcY = 1 - (found.screenY / Math.max(1, vpH)) * 2;
          return {
            worldX: ndcX * (visWAtEnv * 0.5),
            worldY: ndcY * (visHAtEnv * 0.5),
            screenX: found.screenX,
            screenY: found.screenY,
          };
        };

        // ---------------------------------------------------------------------
        // ACTION A (0.00s -> 0.60s): Accordion 3-panel Z half-fold to 65°
        // ---------------------------------------------------------------------
        const actionAP = easeInOutCubic(clamp01(sElapsed / 0.6));

        // ---------------------------------------------------------------------
        // ACTION B (0.60s -> 4.18s): Pendulum showcase + full backside credits reveal
        //   B1 (0.60s -> 1.08s): Swing LEFT to +35° with -8° viewing pitch
        //   B2 (1.08s -> 1.72s): Sweep across center to RIGHT -35°
        //   B3 (1.72s -> 2.42s): Continue rotating to BACK (-180°) & tighten Z-fold
        //                        so "No Side Here" logo & team credits face the viewer
        //   B4 (2.42s -> 3.42s): Graceful 1.0s pause showcasing the backside credits
        //   B5 (3.42s -> 4.18s): Complete 360° spin (-180° -> -360° front) & press flat
        // ---------------------------------------------------------------------
        const b1 = easePendulum(clamp01((sElapsed - 0.6) / 0.48));
        const b2 = easePendulum(clamp01((sElapsed - 1.08) / 0.64));
        const b3 = easePendulum(clamp01((sElapsed - 1.72) / 0.7));
        const b4 = clamp01((sElapsed - 2.42) / 1.0);
        const b5 = easePendulum(clamp01((sElapsed - 3.42) / 0.76));

        const BACK_PITCH_X = THREE.MathUtils.degToRad(3);
        let foldAngle = actionAP * HALF_FOLD_RAD;
        let showcaseRotY = 0;
        let showcaseRotX = 0;

        if (sElapsed >= 0.6 && sElapsed < 1.08) {
          foldAngle = HALF_FOLD_RAD;
          showcaseRotY = SHOWCASE_SWING_Y * b1;
          showcaseRotX = SHOWCASE_PITCH_X * b1;
        } else if (sElapsed >= 1.08 && sElapsed < 1.72) {
          foldAngle = HALF_FOLD_RAD;
          showcaseRotY = SHOWCASE_SWING_Y * (1 - 2 * b2);
          showcaseRotX = SHOWCASE_PITCH_X;
        } else if (sElapsed >= 1.72 && sElapsed < 2.42) {
          foldAngle = HALF_FOLD_RAD + (MAX_FOLD_ANGLE - HALF_FOLD_RAD) * b3;
          showcaseRotY =
            -SHOWCASE_SWING_Y + (-Math.PI - -SHOWCASE_SWING_Y) * b3;
          showcaseRotX = SHOWCASE_PITCH_X + (BACK_PITCH_X - SHOWCASE_PITCH_X) * b3;
        } else if (sElapsed >= 2.42 && sElapsed < 3.42) {
          foldAngle = MAX_FOLD_ANGLE;
          // Subtle living float on backside so logo & team credits read clearly
          showcaseRotY = -Math.PI + Math.sin(b4 * Math.PI) * 0.055;
          showcaseRotX = BACK_PITCH_X;
        } else if (sElapsed >= 3.42) {
          foldAngle =
            MAX_FOLD_ANGLE + (FLAT_ENVELOPE_FOLD - MAX_FOLD_ANGLE) * b5;
          showcaseRotY = -Math.PI + (-Math.PI * 2 - -Math.PI) * b5;
          showcaseRotX = BACK_PITCH_X * (1 - b5);
        }

        // ---------------------------------------------------------------------
        // ACTION C (3.95s -> 5.65s): Wireframe envelope appears -> letter glides
        //   smoothly into pocket -> top triangular flap folds down 0° -> 180°
        // ---------------------------------------------------------------------
        const envInP = easeOutCubic(clamp01((sElapsed - 3.95) / 0.55));
        const insertP = easeInOutCubic(clamp01((sElapsed - 4.38) / 0.66));
        const sealP = easeInOutCubic(clamp01((sElapsed - 5.0) / 0.65));

        // Notify the exact instant the envelope flap touches shut so the top status capsule fades out
        if (
          st.sendSubPhase === "folding" &&
          !st.envelopeSealedFired &&
          sealP >= 0.96
        ) {
          st.envelopeSealedFired = true;
          st.onEnvelopeSealed?.();
        }

        // Transition into interactive SWIPE-UP WAIT state right once flap seals!
        if (st.sendSubPhase === "folding" && sElapsed >= SEAL_COMPLETE_SEC) {
          if (!st.envelopeSealedFired) {
            st.envelopeSealedFired = true;
            st.onEnvelopeSealed?.();
          }
          st.sendSubPhase = "awaiting-swipe";
          st.swipeDragPx = 0;
          st.swipeDragX = 0;
          st.swipeVisualOffset = 0;
          st.swipeVisualOffsetX = 0;
          st.swipeVisualRotZ = 0;
          st.swipeVelocityY = 0;
          st.targetedMailbox = null;
          setIsAwaitingSwipe(true);
          st.onReadyToSwipe?.();
        }

        // Compute flight / interactive directional swipe progress based on sub-phase
        let flyP = 0;
        let currentEnvX = 0;
        let currentEnvY = envBaseY;
        let currentEnvScale = 0.9 + 0.1 * envInP;
        let currentEnvRotX = 0;
        let currentEnvRotZ = 0;
        let envFadeOut = 1;
        let arcDrawP = easeOutCubic(clamp01((sElapsed - 5.25) / 0.65));

        if (st.sendSubPhase === "awaiting-swipe") {
          const dragNorm = clamp01(st.swipeDragPx / Math.max(210, vpH * 0.36));
          const targetWorldPullY =
            Math.pow(dragNorm, 0.88) * (visHAtEnv * 0.25);

          // Gentle horizontal lean & banking angle toward the aimed mailbox
          let targetWorldPullX = 0;
          let targetRotZ = 0;
          if (st.swipePointerActive && st.targetedMailbox !== null) {
            const mbWorld = getTargetMailboxWorld(st.targetedMailbox);
            const dxNorm = clamp01(Math.abs(st.swipeDragX) / Math.max(90, vpW * 0.24));
            const leanStrength = 0.14 + 0.22 * Math.max(dragNorm, dxNorm);
            targetWorldPullX = Math.max(
              -visWAtEnv * 0.18,
              Math.min(visWAtEnv * 0.18, mbWorld.worldX * leanStrength)
            );
            const aimAngle = Math.atan2(
              mbWorld.worldY - (envBaseY + targetWorldPullY),
              mbWorld.worldX - targetWorldPullX
            );
            targetRotZ = Math.max(
              -0.3,
              Math.min(0.3, (aimAngle - Math.PI / 2) * 0.52)
            );
          }

          const idleFloat =
            st.swipePointerActive || st.swipeDragPx > 2
              ? 0
              : Math.sin(now * 0.0031) * 0.048;

          const lerpFactor = st.swipePointerActive ? 0.3 : 0.14;
          st.swipeVisualOffset +=
            (targetWorldPullY - st.swipeVisualOffset) * lerpFactor;
          st.swipeVisualOffsetX +=
            (targetWorldPullX - st.swipeVisualOffsetX) * lerpFactor;
          st.swipeVisualRotZ +=
            (targetRotZ - st.swipeVisualRotZ) * lerpFactor;

          currentEnvX = st.swipeVisualOffsetX;
          currentEnvY = envBaseY + st.swipeVisualOffset + idleFloat;
          currentEnvScale = 1 + Math.min(0.055, dragNorm * 0.055);
          currentEnvRotX = -Math.min(0.16, dragNorm * 0.16);
          currentEnvRotZ = st.swipeVisualRotZ;
          arcDrawP = st.targetedMailbox !== null ? 0.72 + 0.28 * dragNorm : 0.42;
        } else if (st.sendSubPhase === "launching") {
          const rawFly = clamp01((now - st.launchStartMs) / LAUNCH_DURATION_MS);
          // Brisk, joyful launch acceleration curving gracefully into the target mailbox slot
          flyP = rawFly < 0.5
            ? 2.2 * rawFly * rawFly
            : 1 - Math.pow(-2 * rawFly + 2, 2.2) * 0.45;
          flyP = clamp01(flyP);

          const mbTarget = getTargetMailboxWorld(st.launchTargetMailbox);
          const sx = st.launchStartWorldX;
          const sy = st.launchStartWorldY;
          const tx = mbTarget.worldX;
          const ty = mbTarget.worldY;
          // Graceful lofted quadratic Bezier control point
          const cx = sx * 0.62 + tx * 0.38;
          const cy = sy + (ty - sy) * 0.64 + 0.24;

          const inv = 1 - flyP;
          currentEnvX = inv * inv * sx + 2 * inv * flyP * cx + flyP * flyP * tx;
          currentEnvY = inv * inv * sy + 2 * inv * flyP * cy + flyP * flyP * ty;

          // Tangent heading steers envelope nose smoothly toward the target mailbox
          const tanX = 2 * inv * (cx - sx) + 2 * flyP * (tx - cx);
          const tanY = 2 * inv * (cy - sy) + 2 * flyP * (ty - cy);
          const flightHeading = Math.atan2(tanY, tanX) - Math.PI / 2;
          currentEnvRotZ =
            st.launchStartRotZ * (1 - flyP) +
            Math.max(-0.52, Math.min(0.52, flightHeading * 0.62)) * flyP;

          currentEnvScale = 1.04 - 0.86 * Math.pow(flyP, 0.92);
          currentEnvRotX = -0.14 * (1 - flyP) - 0.22 * flyP;
          envFadeOut = 1 - clamp01((flyP - 0.78) / 0.22);
          arcDrawP = 1;

          // Celebratory arrival starlight burst right inside the chosen mailbox!
          if (!st.launchImpactSparkleFired && flyP >= 0.88) {
            st.launchImpactSparkleFired = true;
            st.onEmitSparkles?.({
              x: mbTarget.screenX,
              y: mbTarget.screenY,
              spreadX: 34,
              spreadY: 22,
              count: 11,
              vxBias: 0,
              vyBias: -36,
              speedMin: 40,
              speedMax: 135,
              sizeScale: 1.05,
            });
          }
        }

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
        const yAfterLift = yAfterA + (letterLiftedY - yAfterA) * b5;
        const lY = yAfterLift + (envBaseY - yAfterLift) * insertP;

        const scaleXAfterA = flatScaleX + (1.0 - flatScaleX) * actionAP;
        const lScaleX = scaleXAfterA + (0.94 - scaleXAfterA) * b5;
        const lScaleY = 1 - 0.06 * b5;
        const lScaleZ = 1 - 0.78 * insertP;

        // Envelope visibility & fade-out during vertical exit
        envGroup.visible = envInP > 0.005;
        const envAlpha = envInP * envFadeOut;

        // Hide letter cleanly behind front pocket wall once inserted & flap closes
        const letterAlpha = insertP > 0.9 ? Math.max(0, 1 - sealP * 2.4) : 1;
        frontMat.opacity = letterAlpha;
        backPaperMat.opacity = letterAlpha;
        backCreditsMat.opacity = letterAlpha;
        outerLineMat.opacity = letterAlpha;
        creaseLineMat.opacity = (0.08 + 0.92 * actionAP) * letterAlpha;
        letterRoot.visible = letterAlpha > 0.01;

        envGroup.position.set(currentEnvX, currentEnvY, 0);
        envGroup.scale.set(currentEnvScale, currentEnvScale, currentEnvScale);
        envGroup.rotation.set(currentEnvRotX, 0, currentEnvRotZ);

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

        // Dynamic curved dashed trajectory line aiming straight at the targeted mailbox
        const activeArcMailbox =
          st.sendSubPhase === "launching"
            ? st.launchTargetMailbox
            : st.targetedMailbox;
        flightArcLine.visible =
          arcDrawP > 0.01 &&
          envFadeOut > 0.01 &&
          (st.sendSubPhase === "awaiting-swipe" || st.sendSubPhase === "launching");
        if (flightArcLine.visible) {
          const posAttr = arcGeom.getAttribute("position") as THREE.BufferAttribute;
          const startX =
            st.sendSubPhase === "launching" ? st.launchStartWorldX : currentEnvX;
          const startY =
            (st.sendSubPhase === "launching" ? st.launchStartWorldY : currentEnvY) +
            envH * 0.16;

          if (activeArcMailbox !== null) {
            const mbWorld = getTargetMailboxWorld(activeArcMailbox);
            const tx = mbWorld.worldX;
            const ty = mbWorld.worldY - 0.18;
            const cx = startX * 0.62 + tx * 0.38;
            const cy = startY + (ty - startY) * 0.64 + 0.24;
            for (let i = 0; i <= verticalLineSegments; i++) {
              const t = i / verticalLineSegments;
              const inv = 1 - t;
              const px = inv * inv * startX + 2 * inv * t * cx + t * t * tx;
              const py = inv * inv * startY + 2 * inv * t * cy + t * t * ty;
              posAttr.setXYZ(i, px, py, -0.08);
            }
          } else {
            const stemTop = Math.min(exitY - 1.2, startY + 2.4);
            for (let i = 0; i <= verticalLineSegments; i++) {
              const t = i / verticalLineSegments;
              posAttr.setXYZ(i, 0, startY + (stemTop - startY) * t, -0.08);
            }
          }
          posAttr.needsUpdate = true;
          flightArcLine.computeLineDistances();

          const drawVerts = Math.max(
            2,
            Math.min(
              verticalPts.length,
              Math.ceil(arcDrawP * verticalPts.length)
            )
          );
          arcGeom.setDrawRange(0, drawVerts);
          arcMat.color.setHex(activeArcMailbox !== null ? 0xf3d98b : 0xd8d8d0);
          arcMat.opacity =
            (activeArcMailbox !== null
              ? st.sendSubPhase === "launching"
                ? 0.56
                : 0.62
              : 0.22) * envFadeOut;
        }

        // ---------------------------------------------------------------------
        // CONTINUOUS SPARKLE EMISSION FROM CREASES, ENVELOPE MOUTH & FLIGHT TAIL
        // ---------------------------------------------------------------------
        if (st.onEmitSparkles) {
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld();

          const emitIntervalMs =
            st.sendSubPhase === "launching"
              ? 105
              : st.sendSubPhase === "awaiting-swipe"
                ? st.swipePointerActive
                  ? 135
                  : 320
                : sElapsed < 4.18
                  ? 190
                  : 165;

          if (now - st.lastSparkleEmitMs >= emitIntervalMs) {
            st.lastSparkleEmitMs = now;

            if (st.sendSubPhase === "folding" && sElapsed >= 0.05 && sElapsed < 4.18) {
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
                vxBias: Math.sin(showcaseRotY) * 28,
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
                vxBias: -Math.sin(showcaseRotY) * 24,
                vyBias: -28,
                speedMin: 32,
                speedMax: 84,
                sizeScale: 0.96,
              });
            } else if (st.sendSubPhase === "folding" && sElapsed >= 4.18 && sElapsed < 5.64) {
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
            } else if (st.sendSubPhase === "awaiting-swipe") {
              // Gentle floating starlight around the waiting sealed envelope (stronger as user pulls upward)
              projTmpA.set(currentEnvX, currentEnvY - envH * 0.25, 0.05);
              const envScreen = projectWorldToViewport(projTmpA);
              st.onEmitSparkles({
                x: envScreen.x,
                y: envScreen.y,
                spreadX: st.swipePointerActive ? 78 : 110,
                spreadY: 24,
                count: 1,
                vxBias: 0,
                vyBias: st.swipePointerActive ? 22 : -26,
                speedMin: 18,
                speedMax: 52,
                sizeScale: 0.88,
              });
            } else if (st.sendSubPhase === "launching" && flyP < 0.92 && envFadeOut > 0.08) {
              // Crisp trailing hand-drawn stars along the curved arc behind the flying envelope
              projTmpA.set(currentEnvX, currentEnvY - envH * 0.35 * currentEnvScale, 0);
              const tailScreen = projectWorldToViewport(projTmpA);
              st.onEmitSparkles({
                x: tailScreen.x,
                y: tailScreen.y,
                spreadX: 38 * Math.max(0.35, currentEnvScale),
                spreadY: 12,
                count: 1,
                vxBias: 0,
                vyBias: 20,
                speedMin: 16,
                speedMax: 52,
                sizeScale: 0.88 * Math.max(0.55, currentEnvScale),
              });
            }
          }
        }

        renderer.render(scene, camera);

        if (st.sendSubPhase === "launching" && flyP >= 1 && !st.sendCompleteFired) {
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
      backCreditsMat.opacity = introAlpha;
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

      // Progressive 3D unfold stroke-reveal & ~6.9 FPS boiling lines for Yanshui motifs
      // (Shown ONLY during initial unfold before preset illustrations are erased for drawing;
      // cleanly handed off to 2D YanshuiPaperIllustration once flat)
      if (st.lastEmittedMode !== "flat") {
        const pipe = texturePipelineRef.current;
        if (pipe.illustrationCanvas) {
          if (pipe.hasIntroDecal && p > 0.01) {
            const boilStep = Math.floor((elapsed * 1000) / 145);
            if (
              boilStep !== st.lastIllusBoilStep ||
              Math.abs(p - st.lastIllusP) > 0.012
            ) {
              st.lastIllusBoilStep = boilStep;
              st.lastIllusP = p;
              const illusCtx = pipe.illustrationCanvas.getContext("2d");
              if (illusCtx) {
                illusCtx.clearRect(0, 0, TEX_W, TEX_H);
                drawYanshuiPerimeterMotifs(
                  illusCtx,
                  TEX_W,
                  TEX_H,
                  p,
                  boilStep,
                  elapsed,
                  1
                );
                pipe.has3DIllustration = true;
                recompositeFrontTexture();
              }
            }
          } else if (pipe.has3DIllustration) {
            pipe.illustrationCanvas
              .getContext("2d")
              ?.clearRect(0, 0, TEX_W, TEX_H);
            pipe.has3DIllustration = false;
            st.lastIllusP = 0;
            recompositeFrontTexture();
          }
        }
      }

      // Step 1.3 Smooth 60fps slow auto-eraser sweep over the 3D intro paper decal (2.25s)
      if (st.introEraserActive) {
        const pipe = texturePipelineRef.current;
        const elapsedEraserMs = Math.max(0, now - st.introEraserStartMs);
        const pNow = clamp01(elapsedEraserMs / INTRO_ERASER_DURATION_MS);
        const pPrev = st.introEraserLastP;

        if (
          pipe.introDecalCanvas &&
          pipe.compositeCanvas &&
          pipe.baseCanvas &&
          pipe.texture
        ) {
          const decalCtx = pipe.introDecalCanvas.getContext("2d");
          if (decalCtx) {
            const subSteps = Math.max(
              1,
              Math.min(8, Math.ceil((pNow - pPrev) / 0.008))
            );
            let didErase = false;
            let latestSample = sampleIntroEraserTrajectory(pNow);

            for (let s = 1; s <= subSteps; s++) {
              const ps = pPrev + ((pNow - pPrev) * s) / subSteps;
              const sample = sampleIntroEraserTrajectory(ps);
              latestSample = sample;
              if (sample.isErasing) {
                const x0 = st.introEraserWasErasing
                  ? st.introEraserLastX
                  : sample.texX;
                const y0 = st.introEraserWasErasing
                  ? st.introEraserLastY
                  : sample.texY;
                eraseIntroDecalSegment(
                  decalCtx,
                  x0,
                  y0,
                  sample.texX,
                  sample.texY,
                  sample.diameterTex,
                  7700 + st.introEraserStepSeed++
                );
                didErase = true;
              }
              st.introEraserLastX = sample.texX;
              st.introEraserLastY = sample.texY;
              st.introEraserWasErasing = sample.isErasing;
            }

            st.introEraserLastP = pNow;

            if (pNow >= 1) {
              decalCtx.clearRect(0, 0, TEX_W, TEX_H);
              pipe.hasIntroDecal = false;
              didErase = true;
            }

            if (didErase) {
              recompositeFrontTexture();
            }

            if (pNow >= 1) {
              st.introEraserActive = false;
              st.onIntroEraserCursor?.({
                u: latestSample.texX / TEX_W,
                v: latestSample.texY / TEX_H,
                diameterNorm: latestSample.diameterTex / TEX_W,
                opacity: 0,
                isErasing: false,
                tiltDeg: 0,
                visible: false,
              });
              const doneCb = st.onIntroEraserComplete;
              st.onIntroEraserCursor = null;
              st.onIntroEraserComplete = null;
              doneCb?.();
            } else {
              const smoothTiltDeg = Math.sin(pNow * Math.PI * 10) * 4.5;
              st.onIntroEraserCursor?.({
                u: latestSample.texX / TEX_W,
                v: latestSample.texY / TEX_H,
                diameterNorm: latestSample.diameterTex / TEX_W,
                opacity: latestSample.opacity,
                isErasing: latestSample.isErasing,
                tiltDeg: smoothTiltDeg,
                visible: latestSample.opacity > 0.01,
              });
            }
          }
        }
      }

      renderer.render(scene, camera);

      // Live 3D-projected clickable Instagram hitbox glued onto the backside IG pill
      const igLinkEl = backIgLinkRef.current;
      if (igLinkEl) {
        const backFacing = -Math.cos(st.currentRotY);
        const showIgLink = p < 0.08 && backFacing > 0.52 && introAlpha > 0.5;
        if (showIgLink) {
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld();
          // IG pill center on topBackMesh (canvas y=456/584 -> local y=-0.415)
          projTmpA.set(0, -0.415, -0.01);
          topPanel.localToWorld(projTmpA);
          const centerScr = projectWorldToViewport(projTmpA);

          projTmpA.set(0.41, -0.415, -0.01);
          topPanel.localToWorld(projTmpA);
          const edgeScr = projectWorldToViewport(projTmpA);

          const halfW = Math.max(46, Math.abs(edgeScr.x - centerScr.x));
          const pillW = halfW * 2;
          const pillH = Math.max(28, pillW * 0.22);
          const linkAlpha = clamp01((backFacing - 0.52) / 0.26);

          igLinkEl.style.left = `${centerScr.x.toFixed(1)}px`;
          igLinkEl.style.top = `${centerScr.y.toFixed(1)}px`;
          igLinkEl.style.width = `${pillW.toFixed(1)}px`;
          igLinkEl.style.height = `${pillH.toFixed(1)}px`;
          igLinkEl.style.opacity = linkAlpha.toFixed(3);
          igLinkEl.style.pointerEvents = "auto";
        } else {
          igLinkEl.style.opacity = "0";
          igLinkEl.style.pointerEvents = "none";
        }
      }

      // Live 3D-projected directional arrow hints anchored to bottom & right edges when Z-folded
      const pullHintEl = pullArrowHintRef.current;
      const turnHintEl = turnArrowHintRef.current;
      if (pullHintEl && turnHintEl) {
        const frontFacing = Math.cos(st.currentRotY);
        const hintAlpha =
          clamp01((frontFacing - 0.36) / 0.36) *
          clamp01(1 - p / 0.14) *
          introAlpha;
        if (hintAlpha > 0.015) {
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld();

          // 1. Bottom-center pull-down arrow hint anchored below botPanel bottom edge
          projTmpA.set(0, -panelH * 0.5, 0.02);
          botPanel.localToWorld(projTmpA);
          const botScr = projectWorldToViewport(projTmpA);
          pullHintEl.style.left = `${botScr.x.toFixed(1)}px`;
          pullHintEl.style.top = `${Math.min(vpH - 160, botScr.y + 10).toFixed(1)}px`;
          pullHintEl.style.opacity = hintAlpha.toFixed(3);

          // 2. Right-edge curved turn-to-back arrow hint wrapping behind the Z-fold right edge
          projTmpA.set(panelW * 0.5, 0.08, 0.02);
          botPanel.localToWorld(projTmpA);
          const rightScr = projectWorldToViewport(projTmpA);
          const clampedRightX = Math.min(vpW - 26, Math.max(26, rightScr.x + 8));
          turnHintEl.style.left = `${clampedRightX.toFixed(1)}px`;
          turnHintEl.style.top = `${rightScr.y.toFixed(1)}px`;
          turnHintEl.style.opacity = hintAlpha.toFixed(3);
        } else {
          pullHintEl.style.opacity = "0";
          turnHintEl.style.opacity = "0";
        }
      }

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
      disposed = true;
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      disposableGeoms.forEach((g) => g.dispose());
      disposableMats.forEach((m) => m.dispose());
      sharedTexture.dispose();
      backCreditsTexture.dispose();
      envFrontTex.dispose();
      shadowTex.dispose();
      renderer.dispose();
      texturePipelineRef.current = {
        baseCanvas: null,
        illustrationCanvas: null,
        has3DIllustration: false,
        introDecalCanvas: null,
        hasIntroDecal: false,
        lastDrawingCanvas: null,
        compositeCanvas: null,
        texture: null,
      };
    };
  }, [emitModeIfChanged, recompositeFrontTexture]);

  // Pointer interactions:
  // 1) When folded: Orbit/Tilt OR Pull-down to Unfold
  // 2) When sealed & awaiting swipe: Swipe / Drag UPWARD to launch envelope straight up!
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, forcePull = false) => {
      const st = stateRef.current;

      // Branch 1: Interactive Directional Swipe-Up to Send sealed envelope to Mailbox 1..6
      if (st.isSendingSequence) {
        if (st.sendSubPhase !== "awaiting-swipe") return;
        e.currentTarget.setPointerCapture(e.pointerId);
        st.swipePointerActive = true;
        st.swipeStartX = e.clientX;
        st.swipeStartY = e.clientY;
        st.swipeLastY = e.clientY;
        st.swipeLastMs = performance.now();
        st.swipeDragPx = 0;
        st.swipeDragX = 0;
        st.swipeVelocityY = 0;
        st.targetedMailbox = null;
        setIsSwipeDragging(true);
        return;
      }

      if (st.lastEmittedMode === "flat") return;

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

      // Branch 1: Interactive Directional Swipe-Up to Send sealed envelope to Mailbox 1..6
      if (st.isSendingSequence) {
        if (!st.swipePointerActive || st.sendSubPhase !== "awaiting-swipe") return;
        const nowMs = performance.now();
        const dtMs = Math.max(1, nowMs - st.swipeLastMs);
        const stepUp = st.swipeLastY - e.clientY; // positive when moving UP
        st.swipeVelocityY = st.swipeVelocityY * 0.45 + (stepUp / dtMs) * 0.55;
        st.swipeLastY = e.clientY;
        st.swipeLastMs = nowMs;

        const dragUpPx = Math.max(0, st.swipeStartY - e.clientY);
        const dragX = e.clientX - st.swipeStartX;
        st.swipeDragPx = dragUpPx;
        st.swipeDragX = dragX;

        const targetMb = resolveTargetedMailbox(
          st.swipeStartX,
          st.swipeStartY,
          e.clientX,
          e.clientY,
          window.innerWidth,
          window.innerHeight,
          st.mailboxScreenTargets
        );
        st.targetedMailbox = targetMb;

        const dragDist = Math.hypot(dragX * 0.55, dragUpPx);
        const effectivePull = dragUpPx > 24 ? Math.max(dragUpPx, dragDist * 0.85) : dragUpPx;
        st.onSwipeProgress?.(
          clamp01(effectivePull / SWIPE_LAUNCH_THRESHOLD_PX),
          targetMb
        );
        return;
      }

      if (!st.isPointerDown) return;

      const totalDx = e.clientX - st.pointerStartX;
      const totalDy = e.clientY - st.pointerStartY;
      const stepDx = e.clientX - st.lastPointerX;
      const stepDy = e.clientY - st.lastPointerY;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;

      if (st.gestureMode === "none" && Math.hypot(totalDx, totalDy) > 8) {
        if (totalDy > 10 && Math.abs(totalDy) > Math.abs(totalDx) * 1.2) {
          st.gestureMode = "pull";
          // Wrap current Y rotation into [-PI, PI] so pulling down always unwinds cleanly
          st.currentRotY = normalizeAngleRad(st.currentRotY);
          st.targetRotY = normalizeAngleRad(st.targetRotY);
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
        st.targetRotY += stepDx * 0.002;
      } else if (st.gestureMode === "orbit") {
        // Full unrestricted 360° horizontal spin so users can inspect the backside credits!
        st.targetRotY += stepDx * 0.0105;
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

      // Branch 1: Release from Swipe-Up gesture -> Launch or Rebound
      if (st.isSendingSequence && st.swipePointerActive) {
        st.swipePointerActive = false;
        setIsSwipeDragging(false);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        const dragDist = Math.hypot(st.swipeDragX * 0.55, st.swipeDragPx);
        const effectivePull =
          st.swipeDragPx > 24
            ? Math.max(st.swipeDragPx, dragDist * 0.85)
            : st.swipeDragPx;

        const shouldLaunch =
          effectivePull >= SWIPE_LAUNCH_THRESHOLD_PX ||
          (st.swipeDragPx >= 32 && st.swipeVelocityY >= 0.4);

        if (shouldLaunch && st.sendSubPhase === "awaiting-swipe") {
          const fallbackTarget = resolveTargetedMailbox(
            st.swipeStartX,
            st.swipeStartY,
            e.clientX,
            e.clientY,
            window.innerWidth,
            window.innerHeight,
            st.mailboxScreenTargets
          );
          const chosenMailbox: MailboxNumber =
            st.targetedMailbox ?? fallbackTarget ?? 3;

          st.sendSubPhase = "launching";
          st.launchStartMs = performance.now();
          st.launchStartWorldX = st.swipeVisualOffsetX;
          st.launchStartWorldY = st.currentEnvBaseY + st.swipeVisualOffset;
          st.launchStartRotZ = st.swipeVisualRotZ;
          st.launchTargetMailbox = chosenMailbox;
          st.launchImpactSparkleFired = false;
          setIsAwaitingSwipe(false);
          st.onSwipeProgress?.(1, chosenMailbox);
          st.onSwipeLaunched?.(chosenMailbox);

          // Celebratory hand-drawn crayon star burst on launch (near lower envelope position)
          st.onEmitSparkles?.({
            x: window.innerWidth * 0.5,
            y: window.innerHeight * 0.7,
            spreadX: 84,
            spreadY: 26,
            count: 7,
            vxBias: Math.max(-75, Math.min(75, st.swipeDragX * 0.45)),
            vyBias: -85,
            speedMin: 48,
            speedMax: 140,
            sizeScale: 1.06,
          });
        } else {
          st.swipeDragPx = 0;
          st.swipeDragX = 0;
          st.swipeVelocityY = 0;
          st.targetedMailbox = null;
          st.onSwipeProgress?.(0, null);
        }
        return;
      }

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
        st.currentRotY = normalizeAngleRad(st.currentRotY);
        st.targetProgress = 1;
        st.targetRotX = 0;
        st.targetRotY = 0;
      }
    },
    [emitModeIfChanged]
  );

  const isFoldedUI = sceneMode === "folded" || sceneMode === "transitioning";
  const chromeOpacity = isFoldedUI ? Math.max(0, 1 - uiProgress / 42) : 0;
  const canInteractMount = isFoldedUI || (sceneMode === "sending" && isAwaitingSwipe);

  // Hidden 5-tap trigger on the top-right date (links to light-msg-server.nosidehere.space)
  const secretDateTapRef = useRef<{ count: number; lastTapMs: number }>({
    count: 0,
    lastTapMs: 0,
  });
  const handleSecretDateTap = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const now = Date.now();
      const tracker = secretDateTapRef.current;
      if (now - tracker.lastTapMs > 2500) {
        tracker.count = 0;
      }
      tracker.count += 1;
      tracker.lastTapMs = now;
      if (tracker.count >= 5) {
        tracker.count = 0;
        window.location.href = "https://light-msg-server.nosidehere.space";
      }
    },
    []
  );

  return (
    <div
      onWheel={handleWheel}
      className={`fixed inset-0 ${
        sceneMode === "sending"
          ? isAwaitingSwipe
            ? "z-30 pointer-events-auto"
            : "z-30 pointer-events-none"
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
          canInteractMount
            ? isDraggingPull || isSwipeDragging
              ? "cursor-grabbing pointer-events-auto"
              : "cursor-grab pointer-events-auto"
            : "pointer-events-none"
        }`}
        aria-label={
          isAwaitingSwipe
            ? "向上滑動寄出已封緘的信封"
            : "3D Z 字折疊空白信紙，可旋轉檢視或向下拉動展開"
        }
      />

      {/* Live 3D-projected clickable Instagram link glued onto the backside IG pill */}
      <a
        ref={backIgLinkRef}
        href={NO_SIDE_HERE_IG_URL}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="前往 No Side Here Instagram"
        style={{
          left: "50%",
          top: "50%",
          width: "140px",
          height: "34px",
          opacity: 0,
          pointerEvents: "none",
          transform: "translate(-50%, -50%)",
        }}
        className="fixed z-20 rounded-full border border-transparent transition-colors duration-200 hover:border-[#222222]/45 hover:bg-[#222222]/[0.06] active:bg-[#222222]/[0.12]"
      >
        <span className="sr-only">No Side Here Instagram (@no.side.here)</span>
      </a>

      {/* Live 3D-projected Bottom-Center Pull-Down Arrow + Small Circular Draw Icon (when Z-folded) */}
      <div
        ref={pullArrowHintRef}
        aria-hidden="true"
        style={{
          left: "50%",
          top: "66%",
          opacity: 0,
          transform: "translate(-50%, 0)",
          willChange: "left, top, opacity",
        }}
        className="pointer-events-none fixed z-10 flex flex-col items-center gap-1.5 select-none"
      >
        <svg
          width="18"
          height="22"
          viewBox="0 0 22 26"
          fill="none"
          className="animate-hint-pull-down text-[#222222]/75 drop-shadow-[0_1px_2px_rgba(252,251,250,0.9)]"
        >
          <path
            d="M11.2 2.2C10.8 8.4 11.4 15.2 11 22.4M11 22.4C8.9 19.8 6.8 17.6 4.4 15.8M11 22.4C13.2 19.6 15.4 17.6 17.6 15.6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#222222]/28 bg-[#FCFBFA]/90 text-[#222222]/75 shadow-[0_1px_4px_rgba(34,34,34,0.06)] backdrop-blur-[2px]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M11.6 2.4L13.6 4.4L5.8 12.2L2.8 13.2L3.8 10.2L11.6 2.4Z"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9.9 4.1L11.9 6.1"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>

      {/* Live 3D-projected Right-Edge Turn-to-Back Curved Arrow + Small Circular Info Icon (when Z-folded) */}
      <div
        ref={turnArrowHintRef}
        aria-hidden="true"
        style={{
          left: "88%",
          top: "52%",
          opacity: 0,
          transform: "translate(-50%, -50%)",
          willChange: "left, top, opacity",
        }}
        className="pointer-events-none fixed z-10 flex flex-col items-center gap-1 select-none"
      >
        <svg
          width="30"
          height="26"
          viewBox="0 0 36 32"
          fill="none"
          className="animate-hint-turn-back text-[#222222]/78 drop-shadow-[0_1px_3px_rgba(252,251,250,0.95)]"
        >
          {/* Hand-drawn curved 3D wrap-around arrow curling behind the right edge of the Z-fold */}
          <path
            d="M4.5 23.5C15.5 26.8 29.5 23.2 31.2 14.5C32.4 8.2 25.4 5.2 15.8 8.2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M19.8 4.1C17.8 5.8 16.2 7.2 14.8 8.4C17.2 9.4 19.6 10.6 21.8 11.9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#222222]/28 bg-[#FCFBFA]/90 text-[#222222]/75 shadow-[0_1px_4px_rgba(34,34,34,0.06)] backdrop-blur-[2px]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="8" cy="4.4" r="0.95" fill="currentColor" />
            <path
              d="M8 7.1V11.8"
              stroke="currentColor"
              strokeWidth="1.45"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>

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
        className="pointer-events-none absolute top-5 right-5 left-5 z-10 flex items-center justify-between font-mono text-[10px] tracking-[0.22em] text-[#8C8C8A] transition-opacity duration-150 sm:top-7 sm:right-10 sm:left-10"
      >
        <span>NO. 001 // Z-FOLD</span>
        <span className="hidden md:inline">
          DRAG TO ORBIT · PULL DOWN TO UNFOLD
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleSecretDateTap}
          suppressHydrationWarning
          tabIndex={-1}
          aria-label="日期"
          className={`-m-2 cursor-default select-none border-0 bg-transparent p-2 font-mono text-[10px] tracking-[0.22em] text-[#8C8C8A] focus:outline-none ${
            isFoldedUI && chromeOpacity > 0.2
              ? "pointer-events-auto"
              : "pointer-events-none"
          }`}
        >
          {dateStamp || "\u00A0"}
        </button>
      </div>

      {/* Bottom Pull-to-Open Indicator when folded (enhanced visibility & clarity) */}
      {isFoldedUI && (
        <div
          style={{
            opacity: Math.max(0, 1 - Math.max(0, uiProgress - 45) / 35),
          }}
          className="pointer-events-none absolute right-0 bottom-7 left-0 flex flex-col items-center gap-3 px-5 transition-opacity duration-150 sm:bottom-9"
        >
          <div className="sketch-progress relative h-[5px] w-48 border border-[#222222]/35 bg-[#FAF9F6] sm:w-52">
            <span
              aria-hidden="true"
              className="absolute -top-1 bottom-0 h-3 w-[1.5px] bg-[#6E6D6A]"
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
              className="sketch-pill group inline-flex items-center gap-3 border-[1.25px] border-[#222222] bg-[#FDFCF9] px-5 py-2 transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FAF9F6] active:scale-[0.97]"
            >
              <svg
                width="14"
                height="16"
                viewBox="0 0 12 14"
                fill="none"
                className="text-[#222222] transition-transform duration-300 group-hover:translate-y-0.5"
                aria-hidden="true"
              >
                <path
                  d="M6.2 1.4C5.8 4.8 6.3 8.4 6 11.9M6 11.9C4.7 10.7 3.7 9.5 2.4 8.6M6 11.9C7.3 10.6 8.3 9.7 9.6 8.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="font-mono text-xs font-medium tracking-[0.2em] text-[#222222]">
                PULL TO OPEN
              </span>
              <span className="font-mono text-[11px] font-normal tabular-nums text-[#555450]">
                {String(uiProgress).padStart(2, "0")}%
              </span>
            </button>
          </div>

          <p className="font-sans text-[14px] font-normal tracking-[0.16em] text-[#2F2E2B] sm:text-[15.5px]">
            向下拉開信紙開始創作，或拖曳旋轉檢視
          </p>
        </div>
      )}
    </div>
  );
});
