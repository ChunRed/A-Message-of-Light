import { clamp } from "./keystroke-telemetry";

export const LIGHT_NODE_COUNT = 30;

export interface LightPulseInput {
  /** Single commit/input character length (1 for single key, 2-4+ for word/phrase) */
  charLength: number;
  /** Typing or IME composition duration in ms */
  typingDurationMs: number;
  /** Interval difference from previous event (Δ IKI in ms) */
  deltaPrevMs: number;
  /** Instantaneous or sliding-window velocity in CPM */
  velocityCpm: number;
  /** Speed variability SD in CPM */
  variabilitySd: number;
  /** Whether this pulse represents a deletion/backspace event */
  isDelete: boolean;
}

export interface ActiveLightPulse extends LightPulseInput {
  id: number;
  /** performance.now() when emitted at HEAD (Node 01) */
  startTime: number;
  /** Wave propagation speed in nodes per second */
  speedNodesPerSec: number;
  /** Gaussian leading edge sigma in ms */
  leadSigmaMs: number;
  /** Trailing decay constant in ms (~450-550ms full decay back to idle) */
  decayTauMs: number;
}

export interface LightNodeShapeParams {
  /** 1..3 concentric rings driven by charLength */
  ringCount: number;
  /** Core solid black dot scale factor [0..1] driven by charLength & intensity */
  coreScale: number;
  /** Translucent grayscale halo radius factor [0..1] driven by typingDuration */
  haloScale: number;
  /** Translucent grayscale halo opacity [0.12..0.65] when active, 0 when idle */
  haloOpacity: number;
  /** Symmetric vertical waveform needle amplitude [0..1] driven by deltaPrev & burst */
  needleAmplitude: number;
  /** Graphic score horizontal bar vertical position [-1 (bottom) .. +1 (top)] driven by velocity */
  barOffsetY: number;
  /** Graphic score horizontal bar thickness [0..1] driven by velocity */
  barThicknessNorm: number;
  /** When true, horizontal bar renders as hollow frame / X cross mark */
  isDelete: boolean;
}

/**
 * Hardware-ready state snapshot for a single channel (01..30).
 * Can be serialized directly over WebSocket or Web Serial to drive a 30-LED physical strip.
 */
export interface LightNodeState {
  /** 1-based physical channel index (1 = HEAD/IN, 30 = TAIL/OUT) */
  index: number;
  /** Normalized activation intensity [0..1] (maps cleanly to 0..255 PWM) */
  intensity: number;
  /** Normalized overall geometric size [0..1] */
  size: number;
  /** Normalized overall visual opacity [0..1] */
  opacity: number;
  /** Detailed geometric parameters for Graphic Score rendering */
  shapeParams: LightNodeShapeParams;
}

const DEFAULT_SPEED_NODES_PER_SEC = 16.5; // ~1.8s head-to-tail travel across 30 nodes
const DEFAULT_LEAD_SIGMA_MS = 85; // crisp Gaussian wavefront rise
const DEFAULT_DECAY_TAU_MS = 265; // smooth ~450-550ms trailing decay back to idle
const PULSE_PRUNE_MARGIN_MS = 950;

/**
 * Computes the asymmetric Gaussian wave envelope for a single pulse at a given node index (0..29).
 */
function evaluatePulseEnvelope(
  pulse: ActiveLightPulse,
  nodeZeroIdx: number,
  now: number
): number {
  const arrivalTime =
    pulse.startTime + (nodeZeroIdx / pulse.speedNodesPerSec) * 1000;
  const dt = now - arrivalTime;

  if (dt < 0) {
    // Smooth Gaussian leading edge before crest arrives
    const ratio = dt / pulse.leadSigmaMs;
    if (ratio < -3.5) return 0;
    return Math.exp(-(ratio * ratio));
  } else {
    // Smooth 400ms~600ms trailing decay after crest passes
    const ratio = dt / pulse.decayTauMs;
    if (ratio > 3.6) return 0;
    return Math.exp(-Math.pow(ratio, 1.55));
  }
}

/**
 * Stateful 30-node Gaussian Light-Flow propagation engine.
 * Designed to run at 60fps outside React state and expose hardware-ready arrays.
 */
export class LightFlowEngine {
  private pulses: ActiveLightPulse[] = [];
  private nextPulseId = 1;

  /**
   * Emits a new keystroke telemetry pulse at Node 01 (HEAD).
   */
  public emitPulse(input: LightPulseInput, now = performance.now()): void {
    // Slight speed modulation from velocity so fast bursts feel taut and brisk
    const velBoost = clamp((input.velocityCpm - 120) / 600, -0.1, 0.25);
    const speedNodesPerSec = DEFAULT_SPEED_NODES_PER_SEC * (1 + velBoost);

    this.pulses.push({
      ...input,
      id: this.nextPulseId++,
      startTime: now,
      speedNodesPerSec,
      leadSigmaMs: DEFAULT_LEAD_SIGMA_MS,
      decayTauMs: DEFAULT_DECAY_TAU_MS,
    });

    // Cap concurrent pulses defensively
    if (this.pulses.length > 48) {
      this.pulses.splice(0, this.pulses.length - 48);
    }
  }

  /**
   * Immediately halts all active light-flow waves and resets all 30 nodes to idle.
   */
  public reset(): void {
    this.pulses = [];
  }

