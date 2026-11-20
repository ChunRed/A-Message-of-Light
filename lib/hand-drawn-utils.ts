/**
 * Shared procedural hand-drawn paper texture, subdivided jittery ink/pencil lines,
 * and 3D sketchy wireframe edge generators for "一則光的訊息".
 */

export function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Renders tactile handmade cotton / washi stationery paper onto a 2D Canvas:
 * - Warm off-white base (#FAF9F6)
 * - Subtle tonal paper clouds (warm organic variation)
 * - Fine cotton speckle grain
 * - Delicate short organic paper fibers
 * - Gentle edge warmth
 */
export function drawWashiPaperTexture(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed = 20261120
): void {
  const rng = createSeededRng(seed);

  // 1. Warm Muji cotton paper base
  ctx.fillStyle = "#FAF9F6";
  ctx.fillRect(0, 0, w, h);

  // 2. Very soft organic paper-pulp tonal clouds (subtle, warm, never muddy)
  const cloudCount = Math.max(10, Math.round((w * h) / 68000));
  for (let i = 0; i < cloudCount; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const rad = Math.max(w, h) * (0.14 + rng() * 0.24);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const isWarm = rng() < 0.65;
    grad.addColorStop(
      0,
      isWarm ? "rgba(232, 224, 206, 0.16)" : "rgba(255, 255, 252, 0.22)"
    );
    grad.addColorStop(1, "rgba(250, 249, 246, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }

  // 3. Fine organic paper grain noise (warm sepia + muted charcoal + bright pulp specks)
  const scaleFactor = Math.min(2.2, Math.max(0.85, Math.sqrt((w * h) / 400000)));
  const speckCount = Math.min(5500, Math.max(900, Math.round((w * h) / 360)));
  for (let i = 0; i < speckCount; i++) {
    const sx = rng() * w;
    const sy = rng() * h;
    const sz = (0.7 + rng() * 1.15) * scaleFactor;
    const roll = rng();
    if (roll < 0.52) {
      ctx.fillStyle = `rgba(92, 82, 68, ${(0.018 + rng() * 0.026).toFixed(3)})`;
    } else if (roll < 0.84) {
      ctx.fillStyle = `rgba(34, 34, 34, ${(0.014 + rng() * 0.022).toFixed(3)})`;
    } else {
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.18 + rng() * 0.22).toFixed(3)})`;
    }
    ctx.fillRect(sx, sy, sz, sz * (0.7 + rng() * 0.6));
  }

  // 4. Delicate short cotton fibers scattered gently across the paper
  const fiberCount = Math.min(240, Math.max(45, Math.round((w * h) / 9500)));
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < fiberCount; i++) {
    const fx = rng() * w;
    const fy = rng() * h;
    const angle = rng() * Math.PI * 2;
    const fLen = (4 + rng() * 10) * scaleFactor;
    const bend = (rng() - 0.5) * 3.5 * scaleFactor;
    const ex = fx + Math.cos(angle) * fLen;
    const ey = fy + Math.sin(angle) * fLen;
    const cx = (fx + ex) * 0.5 - Math.sin(angle) * bend;
    const cy = (fy + ey) * 0.5 + Math.cos(angle) * bend;

    ctx.strokeStyle =
      rng() < 0.7
        ? `rgba(128, 118, 102, ${(0.055 + rng() * 0.055).toFixed(3)})`
        : `rgba(255, 254, 250, ${(0.28 + rng() * 0.2).toFixed(3)})`;
    ctx.lineWidth = (0.55 + rng() * 0.5) * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }
  ctx.restore();

  // 5. Subtle warm paper-edge shading along perimeter
  ctx.save();
  const edgeW = Math.max(12, Math.min(w, h) * 0.045);
  const topGrad = ctx.createLinearGradient(0, 0, 0, edgeW);
  topGrad.addColorStop(0, "rgba(186, 178, 162, 0.09)");
  topGrad.addColorStop(1, "rgba(250, 249, 246, 0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, edgeW);

  const botGrad = ctx.createLinearGradient(0, h, 0, h - edgeW);
  botGrad.addColorStop(0, "rgba(186, 178, 162, 0.11)");
  botGrad.addColorStop(1, "rgba(250, 249, 246, 0)");
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, h - edgeW, w, edgeW);
  ctx.restore();
}

export interface SketchLineOpts {
  stepPx?: number;
  jitterAmp?: number;
  lineWidth?: number;
  strokeStyle?: string;
  overshoot?: number;
  doublePass?: boolean;
  dashed?: boolean;
  dashLen?: number;
  gapLen?: number;
}

/**
 * Draws a subdivided hand-drawn jittery ink/graphite line from (x0, y0) to (x1, y1).
 * Never relies on a sterile single straight stroke.
 */
export function drawSketchyLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rng: () => number,
  opts: SketchLineOpts = {}
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;

  const stepPx = opts.stepPx ?? Math.max(4, Math.min(18, len / 10));
  const jitterAmp = opts.jitterAmp ?? 0.9;
  const lineWidth = opts.lineWidth ?? 1.2;
  const overshoot = opts.overshoot ?? 0;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const sx = x0 - ux * overshoot;
  const sy = y0 - uy * overshoot;
  const ex = x1 + ux * overshoot;
  const ey = y1 + uy * overshoot;
  const totalLen = Math.hypot(ex - sx, ey - sy);
  const steps = Math.max(2, Math.ceil(totalLen / stepPx));

  const tracePass = (ampMult: number, widthMult: number, alphaMult: number) => {
    ctx.save();
    if (opts.strokeStyle) ctx.strokeStyle = opts.strokeStyle;
    ctx.globalAlpha *= alphaMult;
    ctx.lineWidth = lineWidth * widthMult;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (opts.dashed) {
      ctx.setLineDash([opts.dashLen ?? 6, opts.gapLen ?? 5]);
    }

    ctx.beginPath();
    let drift = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const taper = 0.4 + 0.6 * Math.sin(t * Math.PI);
      drift = drift * 0.48 + (rng() - 0.5) * 2 * jitterAmp * ampMult * taper;
      const px = sx + (ex - sx) * t + nx * drift;
      const py = sy + (ey - sy) * t + ny * drift;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  };

  tracePass(1, 1, 1);
  if (opts.doublePass) {
    tracePass(1.4, 0.72, 0.32);
  }
}

/**
 * Draws a hand-sketched rectangle using four subdivided jittery lines with tiny corner overshoots.
 */
export function drawSketchyRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: () => number,
  opts: SketchLineOpts = {}
): void {
  drawSketchyLine(ctx, x, y, x + w, y, rng, opts);
  drawSketchyLine(ctx, x + w, y, x + w, y + h, rng, opts);
  drawSketchyLine(ctx, x + w, y + h, x, y + h, rng, opts);
  drawSketchyLine(ctx, x, y + h, x, y, rng, opts);
}

/**
 * Draws an organic hand-sketched circle via subdivided angular jittered polyline.
 */
export function drawSketchyCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rng: () => number,
  opts: {
    strokeStyle?: string;
    lineWidth?: number;
    jitterAmp?: number;
    segments?: number;
  } = {}
): void {
  const segs = opts.segments ?? 24;
  const jitterAmp = opts.jitterAmp ?? Math.max(0.35, radius * 0.075);

  ctx.save();
  if (opts.strokeStyle) ctx.strokeStyle = opts.strokeStyle;
  ctx.lineWidth = opts.lineWidth ?? 1.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  let rOff = 0;
  // Slightly overshoot closing by 1 extra segment for hand-drawn pen loop feel
  for (let i = 0; i <= segs + 1; i++) {
    const a = (i / segs) * Math.PI * 2;
    rOff = rOff * 0.45 + (rng() - 0.5) * 2 * jitterAmp;
    const r = radius + rOff;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a hand-sketched perforated postage stamp + organic light-ray sun + wavy ink postmark.
 * Scales cleanly for both 1200x1740 3D texture (`scale ~ 2.4`) and exported JPG (`scale = 1`).
 */
export function drawHandDrawnPostageStamp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  scale: number,
  rng: () => number
): void {
  ctx.save();

  // Outer perforated stamp frame (hand-sketched dashed jittery border)
  drawSketchyRect(ctx, sx, sy, sw, sh, rng, {
    stepPx: Math.max(4, 6 * scale),
    jitterAmp: 0.45 * scale,
    lineWidth: 1.0 * scale,
    strokeStyle: "#B3B2AC",
    dashed: true,
    dashLen: 2.8 * scale,
    gapLen: 2.6 * scale,
  });

  // Inner double-ruled stamp frame with tiny pen overshoot
  const inset = 4.2 * scale;
  drawSketchyRect(ctx, sx + inset, sy + inset, sw - inset * 2, sh - inset * 2, rng, {
    stepPx: Math.max(4, 6 * scale),
    jitterAmp: 0.38 * scale,
    lineWidth: 0.85 * scale,
    strokeStyle: "#D5D4CE",
    overshoot: 0.7 * scale,
  });

  // Hand-drawn geometric sun / starlight emblem in stamp center
  const sunX = sx + sw / 2;
  const sunY = sy + sh / 2;
  drawSketchyCircle(ctx, sunX, sunY, 4.3 * scale, rng, {
    strokeStyle: "#7D7D7A",
    lineWidth: 0.95 * scale,
    jitterAmp: 0.35 * scale,
    segments: 18,
  });

  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4 + (rng() - 0.5) * 0.08;
    const r0 = (6.4 + rng() * 0.6) * scale;
    const r1 = (a % 2 === 0 ? 9.6 : 8.5) * scale + (rng() - 0.5) * 0.6 * scale;
    drawSketchyLine(
      ctx,
      sunX + Math.cos(rad) * r0,
      sunY + Math.sin(rad) * r0,
      sunX + Math.cos(rad) * r1,
      sunY + Math.sin(rad) * r1,
      rng,
      {
        stepPx: Math.max(2, 3 * scale),
        jitterAmp: 0.28 * scale,
        lineWidth: 0.9 * scale,
        strokeStyle: "#7D7D7A",
      }
    );
  }

  // Organic hand-inked wavy postmark cancel lines overlapping left edge of stamp
  for (let k = 0; k < 3; k++) {
    const wy = sy + (13 + k * 7.5) * scale;
    const xStart = sx - 28 * scale;
    const xEnd = sx - 2 * scale;
    const steps = 14;
    ctx.save();
    ctx.strokeStyle = "rgba(130, 128, 122, 0.52)";
    ctx.lineWidth = 0.85 * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = xStart + (xEnd - xStart) * t;
      const wave = Math.sin(t * Math.PI * 2.2 + k * 0.4) * 2.4 * scale;
      const jitter = (rng() - 0.5) * 0.75 * scale;
      const py = wy + wave + jitter;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Converts flat pairs of 3D segment endpoints [x0,y0,z0, x1,y1,z1, ...] into
 * subdivided hand-drawn jittered 3D line segments for Three.js `LineSegments`.
 * Gives the 3D letter paper outline, fold creases, and 3D wireframe envelope
 * a subtle organic hand-inked silhouette!
 */
export function buildJittered3DLineSegments(
  rawSegmentCoords: number[],
  stepWorld = 0.14,
  jitterWorld = 0.0075,
  seed = 7741
): number[] {
  const rng = createSeededRng(seed);
  const out: number[] = [];

  for (let i = 0; i < rawSegmentCoords.length; i += 6) {
    const x0 = rawSegmentCoords[i];
    const y0 = rawSegmentCoords[i + 1];
    const z0 = rawSegmentCoords[i + 2];
    const x1 = rawSegmentCoords[i + 3];
    const y1 = rawSegmentCoords[i + 4];
    const z1 = rawSegmentCoords[i + 5];

    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) continue;

    // Perpendicular direction in XY plane for organic 2D hand-drawn line wobble
    const xyLen = Math.hypot(dx, dy) || 1;
    const nx = -dy / xyLen;
    const ny = dx / xyLen;

    const steps = Math.max(3, Math.ceil(len / stepWorld));
    let px = x0;
    let py = y0;
    let pz = z0;
    let wander = 0;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const taper = s === steps ? 0 : 0.35 + 0.65 * Math.sin(t * Math.PI);
      wander = wander * 0.45 + (rng() - 0.5) * 2 * jitterWorld * taper;
      const qx = x0 + dx * t + nx * wander;
      const qy = y0 + dy * t + ny * wander;
      const qz = z0 + dz * t;

      out.push(px, py, pz, qx, qy, qz);
      px = qx;
      py = qy;
      pz = qz;
    }
  }

  return out;
}
