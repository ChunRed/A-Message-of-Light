import { createSeededRng } from "@/lib/hand-drawn-utils";

/**
 * Authentic storybook wax-crayon palette inspired by warm hand-rubbed crayon
 * illustrations on cream cotton paper (terracotta brick, sage-slate roof,
 * mustard ochre, sky cerulean, coral pink, leaf green, bark brown).
 */
export const YANSHUI_PALETTE = {
  brickRed: "#B5492B",
  vermilion: "#E36133",
  coralPink: "#E37D87",
  marigold: "#E2AD3B",
  lemon: "#D6CE56",
  sageRoof: "#7E8872",
  leafGreen: "#5D8A58",
  mint: "#74B89B",
  skyBlue: "#4E92C4",
  cobalt: "#355E93",
  lilac: "#9B7EC4",
  barkBrown: "#8B643E",
  darkUmber: "#4A3F35",
  cream: "#FCF8EC",
} as const;

interface Pt2 {
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function sampleQuadCurve(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  steps: number
): Pt2[] {
  const pts: Pt2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    pts.push({
      x: inv * inv * x0 + 2 * inv * t * cx + t * t * x1,
      y: inv * inv * y0 + 2 * inv * t * cy + t * t * y1,
    });
  }
  return pts;
}

function sampleWaveLine(
  x0: number,
  y0: number,
  len: number,
  amp: number,
  cycles: number,
  phase: number,
  steps: number
): Pt2[] {
  const pts: Pt2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({
      x: x0 + len * t,
      y: y0 + Math.sin(t * Math.PI * 2 * cycles + phase) * amp,
    });
  }
  return pts;
}

// =============================================================================
// AUTHENTIC COTTON-PAPER WAX CRAYON GRAIN PATTERN CACHE
// Every filled area & stroke uses real woven paper-tooth wax pores so tiny
// cream paper flecks peek organically through every crayon rubbing!
// =============================================================================

type CrayonDensity = "light" | "medium" | "rich";

const crayonTileCache = new Map<string, HTMLCanvasElement>();

function hash2D(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) ^ (x * y);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Generates & caches a seamless 96×96 wax-crayon paper-tooth tile canvas
 * for a given color and rubbing density. When used as a CanvasPattern for
 * both fills and strokes, every pixel exhibits authentic dry wax grain!
 */
