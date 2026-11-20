import {
  createSeededRng,
  drawSketchyLine,
  drawSketchyRect,
} from "@/lib/hand-drawn-utils";

export const LED_CHANNEL_COUNT = 30;

export interface SampledGridCell {
  col: number;
  row: number;
  /** CSS pixel bounds inside the letter sheet */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Normalized ink density [0..1] */
  density: number;
  /** Mapped LED channel index [0..29] */
  channelIndex: number;
}

export interface GridSamplingResult {
  /** 30-channel integer array in [0..255] ready for physical LED hardware */
  ledValues: number[];
  /** Individual active grid cells aligned with the 24px stationery grid */
  activeCells: SampledGridCell[];
  gridRect: { x: number; y: number; w: number; h: number };
  cols: number;
  rows: number;
}

/**
 * Samples the user's transparent 2D drawing canvas aligned with the stationery's
 * 24px square grid and quantizes stroke coverage + ink darkness into:
 * 1) Per-cell density values for visual grid-quantization telemetry
 * 2) A 30-unit [0..255] integer LED brightness sequence
 */
export function sampleDrawingToGridAnd30Led(
  drawingCanvas: HTMLCanvasElement,
  displayW: number,
  displayH: number
): GridSamplingResult {
  const safeW = Math.max(1, Math.floor(displayW));
  const safeH = Math.max(1, Math.floor(displayH));

  // Match the stationery grid area margins
  const padX = safeW >= 540 ? 36 : 24;
  const gridTop = 70;
  const gridBottom = Math.max(gridTop + 48, safeH - 48);
  const gridX = padX;
  const gridY = gridTop;
  const gridW = Math.max(30, safeW - padX * 2);
  const gridH = Math.max(30, gridBottom - gridTop);

  // Downsample drawing onto a clean CSS-resolution analysis canvas for fast pixel reads
  const analysis = document.createElement("canvas");
  analysis.width = safeW;
  analysis.height = safeH;
  const aCtx = analysis.getContext("2d", { willReadFrequently: true });

  if (!aCtx || drawingCanvas.width === 0 || drawingCanvas.height === 0) {
    return {
      ledValues: new Array<number>(LED_CHANNEL_COUNT).fill(0),
      activeCells: [],
      gridRect: { x: gridX, y: gridY, w: gridW, h: gridH },
      cols: Math.max(1, Math.floor(gridW / 24)),
      rows: Math.max(1, Math.floor(gridH / 24)),
    };
  }

  aCtx.drawImage(drawingCanvas, 0, 0, safeW, safeH);
  const imgData = aCtx.getImageData(0, 0, safeW, safeH).data;

  const pixelInkAt = (px: number, py: number): number => {
    if (px < 0 || px >= safeW || py < 0 || py >= safeH) return 0;
    const idx = (py * safeW + px) * 4;
    const alpha = imgData[idx + 3] / 255;
    if (alpha < 0.02) return 0;
    const r = imgData[idx] / 255;
    const g = imgData[idx + 1] / 255;
    const b = imgData[idx + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Darker ink registers higher intensity while keeping light warm colors meaningful
    const darknessWeight = 0.55 + (1 - lum) * 0.45;
    return alpha * darknessWeight;
  };

  // 1. Sample 24px square grid cells aligned to the stationery grid
  const cellSize = 24;
  const cols = Math.max(1, Math.floor(gridW / cellSize));
  const rows = Math.max(1, Math.floor(gridH / cellSize));
  const activeCells: SampledGridCell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx0 = Math.floor(gridX + col * cellSize);
      const cy0 = Math.floor(gridY + row * cellSize);
      const cw = Math.min(cellSize, safeW - cx0);
      const ch = Math.min(cellSize, safeH - cy0);
      if (cw <= 0 || ch <= 0) continue;

      let inkSum = 0;
      let sampleCount = 0;
      for (let py = cy0; py < cy0 + ch; py += 2) {
        for (let px = cx0; px < cx0 + cw; px += 2) {
          inkSum += pixelInkAt(px, py);
          sampleCount += 1;
        }
      }

      const rawCoverage = sampleCount > 0 ? inkSum / sampleCount : 0;
      if (rawCoverage > 0.008) {
        // Gentle perceptual boost so thin pencil/crayon strokes clearly light up cells
        const density = Math.min(1, Math.pow(rawCoverage * 4.5, 0.72));
        const normX = (col + 0.5) / cols;
        const channelIndex = Math.min(
          LED_CHANNEL_COUNT - 1,
          Math.floor(normX * LED_CHANNEL_COUNT)
        );
        activeCells.push({
          col,
          row,
          x: cx0,
          y: cy0,
          w: cw,
          h: ch,
          density,
          channelIndex,
        });
      }
    }
  }

  // 2. Sample 30 continuous horizontal buckets (Columns 0..29) across the grid width
  const rawBuckets = new Array<number>(LED_CHANNEL_COUNT).fill(0);
  let maxBucket = 0;

  for (let ch = 0; ch < LED_CHANNEL_COUNT; ch++) {
    const bx0 = Math.floor(gridX + (ch / LED_CHANNEL_COUNT) * gridW);
    const bx1 = Math.max(
      bx0 + 1,
      Math.floor(gridX + ((ch + 1) / LED_CHANNEL_COUNT) * gridW)
    );
    const by0 = Math.floor(gridY);
    const by1 = Math.floor(gridY + gridH);

    let sum = 0;
    let count = 0;
    for (let py = by0; py < by1; py += 2) {
      for (let px = bx0; px < bx1; px += 1) {
        sum += pixelInkAt(px, py);
        count += 1;
      }
    }

    const avg = count > 0 ? sum / count : 0;
    rawBuckets[ch] = avg;
    if (avg > maxBucket) maxBucket = avg;
  }

  // Normalize buckets to [0..255] integers cleanly
  // Keeps completely blank buckets strictly 0 while giving drawn strokes full expressive dynamic range
  const ledValues = rawBuckets.map((val) => {
    if (val <= 0.0008 || maxBucket <= 0.0008) return 0;
    // Blend relative peak normalization with absolute coverage ceiling so a single tiny dot doesn't blow out to 255
    const effectiveCeil = Math.max(maxBucket, 0.045);
    const norm = Math.min(1, val / effectiveCeil);
    const perceptual = Math.pow(norm, 0.78);
    return Math.max(12, Math.min(255, Math.round(perceptual * 255)));
  });

  return {
    ledValues,
    activeCells,
    gridRect: { x: gridX, y: gridY, w: gridW, h: gridH },
    cols,
    rows,
  };
}

