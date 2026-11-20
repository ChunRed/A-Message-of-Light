import {
  createSeededRng,
  drawHandDrawnPostageStamp,
  drawSketchyLine,
  drawSketchyRect,
  drawWashiPaperTexture,
} from "@/lib/hand-drawn-utils";

export interface CrayonColor {
  id: string;
  name: string;
  hex: string;
}

export const CRAYON_COLORS: CrayonColor[] = [
  { id: "charcoal", name: "炭墨黑", hex: "#222222" },
  { id: "warm-gray", name: "暖石炭", hex: "#6E6D6A" },
  { id: "umber", name: "焦糖褐", hex: "#8F654D" },
  { id: "terracotta", name: "暖陶紅", hex: "#C86D51" },
  { id: "blush", name: "柔粉橘", hex: "#D98A7C" },
  { id: "dusty-rose", name: "枯玫瑰", hex: "#B87A88" },
  { id: "mustard", name: "芥末黃", hex: "#D4A84B" },
  { id: "olive", name: "橄欖綠", hex: "#8A9A5B" },
  { id: "sage", name: "鼠尾草綠", hex: "#6E8B74" },
  { id: "slate", name: "霧灰藍", hex: "#5B7A8C" },
  { id: "mauve", name: "暮紫灰", hex: "#7D6E83" },
];

export interface SizeOption {
  id: string;
  label: string;
  brushRadius: number;
  eraserDiameter: number;
  dotPx: number;
}

export const SIZE_OPTIONS: SizeOption[] = [
  { id: "xs", label: "細", brushRadius: 3.2, eraserDiameter: 16, dotPx: 4 },
  { id: "sm", label: "中", brushRadius: 5.8, eraserDiameter: 26, dotPx: 7 },
  { id: "md", label: "粗", brushRadius: 9.2, eraserDiameter: 40, dotPx: 10 },
  { id: "lg", label: "厚", brushRadius: 13.5, eraserDiameter: 58, dotPx: 13 },
];

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

/**
 * Parses a #RRGGBB hex string into RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Deterministic cotton-paper tooth texture [0..1] at coordinate (x, y).
 * Simulates microscopic peaks and valleys in paper fibers so crayon pigment
 * catches organically and leaves delicate tactile grain.
 */
function paperTooth(x: number, y: number): number {
  const gx = Math.floor(x * 0.85);
  const gy = Math.floor(y * 0.85);
  // Fast deterministic hash for fine paper fiber noise
  let h = (gx * 374761393 + gy * 668265263) ^ (gx * gy);
  h = (h ^ (h >> 13)) * 1274126177;
  const hashNoise = ((h ^ (h >> 16)) >>> 0) / 4294967295;

  // Gentle woven cotton directional grain
  const weave =
    0.5 +
    0.25 * Math.sin(x * 0.72 + y * 0.14) +
    0.25 * Math.cos(y * 0.78 - x * 0.12);

  return 0.42 * weave + 0.58 * hashNoise;
}

/**
 * Stamps a single procedural wax-crayon footprint at (cx, cy).
 * Scatters irregular micro-grains modulated by paper fiber tooth & jitter.
 */
export function stampCrayonDab(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  colorHex: string,
  pressure = 0.5
): void {
  const { r, g, b } = hexToRgb(colorHex);
  const pFactor = 0.78 + Math.min(1, Math.max(0.15, pressure)) * 0.42;
  const effectiveR = radius * pFactor;

  // Number of wax micro-particles scales with brush footprint area
  const grainCount = Math.round(
    Math.min(62, Math.max(16, effectiveR * 4.4))
  );

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  for (let i = 0; i < grainCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Slightly biased toward center with frayed rough outer edge
    const radialBias = Math.pow(Math.random(), 0.74);
    const dist = radialBias * effectiveR;

    // Micro jitter to break any geometric uniformity
    const jitterX = (Math.random() - 0.5) * 1.35;
    const jitterY = (Math.random() - 0.5) * 1.35;
    const px = cx + Math.cos(angle) * dist + jitterX;
    const py = cy + Math.sin(angle) * dist + jitterY;

    // Paper fiber catch probability: valleys skip pigment for authentic dry crayon texture
    const tooth = paperTooth(px, py);
    const edgeFalloff = 1 - radialBias * 0.72;
    if (tooth * edgeFalloff < 0.19) continue;

    // Irregular wax flake size & slight rotation
    const flakeW = 0.7 + Math.random() * Math.min(2.3, 0.9 + effectiveR * 0.13);
    const flakeH = flakeW * (0.55 + Math.random() * 0.85);
    const alpha = Math.min(
      0.62,
      (0.1 + Math.random() * 0.34) * edgeFalloff * (0.65 + tooth * 0.55)
    );

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      px,
      py,
      flakeW * 0.5,
      flakeH * 0.5,
      Math.random() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Interpolates along the path from `from` to `to` and deposits procedural crayon wax grains.
 * Strictly avoids smooth vector `lineTo()` strokes.
 */
export function drawCrayonSegment(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  radius: number,
  colorHex: string
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);

  const stepSize = Math.max(1.25, radius * 0.23);
  const steps = Math.max(1, Math.ceil(dist / stepSize));

  const p0 = from.pressure ?? 0.5;
  const p1 = to.pressure ?? 0.5;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ix = from.x + dx * t;
    const iy = from.y + dy * t;
    const ip = p0 + (p1 - p0) * t;
    stampCrayonDab(ctx, ix, iy, radius, colorHex, ip);
  }
}

/**
 * Cleanly erases only the transparent drawing layer using `destination-out` interpolation.
 */
