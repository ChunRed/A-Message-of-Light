"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { TargetPaperRect } from "@/components/ZFoldLetterScene";

export interface SparkleColorTriplet {
  id: string;
  main: string;
  accent: string;
}

export interface SparkleOverlayHandle {
  /** Enable/disable gentle hand-drawn ambient stars, sparklers & orbital rings around the letter */
  setAmbientActive: (active: boolean, paperRect: TargetPaperRect | null) => void;
  /**
   * Scans the user's 2D drawing canvas and spawns color-matched hand-drawn crayon stars
   * & curved crayon comet streaks at the exact stroke coordinates.
   * Returns the extracted matte crayon palette for subsequent crease/envelope bursts.
   */
  spawnDissolveFromCanvas: (
    drawingCanvas: HTMLCanvasElement,
    paperRect: TargetPaperRect
  ) => SparkleColorTriplet[];
  /** Emits a directional burst of hand-drawn sparklers, crayon comets, stars & dust */
  emitBurst: (opts: {
    x: number;
    y: number;
    spreadX?: number;
    spreadY?: number;
    count: number;
    vxBias?: number;
    vyBias?: number;
    speedMin?: number;
    speedMax?: number;
    sizeScale?: number;
    palette?: SparkleColorTriplet[];
  }) => void;
  /** Gracefully stops ambient spawning and lets remaining hand-drawn particles fade out */
  fadeOutAndClear: (fast?: boolean) => void;
}

// =============================================================================
// 1. MATTE CRAYON / PASTEL COLOR PALETTE FOR BLACK CARDSTOCK (#0B0B0D)
// =============================================================================
const CREAM_GOLD: SparkleColorTriplet = {
  id: "cream-gold",
  main: "#F3D98B",
  accent: "#F7F4EB",
};

const CHALK_WHITE: SparkleColorTriplet = {
  id: "chalk-white",
  main: "#F7F4EB",
  accent: "#F3D98B",
};

interface KnownCrayonPaletteEntry {
  r: number;
  g: number;
  b: number;
  swatch: SparkleColorTriplet;
}

// Crisp matte pastel/crayon mapping for all 11 curated Muji ink colors
const KNOWN_CRAYON_PALETTE: KnownCrayonPaletteEntry[] = [
  // Charcoal #222222 -> Warm Cream Gold #F3D98B + Chalk White #F7F4EB
  { r: 34, g: 34, b: 34, swatch: CREAM_GOLD },
  // Warm Gray #6E6D6A -> Chalk White #F7F4EB
  { r: 110, g: 109, b: 106, swatch: CHALK_WHITE },
  // Umber #8F654D -> Warm Caramel Pastel
  {
    r: 143,
    g: 101,
    b: 77,
    swatch: { id: "umber", main: "#DC9F72", accent: "#F3D98B" },
  },
  // Terracotta #C86D51 -> Warm Pastel Coral-Red
  {
    r: 200,
    g: 109,
    b: 81,
    swatch: { id: "terracotta", main: "#DF7A5E", accent: "#F3D98B" },
  },
  // Blush #D98A7C -> Soft Pastel Peach
  {
    r: 217,
    g: 138,
    b: 124,
    swatch: { id: "blush", main: "#ECA698", accent: "#F7F4EB" },
  },
  // Dusty Rose #B87A88 -> Matte Dusty Pink
  {
    r: 184,
    g: 122,
    b: 136,
    swatch: { id: "dusty-rose", main: "#DC95A7", accent: "#F7F4EB" },
  },
  // Mustard #D4A84B -> Warm Mustard Crayon Gold
  {
    r: 212,
    g: 168,
    b: 75,
    swatch: { id: "mustard", main: "#EBC35E", accent: "#F7F4EB" },
  },
  // Olive #8A9A5B -> Pastel Olive Crayon
  {
    r: 138,
    g: 154,
    b: 91,
    swatch: { id: "olive", main: "#B8CA76", accent: "#F3D98B" },
  },
  // Sage #6E8B74 -> Pastel Sage Green
  {
    r: 110,
    g: 139,
    b: 116,
    swatch: { id: "sage", main: "#8EC29B", accent: "#F7F4EB" },
  },
  // Slate #5B7A8C -> Dusty Pastel Sky Blue
  {
    r: 91,
    g: 122,
    b: 140,
    swatch: { id: "slate", main: "#78AFC6", accent: "#F7F4EB" },
  },
  // Mauve #7D6E83 -> Soft Pastel Lavender
  {
    r: 125,
    g: 110,
    b: 131,
    swatch: { id: "mauve", main: "#BA9FD4", accent: "#F3D98B" },
  },
];

function mapInkRgbToCrayonSwatch(
  r: number,
  g: number,
  b: number,
  sampleIndex: number
): SparkleColorTriplet {
  let bestDist = Infinity;
  let bestSwatch: SparkleColorTriplet | null = null;

  for (let i = 0; i < KNOWN_CRAYON_PALETTE.length; i++) {
    const entry = KNOWN_CRAYON_PALETTE[i];
    const dr = r - entry.r;
    const dg = g - entry.g;
    const db = b - entry.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestSwatch = entry.swatch;
    }
  }

  if (bestSwatch && bestDist < 2800) {
    // Charcoal strokes richly alternate between warm cream gold #F3D98B & chalk white #F7F4EB
    if (bestSwatch.id === "cream-gold") {
      return sampleIndex % 3 === 0 ? CHALK_WHITE : CREAM_GOLD;
    }
    return bestSwatch;
  }

  // Fallback for blended colors: lift into chalky matte pastel
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  if (lum < 0.26 && sat < 0.22) {
    return sampleIndex % 3 === 0 ? CHALK_WHITE : CREAM_GOLD;
  }

  // Quantize fallback color key so sprite cache stays compact
  const lift = (c: number) =>
    Math.min(242, Math.round((88 + (c / 255) * 150) / 16) * 16);
  const mr = lift(r);
  const mg = lift(g);
  const mb = lift(b);
  return {
    id: `custom-${mr}-${mg}-${mb}`,
    main: `rgb(${mr}, ${mg}, ${mb})`,
    accent: "#F7F4EB",
  };
}

// =============================================================================
// 2. DETERMINISTIC PRNG + SUBDIVIDED JITTERY POLYLINE & DRY CRAYON PRIMITIVES
//    (Strictly NO radial gradient orbs, NO shadowBlur, NO lighter blending,
//     NO single straight lineTo or native ctx.ellipse!)
// =============================================================================
function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseColorRgb(color: string): { r: number; g: number; b: number } {
  if (color.startsWith("#")) {
    const clean = color.slice(1);
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }
  const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  return { r: 243, g: 217, b: 139 };
}

/**
 * Stamps a rich, creamy oil-pastel / wax-crayon cluster at (x, y):
 * dense opaque pigment core so dark background does not leak through the body,
 * surrounded by tactile dry crayon micro-grains along the outer edge.
 */
function stampCrayonGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  thickness: number,
  rgb: { r: number; g: number; b: number },
  rng: () => number,
  density = 1
): void {
  // 1. Rich opaque core body so strokes read full & vibrant (never sparse/dotted)
  const coreW = Math.max(1.3, thickness * (0.86 + rng() * 0.22));
  const coreH = Math.max(1.3, thickness * (0.82 + rng() * 0.24));
  const coreAlpha = 0.88 + rng() * 0.12;
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${coreAlpha.toFixed(2)})`;
  ctx.fillRect(
    x - coreW * 0.5 + (rng() - 0.5) * 0.45,
    y - coreH * 0.5 + (rng() - 0.5) * 0.45,
    coreW,
    coreH
  );

  // 2. Tactile dry wax-crayon tooth grains hugging the outer rim
  const grains = Math.max(3, Math.round((3.0 + thickness * 1.4) * density));
  const spread = Math.max(0.9, thickness * 0.62);

  for (let i = 0; i < grains; i++) {
    if (rng() < 0.09) continue;
    const gx = x + (rng() - 0.5) * spread * 2;
    const gy = y + (rng() - 0.5) * spread * 2;
    const gw = 0.9 + rng() * Math.max(1.2, thickness * 0.46);
    const gh = gw * (0.65 + rng() * 0.6);
    const alpha = 0.72 + rng() * 0.28;
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(2)})`;
    ctx.fillRect(gx - gw * 0.5, gy - gh * 0.5, gw, gh);
  }
}

interface JitterLineOpts {
  stepPx?: number;
  jitterAmp?: number;
  thickness?: number;
  overshootStart?: number;
  overshootEnd?: number;
  brokenChance?: number;
  density?: number;
}

/**
 * Draws a subdivided jittery hand-drawn crayon/pen polyline from (x0, y0) to (x1, y1).
 * Subdivides every 3–5px with normal-axis jitter, optional corner overshoot & dry skip gaps.
 */
function drawJitteryCrayonLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: { r: number; g: number; b: number },
  rng: () => number,
  opts: JitterLineOpts = {}
): void {
  const stepPx = opts.stepPx ?? 3.4;
  const jitterAmp = opts.jitterAmp ?? 1.25;
  const thickness = opts.thickness ?? 2.1;
  const overshootStart = opts.overshootStart ?? 0;
  const overshootEnd = opts.overshootEnd ?? 0;
  const brokenChance = opts.brokenChance ?? 0;
  const density = opts.density ?? 1;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const sx = x0 - ux * overshootStart;
  const sy = y0 - uy * overshootStart;
  const ex = x1 + ux * overshootEnd;
  const ey = y1 + uy * overshootEnd;
  const totalLen = Math.hypot(ex - sx, ey - sy);
  const steps = Math.max(2, Math.ceil(totalLen / stepPx));

  // Build jittered node polyline
  const pts: { x: number; y: number }[] = [];
  let runningOffset = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Slight organic wander along normal, tapered slightly at very ends
    const edgeTaper = 0.45 + 0.55 * Math.sin(t * Math.PI);
    runningOffset = runningOffset * 0.42 + (rng() - 0.5) * 2 * jitterAmp * edgeTaper;
    pts.push({
      x: sx + (ex - sx) * t + nx * runningOffset,
      y: sy + (ey - sy) * t + ny * runningOffset,
    });
  }

  let skipping = false;
  for (let i = 0; i < pts.length - 1; i++) {
    if (brokenChance > 0) {
      if (!skipping && i > 1 && i < pts.length - 2 && rng() < brokenChance) {
        skipping = true;
        continue;
      } else if (skipping && rng() < 0.65) {
        skipping = false;
      } else if (skipping) {
        continue;
      }
    }

    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const subDabs = Math.max(2, Math.ceil(segLen / 1.45));

    // Slight taper near endpoints for dip-pen / sharpened crayon feel
    const tMid = (i + 0.5) / (pts.length - 1);
    const localThick = thickness * (0.72 + 0.36 * Math.sin(tMid * Math.PI));

    for (let d = 0; d <= subDabs; d++) {
      const f = d / subDabs;
      stampCrayonGrain(
        ctx,
        a.x + (b.x - a.x) * f,
        a.y + (b.y - a.y) * f,
        localThick,
        rgb,
        rng,
        density
      );
    }
  }
}

/**
 * Draws a subdivided jittery curved crayon/pastel arc (quadratic Bezier sampled every ~3.5px).
 * Supports thick multi-bristle broken pastel streaks for Comet Tails & concave star edges!
 */
function drawJitteryCrayonArc(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  rgb: { r: number; g: number; b: number },
  rng: () => number,
  opts: {
    stepPx?: number;
    jitterAmp?: number;
    thickness?: number;
    brokenChance?: number;
    overshoot?: number;
    density?: number;
  } = {}
): void {
  const stepPx = opts.stepPx ?? 3.5;
  const jitterAmp = opts.jitterAmp ?? 1.2;
  const thickness = opts.thickness ?? 2.3;
  const brokenChance = opts.brokenChance ?? 0;
  const overshoot = opts.overshoot ?? 0;
  const density = opts.density ?? 1;

  // Approximate arc length
  const chord = Math.hypot(x1 - x0, y1 - y0);
  const hull = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
  const approxLen = (chord + hull) * 0.5;
  const steps = Math.max(4, Math.ceil(approxLen / stepPx));

  const pts: { x: number; y: number }[] = [];
  let wander = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    const px = inv * inv * x0 + 2 * inv * t * cx + t * t * x1;
    const py = inv * inv * y0 + 2 * inv * t * cy + t * t * y1;

    // Local tangent for normal-axis jitter
    const tx = 2 * inv * (cx - x0) + 2 * t * (x1 - cx);
    const ty = 2 * inv * (cy - y0) + 2 * t * (y1 - cy);
    const tLen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tLen;
    const ny = tx / tLen;

    wander = wander * 0.45 + (rng() - 0.5) * 2 * jitterAmp;
    pts.push({ x: px + nx * wander, y: py + ny * wander });
  }

  // Optional tiny hand-drawn overshoot at ends
  if (overshoot > 0 && pts.length >= 2) {
    const pStart = pts[0];
    const pNext = pts[1];
    const d0 = Math.hypot(pNext.x - pStart.x, pNext.y - pStart.y) || 1;
    pts.unshift({
      x: pStart.x - ((pNext.x - pStart.x) / d0) * overshoot,
      y: pStart.y - ((pNext.y - pStart.y) / d0) * overshoot,
    });

    const pEnd = pts[pts.length - 1];
    const pPrev = pts[pts.length - 2];
    const d1 = Math.hypot(pEnd.x - pPrev.x, pEnd.y - pPrev.y) || 1;
    pts.push({
      x: pEnd.x + ((pEnd.x - pPrev.x) / d1) * overshoot,
      y: pEnd.y + ((pEnd.y - pPrev.y) / d1) * overshoot,
    });
  }

  let skipping = false;
  for (let i = 0; i < pts.length - 1; i++) {
    if (brokenChance > 0) {
      if (!skipping && i > 1 && i < pts.length - 2 && rng() < brokenChance) {
        skipping = true;
        continue;
      } else if (skipping && rng() < 0.55) {
        skipping = false;
      } else if (skipping) {
        continue;
      }
    }

    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const subDabs = Math.max(2, Math.ceil(segLen / 1.4));
    const tMid = (i + 0.5) / (pts.length - 1);
    const localThick = thickness * (0.68 + 0.42 * Math.sin(tMid * Math.PI));

    for (let d = 0; d <= subDabs; d++) {
      const f = d / subDabs;
      stampCrayonGrain(
        ctx,
        a.x + (b.x - a.x) * f,
        a.y + (b.y - a.y) * f,
        localThick,
        rgb,
        rng,
        density
      );
    }
  }
}

/**
 * Draws a rich, opaque hand-drawn crayon dot / speck with rough waxy edges.
 */
function drawCrayonDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  rng: () => number
): void {
  // Opaque irregular core so dots read crisply without leaking background
  const coreSz = Math.max(1.8, radius * 1.45);
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.96)`;
  ctx.fillRect(
    x - coreSz * 0.5,
    y - coreSz * 0.5,
    coreSz,
    coreSz * (0.85 + rng() * 0.3)
  );

  const count = Math.max(6, Math.round(radius * radius * 3.8));
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.pow(rng(), 0.55) * radius;
    const gx = x + Math.cos(a) * rad;
    const gy = y + Math.sin(a) * rad;
    const sz = 1.0 + rng() * Math.max(1.2, radius * 0.6);
    const alpha = 0.78 + rng() * 0.22;
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(2)})`;
    ctx.fillRect(gx - sz * 0.5, gy - sz * 0.5, sz, sz * (0.75 + rng() * 0.45));
  }
}

/**
 * Fills a concave 4-point star shape with rich, full matte oil-pastel coverage
 * (solid pastel body with subtle waxy crayon grain texture — minimal background bleed).
 */
function fillConcave4PtStarWithCrayon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  top: number,
  right: number,
  bot: number,
  left: number,
  waist: number,
  rgb: { r: number; g: number; b: number },
  rng: () => number
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - top);
  ctx.quadraticCurveTo(cx + waist, cy - waist, cx + right, cy);
  ctx.quadraticCurveTo(cx + waist, cy + waist, cx, cy + bot);
  ctx.quadraticCurveTo(cx - waist, cy + waist, cx - left, cy);
  ctx.quadraticCurveTo(cx - waist, cy - waist, cx, cy - top);
  ctx.closePath();

  // 1. Full matte pastel base fill so the star silhouette is rich & solid
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.94)`;
  ctx.fill();

  ctx.clip();

  // 2. Subtle layered diagonal wax-crayon grain passes for authentic tactile richness
  const maxR = Math.max(top, right, bot, left) + 4;
  const hiR = Math.min(255, rgb.r + 18);
  const hiG = Math.min(255, rgb.g + 16);
  const hiB = Math.min(255, rgb.b + 14);
  const hatchStep = 3.0;
  for (let d = -maxR * 1.3; d <= maxR * 1.3; d += hatchStep) {
    const xA = cx + d - maxR;
    const yA = cy - maxR;
    const xB = cx + d + maxR;
    const yB = cy + maxR;
    const steps = Math.ceil((maxR * 2.6) / 2.6);
    for (let s = 0; s <= steps; s++) {
      if (rng() < 0.35) continue;
      const t = s / steps;
      const px = xA + (xB - xA) * t + (rng() - 0.5) * 1.5;
      const py = yA + (yB - yA) * t + (rng() - 0.5) * 1.5;
      const sz = 1.4 + rng() * 2.0;
      const useHighlight = rng() < 0.45;
      ctx.fillStyle = useHighlight
        ? `rgba(${hiR}, ${hiG}, ${hiB}, 0.42)`
        : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.98)`;
      ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz * (0.7 + rng() * 0.5));
    }
  }
  ctx.restore();
}

// =============================================================================
// 3. OFFSCREEN SPRITE CACHE WITH 5 HAND-DRAWN MOTIFS × 3 LINE-BOIL FRAMES EACH
// =============================================================================
type MotifKind =
  | "sketchy-4pt-hollow"
  | "sketchy-4pt-solid"
  | "sparkler-burst"
  | "orbital-ring"
  | "crayon-comet"
  | "crayon-dust";

interface BoiledSprite {
  frames: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
  width: number;
  height: number;
}

type ColorSpriteBank = Record<MotifKind, BoiledSprite[]>;

function render4PtStarFrame(
  size: number,
  rgb: { r: number; g: number; b: number },
  solid: boolean,
  variant: number,
  boilSeed: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const shapeRng = createSeededRng(1001 + variant * 79);
  const boilRng = createSeededRng(boilSeed);

  const cx = size * 0.5;
  const cy = size * 0.5;
  const baseR = size * 0.36;

  // Intentional hand-drawn asymmetry (taller vertically, slight uneven arms)
  const top = baseR * (1.06 + shapeRng() * 0.24);
  const bot = baseR * (0.98 + shapeRng() * 0.24);
  const left = baseR * (0.66 + shapeRng() * 0.22);
  const right = baseR * (0.68 + shapeRng() * 0.22);
  const waist = baseR * (solid ? 0.22 : 0.19);
  const tilt = (shapeRng() - 0.5) * 0.28;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.translate(-cx, -cy);

  if (solid) {
    fillConcave4PtStarWithCrayon(
      ctx,
      cx,
      cy,
      top,
      right,
      bot,
      left,
      waist,
      rgb,
      boilRng
    );
  }

  // Sketchy jittery concave outline with tiny hand-drawn tip overshoots
  const thickness = solid ? 2.0 : 2.35;
  const jitter = 1.15;
  const overshoot = solid ? 1.0 : 2.0;

  drawJitteryCrayonArc(
    ctx,
    cx,
    cy - top,
    cx + waist,
    cy - waist,
    cx + right,
    cy,
    rgb,
    boilRng,
    { stepPx: 3.4, jitterAmp: jitter, thickness, overshoot }
  );
  drawJitteryCrayonArc(
    ctx,
    cx + right,
    cy,
    cx + waist,
    cy + waist,
    cx,
    cy + bot,
    rgb,
    boilRng,
    { stepPx: 3.4, jitterAmp: jitter, thickness, overshoot }
  );
  drawJitteryCrayonArc(
    ctx,
    cx,
    cy + bot,
    cx - waist,
    cy + waist,
    cx - left,
    cy,
    rgb,
    boilRng,
    { stepPx: 3.4, jitterAmp: jitter, thickness, overshoot }
  );
  drawJitteryCrayonArc(
    ctx,
    cx - left,
    cy,
    cx - waist,
    cy - waist,
    cx,
    cy - top,
    rgb,
    boilRng,
    { stepPx: 3.4, jitterAmp: jitter, thickness, overshoot }
  );

  // Tiny companion hand-drawn crayon dots beside hollow/solid star
  if (variant === 1) {
    drawCrayonDot(ctx, cx + right * 0.72, cy - top * 0.62, 2.2, rgb, boilRng);
    drawCrayonDot(ctx, cx - left * 0.8, cy + bot * 0.56, 1.7, rgb, boilRng);
  }

  ctx.restore();
  return canvas;
}

