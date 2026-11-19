export type BrushType = "crayon" | "pencil" | "marker" | "fountain" | "pixel";

export interface BrushMeta {
  id: BrushType;
  label: string;
  enLabel: string;
  hint: string;
}

export const BRUSH_TYPES: BrushMeta[] = [
  {
    id: "crayon",
    label: "蠟筆",
    enLabel: "CRAYON",
    hint: "蠟質顆粒與紙張纖維留白",
  },
  {
    id: "pencil",
    label: "鉛筆",
    enLabel: "PENCIL",
    hint: "細膩石墨紋理與側鋒濃淡",
  },
  {
    id: "marker",
    label: "麥克筆",
    enLabel: "MARKER",
    hint: "半透明平頭疊加與斜切角",
  },
  {
    id: "fountain",
    label: "鋼筆",
    enLabel: "FOUNTAIN",
    hint: "運筆速度粗細與微滲墨毛邊",
  },
  {
    id: "pixel",
    label: "像素",
    enLabel: "PIXEL",
    hint: "網格點陣方塊與邊緣抖動",
  },
];

export interface BrushParams {
  type: BrushType;
  colorHex: string;
  baseRadius: number;
  /** 1..100: internal grain or pixel block size */
  noiseSize: number;
  /** 0..100: edge jitter, feathering bleed, or dither radius */
  edgeRoughness: number;
  /** -90..+90 degrees: nib flat angle & texture orientation */
  tiltAngle: number;
  /** 1..9999: deterministic Mulberry32 PRNG seed */
  randomSeed: number;
}

export const DEFAULT_BRUSH_PARAMS: Omit<BrushParams, "colorHex" | "baseRadius"> = {
  type: "crayon",
  noiseSize: 42,
  edgeRoughness: 48,
  tiltAngle: -28,
  randomSeed: 1024,
};

export interface ProceduralStrokePoint {
  x: number;
  y: number;
  pressure?: number;
  timestamp?: number;
}

/**
 * Deterministic Mulberry32 PRNG (returns uniform float in [0, 1)).
 */
export function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mixes user seed with spatial/step index for deterministic per-dab randomness.
 */