/**
 * Publishes the 30-channel [0..255] LED sequence to window.latestLightSequence,
 * dispatches the `light-message-sampled` CustomEvent, and logs to Console
 * for direct ESP32 / TouchDesigner / WebSerial hardware integration.
 */
export function publishLightSequenceToHardware(ledValues: number[]): void {
  if (typeof window === "undefined") return;
  const copy = [...ledValues];
  (
    window as Window & { latestLightSequence?: number[] }
  ).latestLightSequence = copy;

  window.dispatchEvent(
    new CustomEvent("light-message-sampled", {
      detail: {
        values: copy,
        timestamp: Date.now(),
      },
    })
  );

  console.log("[一則光的訊息] 30-CH LED Sequence (0–255):", copy);
}

/**
 * Default lower comparison vertical ratio (0..1 of letter height) where the
 * 30-unit strip settles beneath the preserved hand-drawn strokes.
 */
export const SETTLED_STRIP_Y_RATIO = 0.825;

/**
 * Draws the minimalist 30-unit horizontal grayscale strip onto any 2D Canvas
 * at a configurable vertical position (`centerYRatio`, 0.5 = center, 0.825 = lower comparison band).
 * Shared between the live Stage A sampling overlay AND the 3D Three.js CanvasTexture
 * so Step B -> Step C has zero visual seam.
 */
