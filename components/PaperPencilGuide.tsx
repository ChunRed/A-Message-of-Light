"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createSeededRng } from "@/lib/hand-drawn-utils";
import {
  drawHandJitteredTextMask,
  eraseIntroDecalSegment,
  resolveDocumentFontFamilies,
  transferFinePencilTexture,
} from "@/lib/paper-decal";
import { EraserIcon } from "@/components/LetterIcons";

interface PaperPencilGuideProps {
  /** Called immediately when the user clicks "開始創作" and the rubber-eraser begins wiping */
  onBeginErasing?: () => void;
  /** Called once the rubber eraser finishes wiping away the pencil guide */
  onStartCreating: () => void;
}

interface ButtonHitbox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SketchPolylinePoint {
  x: number;
  y: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Generates an organic hand-sketched rounded-pill perimeter polyline
 * (with tiny corner overshoot) so it can be progressively traced stroke-by-stroke
 * like a graphite pencil drawing a button directly onto stationery paper.
 */
function buildHandSketchedButtonLoop(
  cx: number,
  cy: number,
  w: number,
  h: number,
  seed: number
): SketchPolylinePoint[] {
  const rng = createSeededRng(seed);
  const rx = w * 0.5;
  const ry = h * 0.5;
  const r = Math.min(ry, 16);
  const pts: SketchPolylinePoint[] = [];

  const pushArc = (
    acx: number,
    acy: number,
    rad: number,
    startA: number,
    endA: number,
    steps: number
  ) => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = startA + (endA - startA) * t;
      pts.push({
        x: acx + Math.cos(a) * rad + (rng() - 0.5) * 1.15,
        y: acy + Math.sin(a) * rad + (rng() - 0.5) * 1.15,
      });
    }
  };

  const pushLine = (x0: number, y0: number, x1: number, y1: number, steps: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    let drift = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      drift = drift * 0.45 + (rng() - 0.5) * 1.35 * Math.sin(t * Math.PI);
      pts.push({
        x: x0 + dx * t + nx * drift,
        y: y0 + dy * t + ny * drift,
      });
    }
  };

  const left = cx - rx;
  const right = cx + rx;
  const top = cy - ry;
  const bottom = cy + ry;

  pts.push({ x: left + r - 3, y: top + 0.6 });
  pushLine(left + r, top, right - r, top, 14);
  pushArc(right - r, top + r, r, -Math.PI / 2, 0, 6);
  pushLine(right, top + r, right, bottom - r, 5);
  pushArc(right - r, bottom - r, r, 0, Math.PI / 2, 6);
  pushLine(right - r, bottom, left + r, bottom, 14);
  pushArc(left + r, bottom - r, r, Math.PI / 2, Math.PI, 6);
  pushLine(left, bottom - r, left, top + r, 5);
  pushArc(left + r, top + r, r, Math.PI, Math.PI * 1.5, 6);
  pts.push({ x: left + r + 8, y: top - 0.5 });

  return pts;
}

/**
 * Draws a portion [0..progress] of a polyline and returns the current head point
 * so the animated graphite pencil tip stays locked to the line being drawn.
 */
function strokeProgressivePolyline(
  ctx: CanvasRenderingContext2D,
  pts: SketchPolylinePoint[],
  progress: number,
  strokeStyle: string,
  lineWidth: number
): SketchPolylinePoint | null {
  if (pts.length < 2 || progress <= 0.002) return null;

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLens.push(l);
    totalLen += l;
  }
  if (totalLen < 1) return null;

  let remaining = totalLen * clamp01(progress);
  let head: SketchPolylinePoint = pts[0];

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 0; i < segLens.length && remaining > 0; i++) {
    const l = segLens[i];
    if (l < 0.01) continue;
    if (remaining >= l) {
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      head = pts[i + 1];
      remaining -= l;
    } else {
      const f = remaining / l;
      head = {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
      };
      ctx.lineTo(head.x, head.y);
      remaining = 0;
    }
  }
  ctx.stroke();
  ctx.restore();
  return head;
}

/**
 * Renders a pre-baked graphite text canvas revealed cleanly left-to-right with
 * a slanted natural writing-edge clip matching a tilted pencil nib.
 */
