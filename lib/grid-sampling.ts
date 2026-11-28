import {
  createSeededRng,
  drawSketchyLine,
  drawSketchyRect,
} from "@/lib/hand-drawn-utils";

export const LED_CHANNEL_COUNT = 30;
export const QUADTREE_MAX_DEPTH = 5;

export interface QuadtreeNode {
  id: number;
  depth: number;
  /** Normalized bounds [0..1] relative to the full letter paper */
  nx: number;
  ny: number;
  nw: number;
  nh: number;
  /** Average ink coverage [0..1] */
  inkMean: number;
  /** Ink variance within cell */
  inkVariance: number;
  /** Average gradient / stroke-edge energy [0..1] */
  edgeEnergy: number;
  /** Combined stroke detail richness score [0..1] */
  detailScore: number;
  /** Whether this node has meaningful stroke detail */
  hasInk: boolean;
  isLeaf: boolean;
}

export interface QuadtreeChannelLink {
  channelIndex: number;
  /** Quantized LED brightness / detail richness [0..255] */
  value: number;
  /** True when the channel's region contains actual stroke detail */
  hasFeature: boolean;
  /** Normalized feature point on the letter paper [0..1] */
  anchorNx: number;
  anchorNy: number;
  /** Associated quadtree leaf metadata */
  leafId: number;
  leafDepth: number;
  detailScore: number;
}

export interface GridSamplingResult {
  /** 30-channel integer array in [0..255] driven by Quadtree detail richness */
  ledValues: number[];
  /** All quadtree nodes (internal + leaves) ordered by depth for staged animation */
  quadtreeNodes: QuadtreeNode[];
  /** Final quadtree leaf nodes */
  quadtreeLeaves: QuadtreeNode[];
  /** 30 channel links connecting letter stroke features to CH.01..CH.30 */
  channelLinks: QuadtreeChannelLink[];
  /** Normalized sampling bounds on the letter paper [0..1] */
  normGridRect: { nx: number; ny: number; nw: number; nh: number };
  /** Maximum depth reached in this sampling */
  maxDepthReached: number;
}

interface InternalCell {
  id: number;
  depth: number;
  px0: number;
  py0: number;
  pw: number;
  ph: number;
  inkMean: number;
  inkVariance: number;
  edgeEnergy: number;
  detailScore: number;
  hasInk: boolean;
  splitPriority: number;
  isLeaf: boolean;
}

/**
 * Computes stroke detail richness using a Best-First Adaptive Quadtree:
 * - Evaluates both ink coverage AND spatial edge/gradient complexity (Sobel-like finite diff)
 * - Subdivides regions with the richest stroke detail down to depth 5 while keeping empty paper coarse
 * - Maps the Quadtree's multi-scale detail richness into 30 LED values [0..255]
 *   plus exact stroke feature anchor points so leader lines visually explain every channel.
 */