function renderSparklerBurstFrame(
  size: number,
  rgbMain: { r: number; g: number; b: number },
  rgbAccent: { r: number; g: number; b: number },
  variant: number,
  boilSeed: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const shapeRng = createSeededRng(2003 + variant * 131);
  const boilRng = createSeededRng(boilSeed);

  const cx = size * 0.5;
  const cy = size * 0.5;
  const maxR = size * 0.42;
  const rayCount = variant === 0 ? 8 : 11;

  // Hand-drawn radiating sparkler rays with unequal lengths, gentle bend & broken dashes
  for (let i = 0; i < rayCount; i++) {
    const baseAngle = (i / rayCount) * Math.PI * 2;
    const angle = baseAngle + (shapeRng() - 0.5) * 0.24;
    const innerGap = 2.5 + shapeRng() * 5.0;
    const rayLen = maxR * (0.48 + shapeRng() * 0.52);
    const useAccent = i % 3 === 1;
    const col = useAccent ? rgbAccent : rgbMain;

    const x0 = cx + Math.cos(angle) * innerGap;
    const y0 = cy + Math.sin(angle) * innerGap;
    const x1 = cx + Math.cos(angle) * rayLen;
    const y1 = cy + Math.sin(angle) * rayLen;

    // Slight organic wave curvature on longer rays
    const midX = (x0 + x1) * 0.5 + -Math.sin(angle) * (shapeRng() - 0.5) * 4.5;
    const midY = (y0 + y1) * 0.5 + Math.cos(angle) * (shapeRng() - 0.5) * 4.5;

    drawJitteryCrayonArc(ctx, x0, y0, midX, midY, x1, y1, col, boilRng, {
      stepPx: 3.4,
      jitterAmp: 1.05,
      thickness: 1.7 + shapeRng() * 0.75,
      brokenChance: 0.14,
      density: 0.95,
    });

    // Scatter tiny hand-drawn dots outside several ray tips (signature sparkler look!)
    if (shapeRng() < 0.62) {
      const dotDist = rayLen + 4.5 + shapeRng() * 6.5;
      const dotAng = angle + (shapeRng() - 0.5) * 0.18;
      drawCrayonDot(
        ctx,
        cx + Math.cos(dotAng) * dotDist,
        cy + Math.sin(dotAng) * dotDist,
        1.5 + shapeRng() * 1.1,
        col,
        boilRng
      );
    }
  }

  // Rough hand-drawn center hub speck
  drawCrayonDot(ctx, cx, cy, 2.8, rgbMain, boilRng);

  return canvas;
}

function renderOrbitalRingFrame(
  size: number,
  rgbMain: { r: number; g: number; b: number },
  rgbAccent: { r: number; g: number; b: number },
  variant: number,
  boilSeed: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const shapeRng = createSeededRng(3011 + variant * 97);
  const boilRng = createSeededRng(boilSeed);

  const cx = size * 0.5;
  const cy = size * 0.5;

  // 1. Central sketchy multi-ray star or concave 4-point star
  const starR = size * 0.25;
  if (variant === 0) {
    // Sketchy hollow-core concave 4-point star with inner cross ticks
    const top = starR * 1.25;
    const bot = starR * 1.15;
    const left = starR * 0.85;
    const right = starR * 0.9;
    const waist = starR * 0.22;

    drawJitteryCrayonArc(ctx, cx, cy - top, cx + waist, cy - waist, cx + right, cy, rgbMain, boilRng, {
      stepPx: 3.3,
      jitterAmp: 1.0,
      thickness: 2.1,
      overshoot: 1.8,
    });
    drawJitteryCrayonArc(ctx, cx + right, cy, cx + waist, cy + waist, cx, cy + bot, rgbMain, boilRng, {
      stepPx: 3.3,
      jitterAmp: 1.0,
      thickness: 2.1,
      overshoot: 1.8,
    });
    drawJitteryCrayonArc(ctx, cx, cy + bot, cx - waist, cy + waist, cx - left, cy, rgbMain, boilRng, {
      stepPx: 3.3,
      jitterAmp: 1.0,
      thickness: 2.1,
      overshoot: 1.8,
    });
    drawJitteryCrayonArc(ctx, cx - left, cy, cx - waist, cy - waist, cx, cy - top, rgbMain, boilRng, {
      stepPx: 3.3,
      jitterAmp: 1.0,
      thickness: 2.1,
      overshoot: 1.8,
    });
  } else {
    // 6-ray hand-drawn starburst center
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + (shapeRng() - 0.5) * 0.16;
      const rLen = starR * (i % 2 === 0 ? 1.25 : 0.82);
      drawJitteryCrayonLine(
        ctx,
        cx - Math.cos(ang) * 2,
        cy - Math.sin(ang) * 2,
        cx + Math.cos(ang) * rLen,
        cy + Math.sin(ang) * rLen,
        rgbMain,
        boilRng,
        { stepPx: 3.2, jitterAmp: 0.95, thickness: 2.0, overshootEnd: 1.4 }
      );
    }
  }

  // 2. Intentionally unclosed tilted hand-drawn elliptical orbital loop (subdivided polyline, NEVER ctx.ellipse!)
  const rx = size * 0.39;
  const ry = size * 0.155;
  const ringTilt = variant === 0 ? -0.44 : 0.38;
  const startAng = 0.25 + shapeRng() * 0.6;
  const sweepAng = Math.PI * (1.74 + shapeRng() * 0.16); // Unclosed gap!
  const steps = 34;

  const cosT = Math.cos(ringTilt);
  const sinT = Math.sin(ringTilt);

  const ringPts: { x: number; y: number }[] = [];
  let wander = 0;
  for (let i = 0; i <= steps; i++) {
    const a = startAng + (i / steps) * sweepAng;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    // Slight organic eccentricity wobble
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    wander = wander * 0.55 + (boilRng() - 0.5) * 2.2;
    const lx = ex + nx * wander;
    const ly = ey + ny * wander;
    ringPts.push({
      x: cx + lx * cosT - ly * sinT,
      y: cy + lx * sinT + ly * cosT,
    });
  }

  for (let i = 0; i < ringPts.length - 1; i++) {
    // Occasional tiny dry break on the ring
    if (boilRng() < 0.06) continue;
    const a = ringPts[i];
    const b = ringPts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const sub = Math.max(2, Math.ceil(segLen / 1.5));
    for (let d = 0; d <= sub; d++) {
      const f = d / sub;
      stampCrayonGrain(
        ctx,
        a.x + (b.x - a.x) * f,
        a.y + (b.y - a.y) * f,
        1.75,
        rgbMain,
        boilRng,
        0.92
      );
    }
  }

  // 3. Subtle satellite crayon dots near the ring (no stray '+' cross)
  drawCrayonDot(
    ctx,
    cx + rx * 0.72 * cosT - -ry * 1.15 * sinT,
    cy + rx * 0.72 * sinT + -ry * 1.15 * cosT,
    2.4,
    rgbAccent,
    boilRng
  );
  drawCrayonDot(
    ctx,
    cx - rx * 0.76 * cosT,
    cy - rx * 0.76 * sinT + 8,
    2.1,
    rgbAccent,
    boilRng
  );
  drawCrayonDot(
    ctx,
    cx + rx * 0.42 * cosT,
    cy + rx * 0.42 * sinT + ry * 1.35,
    1.6,
    rgbMain,
    boilRng
  );

  return canvas;
}

/**
 * Motif 4: Curved Crayon Comet Streak
 * 3 parallel broken rough pastel arcs whose tangent at the star head points strictly
 * along +X (angle = 0), while curving organically away to +Y (variant 0, clockwise arc
 * for right/up-right travel) or -Y (variant 1, counter-clockwise arc for left/up-left travel).
 */