function getCrayonTile(
  colorHex: string,
  density: CrayonDensity
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${colorHex}|${density}`;
  const cached = crayonTileCache.get(key);
  if (cached) return cached;

  const size = 96;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tCtx = tile.getContext("2d");
  if (!tCtx) return null;

  const { r, g, b } = hexToRgb(colorHex);
  const img = tCtx.createImageData(size, size);
  const data = img.data;

  // Higher density = more wax coverage while still keeping crisp cotton-paper pores
  const threshold =
    density === "rich" ? 0.25 : density === "medium" ? 0.37 : 0.49;
  const seed = (r * 7 + g * 13 + b * 19) & 1023;

  for (let y = 0; y < size; y++) {
    // Periodic sinusoidal fiber weave (wraps seamlessly at 96px!)
    const wy = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const wx = (x / size) * Math.PI * 2;
      // Multi-frequency woven cotton paper tooth + directional crayon rub streaks
      const fine = hash2D(x, y, seed);
      const coarse = hash2D(x >> 1, y >> 1, seed + 31);
      const streak = hash2D(x >> 2, y, seed + 73);
      const weave =
        0.5 +
        0.24 * Math.sin(wx * 14 + wy * 3) +
        0.22 * Math.cos(wy * 16 - wx * 2);

      const tooth = fine * 0.42 + coarse * 0.26 + streak * 0.16 + weave * 0.16;

      const idx = (y * size + x) * 4;
      if (tooth > threshold) {
        const norm = clamp01((tooth - threshold) / (1 - threshold));
        // Subtle warm wax clump variation so color feels hand-pressed
        const shade = 0.92 + norm * 0.12;
        data[idx] = Math.min(255, Math.round(r * shade));
        data[idx + 1] = Math.min(255, Math.round(g * shade));
        data[idx + 2] = Math.min(255, Math.round(b * shade));
        // Crisp wax pigment catch with organic crumbly mid-alphas
        data[idx + 3] = Math.round((0.42 + Math.pow(norm, 0.72) * 0.56) * 255);
      } else {
        // Paper valley pore — transparent so cream cotton paper shows through!
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 0;
      }
    }
  }

  tCtx.putImageData(img, 0, 0);
  crayonTileCache.set(key, tile);
  return tile;
}

let activeGrainScale = 1;

function getCrayonStyle(
  ctx: CanvasRenderingContext2D,
  colorHex: string,
  density: CrayonDensity,
  offsetX = 0,
  offsetY = 0
): CanvasPattern | string {
  const tile = getCrayonTile(colorHex, density);
  if (!tile) return colorHex;
  const pat = ctx.createPattern(tile, "repeat");
  if (!pat) return colorHex;
  if (typeof DOMMatrix !== "undefined") {
    pat.setTransform(
      new DOMMatrix()
        .translate(offsetX * activeGrainScale, offsetY * activeGrainScale)
        .scale(activeGrainScale, activeGrainScale)
    );
  }
  return pat;
}

// =============================================================================
// WAX-CRAYON DRAWING PRIMITIVES (ZERO SMOOTH VECTOR FILLS OR AIRBRUSH BLOBS!)
// =============================================================================

/**
 * Draws a genuine grainy wax-crayon polyline progressively revealed up to
 * `progress ∈ [0..1]`, textured through the cotton-paper tooth pattern with
 * multi-pass wax stick wobble & tiny crumbly edge flecks.
 */
export function drawCrayonStroke(
  ctx: CanvasRenderingContext2D,
  pts: Pt2[],
  progress: number,
  colorHex: string,
  rng: () => number,
  opts: {
    lineWidth: number;
    alpha?: number;
    jitterAmp?: number;
    density?: CrayonDensity;
    passes?: number;
    brokenChance?: number;
  }
): void {
  const p = clamp01(progress);
  if (pts.length < 2 || p <= 0.004) return;

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLens.push(l);
    totalLen += l;
  }
  if (totalLen < 0.5) return;

  const clipped: Pt2[] = [pts[0]];
  let remaining = totalLen * p;
  for (let i = 0; i < segLens.length && remaining > 0; i++) {
    const l = segLens[i];
    if (l < 0.01) continue;
    if (remaining >= l) {
      clipped.push(pts[i + 1]);
      remaining -= l;
    } else {
      const f = remaining / l;
      clipped.push({
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
      });
      remaining = 0;
    }
  }
  if (clipped.length < 2) return;

  const baseAlpha = opts.alpha ?? 0.94;
  const jitterAmp = opts.jitterAmp ?? 0.9;
  const density = opts.density ?? "rich";
  const passes = opts.passes ?? 2;
  const brokenChance = opts.brokenChance ?? 0.04;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let pass = 0; pass < passes; pass++) {
    const pat = getCrayonStyle(
      ctx,
      colorHex,
      pass === 0 ? density : "medium",
      Math.round(rng() * 48),
      Math.round(rng() * 48)
    );
    ctx.strokeStyle = pat;
    ctx.globalAlpha = baseAlpha * (pass === 0 ? 1 : 0.68);
    ctx.lineWidth = opts.lineWidth * (pass === 0 ? 1 : 0.78);

    const spread = pass === 0 ? 0 : opts.lineWidth * 0.42;
    ctx.beginPath();
    let penDown = false;
    for (let i = 0; i < clipped.length; i++) {
      const pt = clipped[i];
      const jx = (rng() - 0.5) * jitterAmp + (rng() - 0.5) * spread;
      const jy = (rng() - 0.5) * jitterAmp + (rng() - 0.5) * spread;
      if (i === 0 || (brokenChance > 0 && rng() < brokenChance)) {
        ctx.moveTo(pt.x + jx, pt.y + jy);
        penDown = true;
      } else if (penDown) {
        ctx.lineTo(pt.x + jx, pt.y + jy);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Fills an organic hand-sketched polygon with genuine grainy wax-crayon texture:
 * 1. Textured cotton-tooth wax fill (cream paper pores shine through organically!)
 * 2. Directional hand-rubbed back-and-forth crayon shading strokes inside the shape
 * 3. Soft blunt-crayon crumbly outline pass (like Reference Images 1 & 2!)
 */
function drawCrayonFilledPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Pt2[],
  colorHex: string,
  alpha: number,
  rng: () => number,
  unit: number,
  opts?: {
    density?: CrayonDensity;
    rubAngleDeg?: number;
    edgeWidth?: number;
  }
): void {
  if (pts.length < 3 || alpha <= 0.01) return;
  const density = opts?.density ?? "rich";
  const edgeWidth = (opts?.edgeWidth ?? 2.3) * unit;

  const jittered: Pt2[] = pts.map((pt) => ({
    x: pt.x + (rng() - 0.5) * 1.4 * unit,
    y: pt.y + (rng() - 0.5) * 1.4 * unit,
  }));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(jittered[0].x, jittered[0].y);
  for (let i = 1; i < jittered.length; i++) {
    ctx.lineTo(jittered[i].x, jittered[i].y);
  }
  ctx.closePath();

  // 1. Base grainy wax-crayon rubbing fill
  ctx.globalAlpha = alpha * 0.94;
  ctx.fillStyle = getCrayonStyle(
    ctx,
    colorHex,
    density,
    Math.round(rng() * 64),
    Math.round(rng() * 64)
  );
  ctx.fill();

  // 2. Clipped back-and-forth directional wax crayon rub streaks (gives hand-colored depth!)
  ctx.save();
  ctx.clip();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of jittered) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const diag = Math.hypot(maxX - minX, maxY - minY) * 0.65;
  const rubRad = ((opts?.rubAngleDeg ?? -12) * Math.PI) / 180;

  ctx.translate(cx, cy);
  ctx.rotate(rubRad);
  ctx.strokeStyle = getCrayonStyle(
    ctx,
    colorHex,
    "medium",
    Math.round(rng() * 64),
    Math.round(rng() * 64)
  );
  ctx.globalAlpha = alpha * 0.58;
  ctx.lineCap = "round";
  const step = Math.max(3.2 * unit, diag / 9);
  for (let y = -diag; y <= diag; y += step) {
    ctx.lineWidth = (2.2 + rng() * 1.8) * unit;
    ctx.beginPath();
    ctx.moveTo(-diag + (rng() - 0.5) * 3 * unit, y + (rng() - 0.5) * 1.4 * unit);
    ctx.lineTo(diag + (rng() - 0.5) * 3 * unit, y + (rng() - 0.5) * 1.4 * unit);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Soft blunt-crayon crumbly edge stroke (breaks sharp digital edges!)
  ctx.globalAlpha = alpha * 0.88;
  ctx.strokeStyle = getCrayonStyle(
    ctx,
    colorHex,
    "medium",
    Math.round(rng() * 64),
    Math.round(rng() * 64)
  );
  ctx.lineWidth = edgeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws a playful airy curly wax-crayon loop ribbon.
 */
function drawCrayonCurlyLoop(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  loops: number,
  amp: number,
  progress: number,
  colorHex: string,
  rng: () => number,
  unit: number,
  alpha = 0.88,
  widthMul = 2.1
): void {
  const p = clamp01(progress);
  if (p <= 0.02) return;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const steps = Math.max(14, Math.round(loops * 8));
  const pts: Pt2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * loops;
    const along = t * len + Math.cos(a) * amp * 0.45;
    const across = Math.sin(a) * amp;
    pts.push({
      x: x0 + ux * along + nx * across,
      y: y0 + uy * along + ny * across,
    });
  }

  drawCrayonStroke(ctx, pts, p, colorHex, rng, {
    lineWidth: widthMul * unit,
    alpha,
    jitterAmp: 0.65 * unit,
    density: "rich",
    passes: 2,
  });
}

/**
 * Draws a grainy wax-crayon 6-point spark asterisk (NOT a `+` cross!).
 */
function drawCrayonSparkAsterisk(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  colorHex: string,
  rng: () => number,
  unit: number,
  alpha = 0.92
): void {
  if (r < 1.5) return;
  const tilt = rng() * 0.45;
  for (let i = 0; i < 3; i++) {
    const a = tilt + (i * Math.PI) / 3 + (rng() - 0.5) * 0.14;
    const l1 = r * (0.82 + rng() * 0.3);
    const l2 = r * (0.82 + rng() * 0.3);
    drawCrayonStroke(
      ctx,
      [
        { x: cx - Math.cos(a) * l1, y: cy - Math.sin(a) * l1 },
        { x: cx + Math.cos(a) * l2, y: cy + Math.sin(a) * l2 },
      ],
      1,
      colorHex,
      rng,
      {
        lineWidth: 1.8 * unit,
        alpha,
        jitterAmp: 0.45 * unit,
        density: "rich",
        passes: 1,
      }
    );
  }
}

/**
 * Draws a charming grainy wax-crayon filled circle / dab (for firework dots,
 * moon, or small Yuejin lanterns).
 */
function drawCrayonDab(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colorHex: string,
  alpha: number,
  rng: () => number,
  unit: number,
  density: CrayonDensity = "rich"
): void {
  if (rx < 1 || ry < 1 || alpha <= 0.01) return;
  const pts: Pt2[] = [];
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const radJ = 0.9 + rng() * 0.2;
    pts.push({
      x: cx + Math.cos(a) * rx * radJ,
      y: cy + Math.sin(a) * ry * radJ,
    });
  }
  drawCrayonFilledPolygon(ctx, pts, colorHex, alpha, rng, unit, {
    density,
    rubAngleDeg: -20 + rng() * 40,
    edgeWidth: 1.5,
  });
}

// =============================================================================
// VIGNETTE 1: 鹽水八角樓 (STORYBOOK WAX-CRAYON OCTAGONAL BUILDING + TREE)
// Inspired by Reference Images 1 & 2: warm brick-red crayon walls with cream
// paper pores, sage-grey flying-eave roof with scalloped vermilion tiles,
// ochre wooden octagonal window, and a slender brown crayon tree beside it!
// =============================================================================

function drawOctagonalBuildingCrayon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  reveal: number,
  rng: () => number,
  unit: number
): void {
  const p = clamp01(reveal);
  if (p <= 0.01) return;

  // Compact, breathable upper-right vignette cleanly below postage stamp
  const cx = w * 0.775;
  const baseY = h * 0.295;
  const bw = w * 0.215;
  const bh = h * 0.15;

  // 1. Slender earthy-brown wax-crayon tree standing beside 八角樓 (Ref 1!)
  const treeP = easeOutCubic(clamp01((p - 0.05) / 0.6));
  if (treeP > 0.02) {
    const tx = cx + bw * 0.51;
    const trunkPts: Pt2[] = [
      { x: tx + 1.5 * unit, y: baseY + 1 * unit },
      { x: tx + 0.5 * unit, y: baseY - bh * 0.52 },
      { x: tx + 2.5 * unit, y: baseY - bh * 0.96 },
    ];
    drawCrayonStroke(ctx, trunkPts, treeP, YANSHUI_PALETTE.barkBrown, rng, {
      lineWidth: 4.2 * unit,
      alpha: 0.9,
      jitterAmp: 0.75 * unit,
      density: "rich",
      passes: 2,
    });
    // Expressive reaching upper branches
    const b1 = sampleQuadCurve(
      tx + 1.5 * unit,
      baseY - bh * 0.72,
      tx - bw * 0.12,
      baseY - bh * 0.92,
      tx - bw * 0.26,
      baseY - bh * 1.05,
      8
    );
    const b2 = sampleQuadCurve(
      tx + 1.5 * unit,
      baseY - bh * 0.64,
      tx + bw * 0.14,
      baseY - bh * 0.82,
      tx + bw * 0.24,
      baseY - bh * 0.76,
      8
    );
    drawCrayonStroke(
      ctx,
      b1,
      clamp01((treeP - 0.3) / 0.7),
      YANSHUI_PALETTE.barkBrown,
      rng,
      { lineWidth: 2.2 * unit, alpha: 0.86, jitterAmp: 0.6 * unit, passes: 1 }
    );
    drawCrayonStroke(
      ctx,
      b2,
      clamp01((treeP - 0.35) / 0.65),
      YANSHUI_PALETTE.barkBrown,
      rng,
      { lineWidth: 2.0 * unit, alpha: 0.84, jitterAmp: 0.6 * unit, passes: 1 }
    );
    // Airy olive-green crayon leaf tufts (Ref 3 style!)
    if (treeP > 0.55) {
      const leafP = clamp01((treeP - 0.55) / 0.45);
      drawCrayonDab(
        ctx,
        tx - bw * 0.18,
        baseY - bh * 0.98,
        5.5 * unit * leafP,
        4.2 * unit * leafP,
        YANSHUI_PALETTE.leafGreen,
        0.84,
        rng,
        unit,
        "medium"
      );
      drawCrayonDab(
        ctx,
        tx + bw * 0.18,
        baseY - bh * 0.82,
        6.0 * unit * leafP,
        4.5 * unit * leafP,
        YANSHUI_PALETTE.leafGreen,
        0.82,
        rng,
        unit,
        "medium"
      );
    }
  }

  // 2. First-floor brick-red & warm timber crayon walls (Ref 1 & 2 texture!)
  const f1P = easeOutCubic(clamp01((p - 0.08) / 0.55));
  if (f1P > 0.02) {
    const f1Top = baseY - bh * 0.38;
    const f1HW = bw * 0.36;

    // Warm terracotta brick-red grainy wax wall (cream pores peeking through!)
    drawCrayonFilledPolygon(
      ctx,
      [
        { x: cx - f1HW, y: f1Top },
        { x: cx + f1HW, y: f1Top },
        { x: cx + f1HW * 1.03, y: baseY },
        { x: cx - f1HW * 1.03, y: baseY },
      ],
      YANSHUI_PALETTE.brickRed,
      0.95 * f1P,
      rng,
      unit,
      { density: "rich", rubAngleDeg: 84, edgeWidth: 2.4 }
    );

    // Warm olive-umber wooden double doorway with mustard-ochre trim (Ref 1!)
    const doorW = f1HW * 0.56;
    const doorTop = f1Top + bh * 0.08;
    drawCrayonFilledPolygon(
      ctx,
      [
        { x: cx - doorW * 0.5, y: doorTop },
        { x: cx + doorW * 0.5, y: doorTop },
        { x: cx + doorW * 0.5, y: baseY },
        { x: cx - doorW * 0.5, y: baseY },
      ],
      YANSHUI_PALETTE.darkUmber,
      0.88 * f1P,
      rng,
      unit,
      { density: "rich", rubAngleDeg: 90, edgeWidth: 1.6 }
    );
    drawCrayonStroke(
      ctx,
      [
        { x: cx - doorW * 0.56, y: baseY },
        { x: cx - doorW * 0.56, y: doorTop - 1 * unit },
        { x: cx, y: doorTop - 4.5 * unit },
        { x: cx + doorW * 0.56, y: doorTop - 1 * unit },
        { x: cx + doorW * 0.56, y: baseY },
      ],
      f1P,
      YANSHUI_PALETTE.marigold,
      rng,
      { lineWidth: 2.2 * unit, alpha: 0.9, jitterAmp: 0.5 * unit, passes: 1 }
    );

    // Tiny hand-drawn wooden railing fence at front left (Ref 1 charm!)
    drawCrayonStroke(
      ctx,
      [
        { x: cx - f1HW * 1.12, y: baseY - 5 * unit },
        { x: cx - f1HW * 0.36, y: baseY - 5 * unit },
      ],
      f1P,
      YANSHUI_PALETTE.darkUmber,
      rng,
      { lineWidth: 1.6 * unit, alpha: 0.82, jitterAmp: 0.45 * unit, passes: 1 }
    );
    for (let k = 0; k < 4; k++) {
      const fx = cx - f1HW * 1.06 + k * (f1HW * 0.22);
      drawCrayonStroke(
        ctx,
        [
          { x: fx, y: baseY - 8 * unit },
          { x: fx, y: baseY + 1 * unit },
        ],
        f1P,
        YANSHUI_PALETTE.darkUmber,
        rng,
        { lineWidth: 1.6 * unit, alpha: 0.84, jitterAmp: 0.4 * unit, passes: 1 }
      );
    }
  }

  // 3. First-floor curved sage-grey & vermilion flying-eave roof (雙層飛簷)
  const eave1P = easeOutCubic(clamp01((p - 0.22) / 0.5));
  if (eave1P > 0.02) {
    const e1Y = baseY - bh * 0.37;
    const e1HW = bw * 0.54;
    drawCrayonFilledPolygon(
      ctx,
      [
        { x: cx - e1HW, y: e1Y - bh * 0.03 },
        { x: cx - e1HW * 0.62, y: e1Y - bh * 0.14 },
        { x: cx + e1HW * 0.62, y: e1Y - bh * 0.14 },
        { x: cx + e1HW, y: e1Y - bh * 0.03 },
        { x: cx + e1HW * 0.86, y: e1Y + bh * 0.02 },
        { x: cx - e1HW * 0.86, y: e1Y + bh * 0.02 },
      ],
      YANSHUI_PALETTE.sageRoof,
      0.94 * eave1P,
      rng,
      unit,
      { density: "rich", rubAngleDeg: -8, edgeWidth: 2.1 }
    );
    // Curved upturned eave highlight in mustard-ochre
    const eaveCurve = sampleQuadCurve(
      cx - e1HW * 1.03,
      e1Y - bh * 0.04,
      cx,
      e1Y + bh * 0.03,
      cx + e1HW * 1.03,
      e1Y - bh * 0.04,
      12
    );
    drawCrayonStroke(ctx, eaveCurve, eave1P, YANSHUI_PALETTE.marigold, rng, {
      lineWidth: 2.3 * unit,
      alpha: 0.9,
      jitterAmp: 0.55 * unit,
      passes: 1,
    });
  }

  // 4. Second-floor Iconic Octagonal Pavilion (2F 八角閣 + 八角窗欞)
  const f2P = easeOutCubic(clamp01((p - 0.34) / 0.5));
  if (f2P > 0.02) {
    const f2Bot = baseY - bh * 0.5;
    const f2Top = baseY - bh * 0.77;
    const f2HW = bw * 0.3;

    drawCrayonFilledPolygon(
      ctx,
      [
        { x: cx - f2HW, y: f2Top },
        { x: cx + f2HW, y: f2Top },
        { x: cx + f2HW * 1.04, y: f2Bot },
        { x: cx - f2HW * 1.04, y: f2Bot },
      ],
      YANSHUI_PALETTE.brickRed,
      0.95 * f2P,
      rng,
      unit,
      { density: "rich", rubAngleDeg: 86, edgeWidth: 2.2 }
    );

    // Iconic central glowing Octagonal Window (八角窗) in cream + mustard-ochre frame!
    const winCy = (f2Top + f2Bot) * 0.5;
    const octR = Math.min(f2HW * 0.36, (f2Bot - f2Top) * 0.38);
    const octPts: Pt2[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      octPts.push({
        x: cx + Math.cos(a) * octR,
        y: winCy + Math.sin(a) * octR,
      });
    }
    drawCrayonFilledPolygon(ctx, octPts, YANSHUI_PALETTE.cream, 0.96 * f2P, rng, unit, {
      density: "rich",
      edgeWidth: 1.4,
    });
    drawCrayonStroke(
      ctx,
      [...octPts, octPts[0]],
      f2P,
      YANSHUI_PALETTE.marigold,
      rng,
      { lineWidth: 2.1 * unit, alpha: 0.94, jitterAmp: 0.45 * unit, passes: 1 }
    );
    // Cross lattice mullions inside the octagonal window
    drawCrayonStroke(
      ctx,
      [
        { x: cx - octR * 0.68, y: winCy },
        { x: cx + octR * 0.68, y: winCy },
      ],
      f2P,
      YANSHUI_PALETTE.barkBrown,
      rng,
      { lineWidth: 1.3 * unit, alpha: 0.82, jitterAmp: 0.35 * unit, passes: 1 }
    );
    drawCrayonStroke(
      ctx,
      [
        { x: cx, y: winCy - octR * 0.68 },
        { x: cx, y: winCy + octR * 0.68 },
      ],
      f2P,
      YANSHUI_PALETTE.barkBrown,
      rng,
      { lineWidth: 1.3 * unit, alpha: 0.82, jitterAmp: 0.35 * unit, passes: 1 }
    );

    // Two cozy side lattice windows in cream + sky blue
    for (const dir of [-1, 1]) {
      const wx = cx + dir * f2HW * 0.7;
      drawCrayonFilledPolygon(
        ctx,
        [
          { x: wx - f2HW * 0.14, y: winCy - octR * 0.72 },
          { x: wx + f2HW * 0.14, y: winCy - octR * 0.72 },
          { x: wx + f2HW * 0.14, y: winCy + octR * 0.72 },
          { x: wx - f2HW * 0.14, y: winCy + octR * 0.72 },
        ],
        YANSHUI_PALETTE.skyBlue,
        0.86 * f2P,
        rng,
        unit,
        { density: "medium", edgeWidth: 1.2 }
      );
      drawCrayonStroke(
        ctx,
        [
          { x: wx - f2HW * 0.15, y: winCy - octR * 0.72 },
          { x: wx + f2HW * 0.15, y: winCy - octR * 0.72 },
          { x: wx + f2HW * 0.15, y: winCy + octR * 0.72 },
          { x: wx - f2HW * 0.15, y: winCy + octR * 0.72 },
          { x: wx - f2HW * 0.15, y: winCy - octR * 0.72 },
        ],
        f2P,
        YANSHUI_PALETTE.cream,
        rng,
        { lineWidth: 1.3 * unit, alpha: 0.86, jitterAmp: 0.35 * unit, passes: 1 }
      );
    }
  }

  // 5. Top Curved Octagonal Crown Roof (八角飛簷頂) with Ref 2 scalloped tile strokes!
  const roof2P = easeOutCubic(clamp01((p - 0.48) / 0.52));
  if (roof2P > 0.02) {
    const r2Bot = baseY - bh * 0.76;
    const r2Peak = baseY - bh * 1.03;
    const r2HW = bw * 0.46;

    drawCrayonFilledPolygon(
      ctx,
      [
        { x: cx - r2HW, y: r2Bot - bh * 0.03 },
        { x: cx - r2HW * 0.48, y: r2Bot - bh * 0.15 },
        { x: cx, y: r2Peak },
        { x: cx + r2HW * 0.48, y: r2Bot - bh * 0.15 },
        { x: cx + r2HW, y: r2Bot - bh * 0.03 },
        { x: cx + r2HW * 0.84, y: r2Bot + bh * 0.02 },
        { x: cx - r2HW * 0.84, y: r2Bot + bh * 0.02 },
      ],
      YANSHUI_PALETTE.sageRoof,
      0.95 * roof2P,
      rng,
      unit,
      { density: "rich", rubAngleDeg: -16, edgeWidth: 2.2 }
    );

    // Charming curved vermilion roof-tile accent strokes (Ref 2 storybook touch!)
    for (let row = 0; row < 2; row++) {
      const ry = r2Bot - bh * (0.04 + row * 0.085);
      const span = r2HW * (0.7 - row * 0.28);
      const pts = sampleWaveLine(cx - span, ry, span * 2, 2.2 * unit, 4 - row, 0.3, 14);
      drawCrayonStroke(ctx, pts, roof2P, YANSHUI_PALETTE.vermilion, rng, {
        lineWidth: 1.65 * unit,
        alpha: 0.78,
        jitterAmp: 0.45 * unit,
        passes: 1,
      });
    }

    // Sweeping roof ridges & little golden finial dot
    const ridgeL = sampleQuadCurve(
      cx,
      r2Peak,
      cx - r2HW * 0.48,
      r2Bot - bh * 0.04,
      cx - r2HW * 1.04,
      r2Bot - bh * 0.06,
      9
    );
    const ridgeR = sampleQuadCurve(
      cx,
      r2Peak,
      cx + r2HW * 0.48,
      r2Bot - bh * 0.04,
      cx + r2HW * 1.04,
      r2Bot - bh * 0.06,
      9
    );
    drawCrayonStroke(ctx, ridgeL, roof2P, YANSHUI_PALETTE.cream, rng, {
      lineWidth: 2.0 * unit,
      alpha: 0.84,
      jitterAmp: 0.45 * unit,
      passes: 1,
    });
    drawCrayonStroke(ctx, ridgeR, roof2P, YANSHUI_PALETTE.marigold, rng, {
      lineWidth: 2.0 * unit,
      alpha: 0.9,
      jitterAmp: 0.45 * unit,
      passes: 1,
    });
    drawCrayonDab(
      ctx,
      cx,
      r2Peak - 2.5 * unit,
      3.5 * unit,
      3.5 * unit,
      YANSHUI_PALETTE.marigold,
      0.92 * roof2P,
      rng,
      unit
    );
  }
}

// =============================================================================
// VIGNETTE 2: 月津港水月橋 (AIRY WAX-CRAYON ARCH BRIDGE & RIPPLING WATER)
// Compact, breathable lower-left/center vignette cleanly above "一則光的訊息",
// with Ref 3 style airy horizontal crayon water strokes & curly sky-blue waves!
// =============================================================================

function drawShuiyueBridgeCrayon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  reveal: number,
  rng: () => number,
  unit: number,
  elapsedSec: number
): void {
  const p = clamp01(reveal);
  if (p <= 0.01) return;

  // Breathable vignette occupying lower-left-to-center (`nx ∈ [0.11..0.60], ny ∈ [0.71..0.86]`)
  const waterY = h * 0.805;
  const leftX = w * 0.125;
  const rightX = w * 0.585;
  const midX = (leftX + rightX) * 0.5;
  const archPeakY = h * 0.728;

  // 1. Gentle organic rippling Yuejin harbor water waves beneath 水月橋 (zero straight bars!)
  const waterP = easeOutCubic(clamp01(p / 0.58));
  if (waterP > 0.02) {
    const waveConfigs = [
      { x0: w * 0.14, y: waterY + h * 0.018, len: w * 0.42, col: YANSHUI_PALETTE.skyBlue, ph: 0.4 },
      { x0: w * 0.21, y: waterY + h * 0.036, len: w * 0.32, col: YANSHUI_PALETTE.mint, ph: 1.9 },
      { x0: w * 0.18, y: waterY + h * 0.052, len: w * 0.28, col: YANSHUI_PALETTE.skyBlue, ph: 3.1 },
    ];
    for (let i = 0; i < waveConfigs.length; i++) {
      const wc = waveConfigs[i];
      const wPts = sampleWaveLine(
        wc.x0,
        wc.y,
        wc.len,
        2.6 * unit,
        3.2,
        wc.ph + elapsedSec * 0.65,
        20
      );
      drawCrayonStroke(
        ctx,
        wPts,
        clamp01((waterP - i * 0.1) / 0.8),
        wc.col,
        rng,
        {
          lineWidth: 2.3 * unit,
          alpha: 0.8 - i * 0.08,
          jitterAmp: 0.55 * unit,
          density: "medium",
          passes: 1,
        }
      );
    }
  }

  // 2. Warm marigold wax-crayon "Water-Moon" (水月) nested poetically under the arch
  const moonP = easeOutCubic(clamp01((p - 0.12) / 0.54));
  if (moonP > 0.02) {
    const moonX = midX;
    const moonY = waterY - h * 0.014;
    const moonR = w * 0.034;

    drawCrayonDab(
      ctx,
      moonX,
      moonY,
      moonR * moonP,
      moonR * 0.92 * moonP,
      YANSHUI_PALETTE.marigold,
      0.92,
      rng,
      unit,
      "rich"
    );
    // Gentle wavy moon reflection shimmer on the water
    const moonWave = sampleWaveLine(
      moonX - moonR * 1.15,
      waterY + 7 * unit,
      moonR * 2.3,
      2.1 * unit,
      2.0,
      elapsedSec * 1.1,
      12
    );
    drawCrayonStroke(ctx, moonWave, moonP, YANSHUI_PALETTE.marigold, rng, {
      lineWidth: 2.2 * unit,
      alpha: 0.82,
      jitterAmp: 0.5 * unit,
      passes: 1,
    });
  }

  // 3. Curved Wax-Crayon 水月橋 Arch Span & Hand-Sketched Wooden Railings
  const archP = easeOutCubic(clamp01((p - 0.18) / 0.62));
  if (archP > 0.02) {
    const deckTop = sampleQuadCurve(
      leftX,
      waterY - 1 * unit,
      midX,
      archPeakY,
      rightX,
      waterY - 1 * unit,
      20
    );
    const deckBot = sampleQuadCurve(
      leftX + w * 0.022,
      waterY + 3.5 * unit,
      midX,
      archPeakY + h * 0.022,
      rightX - w * 0.022,
      waterY + 3.5 * unit,
      20
    );

    // Grainy brick-red wax-crayon arch body
    drawCrayonFilledPolygon(
      ctx,
      [...deckTop, ...deckBot.slice().reverse()],
      YANSHUI_PALETTE.brickRed,
      0.94 * archP,
      rng,
      unit,
      { density: "rich", rubAngleDeg: -6, edgeWidth: 2.0 }
    );

    // Warm vermilion/marigold top deck edge & cobalt arch underside shadow
    drawCrayonStroke(ctx, deckTop, archP, YANSHUI_PALETTE.marigold, rng, {
      lineWidth: 2.8 * unit,
      alpha: 0.94,
      jitterAmp: 0.55 * unit,
      passes: 2,
    });
    drawCrayonStroke(ctx, deckBot, archP, YANSHUI_PALETTE.cobalt, rng, {
      lineWidth: 2.3 * unit,
      alpha: 0.88,
      jitterAmp: 0.55 * unit,
      passes: 1,
    });

    // Curved bridge railing & vertical hand-drawn posts
    const railTop = sampleQuadCurve(
      leftX + w * 0.01,
      waterY - h * 0.022,
      midX,
      archPeakY - h * 0.022,
      rightX - w * 0.01,
      waterY - h * 0.022,
      18
    );
    drawCrayonStroke(
      ctx,
      railTop,
      clamp01((archP - 0.15) / 0.85),
      YANSHUI_PALETTE.barkBrown,
      rng,
      { lineWidth: 2.0 * unit, alpha: 0.9, jitterAmp: 0.5 * unit, passes: 1 }
    );

    const posts = 9;
    const postP = clamp01((archP - 0.22) / 0.78);
    for (let i = 1; i < posts; i++) {
      const f = i / posts;
      const dIdx = Math.min(deckTop.length - 1, Math.round(f * (deckTop.length - 1)));
      const rIdx = Math.min(railTop.length - 1, Math.round(f * (railTop.length - 1)));
      drawCrayonStroke(
        ctx,
        [deckTop[dIdx], railTop[rIdx]],
        postP,
        YANSHUI_PALETTE.barkBrown,
        rng,
        { lineWidth: 1.5 * unit, alpha: 0.86, jitterAmp: 0.35 * unit, passes: 1 }
      );
      if (i % 2 === 0 && postP > 0.55) {
        drawCrayonDab(
          ctx,
          railTop[rIdx].x,
          railTop[rIdx].y - 1.5 * unit,
          2.6 * unit,
          2.6 * unit,
          YANSHUI_PALETTE.marigold,
          0.95,
          rng,
          unit
        );
      }
    }
  }
}

// =============================================================================
// VIGNETTE 3 & 4: 鹽水蜂炮 (UPWARD-LAUNCHING WAX-CRAYON BEEHIVE FIREWORKS!)
// Launches strictly from LOWER ignition base -> rising UPWARD comet trails ->
// blooming crayon firework crown & upward-spraying sparks at the TOP!
// =============================================================================

function drawUpwardBeehiveFireworkCrayon(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  bloomX: number,
  bloomY: number,
  burstRadius: number,
  reveal: number,
  colors: readonly string[],
  rng: () => number,
  unit: number,
  elapsedSec: number
): void {
  const p = clamp01(reveal);
  if (p <= 0.01) return;

  // Phase 1 (0.0 -> 0.52): Rising upward launch trails from bottom base -> top bloom!
  const riseP = easeOutCubic(clamp01(p / 0.55));
  const midX = (baseX + bloomX) * 0.5 + (bloomX >= baseX ? -1 : 1) * burstRadius * 0.28;
  const midY = (baseY + bloomY) * 0.5;

  // Small lively beehive ignition puff at the BOTTOM launch origin
  drawCrayonDab(
    ctx,
    baseX,
    baseY,
    4.5 * unit * riseP,
    3.6 * unit * riseP,
    YANSHUI_PALETTE.vermilion,
    0.88,
    rng,
    unit
  );
  drawCrayonDab(
    ctx,
    baseX + (bloomX >= baseX ? 3 : -3) * unit,
    baseY - 3 * unit,
    3.2 * unit * riseP,
    3.2 * unit * riseP,
    YANSHUI_PALETTE.marigold,
    0.9,
    rng,
    unit
  );

  // 3 upward-fanning grainy wax-crayon rocket launch trails (strictly bottom -> UP!)
  const mainTrail = sampleQuadCurve(baseX, baseY, midX, midY, bloomX, bloomY, 14);
  const leftFanTrail = sampleQuadCurve(
    baseX,
    baseY,
    midX - burstRadius * 0.25,
    midY - burstRadius * 0.08,
    bloomX - burstRadius * 0.58,
    bloomY + burstRadius * 0.14,
    12
  );
  const rightFanTrail = sampleQuadCurve(
    baseX,
    baseY,
    midX + burstRadius * 0.22,
    midY - burstRadius * 0.05,
    bloomX + burstRadius * 0.52,
    bloomY + burstRadius * 0.18,
    12
  );

  drawCrayonStroke(ctx, mainTrail, riseP, colors[0] ?? YANSHUI_PALETTE.vermilion, rng, {
    lineWidth: 3.4 * unit,
    alpha: 0.92,
    jitterAmp: 0.85 * unit,
    density: "rich",
    passes: 2,
    brokenChance: 0.06,
  });
  drawCrayonStroke(
    ctx,
    leftFanTrail,
    clamp01((riseP - 0.12) / 0.88),
    colors[1] ?? YANSHUI_PALETTE.marigold,
    rng,
    {
      lineWidth: 2.4 * unit,
      alpha: 0.86,
      jitterAmp: 0.8 * unit,
      density: "rich",
      passes: 1,
      brokenChance: 0.1,
    }
  );
  drawCrayonStroke(
    ctx,
    rightFanTrail,
    clamp01((riseP - 0.18) / 0.82),
    colors[2] ?? YANSHUI_PALETTE.skyBlue,
    rng,
    {
      lineWidth: 2.3 * unit,
      alpha: 0.86,
      jitterAmp: 0.8 * unit,
      density: "rich",
      passes: 1,
      brokenChance: 0.1,
    }
  );

  // Phase 2 (0.35 -> 1.0): Blooming upward-arching wax-crayon firework crown at TOP!
  const bloomP = easeOutCubic(clamp01((p - 0.34) / 0.66));
  if (bloomP <= 0.02) return;

  const pulse = 1 + Math.sin(elapsedSec * 2.1) * 0.025;
  const R = burstRadius * pulse;

  // Radiating upward-biased wax-crayon firework sprays (mostly upper hemisphere [-170° .. -10°]
  // plus gentle side flares so the upward launch direction is 100% unmistakable!)
  const rayCount = 11;
  for (let i = 0; i < rayCount; i++) {
    const frac = i / (rayCount - 1);
    // Fan predominantly UPWARD from -195° through -90° (straight up) to +15°
    const ang = -Math.PI * 1.08 + frac * Math.PI * 1.16 + (rng() - 0.5) * 0.14;
    const rLen = R * (0.58 + (i % 3 === 0 ? 0.42 : 0.24) + rng() * 0.18);
    const col = colors[i % colors.length];

    const endX = bloomX + Math.cos(ang) * rLen;
    const endY = bloomY + Math.sin(ang) * rLen;
    // Graceful upward-vaulting arc (curving slightly upward before arching out!)
    const ctrlX = bloomX + Math.cos(ang) * rLen * 0.52;
    const ctrlY = bloomY + Math.sin(ang) * rLen * 0.58 - R * 0.14;

    const rayPts = sampleQuadCurve(bloomX, bloomY, ctrlX, ctrlY, endX, endY, 8);
    drawCrayonStroke(
      ctx,
      rayPts,
      clamp01((bloomP - (i % 4) * 0.06) / 0.75),
      col,
      rng,
      {
        lineWidth: (2.3 + (i % 3) * 0.75) * unit,
        alpha: 0.92,
        jitterAmp: 0.7 * unit,
        density: "rich",
        passes: i % 2 === 0 ? 2 : 1,
        brokenChance: 0.08,
      }
    );

    // Occasional little wax-crayon spark dot or 6-ray asterisk flying off the tip
    if (bloomP > 0.65 && i % 3 === 1) {
      const tipX = endX + Math.cos(ang) * 7 * unit;
      const tipY = endY + Math.sin(ang) * 7 * unit;
      drawCrayonSparkAsterisk(ctx, tipX, tipY, 4.4 * unit, col, rng, unit, 0.9);
    } else if (bloomP > 0.6 && i % 3 === 2) {
      drawCrayonDab(
        ctx,
        endX + Math.cos(ang) * 6 * unit,
        endY + Math.sin(ang) * 6 * unit,
        2.6 * unit,
        2.4 * unit,
        colors[(i + 2) % colors.length],
        0.88,
        rng,
        unit
      );
    }
  }

  // Playful upward curly wax-crayon smoke/spark loop floating above the burst (Ref 3!)
  if (bloomP > 0.45) {
    const loopP = clamp01((bloomP - 0.45) / 0.55);
    drawCrayonCurlyLoop(
      ctx,
      bloomX - R * 0.45,
      bloomY - R * 0.52,
      bloomX + R * 0.48,
      bloomY - R * 0.74,
      2.2,
      3.8 * unit,
      loopP,
      colors[3] ?? YANSHUI_PALETTE.coralPink,
      rng,
      unit,
      0.84,
      1.8
    );
  }

  // Warm grainy lemon-cream center dab at burst apex
  drawCrayonDab(
    ctx,
    bloomX,
    bloomY,
    4.8 * unit * bloomP,
    4.6 * unit * bloomP,
    YANSHUI_PALETTE.marigold,
    0.92,
    rng,
    unit
  );
}

// =============================================================================
// MAIN PERIMETER COMPOSITION: AIRY, BREATHABLE WAX-CRAYON VIGNETTES
// FULLY REVEALED AT 60% UNFOLD PROGRESS (`unfoldProgress >= 0.60`)!
// =============================================================================

/**
 * Draws the airy, hand-drawn grainy wax-crayon Yanshui illustrations
 * (`八角樓`, `水月橋`, and upward-launching `蜂炮`) onto the letter stationery.
 *
 * - Reaches 100% full reveal at `unfoldProgress = 0.60` (60%).
 * - Breathable spacing (not overcrowded / not full-bleed) keeping generous
 *   clean cream paper around the central blessing text, DATE, stamp, & title.
 */
export function drawYanshuiPerimeterMotifs(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  unfoldProgress: number,
  boilStep: number,
  elapsedSec: number,
  globalAlpha = 1
): void {
  const p = clamp01(unfoldProgress);
  if (p <= 0.01 || globalAlpha <= 0.01) return;

  // Map 2% -> 60% pull progress to [0 .. 1] so ALL illustrations are 100% complete at 60%!
  const revealAll = clamp01((p - 0.02) / 0.58);
  if (revealAll <= 0.005) return;

  const unit = Math.max(0.68, w / 460);
  activeGrainScale = Math.max(0.85, unit);
  const rng = createSeededRng(20261128 + (boilStep % 4) * 521);

  ctx.save();
  ctx.globalAlpha *= globalAlpha;

  // =========================================================================
  // 1. LOWER-LEFT / CENTER: 月津港水月橋 (Reveals early: 2% -> 46% pull)
  // =========================================================================
  const bridgeP = easeOutCubic(clamp01(revealAll / 0.76));
  if (bridgeP > 0.01) {
    drawShuiyueBridgeCrayon(ctx, w, h, bridgeP, rng, unit, elapsedSec);
  }

  // =========================================================================
  // 2. UPPER-RIGHT: 鹽水八角樓 + 蠟筆小樹 (Reveals smoothly: 10% -> 54% pull)
  // =========================================================================
  const archP = easeOutCubic(clamp01((revealAll - 0.14) / 0.76));
  if (archP > 0.01) {
    drawOctagonalBuildingCrayon(ctx, w, h, archP, rng, unit);
  }

  // =========================================================================
  // 3. UPPER-LEFT: UPWARD-LAUNCHING 鹽水蜂炮 + 彎月 + 蠟筆色塊 (16% -> 60% pull)
  // =========================================================================
  const leftFireworkP = easeOutCubic(clamp01((revealAll - 0.24) / 0.76));
  if (leftFireworkP > 0.01) {
    // Strictly UPWARD launch: bottom-left origin (0.14, 0.285) -> top bloom (0.215, 0.17)
    drawUpwardBeehiveFireworkCrayon(
      ctx,
      w * 0.135,
      h * 0.285,
      w * 0.215,
      h * 0.17,
      w * 0.092,
      leftFireworkP,
      [
        YANSHUI_PALETTE.vermilion,
        YANSHUI_PALETTE.marigold,
        YANSHUI_PALETTE.skyBlue,
        YANSHUI_PALETTE.coralPink,
        YANSHUI_PALETTE.leafGreen,
      ],
      rng,
      unit,
      elapsedSec
    );

    // Small charming ochre wax-crayon crescent moon floating cleanly above-left of center
    const moonP = clamp01((leftFireworkP - 0.18) / 0.82);
    if (moonP > 0.02) {
      const mx = w * 0.375;
      const my = h * 0.155;
      const mr = w * 0.032;
      const outerMoon: Pt2[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI * 0.36 + (i / 12) * Math.PI * 1.48;
        outerMoon.push({ x: mx + Math.cos(a) * mr, y: my + Math.sin(a) * mr });
      }
      const innerMoon: Pt2[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 1.12 - (i / 10) * Math.PI * 1.48;
        innerMoon.push({
          x: mx + mr * 0.42 + Math.cos(a) * (mr * 0.82),
          y: my - mr * 0.12 + Math.sin(a) * (mr * 0.82),
        });
      }
      drawCrayonFilledPolygon(
        ctx,
        [...outerMoon, ...innerMoon],
        YANSHUI_PALETTE.marigold,
        0.94 * moonP,
        rng,
        unit,
        { density: "rich", edgeWidth: 1.6 }
      );
    }
  }

  // =========================================================================
  // 4. LOWER-RIGHT: UPWARD-LAUNCHING 鹽水蜂炮 (Strictly launching UPWARD!)
  //    Ignition at lower-right (0.76, 0.895) -> sweeping UPWARD -> blooming at
  //    (0.835, 0.725) with sparks spraying UP into the open right sky!
  //    Reaches 100% completion right at 60% pull progress!
  // =========================================================================
  const rightFireworkP = easeOutCubic(clamp01((revealAll - 0.22) / 0.78));
  if (rightFireworkP > 0.01) {
    // Main right-side beehive firework launching UPWARD!
    drawUpwardBeehiveFireworkCrayon(
      ctx,
      w * 0.765,
      h * 0.895,
      w * 0.835,
      h * 0.725,
      w * 0.1,
      rightFireworkP,
      [
        YANSHUI_PALETTE.cobalt,
        YANSHUI_PALETTE.marigold,
        YANSHUI_PALETTE.vermilion,
        YANSHUI_PALETTE.coralPink,
        YANSHUI_PALETTE.mint,
        YANSHUI_PALETTE.lilac,
      ],
      rng,
      unit,
      elapsedSec + 1.3
    );

    // Companion smaller beehive rocket launching UPWARD beside it (0.69, 0.89 -> 0.73, 0.79)
    drawUpwardBeehiveFireworkCrayon(
      ctx,
      w * 0.685,
      h * 0.895,
      w * 0.725,
      h * 0.79,
      w * 0.056,
      clamp01((rightFireworkP - 0.16) / 0.84),
      [
        YANSHUI_PALETTE.vermilion,
        YANSHUI_PALETTE.lemon,
        YANSHUI_PALETTE.skyBlue,
        YANSHUI_PALETTE.coralPink,
      ],
      rng,
      unit,
      elapsedSec + 2.4
    );
  }

  ctx.restore();
}

// =============================================================================
// FULL-PAPER ORGANIC RUBBER-ERASER SWEEP (WIPES PRESET ART WHEN USER DRAWS)
// =============================================================================

export interface IllustrationEraserSample {
  x: number;
  y: number;
  diameter: number;
  isErasing: boolean;
}

/**
 * Computes a brisk, sweeping back-and-forth rubber-eraser trajectory covering
 * the full paper so preset crayon illustrations are scrubbed cleanly off the
 * stationery when the user clicks "開始創作" to start drawing.
 */
export function sampleIllustrationEraserSweep(
  progress: number,
  w: number,
  h: number
): IllustrationEraserSample {
  const p = clamp01(progress);
  const diameter = Math.max(w * 0.26, h * 0.17);

  const passes = [
    { x0: w * 0.02, y0: h * 0.13, x1: w * 0.98, y1: h * 0.16 },
    { x0: w * 0.98, y0: h * 0.25, x1: w * 0.02, y1: h * 0.29 },
    { x0: w * 0.02, y0: h * 0.4, x1: w * 0.98, y1: h * 0.44 },
    { x0: w * 0.98, y0: h * 0.55, x1: w * 0.02, y1: h * 0.59 },
    { x0: w * 0.02, y0: h * 0.7, x1: w * 0.98, y1: h * 0.74 },
    { x0: w * 0.98, y0: h * 0.82, x1: w * 0.02, y1: h * 0.85 },
    { x0: w * 0.02, y0: h * 0.93, x1: w * 0.98, y1: h * 0.91 },
  ];

  const scaled = p * passes.length;
  const idx = Math.min(passes.length - 1, Math.floor(scaled));
  const localT = easeInOutQuad(clamp01(scaled - idx));
  const seg = passes[idx];
  const waveY = Math.sin(localT * Math.PI * 2.5) * h * 0.018;

  return {
    x: seg.x0 + (seg.x1 - seg.x0) * localT,
    y: seg.y0 + (seg.y1 - seg.y0) * localT + waveY,
    diameter,
    isErasing: p > 0.002 && p < 0.998,
  };
}

// =============================================================================
// 60FPS CELEBRATORY 100%-OPEN UPWARD WAX-CRAYON BEEHIVE FIREWORK BURSTS
// Every comet launches strictly UPWARD around the central blessing text and
// renders in authentic grainy wax-crayon texture (no smooth digital gradients!).
// =============================================================================

interface FireworkCometTrail {
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  endX: number;
  endY: number;
  color: string;
  accent: string;
  delaySec: number;
  durationSec: number;
  burstFired: boolean;
  trailPts: Array<{ x: number; y: number; age: number }>;
}

interface CrayonBurstRay {
  cx: number;
  cy: number;
  angle: number;
  maxLen: number;
  thick: number;
  color: string;
  age: number;
  life: number;
  seed: number;
}

interface DriftingCrayonFleck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotSpeed: number;
  len: number;
  thick: number;
  color: string;
  kind: "dash" | "asterisk" | "dot";
  age: number;
  life: number;
  swayPhase: number;
  swayFreq: number;
  seed: number;
}

export class YanshuiCelebrationSystem {
  private comets: FireworkCometTrail[] = [];
  private burstRays: CrayonBurstRay[] = [];
  private flecks: DriftingCrayonFleck[] = [];
  private elapsedSec = 0;
  private active = false;

  /**
   * Triggers 3 joyful, strictly UPWARD-launching wax-crayon Beehive Firework
   * trails curving cleanly around the central text right when the paper hits 100%.
   */
  public trigger(w: number, h: number): void {
    this.comets = [];
    this.burstRays = [];
    this.flecks = [];
    this.elapsedSec = 0;
    this.active = true;

    this.comets = [
      {
        // Left rocket: shoots UPWARD along left edge from lower-left -> upper-left sky
        startX: w * 0.14,
        startY: h * 0.78,
        ctrlX: w * 0.05,
        ctrlY: h * 0.46,
        endX: w * 0.22,
        endY: h * 0.17,
        color: YANSHUI_PALETTE.vermilion,
        accent: YANSHUI_PALETTE.marigold,
        delaySec: 0.06,
        durationSec: 0.92,
        burstFired: false,
        trailPts: [],
      },
      {
        // Right rocket #1: launches UPWARD from lower-right beehive base -> right-mid sky
        startX: w * 0.77,
        startY: h * 0.89,
        ctrlX: w * 0.88,
        ctrlY: h * 0.78,
        endX: w * 0.85,
        endY: h * 0.65,
        color: YANSHUI_PALETTE.cobalt,
        accent: YANSHUI_PALETTE.marigold,
        delaySec: 0.18,
        durationSec: 0.76,
        burstFired: false,
        trailPts: [],
      },
      {
        // Right rocket #2: launches UPWARD along outer-right margin -> upper-right sky
        startX: w * 0.8,
        startY: h * 0.88,
        ctrlX: w * 0.95,
        ctrlY: h * 0.56,
        endX: w * 0.87,
        endY: h * 0.34,
        color: YANSHUI_PALETTE.skyBlue,
        accent: YANSHUI_PALETTE.coralPink,
        delaySec: 0.34,
        durationSec: 0.96,
        burstFired: false,
        trailPts: [],
      },
    ];
  }

  public clear(): void {
    this.comets = [];
    this.burstRays = [];
    this.flecks = [];
    this.active = false;
  }

  public isRunning(): boolean {
    return (
      this.active &&
      (this.comets.length > 0 ||
        this.burstRays.length > 0 ||
        this.flecks.length > 0)
    );
  }

  private spawnCrayonBloom(
    cx: number,
    cy: number,
    primaryColor: string,
    accentColor: string,
    unit: number
  ): void {
    const crayonPool = [
      primaryColor,
      accentColor,
      YANSHUI_PALETTE.vermilion,
      YANSHUI_PALETTE.marigold,
      YANSHUI_PALETTE.skyBlue,
      YANSHUI_PALETTE.coralPink,
      YANSHUI_PALETTE.leafGreen,
      YANSHUI_PALETTE.lilac,
    ];

    // Upward-arch firework crayon rays
    const rayCount = 12;
    for (let i = 0; i < rayCount; i++) {
      const ang = (i / rayCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
      this.burstRays.push({
        cx,
        cy,
        angle: ang,
        maxLen: (22 + Math.random() * 32) * unit,
        thick: (2.2 + Math.random() * 1.8) * unit,
        color: crayonPool[i % crayonPool.length],
        age: 0,
        life: 1.05 + Math.random() * 0.5,
        seed: Math.floor(Math.random() * 9999),
      });
    }

    // Drifting grainy wax-crayon dashes, 6-ray asterisks & pigment dots
    const fleckCount = 14;
    for (let i = 0; i < fleckCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (18 + Math.random() * 38) * unit;
      const roll = Math.random();
      const kind: DriftingCrayonFleck["kind"] =
        roll < 0.52 ? "dash" : roll < 0.78 ? "asterisk" : "dot";
      this.flecks.push({
        x: cx + Math.cos(ang) * (4 + Math.random() * 12) * unit,
        y: cy + Math.sin(ang) * (4 + Math.random() * 12) * unit,
        vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 12 * unit,
        vy: Math.sin(ang) * spd * 0.75 - 10 * unit,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 1.4,
        len:
          kind === "dash"
            ? (8 + Math.random() * 8) * unit
            : kind === "asterisk"
              ? (4.8 + Math.random() * 3.5) * unit
              : (2.8 + Math.random() * 2.4) * unit,
        thick: (2.4 + Math.random() * 2.0) * unit,
        color: crayonPool[i % crayonPool.length],
        kind,
        age: 0,
        life: 2.0 + Math.random() * 1.6,
        swayPhase: Math.random() * Math.PI * 2,
        swayFreq: 1.3 + Math.random() * 1.4,
        seed: Math.floor(Math.random() * 9999),
      });
    }
  }

  public updateAndDraw(
    ctx: CanvasRenderingContext2D,
    dt: number,
    w: number,
    h: number
  ): void {
    if (!this.active) return;
    this.elapsedSec += dt;
    const unit = Math.max(0.7, w / 460);
    activeGrainScale = Math.max(0.85, unit);

    // -----------------------------------------------------------------------
    // A. Rising Upward Grainy Wax-Crayon Comet Trails
    // -----------------------------------------------------------------------
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      const localT = (this.elapsedSec - c.delaySec) / c.durationSec;

      for (let k = c.trailPts.length - 1; k >= 0; k--) {
        c.trailPts[k].age += dt;
        if (c.trailPts[k].age > 0.65) {
          c.trailPts.splice(k, 1);
        }
      }

      if (localT >= 0 && localT <= 1) {
        const u = easeInOutQuad(localT);
        const inv = 1 - u;
        const hx = inv * inv * c.startX + 2 * inv * u * c.ctrlX + u * u * c.endX;
        const hy = inv * inv * c.startY + 2 * inv * u * c.ctrlY + u * u * c.endY;

        c.trailPts.push({ x: hx, y: hy, age: 0 });

        // Drop tiny grainy crayon sparks along rising path
        if (Math.random() < dt * 12) {
          this.flecks.push({
            x: hx + (Math.random() - 0.5) * 7 * unit,
            y: hy + (Math.random() - 0.5) * 7 * unit,
            vx: (Math.random() - 0.5) * 16 * unit,
            vy: (3 + Math.random() * 10) * unit,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 1.2,
            len: (5 + Math.random() * 5) * unit,
            thick: (2.2 + Math.random() * 1.8) * unit,
            color: Math.random() < 0.55 ? c.color : c.accent,
            kind: Math.random() < 0.6 ? "dash" : "dot",
            age: 0,
            life: 1.1 + Math.random() * 0.9,
            swayPhase: Math.random() * Math.PI * 2,
            swayFreq: 1.4 + Math.random(),
            seed: Math.floor(Math.random() * 9999),
          });
        }

        const headRng = createSeededRng(3301 + i * 97);
        drawCrayonDab(
          ctx,
          hx,
          hy,
          5.2 * unit,
          5.2 * unit,
          c.accent,
          0.92,
          headRng,
          unit
        );
      }

      if (localT >= 1 && !c.burstFired) {
        c.burstFired = true;
        this.spawnCrayonBloom(c.endX, c.endY, c.color, c.accent, unit);
      }

      if (c.trailPts.length >= 2) {
        const priPat = getCrayonStyle(ctx, c.color, "rich", 0, 0);
        const accPat = getCrayonStyle(ctx, c.accent, "medium", 18, 12);
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let k = 1; k < c.trailPts.length; k++) {
          const prev = c.trailPts[k - 1];
          const curr = c.trailPts[k];
          const lifeFrac = clamp01(1 - curr.age / 0.65);
          if (lifeFrac <= 0.02) continue;

          ctx.globalAlpha = lifeFrac * 0.84;
          ctx.strokeStyle = priPat;
          ctx.lineWidth = (4.6 * lifeFrac + 1.2) * unit;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.stroke();

          ctx.globalAlpha = lifeFrac * 0.9;
          ctx.strokeStyle = accPat;
          ctx.lineWidth = (2.1 * lifeFrac + 0.6) * unit;
          ctx.beginPath();
          ctx.moveTo(prev.x + 1.2 * unit, prev.y);
          ctx.lineTo(curr.x + 1.2 * unit, curr.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (c.burstFired && c.trailPts.length === 0) {
        this.comets.splice(i, 1);
      }
    }

    // -----------------------------------------------------------------------
    // B. Grainy Wax-Crayon Burst Rays
    // -----------------------------------------------------------------------
    for (let i = this.burstRays.length - 1; i >= 0; i--) {
      const ray = this.burstRays[i];
      ray.age += dt;
      if (ray.age >= ray.life) {
        this.burstRays.splice(i, 1);
        continue;
      }

      const t = ray.age / ray.life;
      const expand = easeOutCubic(clamp01(t / 0.44));
      const fade = t > 0.45 ? 1 - (t - 0.45) / 0.55 : 1;
      const innerR = (4 + expand * 10) * unit;
      const outerR = innerR + ray.maxLen * expand;

      const x0 = ray.cx + Math.cos(ray.angle) * innerR;
      const y0 = ray.cy + Math.sin(ray.angle) * innerR;
      const x1 = ray.cx + Math.cos(ray.angle) * outerR;
      const y1 = ray.cy + Math.sin(ray.angle) * outerR + expand * expand * 4 * unit;

      const rayRng = createSeededRng(ray.seed);
      const pts = sampleQuadCurve(
        x0,
        y0,
        (x0 + x1) * 0.5,
        (y0 + y1) * 0.5 - 3.5 * unit,
        x1,
        y1,
        6
      );
      drawCrayonStroke(ctx, pts, 1, ray.color, rayRng, {
        lineWidth: ray.thick,
        alpha: 0.92 * fade,
        jitterAmp: 0.65 * unit,
        density: "rich",
        passes: 1,
        brokenChance: 0.1,
      });
    }

    // -----------------------------------------------------------------------
    // C. Drifting Wax-Crayon Dashes, 6-Point Asterisks & Dots
    // -----------------------------------------------------------------------
    for (let i = this.flecks.length - 1; i >= 0; i--) {
      const pt = this.flecks[i];
      pt.age += dt;
      if (pt.age >= pt.life) {
        this.flecks.splice(i, 1);
        continue;
      }

      const dragPow = Math.pow(0.968, dt * 60);
      pt.vx *= dragPow;
      pt.vy = pt.vy * dragPow + 9.5 * unit * dt;
      const breeze =
        Math.sin(pt.age * pt.swayFreq + pt.swayPhase) * 14 * unit * dt;
      pt.x += pt.vx * dt + breeze;
      pt.y += pt.vy * dt;
      pt.rot += pt.rotSpeed * dt;

      const t = pt.age / pt.life;
      const envIn = clamp01(t / 0.12);
      const envOut = t > 0.54 ? 1 - (t - 0.54) / 0.46 : 1;
      const alpha = envIn * envOut;
      if (alpha <= 0.015) continue;

      const fRng = createSeededRng(pt.seed);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rot);

      if (pt.kind === "dash") {
        drawCrayonStroke(
          ctx,
          [
            { x: -pt.len * 0.5, y: 0 },
            { x: pt.len * 0.5, y: 0 },
          ],
          1,
          pt.color,
          fRng,
          {
            lineWidth: pt.thick,
            alpha: alpha * 0.92,
            jitterAmp: 0.5 * unit,
            density: "rich",
            passes: 1,
          }
        );
      } else if (pt.kind === "asterisk") {
        drawCrayonSparkAsterisk(ctx, 0, 0, pt.len, pt.color, fRng, unit, alpha * 0.92);
      } else {
        drawCrayonDab(
          ctx,
          0,
          0,
          pt.len * 0.55,
          pt.thick * 0.55,
          pt.color,
          alpha * 0.9,
          fRng,
          unit
        );
      }

      ctx.restore();
    }

    if (!this.isRunning()) {
      this.active = false;
    }
  }
}
