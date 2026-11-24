import { createSeededRng, drawSketchyLine } from "@/lib/hand-drawn-utils";

export const LETTER_TEX_W = 1200;
export const LETTER_TEX_H = 1740;
export const FIRST_CREASE_Y = LETTER_TEX_H / 3; // 580
export const SECOND_CREASE_Y = (LETTER_TEX_H * 2) / 3; // 1160

export interface IntroEraserCursorState {
  /** Normalized paper X coordinate [0..1] */
  u: number;
  /** Normalized paper Y coordinate [0..1] */
  v: number;
  /** Eraser diameter normalized to paper width [0..1] */
  diameterNorm: number;
  /** Opacity [0..1] for smooth fade-in / lift / fade-out */
  opacity: number;
  /** True while actively rubbing/erasing the paper */
  isErasing: boolean;
  /** Subtle stop-motion per-frame rotation in degrees */
  tiltDeg?: number;
  /** Whether the cursor overlay should be rendered */
  visible: boolean;
}

export interface EraserTrajectorySample {
  texX: number;
  texY: number;
  diameterTex: number;
  opacity: number;
  isErasing: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Resolves the active computed Sans/Mono font family from the document so Next.js
 * `next/font/google` hashed `@font-face` names render accurately inside Canvas 2D.
 */
export function resolveDocumentFontFamilies(): { sans: string; mono: string } {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      sans: '"Noto Sans TC", -apple-system, BlinkMacSystemFont, sans-serif',
      mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
    };
  }
  const bodyFont = window.getComputedStyle(document.body).fontFamily;
  const rootStyle = window.getComputedStyle(document.documentElement);
  const notoVar = rootStyle.getPropertyValue("--font-noto-sans-tc").trim();
  const monoVar = rootStyle.getPropertyValue("--font-ibm-plex-mono").trim();

  const sans = notoVar
    ? `${notoVar}, "Noto Sans TC", -apple-system, sans-serif`
    : bodyFont || '"Noto Sans TC", -apple-system, sans-serif';
  const mono = monoVar
    ? `${monoVar}, "IBM Plex Mono", ui-monospace, monospace`
    : '"IBM Plex Mono", ui-monospace, monospace';

  return { sans, mono };
}

/**
 * Deterministic cotton-paper tooth field [0..1] matching `lib/crayon-brush.ts`
 * so the intro paper text feels physically written on the same washi/cotton paper.
 */
function cottonPaperTooth(x: number, y: number, scale = 0.65): number {
  const gx = Math.floor(x * scale);
  const gy = Math.floor(y * scale);
  let h = (gx * 374761393 + gy * 668265263) ^ (gx * gy);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const hashNoise = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  const weave =
    0.5 +
    0.25 * Math.sin(x * 0.48 + y * 0.12) +
    0.25 * Math.cos(y * 0.52 - x * 0.11);
  return 0.4 * weave + 0.6 * hashNoise;
}

/**
 * Draws a centered line of characters with organic hand-written micro-jitter
 * (subtle baseline wave, tiny tilt, and bespoke character tracking) onto a mask canvas.
 */