function renderCrayonCometFrame(
  width: number,
  height: number,
  rgbMain: { r: number; g: number; b: number },
  rgbAccent: { r: number; g: number; b: number },
  variant: number,
  boilSeed: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const shapeRng = createSeededRng(4019 + variant * 113);
  const boilRng = createSeededRng(boilSeed);

  // variant 0 (curveSign = +1): tail droops toward +Y (below path when flying RIGHT/UP-RIGHT)
  // variant 1 (curveSign = -1): tail droops toward -Y (below path when flying LEFT/UP-LEFT)
  const curveSign = variant === 0 ? 1 : -1;
  const headX = width * 0.8;
  const headY = height * 0.5;

  // 3 parallel broken rough pastel/crayon arcs whose tangent at (x1, y1) is strictly +X (cpY === y1)
  const streakCount = 3;
  for (let s = 0; s < streakCount; s++) {
    const laneOffset = (s - 1) * 9.5;
    const lenRatio = s === 1 ? 0.66 : 0.55 + shapeRng() * 0.12;
    const x1 = headX - 15 - Math.abs(laneOffset) * 0.35;
    const y1 = headY + laneOffset * 0.55;
    const x0 = headX - width * lenRatio;
    const arcDrop = 24 + s * 3.5;
    const y0 = y1 + curveSign * arcDrop;
    // Control point shares y1 so the Bezier arrives into the star head strictly tangent to +X!
    const cpX = x0 + (x1 - x0) * 0.56;
    const cpY = y1;

    const col = s === 2 ? rgbAccent : rgbMain;
    const thick = s === 1 ? 4.0 : 3.0;

    drawJitteryCrayonArc(ctx, x0, y0, cpX, cpY, x1, y1, col, boilRng, {
      stepPx: 3.6,
      jitterAmp: 1.35,
      thickness: thick,
      brokenChance: 0.2,
      density: 1.08,
    });
  }

  // Tilted rough crayon 4-point star leading at the comet head
  const starR = 14.0;
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(curveSign * 0.08);
  ctx.translate(-headX, -headY);

  fillConcave4PtStarWithCrayon(
    ctx,
    headX,
    headY,
    starR * 1.12,
    starR * 0.94,
    starR * 1.04,
    starR * 0.86,
    starR * 0.26,
    rgbMain,
    boilRng
  );
  // Crisp sketchy crayon rim
  const w = starR * 0.26;
  drawJitteryCrayonArc(ctx, headX, headY - starR * 1.12, headX + w, headY - w, headX + starR * 0.94, headY, rgbAccent, boilRng, {
    stepPx: 3.2,
    jitterAmp: 0.95,
    thickness: 1.7,
    overshoot: 1.2,
  });
  drawJitteryCrayonArc(ctx, headX + starR * 0.94, headY, headX + w, headY + w, headX, headY + starR * 1.04, rgbMain, boilRng, {
    stepPx: 3.2,
    jitterAmp: 0.95,
    thickness: 1.7,
    overshoot: 1.2,
  });
  drawJitteryCrayonArc(ctx, headX, headY + starR * 1.04, headX - w, headY + w, headX - starR * 0.86, headY, rgbMain, boilRng, {
    stepPx: 3.2,
    jitterAmp: 0.95,
    thickness: 1.7,
    overshoot: 1.2,
  });
  drawJitteryCrayonArc(ctx, headX - starR * 0.86, headY, headX - w, headY - w, headX, headY - starR * 1.12, rgbAccent, boilRng, {
    stepPx: 3.2,
    jitterAmp: 0.95,
    thickness: 1.7,
    overshoot: 1.2,
  });
  ctx.restore();

  // Scattered trailing pastel flecks along the curved wake
  drawCrayonDot(ctx, headX - width * 0.36, headY + curveSign * 14, 2.2, rgbAccent, boilRng);
  drawCrayonDot(ctx, headX - width * 0.56, headY + curveSign * 26, 2.0, rgbMain, boilRng);
  drawCrayonDot(ctx, headX - width * 0.22, headY - curveSign * 10, 1.7, rgbMain, boilRng);

  return canvas;
}

/**
 * Motif 5: Organic Crayon Dust & Pastel Spray Specks (clean dot clusters, zero stray crosses)
 */
function renderCrayonDustFrame(
  size: number,
  rgbMain: { r: number; g: number; b: number },
  rgbAccent: { r: number; g: number; b: number },
  variant: number,
  boilSeed: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const boilRng = createSeededRng(boilSeed);
  const cx = size * 0.5;
  const cy = size * 0.5;

  if (variant === 0) {
    drawCrayonDot(ctx, cx, cy, 3.0, rgbMain, boilRng);
    drawCrayonDot(ctx, cx + 9, cy - 5, 1.9, rgbAccent, boilRng);
    drawCrayonDot(ctx, cx - 8, cy + 6, 1.6, rgbMain, boilRng);
  } else if (variant === 1) {
    drawCrayonDot(ctx, cx - 3, cy - 2, 2.6, rgbAccent, boilRng);
    drawCrayonDot(ctx, cx + 8, cy + 5, 2.2, rgbMain, boilRng);
    drawCrayonDot(ctx, cx - 9, cy + 7, 1.5, rgbAccent, boilRng);
  } else {
    drawCrayonDot(ctx, cx, cy, 3.2, rgbMain, boilRng);
    drawCrayonDot(ctx, cx + 10, cy - 7, 2.1, rgbAccent, boilRng);
    drawCrayonDot(ctx, cx - 9, cy + 8, 1.8, rgbMain, boilRng);
    drawCrayonDot(ctx, cx + 6, cy + 11, 1.5, rgbMain, boilRng);
  }

  return canvas;
}

function buildSpriteBankForSwatch(swatch: SparkleColorTriplet): ColorSpriteBank {
  const rgbMain = parseColorRgb(swatch.main);
  const rgbAccent = parseColorRgb(swatch.accent);

  const hashBase = swatch.id
    .split("")
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 17);

  const makeBoiled = (
    w: number,
    h: number,
    renderFn: (boilSeed: number) => HTMLCanvasElement,
    seedOffset: number
  ): BoiledSprite => ({
    width: w,
    height: h,
    frames: [
      renderFn(hashBase + seedOffset + 101),
      renderFn(hashBase + seedOffset + 202),
      renderFn(hashBase + seedOffset + 303),
    ],
  });

  return {
    "sketchy-4pt-hollow": [0, 1].map((v) =>
      makeBoiled(96, 96, (s) => render4PtStarFrame(96, rgbMain, false, v, s), 1000 + v * 37)
    ),
    "sketchy-4pt-solid": [0, 1].map((v) =>
      makeBoiled(96, 96, (s) => render4PtStarFrame(96, rgbMain, true, v, s), 2000 + v * 37)
    ),
    "sparkler-burst": [0, 1].map((v) =>
      makeBoiled(
        120,
        120,
        (s) => renderSparklerBurstFrame(120, rgbMain, rgbAccent, v, s),
        3000 + v * 37
      )
    ),
    "orbital-ring": [0, 1].map((v) =>
      makeBoiled(
        136,
        136,
        (s) => renderOrbitalRingFrame(136, rgbMain, rgbAccent, v, s),
        4000 + v * 37
      )
    ),
    "crayon-comet": [0, 1].map((v) =>
      makeBoiled(
        156,
        112,
        (s) => renderCrayonCometFrame(156, 112, rgbMain, rgbAccent, v, s),
        5000 + v * 37
      )
    ),
    "crayon-dust": [0, 1, 2].map((v) =>
      makeBoiled(
        64,
        64,
        (s) => renderCrayonDustFrame(64, rgbMain, rgbAccent, v, s),
        6000 + v * 37
      )
    ),
  };
}

// =============================================================================
// 4. PARTICLE SIMULATION & 8FPS (120ms) LINE-BOIL CANVAS RENDERER
// =============================================================================
interface HandDrawnParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  drag: number;
  buoyancy: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  scale: number;
  motif: MotifKind;
  variantIdx: number;
  swatch: SparkleColorTriplet;
  rotation: number;
  rotSpeed: number;
  /** Angular turning rate (rad/s) for curved-tail comets matching exact tail curvature */
  turnRate: number;
  alignToVelocity: boolean;
  twinkleFreq: number;
  twinklePhase: number;
  boilOffsetMs: number;
  age: number;
  delay: number;
  life: number;
  maxAlpha: number;
}