export function drawCentered30UnitStrip(
  ctx: CanvasRenderingContext2D,
  ledValues: number[],
  canvasW: number,
  canvasH: number,
  revealCountFloat = LED_CHANNEL_COUNT,
  stripAlpha = 1,
  centerYRatio = 0.5
): void {
  if (stripAlpha <= 0.005 || revealCountFloat <= 0) return;

  const padX = Math.max(20, canvasW * 0.072);
  const stripW = canvasW - padX * 2;
  const centerY = canvasH * centerYRatio;

  // Strictly proportional geometry so 2D overlay and 1200x1740 3D CanvasTexture match 1:1
  const gap = Math.max(1.5, stripW * 0.0055);
  const blockW = (stripW - gap * (LED_CHANNEL_COUNT - 1)) / LED_CHANNEL_COUNT;
  const blockH = Math.max(14, canvasH * 0.048);
  const topY = centerY - blockH / 2;

  const rulePad = Math.max(5, blockH * 0.28);
  const fontSize = Math.max(8, canvasW * 0.0165);
  const subFont = Math.max(7, canvasW * 0.0135);
  const labelGap = Math.max(3, fontSize * 0.32);

  const rng = createSeededRng(3030);

  ctx.save();
  ctx.globalAlpha = stripAlpha;

  // Subtle translucent Muji cotton paper plate behind the strip with hand-drawn jittery border
  const platePadX = Math.max(8, canvasW * 0.018);
  const plateTop = topY - rulePad - labelGap - fontSize - Math.max(4, blockH * 0.16);
  const plateBottom =
    topY + blockH + rulePad + Math.max(5, subFont * 0.55) + subFont + Math.max(5, blockH * 0.18);
  const plateX = Math.max(4, padX - platePadX);
  const plateW = Math.min(canvasW - plateX * 2, stripW + platePadX * 2);
  const plateH = plateBottom - plateTop;

  ctx.fillStyle = "rgba(250, 249, 246, 0.93)";
  ctx.fillRect(plateX, plateTop, plateW, plateH);
  drawSketchyRect(ctx, plateX, plateTop, plateW, plateH, rng, {
    stepPx: Math.max(10, canvasW * 0.028),
    jitterAmp: Math.max(0.35, canvasW * 0.0009),
    lineWidth: Math.max(0.8, canvasW * 0.0014),
    strokeStyle: "rgba(34, 34, 34, 0.24)",
    overshoot: Math.max(1.2, canvasW * 0.0022),
  });

  // Hand-ruled subtle horizontal reference rules above & below strip
  const ruleOpts = {
    stepPx: Math.max(12, canvasW * 0.03),
    jitterAmp: Math.max(0.3, canvasW * 0.0008),
    lineWidth: Math.max(0.75, canvasW * 0.0012),
    strokeStyle: "rgba(34, 34, 34, 0.18)",
  };
  drawSketchyLine(ctx, padX, topY - rulePad, padX + stripW, topY - rulePad, rng, ruleOpts);
  drawSketchyLine(
    ctx,
    padX,
    topY + blockH + rulePad,
    padX + stripW,
    topY + blockH + rulePad,
    rng,
    ruleOpts
  );

  // Micro monospace channel scale labels (CH.01 — CH.30)
  ctx.font = `400 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = "#6E6D6A";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText("CH.01", padX, topY - rulePad - labelGap);
  ctx.textAlign = "center";
  ctx.fillText("30-CH LIGHT SEQUENCE", canvasW / 2, topY - rulePad - labelGap);
  ctx.textAlign = "right";
  ctx.fillText("CH.30", padX + stripW, topY - rulePad - labelGap);

  // Draw the 30 independent blocks left-to-right with tactile graphite/crayon texture
  const blockJitter = Math.max(0.22, canvasW * 0.00055);
  const blockStrokeW = Math.max(0.72, canvasW * 0.0011);

  for (let i = 0; i < LED_CHANNEL_COUNT; i++) {
    const localReveal = Math.max(0, Math.min(1, revealCountFloat - i));
    if (localReveal <= 0) continue;

    const val = ledValues[i] ?? 0;
    const t = val / 255;

    // Interpolate grayscale cleanly from #EAEAE6 (234, 234, 230) to #222222 (34, 34, 34)
    const r = Math.round(234 + (34 - 234) * t);
    const g = Math.round(234 + (34 - 234) * t);
    const b = Math.round(230 + (34 - 230) * t);

    const bx = padX + i * (blockW + gap);
    const hScale = 0.25 + 0.75 * localReveal;
    const bh = blockH * hScale;
    const by = centerY - bh / 2;

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(bx, by, blockW, bh);

    // Subtle organic paper/pencil grain flecks inside each filled block
    const speckTotal = Math.max(3, Math.round(blockW * 0.35));
    for (let s = 0; s < speckTotal; s++) {
      const gx = bx + rng() * Math.max(1, blockW - 1);
      const gy = by + rng() * Math.max(1, bh - 1);
      const gsz = Math.max(0.8, canvasW * 0.0016);
      ctx.fillStyle =
        t > 0.45
          ? `rgba(250, 249, 246, ${(0.07 + rng() * 0.09).toFixed(2)})`
          : `rgba(34, 34, 34, ${(0.04 + rng() * 0.06).toFixed(2)})`;
      ctx.fillRect(gx, gy, gsz, gsz);
    }

    // Slightly jittery hand-drawn ink outline
    drawSketchyRect(ctx, bx, by, blockW, bh, rng, {
      stepPx: Math.max(5, blockH * 0.48),
      jitterAmp: blockJitter,
      lineWidth: blockStrokeW,
      strokeStyle:
        t > 0.35 ? "rgba(34, 34, 34, 0.85)" : "rgba(34, 34, 34, 0.24)",
    });

    // Tiny hand-drawn bottom tick marks every 5 channels
    if (i === 0 || i === 14 || i === 29 || (i + 1) % 5 === 0) {
      const tickTop = topY + blockH + rulePad;
      const tickLen =
        i === 0 || i === 14 || i === 29 ? rulePad * 0.85 : rulePad * 0.45;
      drawSketchyLine(
        ctx,
        bx + blockW / 2,
        tickTop,
        bx + blockW / 2,
        tickTop + tickLen,
        rng,
        {
          stepPx: Math.max(3, tickLen * 0.5),
          jitterAmp: blockJitter * 0.8,
          lineWidth: blockStrokeW,
          strokeStyle: "rgba(34, 34, 34, 0.46)",
        }
      );
    }
  }

  // Bottom tiny calibration readout
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillStyle = "#8C8C8A";
  ctx.font = `400 ${subFont}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillText(
    "QUANTIZED 000–255 // READY FOR TRANSMISSION",
    canvasW / 2,
    topY + blockH + rulePad + Math.max(5, subFont * 0.55)
  );

  ctx.restore();
}
