export type TelemetryEventType = "INSERT" | "DELETE" | "COMPOSE";

/**
 * Privacy-first de-identified keystroke telemetry event.
 * Never stores actual typed characters or text content.
 */
export interface TelemetryEvent {
  id: number;
  /** High-resolution timestamp from performance.now() */
  timestamp: number;
  /** Elapsed time in ms since the first recorded event of the current session */
  elapsedMs: number;
  /** Inter-Key Interval in ms from the previous effective event */
  ikiMs: number | null;
  /** Single commit / input character length (e.g., 1 for single key, 2-4 for IME phrase) */
  charLength: number;
  /** Typing / IME composition duration in ms (compose duration for IME, IKI for direct key) */
  typingDurationMs: number;
  /** Absolute difference between current interval and previous interval (Δ IKI in ms) */
  deltaPrevMs: number | null;
  /** Instantaneous velocity in CPM derived from IKI & charLength */
  instantCpm: number | null;
  /** Event classification */
  type: TelemetryEventType;
  /** Convenience flag for deletion / backspace correction events */
  isDelete: boolean;
  /** Number of characters affected (kept in sync with charLength) */
  deltaCount: number;
  /** IME composition duration in ms (compositionend - compositionstart) */
  composeDurationMs?: number;
  /** Elapsed time in ms when composition started (for timeline interval rendering) */
  composeStartElapsedMs?: number;
  /** True when ikiMs exceeds the 800ms hesitation pause threshold */
  isPause: boolean;
}

export interface Point2D {
  x: number;
  y: number;
  eventId: number;
  type: TelemetryEventType;
}

export interface TelemetrySummary {
  totalEvents: number;
  totalDurationMs: number;
  latestCharLength: number | null;
  latestTypingDurationMs: number | null;
  latestDeltaPrevMs: number | null;
  latestIkiMs: number | null;
  avgIkiMs: number | null;
  windowCpm: number | null;
  avgCpm: number | null;
  windowSpeedSd: number | null;
  overallSpeedSd: number | null;
  correctionRate: number;
  deleteCount: number;
  hesitationPauses: number;
  currentBurstLength: number;
  maxBurstLength: number;
  avgBurstLength: number | null;
  latestImeDurationMs: number | null;
  avgImeDurationMs: number | null;
  radarPoints: Point2D[];
  convexHull: Point2D[];
}

export const HESITATION_THRESHOLD_MS = 800;
const SLIDING_WINDOW_SIZE = 12;
const MAX_INSTANT_CPM = 1200;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute instantaneous CPM from an event's IKI (ms) and character delta.
 */
export function computeInstantCpm(
  ikiMs: number | null,
  charLength: number
): number | null {
  if (ikiMs === null || ikiMs <= 0) return null;
  const effectiveIki = Math.max(ikiMs, 25);
  const rawCpm = (Math.max(1, charLength) * 60000) / effectiveIki;
  return clamp(Math.round(rawCpm), 1, MAX_INSTANT_CPM);
}

/**
 * Standard deviation helper (population SD).
 */
export function computeStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Andrew's Monotone Chain algorithm for 2D Convex Hull.
 * Returns hull vertices in counter-clockwise order.
 */
export function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 1) return [...points];

  const sorted = [...points].sort((a, b) =>
    Math.abs(a.x - b.x) > 1e-6 ? a.x - b.x : a.y - b.y
  );

  const unique: Point2D[] = [];
  for (const pt of sorted) {
    const prev = unique[unique.length - 1];
    if (
      !prev ||
      Math.abs(pt.x - prev.x) > 1e-5 ||
      Math.abs(pt.y - prev.y) > 1e-5
    ) {
      unique.push(pt);
    }
  }

  if (unique.length <= 2) return unique;

  const lower: Point2D[] = [];
  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Compute all real-time and aggregate telemetry metrics plus 2D radar points and convex hull.
 */
