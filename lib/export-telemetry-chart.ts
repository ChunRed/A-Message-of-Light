import {
  HESITATION_THRESHOLD_MS,
  TelemetryEvent,
  TelemetrySummary,
} from "./keystroke-telemetry";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

/**
 * Generates an engineering-blueprint standalone SVG string of the
 * real-time-axis Keystroke Dynamics telemetry report.
 */
export function buildTelemetryReportSvg(
  events: TelemetryEvent[],
  summary: TelemetrySummary
): string {
  const W = 1200;
  const H = 740;

  // Layout regions
  const padL = 78;
  const padR = 46;
  const headerTop = 24;
  const summaryTop = 74;
  const summaryH = 74;
  const chartTop = 186;
  const chartBottom = 640;
  const chartLeft = padL;
  const chartRight = W - padR;
  const chartW = chartRight - chartLeft;
  const chartH = chartBottom - chartTop;

  const totalSec = Math.max(summary.totalDurationMs / 1000, 0.5);
  // Slight right headroom on time axis so final point & label fit cleanly
  const maxTimeMs = Math.max(summary.totalDurationMs * 1.04, 500);

  // Determine Y-axis max (IKI in ms) with nice ceiling
  const maxEventIki = events.reduce((acc, ev) => {
    const val = ev.ikiMs ?? 0;
    return val > acc ? val : acc;
  }, 0);
  const rawYMax = Math.max(maxEventIki * 1.18, 400);
  const yStep =
    rawYMax <= 500
      ? 100
      : rawYMax <= 1000
        ? 200
        : rawYMax <= 2500
          ? 500
          : 1000;
  const yMax = Math.ceil(rawYMax / yStep) * yStep;

  const mapX = (elapsedMs: number) =>
    chartLeft + (elapsedMs / maxTimeMs) * chartW;
  const mapY = (ikiMs: number) =>
    chartBottom - (Math.min(ikiMs, yMax) / yMax) * chartH;

  // Format summary stats
  const fmtDuration = `${(summary.totalDurationMs / 1000).toFixed(2)}s`;
  const fmtAvgIki =
    summary.avgIkiMs !== null ? `${Math.round(summary.avgIkiMs)}ms` : "--";
  const fmtAvgCpm = summary.avgCpm !== null ? `${summary.avgCpm}` : "--";
  const fmtSpeedSd =
    summary.overallSpeedSd !== null
      ? `${Math.round(summary.overallSpeedSd)}`
      : "--";
  const fmtDelRate = `${summary.correctionRate.toFixed(1)}%`;
  const fmtPauses = `${summary.hesitationPauses}`;
  const fmtBurst = `${summary.maxBurstLength}`;
  const nowIso = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const summaryItems = [
    { label: "DURATION", value: fmtDuration },
    { label: "EVENTS", value: `${summary.totalEvents}` },
    { label: "AVG IKI", value: fmtAvgIki },
    { label: "AVG VELOCITY", value: `${fmtAvgCpm} CPM` },
    { label: "SPEED SD", value: `${fmtSpeedSd} CPM` },
    { label: "DEL RATE", value: fmtDelRate },
    { label: "PAUSES >800ms", value: fmtPauses },
    { label: "MAX BURST", value: fmtBurst },
  ];

  const colW = (W - padL - padR) / summaryItems.length;
  const summaryCellsSvg = summaryItems
    .map((item, idx) => {
      const x = padL + idx * colW;
      const divider =
        idx > 0
          ? `<line x1="${x.toFixed(1)}" y1="${summaryTop + 12}" x2="${x.toFixed(1)}" y2="${summaryTop + summaryH - 12}" stroke="#E5E7EB" stroke-width="1"/>`
          : "";
      return `
        ${divider}
        <text x="${(x + 12).toFixed(1)}" y="${summaryTop + 26}" font-size="10" fill="#71717A" letter-spacing="0.08em">${escapeXml(item.label)}</text>
        <text x="${(x + 12).toFixed(1)}" y="${summaryTop + 54}" font-size="18" font-weight="600" fill="#111111">${escapeXml(item.value)}</text>
      `;
    })
    .join("");

  // Y-axis grid & ticks
  const yGridLines: string[] = [];
  for (let v = 0; v <= yMax; v += yStep) {
    const y = mapY(v);
    yGridLines.push(`
      <line x1="${chartLeft}" y1="${y.toFixed(1)}" x2="${chartRight}" y2="${y.toFixed(1)}" stroke="${v === 0 ? "#111111" : "#E5E7EB"}" stroke-width="${v === 0 ? 1.2 : 1}" ${v > 0 ? 'stroke-dasharray="3 3"' : ""}/>
      <text x="${chartLeft - 10}" y="${(y + 4).toFixed(1)}" font-size="10.5" fill="#52525B" text-anchor="end">${v}ms</text>
    `);
  }

  // Hesitation pause threshold line (800ms)
  let pauseThresholdSvg = "";
  if (HESITATION_THRESHOLD_MS <= yMax) {
    const py = mapY(HESITATION_THRESHOLD_MS);
    pauseThresholdSvg = `
      <line x1="${chartLeft}" y1="${py.toFixed(1)}" x2="${chartRight}" y2="${py.toFixed(1)}" stroke="#A1A1AA" stroke-width="1" stroke-dasharray="6 4"/>
      <rect x="${chartRight - 134}" y="${(py - 16).toFixed(1)}" width="130" height="14" fill="#FFFFFF"/>
      <text x="${chartRight - 6}" y="${(py - 5).toFixed(1)}" font-size="9.5" fill="#71717A" text-anchor="end">PAUSE THRESHOLD 800ms</text>
    `;
  }

  // X-axis (True elapsed time) grid & ticks
  const xTickCount = Math.min(10, Math.max(4, Math.ceil(totalSec)));
  const xGridLines: string[] = [];
  for (let i = 0; i <= xTickCount; i++) {
    const tMs = (maxTimeMs * i) / xTickCount;
    const x = mapX(tMs);
    const label = `${(tMs / 1000).toFixed(1)}s`;
    xGridLines.push(`
      <line x1="${x.toFixed(1)}" y1="${chartTop}" x2="${x.toFixed(1)}" y2="${chartBottom}" stroke="#F4F4F5" stroke-width="1"/>
      <line x1="${x.toFixed(1)}" y1="${chartBottom}" x2="${x.toFixed(1)}" y2="${chartBottom + 6}" stroke="#111111" stroke-width="1"/>
      <text x="${x.toFixed(1)}" y="${chartBottom + 20}" font-size="10.5" fill="#52525B" text-anchor="middle">${label}</text>
    `);
  }

  // Data series: polyline, pulse stems, IME horizontal interval bars, markers, smart value labels
  const polylinePts: string[] = [];
  const pulseStemsSvg: string[] = [];
  const imeIntervalsSvg: string[] = [];
  const markersSvg: string[] = [];
  const labelsSvg: string[] = [];
  const placedBoxes: LabelBox[] = [];

  events.forEach((ev, idx) => {
    const x = mapX(ev.elapsedMs);
    const val = ev.ikiMs ?? 0;
    const y = mapY(val);

    if (ev.ikiMs !== null) {
      polylinePts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      pulseStemsSvg.push(
        `<line x1="${x.toFixed(1)}" y1="${chartBottom}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${ev.type === "DELETE" ? "#DC2626" : "#D4D4D8"}" stroke-width="${ev.type === "DELETE" ? "1.1" : "1"}" ${ev.type === "DELETE" ? 'stroke-dasharray="2 2"' : ""}/>`
      );
    } else if (idx === 0) {
      polylinePts.push(`${x.toFixed(1)},${chartBottom.toFixed(1)}`);
    }

    // IME horizontal composition interval line
    if (
      ev.type === "COMPOSE" &&
      ev.composeStartElapsedMs !== undefined &&
      ev.composeDurationMs !== undefined
    ) {
      const sx = mapX(ev.composeStartElapsedMs);
      const barY = Math.max(chartTop + 8, Math.min(chartBottom - 8, y));
      imeIntervalsSvg.push(`
        <line x1="${sx.toFixed(1)}" y1="${barY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${barY.toFixed(1)}" stroke="#111111" stroke-width="2" stroke-dasharray="4 2"/>
        <line x1="${sx.toFixed(1)}" y1="${(barY - 5).toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(barY + 5).toFixed(1)}" stroke="#111111" stroke-width="1.4"/>
      `);
    }

    // Geometric marker by event type
    if (ev.type === "DELETE") {
      const r = 4.2;
      markersSvg.push(`
        <g stroke="#DC2626" stroke-width="1.6">
          <line x1="${(x - r).toFixed(1)}" y1="${(y - r).toFixed(1)}" x2="${(x + r).toFixed(1)}" y2="${(y + r).toFixed(1)}"/>
          <line x1="${(x - r).toFixed(1)}" y1="${(y + r).toFixed(1)}" x2="${(x + r).toFixed(1)}" y2="${(y - r).toFixed(1)}"/>
        </g>
      `);
    } else if (ev.type === "COMPOSE") {
      markersSvg.push(`
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#FFFFFF" stroke="#111111" stroke-width="1.8"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="#111111"/>
      `);
    } else {
      markersSvg.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="#111111"/>`
      );
    }

    // Node value label with smart anti-overlap placement
    const labelText =
      ev.ikiMs !== null
        ? ev.type === "COMPOSE" && ev.composeDurationMs !== undefined
          ? `${Math.round(ev.ikiMs)}ms·IME${ev.composeDurationMs}`
          : `${Math.round(ev.ikiMs)}ms`
        : "0ms";

    const approxCharW = 5.8;
    const boxW = labelText.length * approxCharW + 6;
    const boxH = 13;

    // Candidate vertical offsets around the node
    const candidateOffsets = [-11, -24, 17, -37, 30, -50, 43];
    let chosenY: number | null = null;

    for (const dy of candidateOffsets) {
      const textY = y + dy;
      const clampedX = Math.max(
        chartLeft + boxW / 2 + 2,
        Math.min(chartRight - boxW / 2 - 2, x)
      );
      const box: LabelBox = {
        x1: clampedX - boxW / 2,
        y1: textY - boxH + 2,
        x2: clampedX + boxW / 2,
        y2: textY + 2,
      };
      if (box.y1 < chartTop + 2 || box.y2 > chartBottom - 2) continue;
      if (!placedBoxes.some((b) => overlaps(b, box))) {
        placedBoxes.push(box);
        chosenY = textY;

        // Draw subtle leader line if label had to be displaced vertically
        if (Math.abs(dy) >= 22) {
          const lineEndY = dy < 0 ? textY + 3 : textY - 10;
          labelsSvg.push(
            `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${clampedX.toFixed(1)}" y2="${lineEndY.toFixed(1)}" stroke="#D4D4D8" stroke-width="0.8"/>`
          );
        }

        labelsSvg.push(`
          <rect x="${(box.x1 - 1).toFixed(1)}" y="${box.y1.toFixed(1)}" width="${(boxW + 2).toFixed(1)}" height="${boxH}" fill="#FFFFFF" fill-opacity="0.82"/>
          <text x="${clampedX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="9.5" fill="${ev.type === "DELETE" ? "#DC2626" : "#18181B"}" text-anchor="middle">${escapeXml(labelText)}</text>
        `);
        break;
      }
    }

    // Always ensure first & last points have a label even in ultra-dense bursts
    if (chosenY === null && (idx === 0 || idx === events.length - 1)) {
      const fallbackY = Math.max(chartTop + 14, y - 11);
      const clampedX = Math.max(
        chartLeft + boxW / 2 + 2,
        Math.min(chartRight - boxW / 2 - 2, x)
      );
      labelsSvg.push(
        `<text x="${clampedX.toFixed(1)}" y="${fallbackY.toFixed(1)}" font-size="9.5" fill="#18181B" text-anchor="middle">${escapeXml(labelText)}</text>`
      );
    }
  });

  // Corner registration crosshairs helper
  const crosshair = (cx: number, cy: number) => `
    <g stroke="#111111" stroke-width="1">
      <line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}"/>
      <line x1="${cx}" y1="${cy - 6}" x2="${cx}" y2="${cy + 6}"/>
    </g>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>

  <!-- Outer engineering frame -->
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="#111111" stroke-width="1"/>
  ${crosshair(16, 16)}
  ${crosshair(W - 16, 16)}
  ${crosshair(16, H - 16)}
  ${crosshair(W - 16, H - 16)}

  <!-- Header bar -->
  <polygon points="${padL},${headerTop + 8} ${padL + 8},${headerTop} ${padL + 365},${headerTop} ${padL + 365},${headerTop + 32} ${padL},${headerTop + 32}" fill="#111111"/>
  <text x="${padL + 16}" y="${headerTop + 21}" font-size="12" font-weight="600" fill="#FFFFFF" letter-spacing="0.1em">SYS.TELEMETRY // 30-CH_LIGHT_ARRAY</text>
  <text x="${W - padR}" y="${headerTop + 20}" font-size="11" fill="#52525B" text-anchor="end">ROUTE_B · PRIVACY DE-IDENTIFIED · ${escapeXml(nowIso)}</text>

  <!-- Summary telemetry strip -->
  <rect x="${padL}" y="${summaryTop}" width="${W - padL - padR}" height="${summaryH}" fill="#FAFAFA" stroke="#D4D4D8" stroke-width="1"/>
  ${summaryCellsSvg}

  <!-- Chart section title -->
  <text x="${chartLeft}" y="${chartTop - 12}" font-size="11" font-weight="600" fill="#111111" letter-spacing="0.08em">REAL-TIME AXIS :: INTER-KEY INTERVAL (IKI ms) vs ELAPSED TIME (s)</text>

  <!-- Legend -->
  <g transform="translate(${chartRight - 360}, ${chartTop - 16})" font-size="10" fill="#52525B">
    <circle cx="0" cy="-3" r="3.4" fill="#111111"/>
    <text x="9" y="0">INSERT</text>

    <g stroke="#DC2626" stroke-width="1.5" transform="translate(76, -3)">
      <line x1="-3.5" y1="-3.5" x2="3.5" y2="3.5"/>
      <line x1="-3.5" y1="3.5" x2="3.5" y2="-3.5"/>
    </g>
    <text x="86" y="0">DELETE</text>

    <line x1="154" y1="-3" x2="176" y2="-3" stroke="#111111" stroke-width="2" stroke-dasharray="4 2"/>
    <circle cx="176" cy="-3" r="4" fill="#FFFFFF" stroke="#111111" stroke-width="1.5"/>
    <text x="186" y="0">IME COMPOSE INTERVAL</text>
  </g>

  <!-- Chart frame -->
  <rect x="${chartLeft}" y="${chartTop}" width="${chartW}" height="${chartH}" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1"/>
  ${crosshair(chartLeft, chartTop)}
  ${crosshair(chartRight, chartTop)}

  <!-- Gridlines -->
  ${yGridLines.join("")}
  ${xGridLines.join("")}
  ${pauseThresholdSvg}

  <!-- Pulse stems -->
  ${pulseStemsSvg.join("")}

  <!-- IME horizontal composition intervals -->
  ${imeIntervalsSvg.join("")}

  <!-- IKI Polyline -->
  ${
    polylinePts.length >= 2
      ? `<polyline points="${polylinePts.join(" ")}" fill="none" stroke="#111111" stroke-width="1.5" stroke-linejoin="miter"/>`
      : ""
  }

  <!-- Data node markers -->
  ${markersSvg.join("")}

  <!-- Node value annotations -->
  ${labelsSvg.join("")}

  <!-- Axis captions -->
  <text x="${(chartLeft + chartRight) / 2}" y="${chartBottom + 44}" font-size="11" fill="#111111" text-anchor="middle" letter-spacing="0.1em">ELAPSED TIME (SECONDS)</text>
  <text x="26" y="${(chartTop + chartBottom) / 2}" font-size="11" fill="#111111" text-anchor="middle" letter-spacing="0.1em" transform="rotate(-90 26 ${(chartTop + chartBottom) / 2})">INTER-KEY INTERVAL (ms)</text>

  <!-- Footer -->
  <text x="${chartLeft}" y="${H - 28}" font-size="9.5" fill="#71717A">LIGHT-MSG-WEB // TELEMETRY REPORT · NO RAW TEXT CONTENT RECORDED</text>
  <text x="${chartRight}" y="${H - 28}" font-size="9.5" fill="#71717A" text-anchor="end">SCALE: 2X RETINA PNG</text>
</svg>`;
}

/**
 * Renders the generated SVG onto a 2x Retina HTML5 Canvas and returns a PNG data URL.
 */
export async function renderTelemetryReportPng(
  events: TelemetryEvent[],
  summary: TelemetrySummary
): Promise<{ dataUrl: string; filename: string }> {
  const svgString = buildTelemetryReportSvg(events, summary);
  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (err) => reject(err);
      image.src = url;
    });

    const scale = 2; // 2x Retina resolution (2400 x 1480)
    const canvas = document.createElement("canvas");
    canvas.width = 1200 * scale;
    canvas.height = 740 * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, 1200, 740);

    const dataUrl = canvas.toDataURL("image/png");
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const filename = `keystroke-telemetry-${stamp}.png`;

    return { dataUrl, filename };
  } finally {
    URL.revokeObjectURL(url);
  }
}