export function drawHandJitteredTextMask(
  maskCtx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  font: string,
  letterSpacing: number,
  rng: () => number,
  opts: {
    yJitter: number;
    angleJitter: number;
    scaleJitter: number;
    strokeBoost?: number;
  }
): { minX: number; minY: number; maxX: number; maxY: number } {
  const chars = Array.from(text);
  maskCtx.save();
  maskCtx.font = font;
  maskCtx.textAlign = "center";
  maskCtx.textBaseline = "middle";
  maskCtx.fillStyle = "#000000";
  maskCtx.strokeStyle = "#000000";
  maskCtx.lineJoin = "round";
  maskCtx.lineCap = "round";

  const widths = chars.map((ch) => maskCtx.measureText(ch).width);
  const rawTotalW =
    widths.reduce((acc, w) => acc + w, 0) +
    Math.max(0, chars.length - 1) * letterSpacing;
  // Optical centering compensation for trailing full-width CJK punctuation (， / 。)
  // whose glyph occupies the left half of the em-box.
  const lastChar = chars[chars.length - 1];
  const trailingPunctTrim =
    lastChar === "，" || lastChar === "。"
      ? (widths[widths.length - 1] ?? 0) * 0.42
      : 0;
  const visualTotalW = rawTotalW - trailingPunctTrim;

  let cursorX = centerX - visualTotalW * 0.5;
  const minX = Math.max(0, Math.floor(cursorX - 28));
  const maxX = Math.min(maskCtx.canvas.width, Math.ceil(cursorX + rawTotalW + 28));
  const minY = Math.max(0, Math.floor(centerY - 56));
  const maxY = Math.min(maskCtx.canvas.height, Math.ceil(centerY + 56));

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cw = widths[i];
    const gx = cursorX + cw * 0.5;
    // Gentle organic hand-written baseline curve + subtle per-glyph variation
    const waveY = Math.sin(i * 0.72 + 0.4) * (opts.yJitter * 0.55);
    const gy = centerY + waveY + (rng() - 0.5) * 2 * opts.yJitter;
    const rot = (rng() - 0.5) * 2 * opts.angleJitter;
    const sc = 1 + (rng() - 0.5) * 2 * opts.scaleJitter;

    maskCtx.save();
    maskCtx.translate(gx, gy);
    maskCtx.rotate(rot);
    maskCtx.scale(sc, sc);
    if (opts.strokeBoost && opts.strokeBoost > 0) {
      maskCtx.lineWidth = opts.strokeBoost;
      maskCtx.strokeText(ch, 0, 0);
    }
    maskCtx.fillText(ch, 0, 0);
    maskCtx.restore();

    cursorX += cw + letterSpacing;
  }

  maskCtx.restore();
  return { minX, minY, maxX, maxY };
}

/**
 * Transfers an alpha mask onto `targetCtx` as authentic fine-graphite pencil strokes
 * (consistent with `DATE // 2026.11.23` on the cotton stationery).
 */
export function transferFinePencilTexture(
  targetCtx: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  rgb: { r: number; g: number; b: number },
  rng: () => number
): void {
  const mCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!mCtx) return;

  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const maskData = mCtx.getImageData(bounds.minX, bounds.minY, bw, bh).data;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = bw;
  outCanvas.height = bh;
  const oCtx = outCanvas.getContext("2d");
  if (!oCtx) return;
  const outImg = oCtx.createImageData(bw, bh);
  const out = outImg.data;

  for (let ly = 0; ly < bh; ly++) {
    const wy = bounds.minY + ly;
    for (let lx = 0; lx < bw; lx++) {
      const wx = bounds.minX + lx;
      const idx = (ly * bw + lx) * 4;
      const ma = maskData[idx + 3] / 255;
      if (ma < 0.04) continue;

      const tooth = cottonPaperTooth(wx, wy, 0.85);
      const fineGrain = 0.62 + tooth * 0.48 + (rng() - 0.5) * 0.24;
      // Leave tiny micro paper-fiber skips on thin edges for authentic graphite lead feel
      if (tooth < 0.22 && ma < 0.65 && rng() < 0.52) continue;

      const alpha = clamp01(ma * fineGrain * 0.92);
      out[idx] = rgb.r;
      out[idx + 1] = rgb.g;
      out[idx + 2] = rgb.b;
      out[idx + 3] = Math.round(alpha * 255);
    }
  }

  oCtx.putImageData(outImg, 0, 0);
  targetCtx.drawImage(outCanvas, bounds.minX, bounds.minY);

  // Subtle second dry-pencil over-sketch pass shifted slightly for tactile graphite richness
  targetCtx.save();
  targetCtx.globalAlpha = 0.24;
  targetCtx.drawImage(outCanvas, bounds.minX + 0.8, bounds.minY + 0.5);
  targetCtx.restore();
}

/**
 * Transfers an alpha mask onto `targetCtx` as tactile wax-crayon hand-lettering:
 * cotton paper tooth modulation, dry wax gaps, and rough outer wax micro-flakes
 * echoing the built-in crayon brush in `lib/crayon-brush.ts` / `lib/procedural-brushes.ts`.
 */
