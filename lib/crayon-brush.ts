export interface CrayonColor {
  id: string;
  name: string;
  hex: string;
}

export const CRAYON_COLORS: CrayonColor[] = [
  { id: "charcoal", name: "炭墨黑", hex: "#222222" },
  { id: "terracotta", name: "暖陶紅", hex: "#C86D51" },
  { id: "mustard", name: "芥末黃", hex: "#D4A84B" },
  { id: "sage", name: "鼠尾草綠", hex: "#6E8B74" },
  { id: "slate", name: "霧灰藍", hex: "#5B7A8C" },
  { id: "blush", name: "柔粉橘", hex: "#D98A7C" },
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

  // 1. Warm off-white Muji paper base (#FAF9F6)
  ctx.fillStyle = "#FAF9F6";
  ctx.fillRect(0, 0, safeW, safeH);

  // 2. Subtle organic cotton paper speckles
  const speckCount = Math.round((safeW * safeH) / 140);
  for (let i = 0; i < speckCount; i++) {
    const sx = ((i * 7919) % 10000) / 10000 * safeW;
    const sy = ((i * 104729) % 10000) / 10000 * safeH;
    ctx.fillStyle =
      i % 2 === 0 ? "rgba(34, 34, 34, 0.022)" : "rgba(140, 140, 138, 0.028)";
    ctx.fillRect(sx, sy, 1, 1);
  }

  // 3. Outer subtle stationery border & corner crop marks
  ctx.strokeStyle = "#E2E2DE";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, safeW - 1, safeH - 1);

  const crop = 10;
  const inset = 12;
  ctx.strokeStyle = "rgba(34, 34, 34, 0.35)";
  ctx.lineWidth = 0.8;
  // Top-left crop tick
  ctx.beginPath();
  ctx.moveTo(inset, inset + crop);
  ctx.lineTo(inset, inset);
  ctx.lineTo(inset + crop, inset);
  // Top-right
  ctx.moveTo(safeW - inset - crop, inset);
  ctx.lineTo(safeW - inset, inset);
  ctx.lineTo(safeW - inset, inset + crop);
  // Bottom-left
  ctx.moveTo(inset, safeH - inset - crop);
  ctx.lineTo(inset, safeH - inset);
  ctx.lineTo(inset + crop, safeH - inset);
  // Bottom-right
  ctx.moveTo(safeW - inset - crop, safeH - inset);
  ctx.lineTo(safeW - inset, safeH - inset);
  ctx.lineTo(safeW - inset, safeH - inset - crop);
  ctx.stroke();

  // 4. Stationery top header (Date stamp + Minimalist Stamp & Postmark)
  const padX = Math.max(24, safeW * 0.065);
  const headerY = 34;

  ctx.fillStyle = "#8C8C8A";
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`DATE // ${dateStamp}`, padX, headerY);

  // Minimalist stamp rectangle on top-right
  const stampW = 34;
  const stampH = 42;
  const stampX = safeW - padX - stampW;
  const stampY = 20;

  ctx.strokeStyle = "#C9C9C4";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(stampX, stampY, stampW, stampH);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#E2E2DE";
  ctx.strokeRect(stampX + 4, stampY + 4, stampW - 8, stampH - 8);

  // Tiny geometric sun/light rays inside stamp
  const sunX = stampX + stampW / 2;
  const sunY = stampY + stampH / 2;
  ctx.strokeStyle = "#8C8C8A";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 4.2, 0, Math.PI * 2);
  ctx.stroke();
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(sunX + Math.cos(rad) * 6.5, sunY + Math.sin(rad) * 6.5);
    ctx.lineTo(sunX + Math.cos(rad) * 9, sunY + Math.sin(rad) * 9);
    ctx.stroke();
  }

  // Wavy postmark lines overlapping left edge of stamp
  ctx.strokeStyle = "rgba(140, 140, 138, 0.5)";
  ctx.lineWidth = 0.8;
  for (let w = 0; w < 3; w++) {
    const wy = stampY + 13 + w * 7;
    ctx.beginPath();
    ctx.moveTo(stampX - 26, wy);
    ctx.bezierCurveTo(
      stampX - 18,
      wy - 3,
      stampX - 10,
      wy + 3,
      stampX - 2,
      wy
    );
    ctx.stroke();
  }

  // 5. Fine horizontal stationery writing guidelines (#E2E2DE)
  const firstLineY = 78;
  const bottomLimitY = safeH - 46;
  const lineSpacing = 34;

  ctx.strokeStyle = "#E7E6E2";
  ctx.lineWidth = 0.9;
  for (let y = firstLineY; y <= bottomLimitY; y += lineSpacing) {
    ctx.beginPath();
    ctx.moveTo(padX, Math.round(y) + 0.5);
    ctx.lineTo(safeW - padX, Math.round(y) + 0.5);
    ctx.stroke();
  }

  // 6. Subtle bottom-right watermark
  ctx.fillStyle = "#8C8C8A";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = '300 10.5px "Noto Sans TC", sans-serif';
  ctx.fillText("一則光的訊息", safeW - padX, safeH - 22);
  ctx.font = '400 8px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = "rgba(140, 140, 138, 0.72)";
  ctx.fillText("A MESSAGE OF LIGHT", safeW - padX, safeH - 11);

  // 7. Composite user's transparent crayon drawing layer cleanly on top
  ctx.drawImage(drawingCanvas, 0, 0, safeW, safeH);

  ctx.restore();

  return offscreen.toDataURL("image/jpeg", 0.94);
}