function mixSeed(baseSeed: number, stepIndex: number, x: number, y: number): number {
  let h = (baseSeed * 374761393) ^ (stepIndex * 668265263);
  h ^= Math.floor(x * 3) * 1274126177;
  h ^= Math.floor(y * 3) * 2246822519;
  return h >>> 0;
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

/**
 * Deterministic cotton-paper tooth texture field [0..1] modulated by seed & noise scale.
 */
function paperTooth(x: number, y: number, noiseScale: number, seed: number): number {
  const inv = 1 / Math.max(0.45, noiseScale);
  const gx = Math.floor(x * inv);
  const gy = Math.floor(y * inv);
  let h =
    (gx * 374761393 + gy * 668265263 + seed * 1442695041) ^ (gx * gy);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const hashNoise = ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  const weave =
    0.5 +
    0.25 * Math.sin(x * 0.65 * inv + y * 0.15) +
    0.25 * Math.cos(y * 0.72 * inv - x * 0.12);
  return 0.4 * weave + 0.6 * hashNoise;
}

/**
 * Stamps a single procedural dab for any of the 5 brushes.
 */
export function stampProceduralDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  strokeDirRad: number,
  velocityPxPerMs: number,
  params: BrushParams,
  stepIndex: number,
  pressure = 0.5
): void {
  const { r, g, b } = hexToRgb(params.colorHex);
  const tiltRad = (params.tiltAngle * Math.PI) / 180;
  const noiseNorm = Math.max(0.01, Math.min(1, params.noiseSize / 100));
  const roughNorm = Math.max(0, Math.min(1, params.edgeRoughness / 100));
  const pFactor = 0.78 + Math.min(1, Math.max(0.2, pressure)) * 0.4;
  const radius = Math.max(1.5, params.baseRadius * pFactor);
  const rand = createMulberry32(mixSeed(params.randomSeed, stepIndex, x, y));

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  switch (params.type) {
    // =========================================================================
    // 1. CRAYON (蠟筆): Irregular wax grains + paper fiber tooth + rough scatter
    // =========================================================================
    case "crayon": {
      const grainScale = 0.65 + noiseNorm * 2.2;
      const scatterExtra = roughNorm * radius * 0.95;
      const grainCount = Math.round(
        Math.min(68, Math.max(16, (radius * 4.5) / (0.65 + noiseNorm * 0.55)))
      );
      const cosT = Math.cos(tiltRad);
      const sinT = Math.sin(tiltRad);

      for (let i = 0; i < grainCount; i++) {
        const a = rand() * Math.PI * 2;
        const radialBias = Math.pow(rand(), 0.72);
        const maxR = radius + scatterExtra * Math.pow(rand(), 1.4);
        // Subtle elliptical directional alignment from tiltAngle
        const lx = Math.cos(a) * radialBias * maxR * 1.12;
        const ly = Math.sin(a) * radialBias * maxR * 0.82;
        const px = x + lx * cosT - ly * sinT + (rand() - 0.5) * (1 + roughNorm * 2);
        const py = y + lx * sinT + ly * cosT + (rand() - 0.5) * (1 + roughNorm * 2);

        const tooth = paperTooth(px, py, 0.7 + noiseNorm * 1.6, params.randomSeed);
        const edgeFalloff = Math.max(0.05, 1 - radialBias * 0.72);
        if (tooth * edgeFalloff < 0.17) continue;

        const flakeW = (0.65 + rand() * 1.35) * grainScale;
        const flakeH = flakeW * (0.5 + rand() * 0.85);
        const alpha = Math.min(
          0.65,
          (0.11 + rand() * 0.34) * edgeFalloff * (0.6 + tooth * 0.55)
        );

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(
          px,
          py,
          flakeW * 0.5,
          flakeH * 0.5,
          tiltRad + (rand() - 0.5) * 0.9,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      break;
    }

    // =========================================================================
    // 2. PENCIL (鉛筆): Fine graphite stipple + tilt-responsive side shading
    // =========================================================================
    case "pencil": {
      // Measure alignment between tiltAngle and stroke direction -> side shading!
      const angleDiff = Math.abs(Math.sin(strokeDirRad - tiltRad));
      const broadFactor = 0.55 + angleDiff * 1.45;
      const thinAxis = Math.max(1.0, radius * 0.36);
      const wideAxis = Math.max(1.8, radius * 0.88 * broadFactor);
      const cosT = Math.cos(tiltRad);
      const sinT = Math.sin(tiltRad);

      const dotSizeBase = 0.45 + noiseNorm * 1.25;
      const dotCount = Math.round(
        Math.min(72, Math.max(18, wideAxis * 5.2))
      );

      for (let i = 0; i < dotCount; i++) {
        const u = (rand() - 0.5) * 2;
        const v = (rand() - 0.5) * 2;
        if (u * u + v * v > 1.0 + roughNorm * 0.55) continue;

        const jitter = roughNorm * radius * 0.55;
        const lx = u * wideAxis + (rand() - 0.5) * jitter;
        const ly = v * thinAxis + (rand() - 0.5) * jitter;
        const px = x + lx * cosT - ly * sinT;
        const py = y + lx * sinT + ly * cosT;

        const tooth = paperTooth(px, py, 0.55 + noiseNorm * 1.1, params.randomSeed);
        if (tooth < 0.28) continue;

        // Sharper tip = darker graphite; broad side shading = softer airy tone
        const shadingDensity = 1.12 - angleDiff * 0.42;
        const alpha = Math.min(
          0.52,
          (0.08 + rand() * 0.24) * shadingDensity * tooth
        );
        const sz = dotSizeBase * (0.6 + rand() * 0.85);

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz * 0.85);
      }
      break;
    }

    // =========================================================================
    // 3. MARKER (麥克筆): Translucent flat chisel nib oriented by tiltAngle
    // =========================================================================
    case "marker": {
      const nibLen = radius * 2.4;
      const nibThick = Math.max(1.8, radius * 0.46);
      // Translucent ink so overlapping turns naturally darken
      const baseAlpha = 0.085 + (1 - noiseNorm * 0.35) * 0.065;

      ctx.translate(x, y);
      ctx.rotate(tiltRad);

      // Core flat chisel-tip stroke footprint
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha.toFixed(3)})`;
      ctx.fillRect(-nibLen * 0.5, -nibThick * 0.5, nibLen, nibThick);

      // Subtle streaky alcohol-marker felt fiber lines along nib
      const fiberCount = Math.max(3, Math.round(4 + noiseNorm * 8));
      for (let i = 0; i < fiberCount; i++) {
        const fy = (rand() - 0.5) * nibLen;
        const fx = (rand() - 0.5) * nibThick * (1 + roughNorm * 1.6);
        const fLen = nibThick * (0.65 + rand() * 0.7);
        const fW = 0.6 + noiseNorm * 1.4;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(baseAlpha * 0.75).toFixed(3)})`;
        ctx.fillRect(fy - fW * 0.5, fx - fLen * 0.5, fW, fLen);
      }

      // Edge paper bleed controlled by edgeRoughness
      if (roughNorm > 0.05) {
        const bleedCount = Math.round(roughNorm * 12);
        for (let i = 0; i < bleedCount; i++) {
          const bx = (rand() - 0.5) * (nibLen + roughNorm * 6);
          const by =
            (rand() < 0.5 ? -1 : 1) *
            (nibThick * 0.45 + rand() * roughNorm * 3.8);
          const br = 0.6 + rand() * (0.8 + noiseNorm * 1.3);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(baseAlpha * 0.55).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    // =========================================================================
    // 4. FOUNTAIN PEN (鋼筆): Velocity-sensitive crisp ink + micro feathering
    // =========================================================================
    case "fountain": {
      // Slower speed -> pools slightly thicker; faster speed -> sleek tapered hairline
      const speedNorm = Math.min(1, velocityPxPerMs / 1.8);
      const speedWidthFactor = 1.24 - speedNorm * 0.66;
      const majorR = Math.max(0.85, radius * 0.68 * speedWidthFactor);
      const minorR = Math.max(0.5, majorR * 0.42);

      ctx.translate(x, y);
      ctx.rotate(tiltRad);

      // Rich crisp ink core
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.88)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, majorR, minorR, 0, 0, Math.PI * 2);
      ctx.fill();

      // Subtle paper ink-feathering / micro bleed around edge
      if (roughNorm > 0.04) {
        const featherCount = Math.round(2 + roughNorm * 14);
        const featherSpread = majorR * (0.4 + roughNorm * 1.15);
        for (let i = 0; i < featherCount; i++) {
          const a = rand() * Math.PI * 2;
          const d = majorR * 0.65 + rand() * featherSpread;
          const fx = Math.cos(a) * d;
          const fy = Math.sin(a) * d * 0.72;
          const fr = (0.35 + rand() * 0.85) * (0.55 + noiseNorm * 1.1);
          const fAlpha = (0.14 + rand() * 0.35) * (1 - d / (majorR + featherSpread + 1));
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(0.05, fAlpha).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(fx, fy, fr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    // =========================================================================
    // 5. PIXEL BRUSH (像素筆刷): Grid-snapped bitmap blocks + dithered edges
    // =========================================================================
    case "pixel": {
      // Pixel block size controlled directly by noiseSize (2px .. 12px)
      const blockSize = Math.max(2, Math.round(2 + noiseNorm * 10));
      const spreadR = radius * 1.05 + roughNorm * blockSize * 1.85;
      const cosT = Math.cos(tiltRad);
      const sinT = Math.sin(tiltRad);

      const minGx = Math.floor((x - spreadR) / blockSize);
      const maxGx = Math.ceil((x + spreadR) / blockSize);
      const minGy = Math.floor((y - spreadR) / blockSize);
      const maxGy = Math.ceil((y + spreadR) / blockSize);

      for (let gx = minGx; gx <= maxGx; gx++) {
        for (let gy = minGy; gy <= maxGy; gy++) {
          const cx = (gx + 0.5) * blockSize;
          const cy = (gy + 0.5) * blockSize;
          const dx = cx - x;
          const dy = cy - y;

          // Oriented elliptical pixel stamp according to tiltAngle
          const rx = dx * cosT + dy * sinT;
          const ry = -dx * sinT + dy * cosT;
          const normDist = Math.hypot(rx / (radius * 1.12), ry / (radius * 0.78));

          if (normDist <= 0.82) {
            // Solid crisp core pixels
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.94)`;
            ctx.fillRect(gx * blockSize, gy * blockSize, blockSize, blockSize);
          } else if (roughNorm > 0.02 && normDist <= 0.82 + roughNorm * 1.45) {
            // Deterministic seeded edge dithering
            const cellRand = createMulberry32(
              (gx * 73856093) ^ (gy * 19349663) ^ (params.randomSeed * 83492791)
            )();
            const prob =
              (1 - (normDist - 0.82) / Math.max(0.05, roughNorm * 1.45)) * 0.82;
            if (cellRand < prob) {
              const alpha = cellRand < prob * 0.55 ? 0.92 : 0.45;
              ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
              ctx.fillRect(gx * blockSize, gy * blockSize, blockSize, blockSize);
            }
          }
        }
      }
      break;
    }
  }

  ctx.restore();
}

/**
 * Draws an interpolated procedural stroke segment between `from` and `to`.
 * Returns the updated step counter for deterministic PRNG progression.
 */
export function drawProceduralSegment(
  ctx: CanvasRenderingContext2D,
  from: ProceduralStrokePoint,
  to: ProceduralStrokePoint,
  params: BrushParams,
  stepCounterStart = 0
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const strokeDirRad = dist > 0.01 ? Math.atan2(dy, dx) : 0;

  const dt = Math.max(
    1,
    to.timestamp !== undefined && from.timestamp !== undefined
      ? to.timestamp - from.timestamp
      : 16
  );
  const velocityPxPerMs = dist / dt;

  // Step density tailored per brush for crispness & 60fps smoothness
  let stepSize = Math.max(1.25, params.baseRadius * 0.24);
  if (params.type === "fountain") {
    stepSize = Math.max(0.85, params.baseRadius * 0.16);
  } else if (params.type === "marker") {
    stepSize = Math.max(1.4, params.baseRadius * 0.26);
  } else if (params.type === "pixel") {
    const block = Math.max(2, Math.round(2 + (params.noiseSize / 100) * 10));
    stepSize = Math.max(1.8, block * 0.45);
  }

  const steps = Math.max(1, Math.ceil(dist / stepSize));
  const p0 = from.pressure ?? 0.5;
  const p1 = to.pressure ?? 0.5;

  let stepIdx = stepCounterStart;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ix = from.x + dx * t;
    const iy = from.y + dy * t;
    const ip = p0 + (p1 - p0) * t;
    stampProceduralDab(
      ctx,
      ix,
      iy,
      strokeDirRad,
      velocityPxPerMs,
      params,
      stepIdx++,
      ip
    );
  }

  return stepIdx;
}

/**
 * Renders an elegant deterministic S-curve sample stroke inside the Live Preview Box
 * so every parameter change updates at 60fps with immediate visual clarity.
 */
export function renderPreviewSCurve(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: BrushParams
): void {
  ctx.clearRect(0, 0, width, height);

  // Subtle centered horizontal baseline guide inside preview box
  ctx.save();
  ctx.strokeStyle = "#E8E7E3";
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(14, Math.round(height / 2) + 0.5);
  ctx.lineTo(width - 14, Math.round(height / 2) + 0.5);
  ctx.stroke();
  ctx.restore();

  // Sample points along an expressive calligraphic S-curve
  const padX = Math.max(22, width * 0.11);
  const usableW = Math.max(40, width - padX * 2);
  const midY = height * 0.5;
  const ampY = Math.min(height * 0.31, 30);

  const sampleCount = 46;
  const pts: ProceduralStrokePoint[] = [];

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const x = padX + t * usableW;
    // Graceful S-wave with gentle taper at ends
    const y = midY - Math.sin(t * Math.PI * 2) * ampY * Math.sin(t * Math.PI * 0.88 + 0.18);
    // Simulate organic speed: slower at start/turns, faster through middle sweep
    const pseudoDt = 22 - Math.sin(t * Math.PI) * 14;
    const prevTime = i === 0 ? 0 : pts[i - 1].timestamp ?? 0;
    const pressure = 0.32 + Math.sin(t * Math.PI) * 0.52;
    pts.push({ x, y, pressure, timestamp: prevTime + pseudoDt });
  }

  let stepIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    stepIdx = drawProceduralSegment(ctx, pts[i - 1], pts[i], params, stepIdx);
  }
}