function drawProgressivePencilLine(
  ctx: CanvasRenderingContext2D,
  bakedCanvas: HTMLCanvasElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  progress: number,
  dpr: number
): { headX: number; headY: number } | null {
  if (progress <= 0.002) return null;
  const p = clamp01(progress);
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const revealX = bounds.minX + bw * p;
  const lineMidY = (bounds.minY + bounds.maxY) * 0.5;
  const slant = 9;

  ctx.save();
  if (p < 0.998) {
    ctx.beginPath();
    ctx.moveTo(bounds.minX - 10, bounds.minY - 8);
    ctx.lineTo(revealX + slant, bounds.minY - 8);
    ctx.lineTo(revealX - slant, bounds.maxY + 8);
    ctx.lineTo(bounds.minX - 10, bounds.maxY + 8);
    ctx.closePath();
    ctx.clip();
  }
  ctx.drawImage(
    bakedCanvas,
    0,
    0,
    bakedCanvas.width,
    bakedCanvas.height,
    0,
    0,
    bakedCanvas.width / dpr,
    bakedCanvas.height / dpr
  );
  ctx.restore();

  const bob = Math.sin(p * Math.PI * 16) * 2.4;
  return {
    headX: revealX,
    headY: lineMidY + bob,
  };
}

/**
 * Draws a delicate minimalist graphite pencil tip hovering at the active writing point.
 */
function drawPencilNibIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  alpha: number,
  wobbleRad = 0
): void {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(-0.62 + wobbleRad);

  ctx.fillStyle = "rgba(34, 34, 34, 0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(42, 41, 38, 0.78)";
  ctx.fillStyle = "rgba(250, 249, 246, 0.92)";
  ctx.lineWidth = 1.15;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(5.5, -8.5);
  ctx.lineTo(5.5, -30);
  ctx.lineTo(-1.5, -30);
  ctx.lineTo(-1.5, -8.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-1.3, -8.5);
  ctx.lineTo(5.3, -8.5);
  ctx.stroke();

  ctx.fillStyle = "rgba(42, 41, 38, 0.85)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(2.4, -3.7);
  ctx.lineTo(-0.5, -3.7);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Samples the back-and-forth rubber-eraser trajectory across the written pencil guide
 * (title -> body lines -> sketched "開始創作" button) in CSS pixels.
 */
function sampleGuideEraserPath(
  p: number,
  area: { left: number; right: number; topY: number; botY: number }
): { x: number; y: number; diameter: number; opacity: number; isErasing: boolean } {
  const t = clamp01(p);
  const { left, right, topY, botY } = area;
  const spanY = Math.max(80, botY - topY);
  const diameter = Math.max(36, Math.min(54, spanY * 0.28));

  const y1 = topY + spanY * 0.08;
  const y2 = topY + spanY * 0.34;
  const y3 = topY + spanY * 0.62;
  const y4 = topY + spanY * 0.9;

  if (t < 0.05) {
    const u = easeOutCubic(t / 0.05);
    return {
      x: left - (1 - u) * 16,
      y: y1 - (1 - u) * 8,
      diameter,
      opacity: u,
      isErasing: false,
    };
  }
  if (t < 0.27) {
    const u = easeInOutQuad((t - 0.05) / 0.22);
    return {
      x: left + (right - left) * u,
      y: y1 + Math.sin(u * Math.PI * 3.5) * 4,
      diameter,
      opacity: 1,
      isErasing: true,
    };
  }
  if (t < 0.49) {
    const u = easeInOutQuad((t - 0.27) / 0.22);
    return {
      x: right - (right - left) * u,
      y: y2 + Math.sin(u * Math.PI * 3.5) * 4,
      diameter: diameter * 1.04,
      opacity: 1,
      isErasing: true,
    };
  }
  if (t < 0.72) {
    const u = easeInOutQuad((t - 0.49) / 0.23);
    return {
      x: left + (right - left) * u,
      y: y3 + Math.sin(u * Math.PI * 3.5) * 4,
      diameter: diameter * 1.06,
      opacity: 1,
      isErasing: true,
    };
  }
  if (t < 0.94) {
    const u = easeInOutQuad((t - 0.72) / 0.22);
    return {
      x: right - (right - left) * u,
      y: y4 + Math.sin(u * Math.PI * 3) * 4,
      diameter: diameter * 1.1,
      opacity: 1,
      isErasing: true,
    };
  }
  const u = clamp01((t - 0.94) / 0.06);
  return {
    x: left - u * 16,
    y: y4 + u * 8,
    diameter,
    opacity: 1 - easeOutCubic(u),
    isErasing: false,
  };
}

/**
 * Hand-written graphite pencil creation guide rendered directly onto the letter paper
 * (zero card/modal chrome). Writes the guidance text & hand-draws the "開始創作" button
 * directly in stop-motion graphite pencil; clicking "開始創作" triggers a matching
 * stop-motion rubber-eraser sweep that wipes the guide clean before unlocking drawing.
 */
export function PaperPencilGuide({
  onBeginErasing,
  onStartCreating,
}: PaperPencilGuideProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraserIndicatorRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef<boolean>(false);
  const pressedRef = useRef<boolean>(false);
  const onBeginErasingRef = useRef(onBeginErasing);
  const onStartCreatingRef = useRef(onStartCreating);

  useEffect(() => {
    onBeginErasingRef.current = onBeginErasing;
  }, [onBeginErasing]);

  useEffect(() => {
    onStartCreatingRef.current = onStartCreating;
  }, [onStartCreating]);

  const eraseStateRef = useRef<{
    active: boolean;
    startMs: number;
    lastFrame: number;
    lastP: number;
    lastX: number;
    lastY: number;
    wasErasing: boolean;
    stepSeed: number;
    doneFired: boolean;
  }>({
    active: false,
    startMs: 0,
    lastFrame: -1,
    lastP: 0,
    lastX: 0,
    lastY: 0,
    wasErasing: false,
    stepSeed: 1,
    doneFired: false,
  });

  const [isButtonReady, setIsButtonReady] = useState<boolean>(false);
  const [isErasingOut, setIsErasingOut] = useState<boolean>(false);
  const [buttonHitbox, setButtonHitbox] = useState<ButtonHitbox | null>(null);

  const handleClickStart = useCallback(() => {
    if (!isButtonReady || eraseStateRef.current.active) return;
    setIsErasingOut(true);
    onBeginErasingRef.current?.();
    eraseStateRef.current = {
      active: true,
      startMs: performance.now(),
      lastFrame: -1,
      lastP: 0,
      lastX: 0,
      lastY: 0,
      wasErasing: false,
      stepSeed: 1,
      doneFired: false,
    };
  }, [isButtonReady]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let readyFired = false;
    const startMs = performance.now();

    interface PreparedAssets {
      w: number;
      h: number;
      dpr: number;
      cx: number;
      titleY: number;
      titleCanvas: HTMLCanvasElement;
      titleBounds: { minX: number; minY: number; maxX: number; maxY: number };
      body1Canvas: HTMLCanvasElement;
      body1Bounds: { minX: number; minY: number; maxX: number; maxY: number };
      body2Canvas: HTMLCanvasElement;
      body2Bounds: { minX: number; minY: number; maxX: number; maxY: number };
      btnTextCanvas: HTMLCanvasElement;
      btnTextBounds: { minX: number; minY: number; maxX: number; maxY: number };
      btnCx: number;
      btnCy: number;
      btnW: number;
      btnH: number;
      btnLoopPrimary: SketchPolylinePoint[];
      btnLoopSecondary: SketchPolylinePoint[];
      underlinePts: SketchPolylinePoint[];
      eraseArea: { left: number; right: number; topY: number; botY: number };
    }

    let assets: PreparedAssets | null = null;

    const bakeAssets = () => {
      if (eraseStateRef.current.active) return;
      const rect = container.getBoundingClientRect();
      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.max(260, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2.25);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const { sans } = resolveDocumentFontFamilies();
      const cx = w * 0.5;
      const cy = h * 0.495;

      const usableW = w * 0.82;
      const titleSize = Math.max(15, Math.min(22, usableW / 14.5));
      const bodySize = Math.max(11.5, Math.min(14.5, usableW / 21.5));
      const btnFontSize = Math.max(12.5, Math.min(15.5, usableW / 20));

      const titleY = cy - Math.max(46, h * 0.088);
      const body1Y = titleY + Math.max(32, titleSize * 1.9);
      const body2Y = body1Y + Math.max(22, bodySize * 1.72);
      const btnW = Math.max(126, Math.min(164, usableW * 0.44));
      const btnH = Math.max(38, Math.min(44, btnFontSize * 2.75));
      const btnCx = cx;
      const btnCy = body2Y + Math.max(46, btnH * 1.24);

      const bakeTextLayer = (
        text: string,
        yPos: number,
        fontSize: number,
        weight: number,
        tracking: number,
        rgb: { r: number; g: number; b: number },
        seed: number,
        jitterScale = 1
      ) => {
        const mask = document.createElement("canvas");
        mask.width = Math.round(w * dpr);
        mask.height = Math.round(h * dpr);
        const mCtx = mask.getContext("2d", { willReadFrequently: true });

        const out = document.createElement("canvas");
        out.width = Math.round(w * dpr);
        out.height = Math.round(h * dpr);
        const oCtx = out.getContext("2d");

        if (!mCtx || !oCtx) {
          return {
            layer: out,
            bounds: { minX: cx - 60, minY: yPos - 14, maxX: cx + 60, maxY: yPos + 14 },
          };
        }

        const rng = createSeededRng(seed);
        const rawBounds = drawHandJitteredTextMask(
          mCtx,
          text,
          cx * dpr,
          yPos * dpr,
          `${weight} ${(fontSize * dpr).toFixed(1)}px ${sans}`,
          tracking * dpr,
          rng,
          {
            yJitter: 0.9 * dpr * jitterScale,
            angleJitter: 0.015 * jitterScale,
            scaleJitter: 0.016 * jitterScale,
            strokeBoost: 0.35 * dpr,
          }
        );

        transferFinePencilTexture(oCtx, mask, rawBounds, rgb, rng);

        return {
          layer: out,
          bounds: {
            minX: rawBounds.minX / dpr,
            minY: rawBounds.minY / dpr,
            maxX: rawBounds.maxX / dpr,
            maxY: rawBounds.maxY / dpr,
          },
        };
      };

      const titleBaked = bakeTextLayer(
        "畫下鹽水片刻或寫一則祝福",
        titleY,
        titleSize,
        500,
        titleSize * 0.14,
        { r: 42, g: 41, b: 38 },
        9101,
        1.05
      );
      const body1Baked = bakeTextLayer(
        "落筆的筆跡與停頓，將化為光芒點亮郵筒。",
        body1Y,
        bodySize,
        400,
        bodySize * 0.06,
        { r: 88, g: 87, b: 83 },
        9202,
        0.78
      );
      const body2Baked = bakeTextLayer(
        "下方工具列可自由切換筆刷與顏色。",
        body2Y,
        bodySize,
        400,
        bodySize * 0.06,
        { r: 88, g: 87, b: 83 },
        9303,
        0.78
      );
      const btnTextBaked = bakeTextLayer(
        "開始創作",
        btnCy + 0.5,
        btnFontSize,
        500,
        btnFontSize * 0.24,
        { r: 34, g: 33, b: 31 },
        9404,
        0.85
      );

      const ulSpan = Math.min(
        usableW * 0.72,
        Math.max(120, (titleBaked.bounds.maxX - titleBaked.bounds.minX) * 0.86)
      );
      const ulRng = createSeededRng(9505);
      const underlinePts: SketchPolylinePoint[] = [];
      const ulSteps = 18;
      const ulY = titleY + titleSize * 0.78;
      let ulDrift = 0;
      for (let i = 0; i <= ulSteps; i++) {
        const f = i / ulSteps;
        ulDrift = ulDrift * 0.48 + (ulRng() - 0.5) * 1.3;
        underlinePts.push({
          x: cx - ulSpan * 0.5 + ulSpan * f,
          y: ulY + ulDrift,
        });
      }

      const btnLoopPrimary = buildHandSketchedButtonLoop(btnCx, btnCy, btnW, btnH, 9606);
      const btnLoopSecondary = buildHandSketchedButtonLoop(
        btnCx + 0.8,
        btnCy + 0.9,
        btnW + 2.2,
        btnH + 1.8,
        9707
      );

      const eraseLeft = Math.max(
        18,
        Math.min(
          titleBaked.bounds.minX,
          body1Baked.bounds.minX,
          btnCx - btnW * 0.5
        ) - 10
      );
      const eraseRight = Math.min(
        w - 18,
        Math.max(
          titleBaked.bounds.maxX,
          body1Baked.bounds.maxX,
          btnCx + btnW * 0.5
        ) + 10
      );

      assets = {
        w,
        h,
        dpr,
        cx,
        titleY,
        titleCanvas: titleBaked.layer,
        titleBounds: titleBaked.bounds,
        body1Canvas: body1Baked.layer,
        body1Bounds: body1Baked.bounds,
        body2Canvas: body2Baked.layer,
        body2Bounds: body2Baked.bounds,
        btnTextCanvas: btnTextBaked.layer,
        btnTextBounds: btnTextBaked.bounds,
        btnCx,
        btnCy,
        btnW,
        btnH,
        btnLoopPrimary,
        btnLoopSecondary,
        underlinePts,
        eraseArea: {
          left: eraseLeft,
          right: eraseRight,
          topY: titleY - titleSize * 0.7,
          botY: btnCy + btnH * 0.5 + 8,
        },
      };

      setButtonHitbox({
        left: btnCx - btnW * 0.5,
        top: btnCy - btnH * 0.5,
        width: btnW,
        height: btnH,
      });
    };

    bakeAssets();
    const ro = new ResizeObserver(bakeAssets);
    ro.observe(container);

    // Smooth 60fps continuous animation at a deliberate, unhurried pace
    const ERASE_DURATION_MS = 1650;
    let settledRendered = false;
    let lastHoverPressKey = "";

    const render = (now: number) => {
      rafId = window.requestAnimationFrame(render);
      const a = assets;
      if (!a) return;

      // =====================================================================
      // BRANCH A: SMOOTH 60FPS RUBBER ERASER WIPING THE GUIDE AFTER CLICK
      // =====================================================================
      const er = eraseStateRef.current;
      if (er.active) {
        if (er.doneFired) return;
        const elapsedMs = Math.max(0, now - er.startMs);
        const pNow = clamp01(elapsedMs / ERASE_DURATION_MS);
        const pPrev = er.lastP;

        ctx.setTransform(a.dpr, 0, 0, a.dpr, 0, 0);
        const subSteps = Math.max(
          1,
          Math.min(8, Math.ceil((pNow - pPrev) / 0.008))
        );
        let latest = sampleGuideEraserPath(pNow, a.eraseArea);

        for (let s = 1; s <= subSteps; s++) {
          const ps = pPrev + ((pNow - pPrev) * s) / subSteps;
          const sample = sampleGuideEraserPath(ps, a.eraseArea);
          latest = sample;
          if (sample.isErasing) {
            const x0 = er.wasErasing ? er.lastX : sample.x;
            const y0 = er.wasErasing ? er.lastY : sample.y;
            eraseIntroDecalSegment(
              ctx,
              x0,
              y0,
              sample.x,
              sample.y,
              sample.diameter,
              8800 + er.stepSeed++
            );
          }
          er.lastX = sample.x;
          er.lastY = sample.y;
          er.wasErasing = sample.isErasing;
        }
        er.lastP = pNow;

        const ind = eraserIndicatorRef.current;
        if (ind) {
          if (pNow >= 1 || latest.opacity <= 0.01) {
            ind.style.opacity = "0";
          } else {
            const tilt = Math.sin(pNow * Math.PI * 10) * 4.5;
            const scale = latest.isErasing ? 1 : 1.08;
            ind.style.width = `${latest.diameter.toFixed(1)}px`;
            ind.style.height = `${latest.diameter.toFixed(1)}px`;
            ind.style.left = `${latest.x.toFixed(1)}px`;
            ind.style.top = `${latest.y.toFixed(1)}px`;
            ind.style.opacity = latest.opacity.toFixed(3);
            ind.style.transform = `translate(-50%, -50%) rotate(${tilt.toFixed(1)}deg) scale(${scale})`;
          }
        }

        if (pNow >= 1) {
          ctx.clearRect(0, 0, a.w, a.h);
          er.doneFired = true;
          onStartCreatingRef.current();
        }
        return;
      }

      // =====================================================================
      // BRANCH B: SMOOTH 60FPS GRAPHITE PENCIL WRITING THE GUIDE ON PAPER
      // =====================================================================
      const elapsed = (now - startMs) / 1000;
      const isHovered = hoveredRef.current;
      const isPressed = pressedRef.current;
      const hpKey = `${isHovered ? 1 : 0}-${isPressed ? 1 : 0}`;
      // Once writing & nib lift finish, keep rendering smoothly for subtle idle pulse & hover
      if (elapsed > 3.7 && settledRendered && hpKey === lastHoverPressKey) {
        // Still allow smooth idle breathing pulse on button
      }
      lastHoverPressKey = hpKey;
      if (elapsed > 3.7) settledRendered = true;

      ctx.setTransform(a.dpr, 0, 0, a.dpr, 0, 0);
      ctx.clearRect(0, 0, a.w, a.h);

      // Slow, smooth continuous writing timeline (seconds):
      // 0.06 - 0.94 : Write title "畫下鹽水片刻或寫一則祝福"
      // 0.94 - 1.20 : Sketch fine pencil underline under title
      // 1.20 - 1.84 : Write body line 1
      // 1.84 - 2.40 : Write body line 2
      // 2.40 - 2.98 : Sketch hand-drawn graphite button outline around "開始創作"
      // 2.86 - 3.28 : Write "開始創作" inside the sketched button
      // 3.28 - 3.56 : Pencil nib lifts gently off paper
      const titleP = easeInOutQuad(clamp01((elapsed - 0.06) / 0.88));
      const ulP = easeInOutQuad(clamp01((elapsed - 0.94) / 0.26));
      const body1P = easeInOutQuad(clamp01((elapsed - 1.2) / 0.64));
      const body2P = easeInOutQuad(clamp01((elapsed - 1.84) / 0.56));
      const btnBoxP = easeInOutQuad(clamp01((elapsed - 2.4) / 0.58));
      const btnTextP = easeInOutQuad(clamp01((elapsed - 2.86) / 0.42));

      if (!readyFired && elapsed >= 2.92) {
        readyFired = true;
        setIsButtonReady(true);
      }

      let activeNib: { x: number; y: number } | null = null;

      // 1. Title written directly in graphite pencil
      const titleHead = drawProgressivePencilLine(
        ctx,
        a.titleCanvas,
        a.titleBounds,
        titleP,
        a.dpr
      );
      if (elapsed >= 0.06 && elapsed < 0.94 && titleHead) {
        activeNib = { x: titleHead.headX, y: titleHead.headY };
      }

      // 2. Hand-sketched graphite underline below title
      const ulHead = strokeProgressivePolyline(
        ctx,
        a.underlinePts,
        ulP,
        "rgba(42, 41, 38, 0.28)",
        1.1
      );
      if (elapsed >= 0.94 && elapsed < 1.2 && ulHead) {
        activeNib = ulHead;
      }

      // 3. Body line 1 & line 2
      const b1Head = drawProgressivePencilLine(
        ctx,
        a.body1Canvas,
        a.body1Bounds,
        body1P,
        a.dpr
      );
      if (elapsed >= 1.2 && elapsed < 1.84 && b1Head) {
        activeNib = { x: b1Head.headX, y: b1Head.headY };
      }

      const b2Head = drawProgressivePencilLine(
        ctx,
        a.body2Canvas,
        a.body2Bounds,
        body2P,
        a.dpr
      );
      if (elapsed >= 1.84 && elapsed < 2.4 && b2Head) {
        activeNib = { x: b2Head.headX, y: b2Head.headY };
      }

      // 4. Hand-drawn graphite button directly on the paper
      if (btnBoxP > 0.005) {
        const idlePulse =
          readyFired && !isHovered ? 0.5 + 0.5 * Math.sin(elapsed * 2.6) : 0;

        ctx.save();
        if (isPressed) {
          ctx.translate(a.btnCx, a.btnCy);
          ctx.scale(0.97, 0.97);
          ctx.translate(-a.btnCx, -a.btnCy);
        }

        const shadeAlpha =
          btnBoxP > 0.45
            ? clamp01((btnBoxP - 0.45) / 0.55) *
              (isPressed ? 0.16 : isHovered ? 0.12 : 0.045 + idlePulse * 0.025)
            : 0;

        if (shadeAlpha > 0.005) {
          ctx.save();
          const r = Math.min(a.btnH * 0.5, 16);
          const bx = a.btnCx - a.btnW * 0.5;
          const by = a.btnCy - a.btnH * 0.5;
          ctx.beginPath();
          ctx.roundRect(bx + 2, by + 2, a.btnW - 4, a.btnH - 4, r);
          ctx.clip();

          ctx.fillStyle = `rgba(34, 34, 34, ${(shadeAlpha * 0.52).toFixed(3)})`;
          ctx.fillRect(bx, by, a.btnW, a.btnH);

          const hRng = createSeededRng(9808);
          ctx.strokeStyle = `rgba(34, 34, 34, ${(shadeAlpha * 1.15).toFixed(3)})`;
          ctx.lineWidth = 0.85;
          const step = 7;
          for (let d = -a.btnH; d < a.btnW + a.btnH; d += step) {
            ctx.beginPath();
            ctx.moveTo(bx + d + (hRng() - 0.5) * 1.5, by + a.btnH + 2);
            ctx.lineTo(bx + d + a.btnH * 0.75 + (hRng() - 0.5) * 1.5, by - 2);
            ctx.stroke();
          }
          ctx.restore();
        }

        const loopHead = strokeProgressivePolyline(
          ctx,
          a.btnLoopPrimary,
          btnBoxP,
          isHovered ? "rgba(34, 34, 34, 0.92)" : "rgba(42, 41, 38, 0.78)",
          isHovered ? 1.55 : 1.35
        );
        strokeProgressivePolyline(
          ctx,
          a.btnLoopSecondary,
          clamp01((btnBoxP - 0.08) / 0.92),
          isHovered ? "rgba(42, 41, 38, 0.42)" : "rgba(42, 41, 38, 0.28)",
          0.9
        );

        if (elapsed >= 2.4 && elapsed < 2.86 && loopHead) {
          activeNib = loopHead;
        }

        // 5. Button text "開始創作" written inside the hand-drawn box
        const btnTextHead = drawProgressivePencilLine(
          ctx,
          a.btnTextCanvas,
          a.btnTextBounds,
          btnTextP,
          a.dpr
        );
        if (elapsed >= 2.86 && elapsed < 3.28 && btnTextHead) {
          activeNib = { x: btnTextHead.headX, y: btnTextHead.headY };
        }

        ctx.restore();
      }

      // 6. Smooth 60fps animated graphite pencil tip following the active writing stroke
      if (elapsed < 3.58) {
        const nibFadeIn = clamp01(elapsed / 0.12);
        const nibFadeOut =
          elapsed > 3.28 ? 1 - easeOutCubic(clamp01((elapsed - 3.28) / 0.28)) : 1;
        const nibPos = activeNib ?? {
          x: a.btnTextBounds.maxX + 6,
          y: a.btnCy - (elapsed - 3.28) * 28,
        };
        const smoothTilt = Math.sin(elapsed * 9) * 0.035;
        drawPencilNibIndicator(
          ctx,
          nibPos.x,
          nibPos.y,
          nibFadeIn * nibFadeOut,
          smoothTilt
        );
      }
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="信紙創作引導"
      className="pointer-events-auto absolute inset-0 z-30 select-none"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none block h-full w-full"
      />

      {/* Stop-motion translucent rubber eraser indicator wiping away the guide after click */}
      <div
        ref={eraserIndicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-40 flex items-center justify-center rounded-full border border-dashed border-[#222222]/80 bg-[#FAF9F6]/65 text-[#222222]/70 shadow-[0_2px_10px_rgba(34,34,34,0.12)] backdrop-blur-[1px]"
        style={{
          width: "40px",
          height: "40px",
          left: "50%",
          top: "50%",
          opacity: 0,
          transform: "translate(-50%, -50%)",
          willChange: "left, top, opacity, transform",
        }}
      >
        <EraserIcon size={14} />
      </div>

      {/* Accessible transparent hitbox aligned pixel-for-pixel over the hand-drawn "開始創作" button */}
      {buttonHitbox && !isErasingOut && (
        <button
          type="button"
          onClick={handleClickStart}
          disabled={!isButtonReady}
          onPointerEnter={() => {
            hoveredRef.current = true;
          }}
          onPointerLeave={() => {
            hoveredRef.current = false;
            pressedRef.current = false;
          }}
          onPointerDown={() => {
            pressedRef.current = true;
          }}
          onPointerUp={() => {
            pressedRef.current = false;
          }}
          aria-label="開始創作"
          style={{
            left: `${buttonHitbox.left}px`,
            top: `${buttonHitbox.top}px`,
            width: `${buttonHitbox.width}px`,
            height: `${buttonHitbox.height}px`,
          }}
          className={`absolute rounded-full bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#222222]/60 ${
            isButtonReady ? "cursor-pointer" : "pointer-events-none cursor-default"
          }`}
        >
          <span className="sr-only">開始創作</span>
        </button>
      )}
    </div>
  );
}