function transferWaxCrayonTexture(
  targetCtx: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  rgb: { r: number; g: number; b: number },
  rng: () => number
): void {
  const mCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!mCtx) return;

  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const maskData = mCtx.getImageData(bounds.minX, bounds.minY, bw, bh).data;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = bw;
  outCanvas.height = bh;
  const oCtx = outCanvas.getContext("2d");
  if (!oCtx) return;
  const outImg = oCtx.createImageData(bw, bh);
  const out = outImg.data;

  // Collect edge coordinates to scatter dry wax flakes around stroke perimeters
  const edgePoints: Array<{ x: number; y: number }> = [];

  for (let ly = 0; ly < bh; ly++) {
    const wy = bounds.minY + ly;
    for (let lx = 0; lx < bw; lx++) {
      const wx = bounds.minX + lx;
      const idx = (ly * bw + lx) * 4;
      const ma = maskData[idx + 3] / 255;
      if (ma < 0.05) continue;

      const tooth = cottonPaperTooth(wx, wy, 0.52);
      const coarseTooth = cottonPaperTooth(wx + 41, wy - 19, 0.26);
      const combinedTooth = tooth * 0.65 + coarseTooth * 0.35;

      // Dry-wax paper valley skips (stronger near edges, subtle inside core so CJK remains crisp)
      const valleyThreshold = ma > 0.78 ? 0.23 : 0.34;
      if (combinedTooth < valleyThreshold) continue;

      if (ma > 0.18 && ma < 0.86 && rng() < 0.22) {
        edgePoints.push({ x: wx, y: wy });
      }

      // Wax pressure modulation along diagonal crayon rub direction
      const waxStreak = 0.84 + 0.16 * Math.sin(wx * 0.14 - wy * 0.22);
      const alpha = clamp01(
        ma * (0.58 + combinedTooth * 0.54) * waxStreak * (0.86 + rng() * 0.18)
      );

      // Slight warm charcoal pigment variation per wax grain
      const shade = Math.round((rng() - 0.5) * 14);
      out[idx] = Math.max(0, Math.min(255, rgb.r + shade));
      out[idx + 1] = Math.max(0, Math.min(255, rgb.g + shade));
      out[idx + 2] = Math.max(0, Math.min(255, rgb.b + shade));
      out[idx + 3] = Math.round(alpha * 255);
    }
  }

  oCtx.putImageData(outImg, 0, 0);
  targetCtx.drawImage(outCanvas, bounds.minX, bounds.minY);

  // Subtle double-pressed dry wax offset pass for lush crayon body
  targetCtx.save();
  targetCtx.globalAlpha = 0.28;
  targetCtx.drawImage(outCanvas, bounds.minX + 1.35, bounds.minY - 0.85);
  targetCtx.restore();

  // Scatter rough wax-crayon micro-grains along stroke borders
  targetCtx.save();
  const tiltRad = (-28 * Math.PI) / 180;
  for (let i = 0; i < edgePoints.length; i++) {
    const pt = edgePoints[i];
    const px = pt.x + (rng() - 0.5) * 4.4;
    const py = pt.y + (rng() - 0.5) * 4.4;
    const tooth = cottonPaperTooth(px, py, 0.58);
    if (tooth < 0.36) continue;

    const fw = 1.0 + rng() * 2.1;
    const fh = fw * (0.52 + rng() * 0.72);
    const alpha = (0.18 + rng() * 0.34) * tooth;
    targetCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`;
    targetCtx.beginPath();
    targetCtx.ellipse(
      px,
      py,
      fw * 0.5,
      fh * 0.5,
      tiltRad + (rng() - 0.5) * 0.8,
      0,
      Math.PI * 2
    );
    targetCtx.fill();
  }
  targetCtx.restore();
}

/**
 * Renders the two inner-fold opening texts onto the dedicated 1200x1740 transparent
 * intro decal canvas, strictly bound to the 3D Z-Fold letter panels:
 *
 * 1) Upper panel bottom edge (right above the first horizontal crease at y = 580):
 *    `漫月美行動 2026` — fine graphite pencil texture matching `DATE // 2026.11.23`.
 *    Hidden behind the folded front panel at 00% and revealed FIRST when pulling down.
 *
 * 2) Middle panel exact vertical & horizontal center (y ∈ [580, 1160], center y = 870):
 *    `將鹽水的片刻與祝福，`
 *    `製成一則會發光的信。`
 *    — rough tactile wax-crayon texture echoing the drawing toolbar's crayon brush.
 */