const MAX_PARTICLES = 86;
const LINE_BOIL_INTERVAL_MS = 120; // ~8.3fps authentic hand-drawn 2D line boil

/**
 * Checks whether (x, y) is too close to an already-active particle so hand-drawn
 * stars, sparklers, orbital rings & comet streaks stay spaced out and readable.
 */
function isTooCrowded(
  list: HandDrawnParticle[],
  x: number,
  y: number,
  minDist: number
): boolean {
  const minDistSq = minDist * minDist;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy < minDistSq) return true;
  }
  return false;
}

function createHandDrawnParticle(
  x: number,
  y: number,
  vx: number,
  vy: number,
  scale: number,
  life: number,
  swatch: SparkleColorTriplet,
  motif: MotifKind,
  delay = 0
): HandDrawnParticle {
  const variantCount = motif === "crayon-dust" ? 3 : 2;
  const isComet = motif === "crayon-comet";
  // Match comet sprite curvature strictly to travel side:
  // Rightward (vx >= 0): variant 0 (tail droops below-left) + clockwise turnRate (> 0)
  // Leftward  (vx <  0): variant 1 (tail droops below-right) + counter-clockwise turnRate (< 0)
  const goingRight = vx >= 0;
  const cometVariant = goingRight ? 0 : 1;
  const cometTurnRate = (goingRight ? 1 : -1) * (0.28 + Math.random() * 0.16);

  return {
    x,
    y,
    vx,
    vy,
    drag: isComet ? 0.988 : 0.986 - Math.random() * 0.01,
    buoyancy: isComet ? 0 : -(12 + Math.random() * 20),
    swayAmp: isComet ? 0 : 8 + Math.random() * 14,
    swayFreq: 1.0 + Math.random() * 1.5,
    swayPhase: Math.random() * Math.PI * 2,
    scale,
    motif,
    variantIdx: isComet ? cometVariant : Math.floor(Math.random() * variantCount),
    swatch,
    rotation: isComet
      ? Math.atan2(vy, vx)
      : (Math.random() - 0.5) * 0.45,
    rotSpeed: isComet ? 0 : (Math.random() - 0.5) * 0.24,
    turnRate: isComet ? cometTurnRate : 0,
    alignToVelocity: isComet,
    twinkleFreq: 2.6 + Math.random() * 3.8,
    twinklePhase: Math.random() * Math.PI * 2,
    boilOffsetMs: Math.random() * 360,
    age: 0,
    delay,
    life,
    maxAlpha: 0.88 + Math.random() * 0.12,
  };
}

/**
 * Picks a graceful outward left/up-left or right/up-right launch angle (never straight up or down).
 */
function sampleOutwardSideAngle(goRight: boolean): number {
  // Elevation above horizontal: -6° to +42° (pure left/right or up-left/up-right)
  const elev = -0.1 + Math.random() * 0.84; // rad: -0.10 .. +0.74
  return goRight ? -elev : Math.PI + elev;
}