  /**
   * Number of currently active waves traversing the 30-node array.
   */
  public getActivePulseCount(now = performance.now()): number {
    this.pruneExpiredPulses(now);
    return this.pulses.length;
  }

  private pruneExpiredPulses(now: number): void {
    if (this.pulses.length === 0) return;
    this.pulses = this.pulses.filter((p) => {
      const tailArrival =
        p.startTime + ((LIGHT_NODE_COUNT - 1) / p.speedNodesPerSec) * 1000;
      return now <= tailArrival + PULSE_PRUNE_MARGIN_MS;
    });
  }

  /**
   * Computes the exact real-time state array for all 30 nodes (01..30).
   * Directly reusable for both 60fps rendering and WebSocket / Web Serial hardware sync.
   */
  public get30NodeArrayState(now = performance.now()): LightNodeState[] {
    this.pruneExpiredPulses(now);

    const nodes: LightNodeState[] = new Array(LIGHT_NODE_COUNT);

    for (let i = 0; i < LIGHT_NODE_COUNT; i++) {
      let oneMinusProd = 1;
      let weightSum = 0;
      let charLenAcc = 0;
      let durAcc = 0;
      let deltaPrevAcc = 0;
      let velAcc = 0;
      let deleteWeight = 0;

      for (let pIdx = 0; pIdx < this.pulses.length; pIdx++) {
        const pulse = this.pulses[pIdx];
        const w = evaluatePulseEnvelope(pulse, i, now);
        if (w < 0.004) continue;

        // Soft energy superposition across overlapping waves
        oneMinusProd *= 1 - w;
        weightSum += w;
        charLenAcc += pulse.charLength * w;
        durAcc += pulse.typingDurationMs * w;
        deltaPrevAcc += pulse.deltaPrevMs * w;
        velAcc += pulse.velocityCpm * w;
        if (pulse.isDelete) {
          deleteWeight += w;
        }
      }

      const rawIntensity = 1 - oneMinusProd;
      const intensity = rawIntensity < 0.012 ? 0 : clamp(rawIntensity, 0, 1);

      if (intensity === 0 || weightSum === 0) {
        nodes[i] = {
          index: i + 1,
          intensity: 0,
          size: 0,
          opacity: 0,
          shapeParams: {
            ringCount: 0,
            coreScale: 0,
            haloScale: 0,
            haloOpacity: 0,
            needleAmplitude: 0,
            barOffsetY: 0,
            barThicknessNorm: 0,
            isDelete: false,
          },
        };
        continue;
      }

      // Blended feature parameters at node i
      const avgCharLen = charLenAcc / weightSum;
      const avgDurMs = durAcc / weightSum;
      const avgDeltaPrevMs = deltaPrevAcc / weightSum;
      const avgVelCpm = velAcc / weightSum;
      const isDelete = deleteWeight / weightSum > 0.38;

      // 1. Concentric rings (1..3) & core dot radius from charLength
      const ringCount =
        avgCharLen >= 2.6 ? 3 : avgCharLen >= 1.5 ? 2 : 1;
      const charNorm = clamp((avgCharLen - 1) / 3, 0, 1);
      const coreScale = clamp((0.35 + charNorm * 0.65) * intensity, 0, 1);

      // 2. Translucent grayscale halo from typingDuration (opacity 0.12..0.65)
      const durNorm = clamp(Math.log1p(avgDurMs) / Math.log1p(1600), 0.08, 1);
      const haloScale = clamp((0.28 + durNorm * 0.72) * intensity, 0, 1);
      const haloOpacity = clamp(
        (0.12 + durNorm * 0.53) * Math.pow(intensity, 0.85),
        0,
        0.65
      );

      // 3. Symmetric waveform needle from deltaPrev (rhythm shift / burst sharpness)
      const deltaNorm = clamp(
        Math.log1p(avgDeltaPrevMs) / Math.log1p(900),
        0.1,
        1
      );
      const burstBoost = avgVelCpm > 260 ? clamp((avgVelCpm - 260) / 500, 0, 0.35) : 0;
      const needleAmplitude = clamp(
        (0.22 + deltaNorm * 0.78 + burstBoost) * intensity,
        0,
        1
      );

      // 4. Graphic score horizontal bar from velocity & isDelete
      const velNorm = clamp(avgVelCpm / 450, 0, 1);
      // Map velocity [0..1] -> vertical staff offset [-0.78 .. +0.78]
      const barOffsetY = (velNorm * 2 - 1) * 0.78;
      const barThicknessNorm = clamp((0.2 + velNorm * 0.8) * intensity, 0, 1);

      const size = clamp(
        (0.35 * coreScale + 0.35 * haloScale + 0.3 * needleAmplitude) /
          Math.max(0.35, intensity),
        0,
        1
      );

      nodes[i] = {
        index: i + 1,
        intensity,
        size: clamp(size * intensity, 0, 1),
        opacity: intensity,
        shapeParams: {
          ringCount,
          coreScale,
          haloScale,
          haloOpacity,
          needleAmplitude,
          barOffsetY,
          barThicknessNorm,
          isDelete,
        },
      };
    }

    return nodes;
  }
}

/**
 * Standalone helper exposing the 30-node array state for external hardware bridges
 * (e.g., WebSocket / Web Serial output to a physical 30-LED light array).
 */
export function get30NodeArrayState(
  engine: LightFlowEngine,
  now?: number
): LightNodeState[] {
  return engine.get30NodeArrayState(now);
}