export function renderIntroPaperDecalCanvas(
  canvas: HTMLCanvasElement
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const { sans, mono } = resolveDocumentFontFamilies();
  const rng = createSeededRng(20260215);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return;

  const cx = w * 0.5;

  // =========================================================================
  // 1. UPPER PANEL BOTTOM EDGE: "漫月美行動 2026" (Fine Graphite Pencil)
  //    First crease sits at y = 580; center text around y = 540 so it hugs
  //    tightly above the crease and emerges FIRST during downward pull!
  // =========================================================================
  const topLabelY = Math.round(FIRST_CREASE_Y - 40); // y = 540
  maskCtx.clearRect(0, 0, w, h);

  const topFont = `400 25px ${sans}, ${mono}`;
  const topBounds = drawHandJitteredTextMask(
    maskCtx,
    "漫月美行動 2026",
    cx,
    topLabelY,
    topFont,
    5.5,
    rng,
    {
      yJitter: 0.65,
      angleJitter: 0.011,
      scaleJitter: 0.014,
      strokeBoost: 0.35,
    }
  );
  transferFinePencilTexture(
    ctx,
    maskCanvas,
    topBounds,
    { r: 108, g: 107, b: 102 }, // Warm graphite matching DATE // 2026.11.23
    rng
  );

  // Delicate hand-ruled fine pencil hairline right under "漫月美行動 2026"
  drawSketchyLine(ctx, cx - 128, topLabelY + 20, cx + 128, topLabelY + 20, rng, {
    stepPx: 14,
    jitterAmp: 0.72,
    lineWidth: 1.25,
    strokeStyle: "rgba(34, 34, 34, 0.18)",
    overshoot: 3,
  });

  // =========================================================================
  // 2. MIDDLE PANEL CENTER: Two-line Wax Crayon Slogan
  //    Middle panel spans y ∈ [580, 1160], exact vertical center = 870.
  // =========================================================================
  const midCenterY = Math.round((FIRST_CREASE_Y + SECOND_CREASE_Y) * 0.5); // 870
  const sloganLines = ["將鹽水的片刻與祝福，", "製成一則會發光的信。"];
  const lineOffsetY = 44;
  const sloganFont = `500 48px ${sans}`;

  for (let i = 0; i < sloganLines.length; i++) {
    const lineY = midCenterY + (i === 0 ? -lineOffsetY : lineOffsetY);
    maskCtx.clearRect(0, 0, w, h);
    const bounds = drawHandJitteredTextMask(
      maskCtx,
      sloganLines[i],
      cx,
      lineY,
      sloganFont,
      11,
      rng,
      {
        yJitter: 1.85,
        angleJitter: 0.022,
        scaleJitter: 0.022,
        strokeBoost: 1.35,
      }
    );
    transferWaxCrayonTexture(
      ctx,
      maskCanvas,
      bounds,
      { r: 42, g: 41, b: 38 }, // Deep warm charcoal wax crayon (#2A2926)
      rng
    );
  }
}

/**
 * Samples the realistic back-and-forth rubber-eraser trajectory across both
 * paper decal regions over normalized animation progress `p ∈ [0..1]` (~1.2s):
 *
 *  - [0.00..0.04]: Eraser head fades in at left of `漫月美行動 2026`
 *  - [0.04..0.34]: Two swift horizontal back-and-forth rubs erasing `漫月美行動 2026`
 *  - [0.34..0.42]: Brief lifted glide down to top-left of the Slogan
 *  - [0.42..0.95]: Four rhythmic back-and-forth diagonal-wave passes erasing the 2-line Slogan
 *  - [0.95..1.00]: Smooth fade-out lift off paper
 */