export const SparkleParticleOverlay = forwardRef<SparkleOverlayHandle>(
  function SparkleParticleOverlay(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const particlesRef = useRef<HandDrawnParticle[]>([]);
    const spriteCacheRef = useRef<Map<string, ColorSpriteBank>>(new Map());
    const ambientRef = useRef<{
      active: boolean;
      paperRect: TargetPaperRect | null;
      spawnCarry: number;
      fadeRate: number;
    }>({
      active: false,
      paperRect: null,
      spawnCarry: 0,
      fadeRate: 1,
    });
    const rafRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const ensureLoopRunningRef = useRef<() => void>(() => {});

    const getSpriteBank = (swatch: SparkleColorTriplet): ColorSpriteBank => {
      const cache = spriteCacheRef.current;
      let bank = cache.get(swatch.id);
      if (!bank) {
        bank = buildSpriteBankForSwatch(swatch);
        cache.set(swatch.id, bank);
      }
      return bank;
    };

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let vpW = window.innerWidth;
      let vpH = window.innerHeight;
      let dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      const syncSize = () => {
        vpW = Math.max(1, window.innerWidth);
        vpH = Math.max(1, window.innerHeight);
        dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.round(vpW * dpr);
        canvas.height = Math.round(vpH * dpr);
        canvas.style.width = `${vpW}px`;
        canvas.style.height = `${vpH}px`;
      };

      syncSize();
      window.addEventListener("resize", syncSize);

      // Ambient perimeter spawner: hollow/solid 4-point stars, sparkler bursts, orbital rings & crayon dust
      const spawnAmbientParticle = () => {
        const list = particlesRef.current;
        if (list.length >= MAX_PARTICLES) return;

        const rect = ambientRef.current.paperRect;
        let x = Math.random() * vpW;
        let y = Math.random() * vpH;

        if (rect && rect.width > 40 && rect.height > 40) {
          if (Math.random() < 0.8) {
            const side = Math.random();
            const margin = 14 + Math.random() * Math.min(120, vpW * 0.15);
            if (side < 0.34) {
              x = Math.max(14, rect.left - margin);
              y = rect.top + Math.random() * (rect.height + 24) - 12;
            } else if (side < 0.68) {
              x = Math.min(vpW - 14, rect.left + rect.width + margin);
              y = rect.top + Math.random() * (rect.height + 24) - 12;
            } else if (side < 0.86) {
              x = rect.left - 36 + Math.random() * (rect.width + 72);
              y = Math.max(14, rect.top - (10 + Math.random() * 58));
            } else {
              x = rect.left - 36 + Math.random() * (rect.width + 72);
              y = Math.min(vpH - 18, rect.top + rect.height + (10 + Math.random() * 56));
            }
          } else {
            for (let attempt = 0; attempt < 4; attempt++) {
              const cx = Math.random() * vpW;
              const cy = Math.random() * vpH;
              if (
                cx < rect.left + 8 ||
                cx > rect.left + rect.width - 8 ||
                cy < rect.top + 8 ||
                cy > rect.top + rect.height - 8
              ) {
                x = cx;
                y = cy;
                break;
              }
            }
          }
        }

        // Avoid stacking right on top of another hand-drawn motif
        if (isTooCrowded(list, x, y, 54)) return;

        const roll = Math.random();
        const motif: MotifKind =
          roll < 0.24
            ? "sketchy-4pt-hollow"
            : roll < 0.46
              ? "sketchy-4pt-solid"
              : roll < 0.66
                ? "sparkler-burst"
                : roll < 0.8
                  ? "orbital-ring"
                  : "crayon-dust";

        const scale =
          motif === "orbital-ring"
            ? 0.54 + Math.random() * 0.24
            : motif === "sparkler-burst"
              ? 0.44 + Math.random() * 0.26
              : motif === "crayon-dust"
                ? 0.5 + Math.random() * 0.34
                : 0.42 + Math.random() * 0.28;

        const swatch = Math.random() < 0.65 ? CREAM_GOLD : CHALK_WHITE;
        const life = 2.4 + Math.random() * 2.0;

        list.push(
          createHandDrawnParticle(
            x,
            y,
            (Math.random() - 0.5) * 14,
            -(10 + Math.random() * 20),
            scale,
            life,
            swatch,
            motif
          )
        );
      };

      const step = (now: number) => {
        const dt =
          lastTimeRef.current > 0
            ? Math.min(0.05, (now - lastTimeRef.current) / 1000)
            : 0.016;
        lastTimeRef.current = now;

        const amb = ambientRef.current;
        if (amb.active) {
          amb.spawnCarry += dt * 4.5;
          while (amb.spawnCarry >= 1) {
            amb.spawnCarry -= 1;
            spawnAmbientParticle();
          }
        }

        const list = particlesRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vpW, vpH);

        if (list.length === 0 && !amb.active) {
          rafRef.current = 0;
          lastTimeRef.current = 0;
          return;
        }

        // Strictly matte 2D illustration compositing (NO lighter / NO shadowBlur / NO digital glow)
        ctx.save();
        ctx.globalCompositeOperation = "source-over";

        let writeIdx = 0;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (p.delay > 0) {
            p.delay -= dt;
            list[writeIdx++] = p;
            continue;
          }

          p.age += dt * amb.fadeRate;
          if (p.age >= p.life) {
            continue;
          }

          const dragPow = Math.pow(p.drag, dt * 60);
          if (p.alignToVelocity) {
            // Pure curved-arc kinematics for tail-trailing comets:
            // moves strictly forward along head tangent & gently bends along tail curvature!
            const nextSpeed = Math.hypot(p.vx, p.vy) * dragPow;
            const nextHeading = Math.atan2(p.vy, p.vx) + p.turnRate * dt;
            p.vx = Math.cos(nextHeading) * nextSpeed;
            p.vy = Math.sin(nextHeading) * nextSpeed;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rotation = nextHeading;
          } else {
            p.vx *= dragPow;
            p.vy = p.vy * dragPow + p.buoyancy * dt;

            const sway =
              Math.cos(p.age * p.swayFreq + p.swayPhase) * p.swayAmp * dt;
            p.x += p.vx * dt + sway;
            p.y += p.vy * dt;
            p.rotation += p.rotSpeed * dt;
          }

          const t = p.age / p.life;
          // Crisp hand-drawn entrance & gentle fade-out
          const envIn = Math.min(1, t / 0.14);
          const envOut = t > 0.58 ? 1 - (t - 0.58) / 0.42 : 1;
          // Subtle stepped 8fps twinkle breath
          const boilStep = Math.floor((now + p.boilOffsetMs) / LINE_BOIL_INTERVAL_MS);
          const twinkle =
            0.78 + 0.22 * Math.sin(boilStep * 0.55 + p.twinklePhase);
          const alpha = p.maxAlpha * envIn * envOut * twinkle;

          if (alpha > 0.015) {
            const bank = getSpriteBank(p.swatch);
            const variants = bank[p.motif];
            const sprite = variants[p.variantIdx % variants.length];
            const frame = sprite.frames[boilStep % 3];

            // Gentle pop-in scale
            const popScale = p.scale * (0.72 + 0.28 * envIn);
            const drawW = sprite.width * popScale;
            const drawH = sprite.height * popScale;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.drawImage(frame, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
            ctx.restore();
          }

          list[writeIdx++] = p;
        }
        list.length = writeIdx;

        ctx.restore();
        rafRef.current = window.requestAnimationFrame(step);
      };

      ensureLoopRunningRef.current = () => {
        if (!rafRef.current) {
          lastTimeRef.current = performance.now();
          rafRef.current = window.requestAnimationFrame(step);
        }
      };

      return () => {
        window.removeEventListener("resize", syncSize);
        if (rafRef.current) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        setAmbientActive: (active, paperRect) => {
          ambientRef.current.active = active;
          ambientRef.current.paperRect = paperRect;
          if (active) {
            ambientRef.current.fadeRate = 1;
            const list = particlesRef.current;
            const vpW = window.innerWidth;
            const vpH = window.innerHeight;

            // Pre-warm cream gold & chalk white sprite banks cleanly
            getSpriteBank(CREAM_GOLD);
            getSpriteBank(CHALK_WHITE);

            const seedMotifs: MotifKind[] = [
              "orbital-ring",
              "sketchy-4pt-hollow",
              "sketchy-4pt-solid",
              "sparkler-burst",
              "crayon-dust",
            ];

            for (let i = 0; i < 6 && list.length < MAX_PARTICLES; i++) {
              let x = Math.random() * vpW;
              let y = Math.random() * vpH;
              if (paperRect && paperRect.width > 40) {
                const onLeft = i % 2 === 0;
                const margin = 22 + Math.random() * Math.min(115, vpW * 0.15);
                x = onLeft
                  ? Math.max(20, paperRect.left - margin)
                  : Math.min(vpW - 20, paperRect.left + paperRect.width + margin);
                // Evenly stagger vertically so seeded motifs never overlap
                y =
                  paperRect.top +
                  ((i + 0.5) / 6) * paperRect.height +
                  (Math.random() - 0.5) * 28;
              }
              const motif = seedMotifs[i % seedMotifs.length];
              const scale =
                motif === "orbital-ring"
                  ? 0.58 + Math.random() * 0.18
                  : motif === "sparkler-burst"
                    ? 0.48 + Math.random() * 0.22
                    : 0.44 + Math.random() * 0.24;

              list.push(
                createHandDrawnParticle(
                  x,
                  y,
                  (Math.random() - 0.5) * 14,
                  -(12 + Math.random() * 18),
                  scale,
                  2.4 + Math.random() * 1.8,
                  i % 3 === 0 ? CHALK_WHITE : CREAM_GOLD,
                  motif,
                  Math.random() * 0.28
                )
              );
            }
            ensureLoopRunningRef.current();
          }
        },

        spawnDissolveFromCanvas: (drawingCanvas, paperRect) => {
          const collectedPalette: SparkleColorTriplet[] = [];
          const seenIds = new Set<string>();

          const safeW = Math.max(1, Math.floor(paperRect.width));
          const safeH = Math.max(1, Math.floor(paperRect.height));

          const off = document.createElement("canvas");
          off.width = safeW;
          off.height = safeH;
          const oCtx = off.getContext("2d", { willReadFrequently: true });

          const samples: {
            x: number;
            y: number;
            swatch: SparkleColorTriplet;
          }[] = [];

          if (oCtx && drawingCanvas.width > 0 && drawingCanvas.height > 0) {
            oCtx.drawImage(drawingCanvas, 0, 0, safeW, safeH);
            const data = oCtx.getImageData(0, 0, safeW, safeH).data;
            const step = 8;

            let sampleIdx = 0;
            for (let py = 0; py < safeH; py += step) {
              for (let px = 0; px < safeW; px += step) {
                const idx = (py * safeW + px) * 4;
                const a = data[idx + 3];
                if (a < 28) continue;

                const swatch = mapInkRgbToCrayonSwatch(
                  data[idx],
                  data[idx + 1],
                  data[idx + 2],
                  sampleIdx++
                );
                samples.push({
                  x: paperRect.left + px + (Math.random() - 0.5) * 4,
                  y: paperRect.top + py + (Math.random() - 0.5) * 4,
                  swatch,
                });

                if (!seenIds.has(swatch.id)) {
                  seenIds.add(swatch.id);
                  collectedPalette.push(swatch);
                  getSpriteBank(swatch);
                }
              }
            }
          }

          if (collectedPalette.length === 0) {
            collectedPalette.push(CREAM_GOLD, CHALK_WHITE);
          }

          ambientRef.current.fadeRate = 1;
          const list = particlesRef.current;

          if (samples.length > 0) {
            // Curated, well-spaced dissolve burst (20..36 particles) so every individual
            // hand-drawn crayon star, curved comet streak, sparkler & orbital ring stays crisp!
            const targetCount = Math.min(
              36,
              Math.max(20, Math.floor(samples.length * 0.14))
            );
            const placed: { x: number; y: number }[] = [];
            const minSpacing = Math.max(38, Math.min(58, Math.min(safeW, safeH) * 0.12));

            // Shuffle sample indices deterministically via stride walk so strokes dissolve evenly
            const maxAttempts = Math.min(samples.length, targetCount * 6);
            const stride = Math.max(1, samples.length / maxAttempts);
            let spawned = 0;

            for (let i = 0; i < maxAttempts && spawned < targetCount; i++) {
              if (list.length >= MAX_PARTICLES) break;
              const s =
                samples[Math.min(samples.length - 1, Math.floor(i * stride))];

              // Enforce clean spatial spacing so shapes never clump into an overlapping blob
              let tooClose = false;
              for (let j = 0; j < placed.length; j++) {
                const dx = placed[j].x - s.x;
                const dy = placed[j].y - s.y;
                if (dx * dx + dy * dy < minSpacing * minSpacing) {
                  tooClose = true;
                  break;
                }
              }
              if (tooClose) continue;
              placed.push({ x: s.x, y: s.y });
              spawned++;

              const roll = Math.random();
              const motif: MotifKind =
                roll < 0.28
                  ? "sketchy-4pt-solid"
                  : roll < 0.44
                    ? "sketchy-4pt-hollow"
                    : roll < 0.68
                      ? "crayon-comet"
                      : roll < 0.82
                        ? "sparkler-burst"
                        : roll < 0.9
                          ? "orbital-ring"
                          : "crayon-dust";

              // Fan outward left/up-left from left half of paper, right/up-right from right half
              const paperCenterX = paperRect.left + paperRect.width * 0.5;
              const goRight =
                Math.abs(s.x - paperCenterX) < 12
                  ? spawned % 2 === 0
                  : s.x >= paperCenterX;
              const angle = sampleOutwardSideAngle(goRight);
              const speed =
                motif === "crayon-comet"
                  ? 82 + Math.random() * 68
                  : 32 + Math.random() * 52;

              const scale =
                motif === "crayon-comet"
                  ? 0.52 + Math.random() * 0.24
                  : motif === "orbital-ring"
                    ? 0.54 + Math.random() * 0.22
                    : motif === "sparkler-burst"
                      ? 0.44 + Math.random() * 0.26
                      : motif === "crayon-dust"
                        ? 0.52 + Math.random() * 0.3
                        : 0.44 + Math.random() * 0.28;

              const life = 1.65 + Math.random() * 1.45;
              const delay = Math.random() * 0.46;

              const p = createHandDrawnParticle(
                s.x,
                s.y,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                scale,
                life,
                s.swatch,
                motif,
                delay
              );
              list.push(p);
            }
          } else {
            // Blank letter: fan outward left/up-left and right/up-right from center
            const cx = paperRect.left + paperRect.width / 2;
            const cy = paperRect.top + paperRect.height / 2;
            const motifs: MotifKind[] = [
              "sketchy-4pt-solid",
              "crayon-comet",
              "sketchy-4pt-hollow",
              "sparkler-burst",
              "orbital-ring",
              "crayon-dust",
            ];
            for (let i = 0; i < 16 && list.length < MAX_PARTICLES; i++) {
              const goRight = i % 2 === 0;
              const ang = sampleOutwardSideAngle(goRight);
              const motif = motifs[i % motifs.length];
              const spd = motif === "crayon-comet" ? 84 + Math.random() * 52 : 30 + Math.random() * 44;
              list.push(
                createHandDrawnParticle(
                  cx + (goRight ? 1 : -1) * (8 + Math.random() * paperRect.width * 0.24),
                  cy + (Math.random() - 0.5) * paperRect.height * 0.45,
                  Math.cos(ang) * spd,
                  Math.sin(ang) * spd,
                  motif === "crayon-comet" ? 0.56 : 0.5,
                  1.6 + Math.random() * 1.3,
                  i % 3 === 0 ? CHALK_WHITE : CREAM_GOLD,
                  motif,
                  Math.random() * 0.32
                )
              );
            }
          }

          ensureLoopRunningRef.current();
          return collectedPalette;
        },

        emitBurst: ({
          x,
          y,
          spreadX = 36,
          spreadY = 14,
          count,
          vxBias = 0,
          vyBias = -34,
          speedMin = 36,
          speedMax = 104,
          sizeScale = 1,
          palette,
        }) => {
          const list = particlesRef.current;
          const colorsPool =
            palette && palette.length > 0
              ? [...palette, CREAM_GOLD, CHALK_WHITE]
              : [CREAM_GOLD, CHALK_WHITE];

          ambientRef.current.fadeRate = 1;

          for (let i = 0; i < count; i++) {
            const px = x + (Math.random() - 0.5) * spreadX * 2;
            const py = y + (Math.random() - 0.5) * spreadY * 2;
            // Skip if directly overlapping an existing fresh particle
            if (isTooCrowded(list, px, py, 34)) continue;

            if (list.length >= MAX_PARTICLES) {
              list.shift();
            }

            const roll = Math.random();
            const motif: MotifKind =
              roll < 0.26
                ? "sparkler-burst"
                : roll < 0.5
                  ? "crayon-comet"
                  : roll < 0.66
                    ? "sketchy-4pt-solid"
                    : roll < 0.78
                      ? "sketchy-4pt-hollow"
                      : roll < 0.88
                        ? "orbital-ring"
                        : "crayon-dust";

            // Fan outward left/up-left or right/up-right from the burst center
            const goRight =
              Math.abs(px - x) < 6 ? Math.random() < 0.5 : px >= x;
            const ang = sampleOutwardSideAngle(goRight);
            const spd =
              motif === "crayon-comet"
                ? Math.max(76, speedMin + Math.random() * (speedMax - speedMin))
                : speedMin + Math.random() * (speedMax - speedMin);
            // Keep comet launch vectors cleanly lateral/up-lateral (never vertical up/down)
            const vx =
              motif === "crayon-comet"
                ? Math.cos(ang) * spd + vxBias * 0.2
                : Math.cos(ang) * spd + vxBias * 0.5;
            const vy =
              motif === "crayon-comet"
                ? Math.sin(ang) * spd
                : Math.sin(ang) * spd + vyBias * 0.25;

            const baseScale =
              motif === "crayon-comet"
                ? 0.5 + Math.random() * 0.24
                : motif === "orbital-ring"
                  ? 0.5 + Math.random() * 0.22
                  : motif === "sparkler-burst"
                    ? 0.44 + Math.random() * 0.24
                    : motif === "crayon-dust"
                      ? 0.5 + Math.random() * 0.3
                      : 0.44 + Math.random() * 0.24;

            const swatch =
              colorsPool[Math.floor(Math.random() * colorsPool.length)];
            const life = 1.15 + Math.random() * 1.25;

            list.push(
              createHandDrawnParticle(
                px,
                py,
                vx,
                vy,
                baseScale * sizeScale,
                life,
                swatch,
                motif
              )
            );
          }

          ensureLoopRunningRef.current();
        },

        fadeOutAndClear: (fast = false) => {
          ambientRef.current.active = false;
          ambientRef.current.fadeRate = fast ? 3.2 : 1.7;
          ensureLoopRunningRef.current();
        },
      }),
      []
    );

    return (
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-40 block h-full w-full"
        aria-hidden="true"
      />
    );
  }
);