export function sampleDrawingToGridAnd30Led(
  drawingCanvas: HTMLCanvasElement,
  displayW: number,
  displayH: number
): GridSamplingResult {
  const safeW = Math.max(32, Math.floor(displayW));
  const safeH = Math.max(32, Math.floor(displayH));

  // Match the stationery grid area margins
  const padX = safeW >= 540 ? 36 : 24;
  const gridTop = 70;
  const gridBottom = Math.max(gridTop + 48, safeH - 48);
  const gridX = padX;
  const gridY = gridTop;
  const gridW = Math.max(30, safeW - padX * 2);
  const gridH = Math.max(30, gridBottom - gridTop);

  const normGridRect = {
    nx: gridX / safeW,
    ny: gridY / safeH,
    nw: gridW / safeW,
    nh: gridH / safeH,
  };

  const emptyResult = (): GridSamplingResult => ({
    ledValues: new Array<number>(LED_CHANNEL_COUNT).fill(0),
    quadtreeNodes: [],
    quadtreeLeaves: [],
    channelLinks: Array.from({ length: LED_CHANNEL_COUNT }, (_, i) => ({
      channelIndex: i,
      value: 0,
      hasFeature: false,
      anchorNx: normGridRect.nx + ((i + 0.5) / LED_CHANNEL_COUNT) * normGridRect.nw,
      anchorNy: normGridRect.ny + normGridRect.nh * 0.5,
      leafId: -1,
      leafDepth: 0,
      detailScore: 0,
    })),
    normGridRect,
    maxDepthReached: 0,
  });

  if (drawingCanvas.width === 0 || drawingCanvas.height === 0) {
    return emptyResult();
  }

  // Downsample to a fast deterministic analysis resolution (~240px wide) for snappy quadtree builds
  const scale = Math.min(1, 256 / safeW);
  const aW = Math.max(32, Math.round(safeW * scale));
  const aH = Math.max(32, Math.round(safeH * scale));

  const analysis = document.createElement("canvas");
  analysis.width = aW;
  analysis.height = aH;
  const aCtx = analysis.getContext("2d", { willReadFrequently: true });
  if (!aCtx) return emptyResult();

  aCtx.drawImage(drawingCanvas, 0, 0, aW, aH);
  const imgData = aCtx.getImageData(0, 0, aW, aH).data;

  // 1. Build ink intensity field [0..1]
  const totalPx = aW * aH;
  const ink = new Float32Array(totalPx);
  let globalInkSum = 0;

  for (let i = 0; i < totalPx; i++) {
    const o = i * 4;
    const alpha = imgData[o + 3] / 255;
    if (alpha < 0.02) continue;
    const r = imgData[o] / 255;
    const g = imgData[o + 1] / 255;
    const b = imgData[o + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const val = alpha * (0.52 + (1 - lum) * 0.48);
    ink[i] = val;
    globalInkSum += val;
  }

  // 2. Build local edge / stroke-detail energy field (captures curves, crossings, texture)
  const edge = new Float32Array(totalPx);
  for (let y = 1; y < aH - 1; y++) {
    const row = y * aW;
    for (let x = 1; x < aW - 1; x++) {
      const idx = row + x;
      const gx = Math.abs(ink[idx + 1] - ink[idx - 1]);
      const gy = Math.abs(ink[idx + aW] - ink[idx - aW]);
      const diag =
        Math.abs(ink[idx + aW + 1] - ink[idx - aW - 1]) * 0.5 +
        Math.abs(ink[idx + aW - 1] - ink[idx - aW + 1]) * 0.5;
      edge[idx] = Math.min(1, gx + gy + diag * 0.5);
    }
  }

  // Integral image helper for O(1) region statistics? Direct loops on <=256x320 are <1.5ms total
  const ax0 = Math.max(0, Math.floor(normGridRect.nx * aW));
  const ay0 = Math.max(0, Math.floor(normGridRect.ny * aH));
  const agW = Math.max(8, Math.min(aW - ax0, Math.floor(normGridRect.nw * aW)));
  const agH = Math.max(8, Math.min(aH - ay0, Math.floor(normGridRect.nh * aH)));

  let nextId = 1;

  const evaluateRegion = (
    px0: number,
    py0: number,
    pw: number,
    ph: number,
    depth: number
  ): InternalCell => {
    const xEnd = Math.min(aW, Math.round(px0 + pw));
    const yEnd = Math.min(aH, Math.round(py0 + ph));
    const xStart = Math.max(0, Math.round(px0));
    const yStart = Math.max(0, Math.round(py0));

    let sumInk = 0;
    let sumInkSq = 0;
    let sumEdge = 0;
    let activePx = 0;
    let count = 0;

    for (let y = yStart; y < yEnd; y++) {
      const row = y * aW;
      for (let x = xStart; x < xEnd; x++) {
        const idx = row + x;
        const iv = ink[idx];
        const ev = edge[idx];
        sumInk += iv;
        sumInkSq += iv * iv;
        sumEdge += ev;
        if (iv > 0.03) activePx += 1;
        count += 1;
      }
    }

    const safeCount = Math.max(1, count);
    const inkMean = sumInk / safeCount;
    const inkVariance = Math.max(0, sumInkSq / safeCount - inkMean * inkMean);
    const edgeEnergy = sumEdge / safeCount;
    const activeRatio = activePx / safeCount;
    const hasInk = activePx >= 2 || inkMean > 0.003;

    // Detail richness combines edge complexity, tonal variance, ink coverage, and depth
    const rawDetail =
      edgeEnergy * 2.4 +
      Math.sqrt(inkVariance) * 1.15 +
      inkMean * 0.72 +
      activeRatio * 0.35;
    const detailScore = Math.min(1, Math.pow(Math.max(0, rawDetail), 0.78));

    // Priority favors splitting larger cells that contain high edge/variance detail
    const areaFactor = Math.pow((pw * ph) / Math.max(1, agW * agH), 0.34);
    const splitPriority = hasInk
      ? (edgeEnergy * 2.8 + Math.sqrt(inkVariance) * 1.6 + inkMean * 0.85) *
        areaFactor
      : 0;

    return {
      id: nextId++,
      depth,
      px0,
      py0,
      pw,
      ph,
      inkMean,
      inkVariance,
      edgeEnergy,
      detailScore,
      hasInk,
      splitPriority,
      isLeaf: true,
    };
  };

  // 3. Best-First Adaptive Quadtree Subdivision
  const root = evaluateRegion(ax0, ay0, agW, agH, 0);
  const allCells: InternalCell[] = [root];
  const leaves: InternalCell[] = [root];

  const hasAnyStroke = globalInkSum > 0.5;
  const maxSplits = hasAnyStroke ? 44 : 5; // Up to ~133 leaves concentrated on stroke detail
  const minCellDim = Math.max(5, Math.min(agW, agH) / 34);

  const splitCellAt = (leafIndex: number): boolean => {
    const parent = leaves[leafIndex];
    if (
      !parent ||
      parent.depth >= QUADTREE_MAX_DEPTH ||
      parent.pw < minCellDim * 1.9 ||
      parent.ph < minCellDim * 1.9
    ) {
      return false;
    }

    parent.isLeaf = false;
    const hw = parent.pw * 0.5;
    const hh = parent.ph * 0.5;
    const nextDepth = parent.depth + 1;

    const children = [
      evaluateRegion(parent.px0, parent.py0, hw, hh, nextDepth),
      evaluateRegion(parent.px0 + hw, parent.py0, parent.pw - hw, hh, nextDepth),
      evaluateRegion(parent.px0, parent.py0 + hh, hw, parent.ph - hh, nextDepth),
      evaluateRegion(
        parent.px0 + hw,
        parent.py0 + hh,
        parent.pw - hw,
        parent.ph - hh,
        nextDepth
      ),
    ];

    leaves.splice(leafIndex, 1, ...children);
    allCells.push(...children);
    return true;
  };

  // Always split root once so the quadtree architecture starts crisply
  splitCellAt(0);

  if (hasAnyStroke) {
    // Split depth-1 quadrants that contain ink so structure reads clearly
    for (let i = leaves.length - 1; i >= 0; i--) {
      if (leaves[i].depth === 1 && leaves[i].hasInk) {
        splitCellAt(i);
      }
    }

    // Best-first splits: always refine the leaf with the highest stroke detail complexity
    for (let step = 0; step < maxSplits; step++) {
      let bestIdx = -1;
      let bestScore = 0.004;

      for (let i = 0; i < leaves.length; i++) {
        const lf = leaves[i];
        if (!lf.hasInk) continue;
        if (lf.depth >= QUADTREE_MAX_DEPTH) continue;
        if (lf.pw < minCellDim * 1.9 || lf.ph < minCellDim * 1.9) continue;

        if (lf.splitPriority > bestScore) {
          bestScore = lf.splitPriority;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;
      splitCellAt(bestIdx);
    }
  }

  const toPublicNode = (c: InternalCell): QuadtreeNode => ({
    id: c.id,
    depth: c.depth,
    nx: c.px0 / aW,
    ny: c.py0 / aH,
    nw: c.pw / aW,
    nh: c.ph / aH,
    inkMean: c.inkMean,
    inkVariance: c.inkVariance,
    edgeEnergy: c.edgeEnergy,
    detailScore: c.detailScore,
    hasInk: c.hasInk,
    isLeaf: c.isLeaf,
  });

  const quadtreeNodes = allCells
    .map(toPublicNode)
    .sort((a, b) => a.depth - b.depth || a.nx - b.nx || a.ny - b.ny);
  const quadtreeLeaves = leaves.map(toPublicNode);
  const maxDepthReached = quadtreeLeaves.reduce(
    (acc, n) => Math.max(acc, n.depth),
    0
  );

  // 4. Derive HIGH-CONTRAST 30 LED values [0..255] + feature anchor links
  // Combines exact narrow-slice pixel ink/edge energy + fine Quadtree detail
  // (never smeared by coarse wide cells) followed by adaptive contrast expansion!
  const rawChannelScores = new Array<number>(LED_CHANNEL_COUNT).fill(0);
  const sliceHasInk = new Array<boolean>(LED_CHANNEL_COUNT).fill(false);
  const chosenLeafPerChannel: (QuadtreeNode | null)[] = new Array(
    LED_CHANNEL_COUNT
  ).fill(null);
  const usedAnchorIds = new Set<number>();

  let maxRawScore = 0;

  for (let ch = 0; ch < LED_CHANNEL_COUNT; ch++) {
    const bandX0 = normGridRect.nx + (ch / LED_CHANNEL_COUNT) * normGridRect.nw;
    const bandX1 =
      normGridRect.nx + ((ch + 1) / LED_CHANNEL_COUNT) * normGridRect.nw;
    const bandCenterX = (bandX0 + bandX1) * 0.5;
    const bandWidth = bandX1 - bandX0;

    // A. Measure exact narrow vertical-column pixel ink & edge energy directly
    const sx0 = Math.max(0, Math.floor(ax0 + (ch / LED_CHANNEL_COUNT) * agW));
    const sx1 = Math.min(
      aW,
      Math.max(sx0 + 1, Math.ceil(ax0 + ((ch + 1) / LED_CHANNEL_COUNT) * agW))
    );
    const sy0 = ay0;
    const sy1 = Math.min(aH, ay0 + agH);

    let sliceInkSum = 0;
    let sliceEdgeSum = 0;
    let sliceActivePx = 0;
    let slicePxCount = 0;
    let peakBandEnergy = 0;

    // Track 12 vertical micro-bands inside this slice to reward dense stroke clusters
    const vBands = 12;
    const vBandH = Math.max(1, (sy1 - sy0) / vBands);
    for (let vb = 0; vb < vBands; vb++) {
      const by0 = Math.floor(sy0 + vb * vBandH);
      const by1 = Math.min(sy1, Math.ceil(sy0 + (vb + 1) * vBandH));
      let bSum = 0;
      let bCnt = 0;
      for (let y = by0; y < by1; y++) {
        const rowOff = y * aW;
        for (let x = sx0; x < sx1; x++) {
          const idx = rowOff + x;
          const iv = ink[idx];
          const ev = edge[idx];
          sliceInkSum += iv;
          sliceEdgeSum += ev;
          if (iv > 0.035) sliceActivePx += 1;
          slicePxCount += 1;
          bSum += iv * 0.75 + ev * 1.25;
          bCnt += 1;
        }
      }
      if (bCnt > 0) {
        const bAvg = bSum / bCnt;
        if (bAvg > peakBandEnergy) peakBandEnergy = bAvg;
      }
    }

    // Collect Quadtree leaves overlapping this narrow slice
    const overlapping = quadtreeLeaves.filter(
      (lf) => lf.hasInk && lf.nx + lf.nw > bandX0 && lf.nx < bandX1
    );

    if (sliceActivePx < 2 || overlapping.length === 0) {
      rawChannelScores[ch] = 0;
      sliceHasInk[ch] = false;
      chosenLeafPerChannel[ch] = null;
      continue;
    }

    sliceHasInk[ch] = true;
    const safeSlicePx = Math.max(1, slicePxCount);
    const sliceInkDensity = sliceInkSum / safeSlicePx;
    const sliceEdgeDensity = sliceEdgeSum / safeSlicePx;

    // B. Add ONLY fine-subdivision Quadtree richness (depth >= 2) weighted by true narrow overlap
    let fineLeafSum = 0;
    let fineWeight = 0;
    for (const lf of overlapping) {
      if (lf.depth < 2) continue;
      const ovLeft = Math.max(lf.nx, bandX0);
      const ovRight = Math.min(lf.nx + lf.nw, bandX1);
      const overlapFrac = Math.max(0.02, (ovRight - ovLeft) / Math.max(1e-5, bandWidth));
      const depthWeight = Math.pow(lf.depth / QUADTREE_MAX_DEPTH, 1.6);
      fineLeafSum += (lf.edgeEnergy * 1.15 + lf.detailScore * 0.85) * depthWeight * overlapFrac;
      fineWeight += overlapFrac;
    }
    const fineQuadtreeEnergy = fineWeight > 0 ? fineLeafSum / fineWeight : 0;

    // High-feature combined score strongly anchored to local column density & edge clusters
    const combinedScore =
      sliceInkDensity * 2.2 +
      sliceEdgeDensity * 3.1 +
      peakBandEnergy * 0.95 +
      fineQuadtreeEnergy * 0.55;

    rawChannelScores[ch] = combinedScore;
    if (combinedScore > maxRawScore) maxRawScore = combinedScore;

    // Pick the single best feature leaf for this channel's leader line
    let bestLeaf: QuadtreeNode | null = null;
    let bestPickScore = -Infinity;

    for (const lf of overlapping) {
      const cx = lf.nx + lf.nw * 0.5;
      const distPenalty = Math.abs(cx - bandCenterX) / Math.max(1e-4, normGridRect.nw);
      const reusePenalty = usedAnchorIds.has(lf.id) ? 0.55 : 0;
      const score =
        lf.depth * 0.45 +
        lf.detailScore * 1.35 +
        lf.edgeEnergy * 1.1 -
        distPenalty * 2.2 -
        reusePenalty;
      if (score > bestPickScore) {
        bestPickScore = score;
        bestLeaf = lf;
      }
    }

    if (bestLeaf) {
      usedAnchorIds.add(bestLeaf.id);
      chosenLeafPerChannel[ch] = bestLeaf;
    }
  }

  // Adaptive min-max contrast stretch across non-empty channels so bright focal peaks
  // blaze near 255 while sparse/light columns drop cleanly into deep lows (0..40)!
  const nonZeroScores = rawChannelScores
    .filter((v) => v > 0.002)
    .sort((a, b) => a - b);
  const lowBaseline =
    nonZeroScores.length >= 6
      ? nonZeroScores[Math.floor(nonZeroScores.length * 0.14)] * 0.72
      : 0;
  const effectiveCeil = Math.max(maxRawScore, lowBaseline + 0.08);
  const span = Math.max(1e-5, effectiveCeil - lowBaseline);

  const ledValues: number[] = [];
  const channelLinks: QuadtreeChannelLink[] = [];

  for (let ch = 0; ch < LED_CHANNEL_COUNT; ch++) {
    const raw = rawChannelScores[ch];
    const leaf = chosenLeafPerChannel[ch];

    if (!sliceHasInk[ch] || !leaf || raw <= 0.002 || maxRawScore <= 0.002) {
      ledValues.push(0);
      channelLinks.push({
        channelIndex: ch,
        value: 0,
        hasFeature: false,
        anchorNx:
          normGridRect.nx + ((ch + 0.5) / LED_CHANNEL_COUNT) * normGridRect.nw,
        anchorNy: normGridRect.ny + normGridRect.nh * 0.5,
        leafId: -1,
        leafDepth: 0,
        detailScore: 0,
      });
      continue;
    }

    const stretched = Math.max(0, Math.min(1, (raw - lowBaseline) / span));
    // High-contrast gamma expansion (> 1 expands peaks & deepens valleys!)
    const highContrast = Math.pow(stretched, 1.85);
    const value =
      highContrast < 0.045
        ? 0
        : Math.min(255, Math.round(highContrast * 255));

    ledValues.push(value);
    channelLinks.push({
      channelIndex: ch,
      value,
      hasFeature: value > 0,
      anchorNx: leaf.nx + leaf.nw * 0.5,
      anchorNy: leaf.ny + leaf.nh * 0.5,
      leafId: leaf.id,
      leafDepth: leaf.depth,
      detailScore: leaf.detailScore,
    });
  }

  return {
    ledValues,
    quadtreeNodes,
    quadtreeLeaves,
    channelLinks,
    normGridRect,
    maxDepthReached,
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
}

export const SETTLED_STRIP_Y_RATIO = 0.825;

export interface StripLayoutGeometry {
  stripX: number;
  stripW: number;
  topY: number;
  blockW: number;
  blockH: number;
  gap: number;
  plateTop: number;
  plateBottom: number;
  getChannelTopAnchor: (channelIndex: number) => { x: number; y: number };
}

/**
 * Computes exact geometry for the 30-CH industrial-sketch bar inside any target box
 * so Quadtree leader lines connect directly to each channel block's top tick!
 */
export function computeStripGeometry(
  centerX: number,
  centerY: number,
  stripW: number,
  blockH: number
): StripLayoutGeometry {
  const gap = Math.max(1.8, stripW * 0.0055);
  const blockW = (stripW - gap * (LED_CHANNEL_COUNT - 1)) / LED_CHANNEL_COUNT;
  const stripX = centerX - stripW / 2;
  const topY = centerY - blockH / 2;
  const rulePad = Math.max(5, blockH * 0.28);
  const plateTop = topY - rulePad - 17;
  const plateBottom = topY + blockH + rulePad + 29;

  return {
    stripX,
    stripW,
    topY,
    blockW,
    blockH,
    gap,
    plateTop,
    plateBottom,
    getChannelTopAnchor: (channelIndex: number) => ({
      x: stripX + channelIndex * (blockW + gap) + blockW * 0.5,
      y: topY - rulePad,
    }),
  };
}

/**
 * Renders the 30-CH Quadtree Detail strip in an authentic hand-drawn
 * Industrial Design Sketch aesthetic (jittery pencil/crayon lines, diagonal
 * graphite hatching, architectural overshoot ticks, and dark-cardstock chalk styling).
 */
export function drawIndustrialSketch30Strip(
  ctx: CanvasRenderingContext2D,
  ledValues: number[],
  centerX: number,
  centerY: number,
  stripW: number,
  blockH: number,
  revealCountFloat = LED_CHANNEL_COUNT,
  stripAlpha = 1,
  boilStep = 0,
  theme: "dark-cardstock" | "light-paper" = "dark-cardstock",
  subtitleText = "正在為畫作生成光的數據⋯",
  subtitlePulseAlpha = 1
): StripLayoutGeometry {
  const geom = computeStripGeometry(centerX, centerY, stripW, blockH);
  if (stripAlpha <= 0.005 || revealCountFloat <= 0) return geom;

  const { stripX, topY, blockW, gap } = geom;
  const rulePad = Math.max(5, blockH * 0.26);
  const fontSize = Math.max(8, Math.min(10.5, stripW * 0.022));
  const subFont = Math.max(12.5, Math.min(14.5, stripW * 0.036));
  const labelGap = Math.max(3, fontSize * 0.35);

  // Subtle 3-frame hand-drawn boiling rhythm
  const rng = createSeededRng(4093 + (boilStep % 3) * 197);

  const isDark = theme === "dark-cardstock";
  const plateFill = isDark
    ? "rgba(18, 18, 22, 0.88)"
    : "rgba(250, 249, 246, 0.94)";
  const frameStroke = isDark
    ? "rgba(243, 217, 139, 0.42)"
    : "rgba(34, 34, 34, 0.30)";
  const ruleStroke = isDark
    ? "rgba(250, 249, 246, 0.24)"
    : "rgba(34, 34, 34, 0.20)";
  const labelColor = isDark ? "rgba(250, 249, 246, 0.72)" : "#6E6D6A";
  const accentLabelColor = isDark ? "#F3D98B" : "#222222";
  const subLabelColor = isDark ? "#F7E5AE" : "#2B2A28";

  ctx.save();
  ctx.globalAlpha = stripAlpha;

  // 1. Hand-sketched drafting plate with architectural corner overshoot ticks
  const platePadX = Math.max(10, stripW * 0.024);
  const plateX = stripX - platePadX;
  const plateW = stripW + platePadX * 2;
  const plateH = geom.plateBottom - geom.plateTop;

  ctx.fillStyle = plateFill;
  ctx.fillRect(plateX, geom.plateTop, plateW, plateH);

  // Double-pass hand-sketched drafting outline
  drawSketchyRect(ctx, plateX, geom.plateTop, plateW, plateH, rng, {
    stepPx: Math.max(12, stripW * 0.045),
    jitterAmp: 0.55,
    lineWidth: 0.95,
    strokeStyle: frameStroke,
    overshoot: 3.4,
  });
  drawSketchyRect(ctx, plateX + 0.5, geom.plateTop + 0.5, plateW - 1, plateH - 1, rng, {
    stepPx: Math.max(16, stripW * 0.06),
    jitterAmp: 0.75,
    lineWidth: 0.5,
    strokeStyle: isDark ? "rgba(250, 249, 246, 0.14)" : "rgba(34, 34, 34, 0.10)",
    overshoot: 1.6,
  });

  // Top & bottom hand-ruled drafting guide rails
  const ruleOpts = {
    stepPx: Math.max(14, stripW * 0.05),
    jitterAmp: 0.45,
    lineWidth: 0.8,
    strokeStyle: ruleStroke,
    overshoot: 2.5,
  };
  drawSketchyLine(ctx, stripX, topY - rulePad, stripX + stripW, topY - rulePad, rng, ruleOpts);
  drawSketchyLine(
    ctx,
    stripX,
    topY + blockH + rulePad,
    stripX + stripW,
    topY + blockH + rulePad,
    rng,
    ruleOpts
  );

  // Micro monospace industrial-blueprint scale headers
  ctx.font = `400 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textBaseline = "bottom";
  ctx.fillStyle = labelColor;
  ctx.textAlign = "left";
  ctx.fillText("CH.01", stripX, topY - rulePad - labelGap);
  ctx.fillStyle = accentLabelColor;
  ctx.textAlign = "center";
  ctx.fillText("QUADTREE DETAIL // 30-CH", centerX, topY - rulePad - labelGap);
  ctx.fillStyle = labelColor;
  ctx.textAlign = "right";
  ctx.fillText("CH.30", stripX + stripW, topY - rulePad - labelGap);

  // 2. Render 30 individual crayon/pencil-hatched industrial value cells
  for (let i = 0; i < LED_CHANNEL_COUNT; i++) {
    const localReveal = Math.max(0, Math.min(1, revealCountFloat - i));
    if (localReveal <= 0) continue;

    const val = ledValues[i] ?? 0;
    const t = val / 255;

    const bx = stripX + i * (blockW + gap);
    const hScale = 0.2 + 0.8 * localReveal;
    const bh = blockH * hScale;
    const by = centerY - bh / 2;

    if (isDark) {
      // Matte dark slot -> warm cream-gold (#F3D98B) & chalk-white crayon fill by richness
      const baseAlpha = 0.06 + t * 0.82;
      ctx.fillStyle =
        t > 0.05
          ? `rgba(243, 217, 139, ${baseAlpha.toFixed(3)})`
          : "rgba(250, 249, 246, 0.05)";
      ctx.fillRect(bx, by, blockW, bh);
    } else {
      const r = Math.round(236 + (34 - 236) * t);
      const g = Math.round(236 + (34 - 236) * t);
      const b = Math.round(232 + (34 - 232) * t);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(bx, by, blockW, bh);
    }

    // Diagonal industrial-sketch pencil hatching lines inside active bars
    if (t > 0.06) {
      const hatchCount = Math.max(2, Math.round(2 + t * 5));
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, blockW, bh);
      ctx.clip();
      ctx.strokeStyle = isDark
        ? `rgba(255, 252, 242, ${(0.22 + t * 0.42).toFixed(2)})`
        : `rgba(34, 34, 34, ${(0.22 + t * 0.45).toFixed(2)})`;
      ctx.lineWidth = 0.7;
      for (let h = 0; h < hatchCount; h++) {
        const hy = by + ((h + 0.5) / hatchCount) * bh;
        ctx.beginPath();
        ctx.moveTo(bx - 1, hy + 2.5 + (rng() - 0.5) * 1.1);
        ctx.lineTo(bx + blockW + 1, hy - 2.5 + (rng() - 0.5) * 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Dry crayon grain noise specks
    const speckCount = Math.max(2, Math.round(blockW * 0.35));
    for (let s = 0; s < speckCount; s++) {
      const gx = bx + rng() * Math.max(1, blockW - 1);
      const gy = by + rng() * Math.max(1, bh - 1);
      ctx.fillStyle = isDark
        ? `rgba(11, 11, 13, ${(0.12 + rng() * 0.16).toFixed(2)})`
        : `rgba(250, 249, 246, ${(0.1 + rng() * 0.14).toFixed(2)})`;
      ctx.fillRect(gx, gy, 1.1, 1.1);
    }

    // Hand-sketched jittery cell outline
    drawSketchyRect(ctx, bx, by, blockW, bh, rng, {
      stepPx: Math.max(5, blockH * 0.48),
      jitterAmp: 0.32,
      lineWidth: t > 0.3 ? 0.92 : 0.65,
      strokeStyle: isDark
        ? t > 0.25
          ? "rgba(250, 249, 246, 0.78)"
          : "rgba(250, 249, 246, 0.22)"
        : t > 0.35
          ? "rgba(34, 34, 34, 0.85)"
          : "rgba(34, 34, 34, 0.24)",
    });

    // Bottom drafting calibration ticks every 5 channels
    if (i === 0 || i === 14 || i === 29 || (i + 1) % 5 === 0) {
      const tickTop = topY + blockH + rulePad;
      const tickLen =
        i === 0 || i === 14 || i === 29 ? rulePad * 0.95 : rulePad * 0.5;
      drawSketchyLine(
        ctx,
        bx + blockW / 2,
        tickTop,
        bx + blockW / 2,
        tickTop + tickLen,
        rng,
        {
          stepPx: Math.max(3, tickLen * 0.5),
          jitterAmp: 0.25,
          lineWidth: 0.8,
          strokeStyle: isDark
            ? "rgba(243, 217, 139, 0.55)"
            : "rgba(34, 34, 34, 0.45)",
        }
      );
    }
  }

  // Bottom prominent light-data explanation caption
  ctx.save();
  ctx.globalAlpha = stripAlpha * Math.max(0.68, Math.min(1, subtitlePulseAlpha));
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillStyle = subLabelColor;
  const subFontStack =
    typeof window !== "undefined"
      ? `${window.getComputedStyle(document.body).fontFamily}, "IBM Plex Mono", sans-serif`
      : '"Noto Sans TC", "IBM Plex Mono", sans-serif';
  ctx.font = `500 ${subFont.toFixed(1)}px ${subFontStack}`;
  ctx.fillText(
    subtitleText,
    centerX,
    topY + blockH + rulePad + Math.max(6, subFont * 0.48),
    plateW - 14
  );
  ctx.restore();

  ctx.restore();
  return geom;
}

/**
 * Legacy helper kept for ZFoldLetterScene 3D texture compatibility.
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
  const padX = Math.max(20, canvasW * 0.072);
  const stripW = canvasW - padX * 2;
  const blockH = Math.max(14, canvasH * 0.048);
  drawIndustrialSketch30Strip(
    ctx,
    ledValues,
    canvasW * 0.5,
    canvasH * centerYRatio,
    stripW,
    blockH,
    revealCountFloat,
    stripAlpha,
    0,
    "light-paper"
  );
}