export function computeTelemetrySummary(
  events: TelemetryEvent[]
): TelemetrySummary {
  const totalEvents = events.length;
  if (totalEvents === 0) {
    return {
      totalEvents: 0,
      totalDurationMs: 0,
      latestCharLength: null,
      latestTypingDurationMs: null,
      latestDeltaPrevMs: null,
      latestIkiMs: null,
      avgIkiMs: null,
      windowCpm: null,
      avgCpm: null,
      windowSpeedSd: null,
      overallSpeedSd: null,
      correctionRate: 0,
      deleteCount: 0,
      hesitationPauses: 0,
      currentBurstLength: 0,
      maxBurstLength: 0,
      avgBurstLength: null,
      latestImeDurationMs: null,
      avgImeDurationMs: null,
      radarPoints: [],
      convexHull: [],
    };
  }

  const lastEvent = events[totalEvents - 1];
  const totalDurationMs = lastEvent.elapsedMs;

  const ikiValues: number[] = [];
  const allInstantCpms: number[] = [];
  const imeDurations: number[] = [];
  let deleteCount = 0;
  let hesitationPauses = 0;

  const completedBursts: number[] = [];
  let currentBurstLength = 0;
  let maxBurstLength = 0;

  const radarPoints: Point2D[] = [];
  let prevInstantCpm: number | null = null;

  for (const ev of events) {
    if (ev.isDelete) {
      deleteCount += 1;
    }

    if (ev.ikiMs !== null) {
      ikiValues.push(ev.ikiMs);
      if (ev.ikiMs > HESITATION_THRESHOLD_MS) {
        hesitationPauses += 1;
        if (currentBurstLength > 0) {
          completedBursts.push(currentBurstLength);
          currentBurstLength = 0;
        }
      }
    }

    if (!ev.isDelete) {
      currentBurstLength += Math.max(1, ev.charLength);
      if (currentBurstLength > maxBurstLength) {
        maxBurstLength = currentBurstLength;
      }
    }

    if (ev.composeDurationMs !== undefined) {
      imeDurations.push(ev.composeDurationMs);
    }

    if (ev.instantCpm !== null) {
      allInstantCpms.push(ev.instantCpm);

      if (ev.ikiMs !== null) {
        const normX = clamp(
          Math.log1p(ev.ikiMs) / Math.log1p(1400),
          0.05,
          0.95
        );
        const deltaV =
          prevInstantCpm !== null ? ev.instantCpm - prevInstantCpm : 0;
        const normY = clamp(0.5 + deltaV / 700, 0.06, 0.94);

        radarPoints.push({
          x: normX,
          y: normY,
          eventId: ev.id,
          type: ev.type,
        });
      }

      prevInstantCpm = ev.instantCpm;
    }
  }

  const allBursts =
    currentBurstLength > 0
      ? [...completedBursts, currentBurstLength]
      : completedBursts;
  const avgBurstLength =
    allBursts.length > 0
      ? allBursts.reduce((a, b) => a + b, 0) / allBursts.length
      : null;

  const latestIkiMs =
    ikiValues.length > 0 ? ikiValues[ikiValues.length - 1] : null;
  const avgIkiMs =
    ikiValues.length > 0
      ? ikiValues.reduce((a, b) => a + b, 0) / ikiValues.length
      : null;

  const windowEvents = events.slice(-SLIDING_WINDOW_SIZE);
  const windowCpms = windowEvents
    .map((e) => e.instantCpm)
    .filter((v): v is number => v !== null);

  let windowCpm: number | null = null;
  if (windowEvents.length >= 2) {
    const windowSpanMs =
      windowEvents[windowEvents.length - 1].elapsedMs -
      windowEvents[0].elapsedMs;
    const windowChars = windowEvents
      .slice(1)
      .reduce((acc, e) => acc + (e.isDelete ? 0 : e.charLength), 0);
    if (windowSpanMs > 50 && windowChars > 0) {
      windowCpm = clamp(
        Math.round((windowChars * 60000) / windowSpanMs),
        1,
        MAX_INSTANT_CPM
      );
    } else if (windowCpms.length > 0) {
      windowCpm = Math.round(
        windowCpms.reduce((a, b) => a + b, 0) / windowCpms.length
      );
    }
  } else if (windowCpms.length > 0) {
    windowCpm = windowCpms[windowCpms.length - 1];
  }

  const totalInsertedChars = events.reduce(
    (acc, e) => acc + (e.isDelete ? 0 : e.charLength),
    0
  );
  const avgCpm =
    totalDurationMs > 100 && totalInsertedChars > 1
      ? clamp(
          Math.round((totalInsertedChars * 60000) / totalDurationMs),
          1,
          MAX_INSTANT_CPM
        )
      : windowCpm;

  const windowSpeedSd = computeStandardDeviation(windowCpms);
  const overallSpeedSd = computeStandardDeviation(allInstantCpms);

  const correctionRate = (deleteCount / totalEvents) * 100;

  const latestImeDurationMs =
    imeDurations.length > 0 ? imeDurations[imeDurations.length - 1] : null;
  const avgImeDurationMs =
    imeDurations.length > 0
      ? imeDurations.reduce((a, b) => a + b, 0) / imeDurations.length
      : null;

  const convexHull = computeConvexHull(radarPoints);

  return {
    totalEvents,
    totalDurationMs,
    latestCharLength: lastEvent.charLength,
    latestTypingDurationMs: lastEvent.typingDurationMs,
    latestDeltaPrevMs: lastEvent.deltaPrevMs,
    latestIkiMs,
    avgIkiMs,
    windowCpm,
    avgCpm,
    windowSpeedSd,
    overallSpeedSd,
    correctionRate,
    deleteCount,
    hesitationPauses,
    currentBurstLength,
    maxBurstLength,
    avgBurstLength,
    latestImeDurationMs,
    avgImeDurationMs,
    radarPoints,
    convexHull,
  };
}