export function drawEraserSegment(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  diameter: number
): void {
  const radius = diameter * 0.5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const stepSize = Math.max(2, radius * 0.28);
  const steps = Math.max(1, Math.ceil(dist / stepSize));

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0, 0, 0, 1)";

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ix = from.x + dx * t;
    const iy = from.y + dy * t;
    ctx.beginPath();
    ctx.arc(ix, iy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Formats today's date in clean Muji monospace style: YYYY.MM.DD
 */
export function getFormattedDateStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/**
 * Composites the Muji stationery paper background (texture, guidelines, stamp, watermark)
 * with the user's transparent crayon drawing canvas onto an offscreen high-res canvas,
 * and exports as a high-quality JPG data URL.
 */
export function exportLetterAsJpg(
  drawingCanvas: HTMLCanvasElement,
  displayWidth: number,
  displayHeight: number,
  dateStamp: string
): string {
  const safeW = Math.max(320, displayWidth);
  const safeH = Math.max(320, displayHeight);

  // Target crisp high-res export (~1600px on long side)
  const scale = Math.min(3, Math.max(2, 1600 / Math.max(safeW, safeH)));
  const outW = Math.round(safeW * scale);
  const outH = Math.round(safeH * scale);

  const offscreen = document.createElement("canvas");
  offscreen.width = outW;
  offscreen.height = outH;

  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error("Offscreen 2D context unavailable");
  }

  ctx.save();
  ctx.scale(scale, scale);

  const rng = createSeededRng(20261120);

  // 1. Handmade cotton / washi paper grain, subtle tonal clouds & organic fibers
  drawWashiPaperTexture(ctx, safeW, safeH, 20261120);

  // 2. Hand-sketched outer stationery hairline & corner crop marks
  drawSketchyRect(ctx, 1, 1, safeW - 2, safeH - 2, rng, {
    stepPx: 14,
    jitterAmp: 0.45,
    lineWidth: 0.9,
    strokeStyle: "#D8D7D1",
  });

  const crop = 10;
  const inset = 12;
  const cropOpts = {
    stepPx: 5,
    jitterAmp: 0.42,
    lineWidth: 0.85,
    strokeStyle: "rgba(34, 34, 34, 0.36)",
    overshoot: 1.0,
  };
  drawSketchyLine(ctx, inset, inset + crop, inset, inset, rng, cropOpts);
  drawSketchyLine(ctx, inset, inset, inset + crop, inset, rng, cropOpts);
  drawSketchyLine(ctx, safeW - inset - crop, inset, safeW - inset, inset, rng, cropOpts);
  drawSketchyLine(ctx, safeW - inset, inset, safeW - inset, inset + crop, rng, cropOpts);
  drawSketchyLine(ctx, inset, safeH - inset - crop, inset, safeH - inset, rng, cropOpts);
  drawSketchyLine(ctx, inset, safeH - inset, inset + crop, safeH - inset, rng, cropOpts);
  drawSketchyLine(ctx, safeW - inset - crop, safeH - inset, safeW - inset, safeH - inset, rng, cropOpts);
  drawSketchyLine(ctx, safeW - inset, safeH - inset, safeW - inset, safeH - inset - crop, rng, cropOpts);

  // 3. Stationery top header (Date stamp + sketchy underline + hand-drawn Stamp & Postmark)
  const padX = Math.max(24, safeW * 0.065);
  const headerY = 34;

  ctx.fillStyle = "#7D7D7A";
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`DATE // ${dateStamp}`, padX, headerY);
  drawSketchyLine(ctx, padX, headerY + 9, padX + 114, headerY + 9, rng, {
    stepPx: 8,
    jitterAmp: 0.38,
    lineWidth: 0.65,
    strokeStyle: "rgba(34, 34, 34, 0.16)",
  });

  const stampW = 35;
  const stampH = 43;
  const stampX = safeW - padX - stampW;
  const stampY = 19;
  drawHandDrawnPostageStamp(ctx, stampX, stampY, stampW, stampH, 1, rng);

  // 4. Hand-ruled jittery square graph grid (Muji cotton stationery)
  const gridTop = 74;
  const gridBottom = safeH - 46;
  const gridLeft = padX;
  const gridRight = safeW - padX;
  const gridStep = 24;

  for (let y = gridTop; y <= gridBottom; y += gridStep) {
    drawSketchyLine(ctx, gridLeft, y, gridRight, y, rng, {
      stepPx: 14,
      jitterAmp: 0.45,
      lineWidth: 0.72,
      strokeStyle: "rgba(34, 34, 34, 0.08)",
      overshoot: 1.0,
    });
  }
  for (let x = gridLeft; x <= gridRight; x += gridStep) {
    drawSketchyLine(ctx, x, gridTop, x, gridBottom, rng, {
      stepPx: 14,
      jitterAmp: 0.45,
      lineWidth: 0.72,
      strokeStyle: "rgba(34, 34, 34, 0.08)",
      overshoot: 1.0,
    });
  }

  // 5. Subtle bottom-left watermark (matches live stationery & 3D front panel)
  ctx.fillStyle = "#7D7D7A";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.font = '300 10.5px "Noto Sans TC", sans-serif';
  ctx.fillText("一則光的訊息", padX, safeH - 22);
  ctx.font = '400 8px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = "rgba(125, 125, 122, 0.78)";
  ctx.fillText("A MESSAGE OF LIGHT", padX, safeH - 11);

  // 6. Composite user's transparent crayon drawing layer cleanly on top
  ctx.drawImage(drawingCanvas, 0, 0, safeW, safeH);

  ctx.restore();

  return offscreen.toDataURL("image/jpeg", 0.94);
}