export function sampleIntroEraserTrajectory(p: number): EraserTrajectorySample {
  const t = clamp01(p);

  const topLeftX = 430;
  const topRightX = 770;
  const topY1 = 532;
  const topY2 = 556;

  const midLeftX = 275;
  const midRightX = 925;
  const midY1 = 806;
  const midY2 = 846;
  const midY3 = 892;
  const midY4 = 932;

  // Entry fade-in
  if (t < 0.04) {
    const u = easeOutCubic(t / 0.04);
    return {
      texX: topLeftX - (1 - u) * 28,
      texY: topY1 - (1 - u) * 14,
      diameterTex: 74,
      opacity: u,
      isErasing: false,
    };
  }

  // Pass A1: Left -> Right over "漫月美行動 2026"
  if (t < 0.19) {
    const u = easeInOutQuad((t - 0.04) / 0.15);
    return {
      texX: topLeftX + (topRightX - topLeftX) * u,
      texY: topY1 + Math.sin(u * Math.PI * 3) * 5,
      diameterTex: 76,
      opacity: 1,
      isErasing: true,
    };
  }

  // Pass A2: Right -> Left over lower edge + graphite underline of "漫月美行動 2026"
  if (t < 0.34) {
    const u = easeInOutQuad((t - 0.19) / 0.15);
    return {
      texX: topRightX - (topRightX - topLeftX) * u,
      texY: topY2 + Math.sin(u * Math.PI * 3) * 5,
      diameterTex: 78,
      opacity: 1,
      isErasing: true,
    };
  }

  // Travel arc: lift gently & glide down to Slogan top-left
  if (t < 0.42) {
    const u = easeInOutQuad((t - 0.34) / 0.08);
    const arcX = topLeftX + (midLeftX - topLeftX) * u - Math.sin(u * Math.PI) * 32;
    const arcY = topY2 + (midY1 - topY2) * u;
    return {
      texX: arcX,
      texY: arcY,
      diameterTex: 78 + (96 - 78) * u,
      opacity: 0.55 + 0.45 * Math.abs(u - 0.5) * 2,
      isErasing: false,
    };
  }

  // Pass B1: Left -> Right across upper Line 1 of Slogan
  if (t < 0.555) {
    const u = easeInOutQuad((t - 0.42) / 0.135);
    return {
      texX: midLeftX + (midRightX - midLeftX) * u,
      texY: midY1 + Math.sin(u * Math.PI * 4) * 7,
      diameterTex: 96,
      opacity: 1,
      isErasing: true,
    };
  }

  // Pass B2: Right -> Left across lower Line 1 / middle gap
  if (t < 0.69) {
    const u = easeInOutQuad((t - 0.555) / 0.135);
    return {
      texX: midRightX - (midRightX - midLeftX) * u,
      texY: midY2 + Math.sin(u * Math.PI * 4) * 7,
      diameterTex: 100,
      opacity: 1,
      isErasing: true,
    };
  }

  // Pass B3: Left -> Right across Line 2 of Slogan
  if (t < 0.825) {
    const u = easeInOutQuad((t - 0.69) / 0.135);
    return {
      texX: midLeftX + (midRightX - midLeftX) * u,
      texY: midY3 + Math.sin(u * Math.PI * 4) * 7,
      diameterTex: 102,
      opacity: 1,
      isErasing: true,
    };
  }

  // Pass B4: Right -> Left finishing rub across bottom of Line 2
  if (t < 0.955) {
    const u = easeInOutQuad((t - 0.825) / 0.13);
    return {
      texX: midRightX - (midRightX - midLeftX) * u,
      texY: midY4 + Math.sin(u * Math.PI * 3.5) * 6,
      diameterTex: 104,
      opacity: 1,
      isErasing: true,
    };
  }

  // Lift & fade out smoothly
  const u = clamp01((t - 0.955) / 0.045);
  return {
    texX: midLeftX - u * 26,
    texY: midY4 + u * 12,
    diameterTex: 98,
    opacity: 1 - easeOutCubic(u),
    isErasing: false,
  };
}

/**
 * Erases along a hand-rubbed segment on the intro decal canvas using `destination-out`,
 * adding subtle dry-rubber perimeter speckles so the erasing trail feels tactile and organic
 * (matching the built-in canvas eraser tool).
 */
export function eraseIntroDecalSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  diameter: number,
  stepSeed: number
): void {
  const radius = diameter * 0.5;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const stepSize = Math.max(4, radius * 0.26);
  const steps = Math.max(1, Math.ceil(dist / stepSize));
  const rng = createSeededRng(stepSeed);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";

  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const ix = x0 + dx * f + (rng() - 0.5) * 2.2;
    const iy = y0 + dy * f + (rng() - 0.5) * 2.2;

    // Main rubber eraser body
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.beginPath();
    ctx.arc(ix, iy, radius * (0.94 + rng() * 0.1), 0, Math.PI * 2);
    ctx.fill();

    // Subtle organic dry-rub feathered grains along trailing rim
    for (let g = 0; g < 6; g++) {
      const ang = rng() * Math.PI * 2;
      const r = radius * (0.88 + rng() * 0.28);
      const gx = ix + Math.cos(ang) * r;
      const gy = iy + Math.sin(ang) * r;
      const gr = 3 + rng() * 5.5;
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.45 + rng() * 0.5).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
