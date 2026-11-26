import { LED_CHANNEL_COUNT } from "@/lib/grid-sampling";
import type { MailboxNumber } from "@/lib/image-library-api";

export const ESP32_STORAGE_KEY = "light_msg_esp32_latest_payload_v1";
export const ESP32_BROADCAST_CHANNEL = "light_msg_esp32_channel_v1";

export type PhysicalNodeKind =
  | "start"       // Green start mailbox (CH.01)
  | "orange-box"  // Audience QR mailboxes 1..5 (CH.07, 10, 18, 24, 28)
  | "gray-box"    // General decorative mailboxes (CH.05, 06, 13, 17, 21, 25)
  | "plate";      // Illuminated house-number plates (remaining 18 channels)

export interface PhysicalLedNodeSpec {
  /** 0-based channel index [0..29] */
  index: number;
  /** 1-based physical LED number [1..30] */
  channel: number;
  kind: PhysicalNodeKind;
  /** Normalized architectural elevation coordinates matching physical installation [0..1] */
  nx: number;
  ny: number;
  /** Audience QR mailbox number (1..5) for orange mailboxes only */
  mailbox?: MailboxNumber;
  /** Optional physical label (e.g. house plate number) */
  tag?: string;
}

/**
 * Exact 5 audience-addressable orange QR mailboxes mapped to 0-based channel indices
 * directly from the physical installation elevation drawing:
 *   Mailbox #1 -> CH.07 (idx 6)
 *   Mailbox #2 -> CH.10 (idx 9)
 *   Mailbox #3 -> CH.18 (idx 17)
 *   Mailbox #4 -> CH.24 (idx 23)
 *   Mailbox #5 -> CH.28 (idx 27)
 */
export const MAILBOX_LED_CHANNEL_MAP: Record<MailboxNumber, number> = {
  1: 6,  // CH.07
  2: 9,  // CH.10
  3: 17, // CH.18
  4: 23, // CH.24
  5: 27, // CH.28
};

export const MAILBOX_CHANNEL_LOOKUP: Record<number, MailboxNumber> = {
  6: 1,
  9: 2,
  17: 3,
  23: 4,
  27: 5,
};

/** Architectural vertical pillar positions [0..1] for spatial orientation on the black stage */
export const ELEVATION_PILLAR_XS = [0.282, 0.498, 0.716, 0.928] as const;

/**
 * Complete 30-LED physical spatial elevation table (CH.01 -> CH.30, left to right)
 * faithful to the Yanshui post-office installation blueprint.
 */
export const ESP32_PHYSICAL_NODES: readonly PhysicalLedNodeSpec[] = [
  { index: 0,  channel: 1,  kind: "start",      nx: 0.056, ny: 0.62, tag: "起頭" },
  { index: 1,  channel: 2,  kind: "plate",      nx: 0.072, ny: 0.30, tag: "91" },
  { index: 2,  channel: 3,  kind: "plate",      nx: 0.106, ny: 0.68, tag: "19" },
  { index: 3,  channel: 4,  kind: "plate",      nx: 0.106, ny: 0.81, tag: "19" },
  { index: 4,  channel: 5,  kind: "gray-box",   nx: 0.128, ny: 0.43 },
  { index: 5,  channel: 6,  kind: "gray-box",   nx: 0.182, ny: 0.29 },
  { index: 6,  channel: 7,  kind: "orange-box", nx: 0.222, ny: 0.56, mailbox: 1, tag: "郵筒1" },
  { index: 7,  channel: 8,  kind: "plate",      nx: 0.250, ny: 0.78, tag: "22" },
  { index: 8,  channel: 9,  kind: "plate",      nx: 0.312, ny: 0.38, tag: "73" },
  { index: 9,  channel: 10, kind: "orange-box", nx: 0.338, ny: 0.72, mailbox: 2, tag: "郵筒2" },
  { index: 10, channel: 11, kind: "plate",      nx: 0.362, ny: 0.50, tag: "73" },
  { index: 11, channel: 12, kind: "plate",      nx: 0.382, ny: 0.60, tag: "91" },
  { index: 12, channel: 13, kind: "gray-box",   nx: 0.422, ny: 0.44 },
  { index: 13, channel: 14, kind: "plate",      nx: 0.462, ny: 0.72, tag: "73" },
  { index: 14, channel: 15, kind: "plate",      nx: 0.466, ny: 0.25, tag: "73" },
  { index: 15, channel: 16, kind: "plate",      nx: 0.528, ny: 0.68, tag: "19" },
  { index: 16, channel: 17, kind: "gray-box",   nx: 0.556, ny: 0.49 },
  { index: 17, channel: 18, kind: "orange-box", nx: 0.604, ny: 0.56, mailbox: 3, tag: "郵筒3" },
  { index: 18, channel: 19, kind: "plate",      nx: 0.630, ny: 0.74, tag: "73" },
  { index: 19, channel: 20, kind: "plate",      nx: 0.630, ny: 0.84, tag: "73" },
  { index: 20, channel: 21, kind: "gray-box",   nx: 0.674, ny: 0.66 },
  { index: 21, channel: 22, kind: "plate",      nx: 0.688, ny: 0.44, tag: "19" },
  { index: 22, channel: 23, kind: "plate",      nx: 0.744, ny: 0.81, tag: "91" },
  { index: 23, channel: 24, kind: "orange-box", nx: 0.764, ny: 0.55, mailbox: 4, tag: "郵筒4" },
  { index: 24, channel: 25, kind: "gray-box",   nx: 0.810, ny: 0.34 },
  { index: 25, channel: 26, kind: "plate",      nx: 0.832, ny: 0.66, tag: "73" },
  { index: 26, channel: 27, kind: "plate",      nx: 0.854, ny: 0.53, tag: "19" },
  { index: 27, channel: 28, kind: "orange-box", nx: 0.896, ny: 0.60, mailbox: 5, tag: "郵筒5" },
  { index: 28, channel: 29, kind: "plate",      nx: 0.952, ny: 0.74, tag: "19" },
  { index: 29, channel: 30, kind: "plate",      nx: 0.976, ny: 0.62, tag: "19" },
] as const;

export interface Esp32LightPayload {
  /** 30-channel integer PWM brightness values [0..255] */
  ledValues: number[];
  /** Destination physical orange mailbox (1..5) */
  mailbox: MailboxNumber;
  /** Epoch milliseconds when this packet was generated */
  timestamp: number;
  /** Lifecycle origin of this payload */
  status: "sampled" | "dispatched" | "demo";
  /** Short monospace packet identifier */
  packetId: string;
}

/**
 * Clamps and normalizes any numeric array into an exact 30-channel [0..255] integer array.
 */
export function normalize30Channels(values: number[]): number[] {
  return Array.from({ length: LED_CHANNEL_COUNT }, (_, idx) => {
    const raw = values[idx] ?? 0;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(255, Math.round(raw)));
  });
}

/**
 * Generates a high-contrast demo 30-CH waveform with clear bright peaks & dark gaps
 * so the flowing light stream clearly shows bright/dark contrast across CH.01..CH.30.
 */
export function createDemoEsp32Payload(
  mailbox: MailboxNumber = 3
): Esp32LightPayload {
  const peakA = 4 + Math.floor(Math.random() * 4);
  const peakB = 13 + Math.floor(Math.random() * 4);
  const peakC = 22 + Math.floor(Math.random() * 5);
  const ledValues = Array.from({ length: LED_CHANNEL_COUNT }, (_, i) => {
    const g1 = Math.exp(-Math.pow((i - peakA) / 2.2, 2)) * 250;
    const g2 = Math.exp(-Math.pow((i - peakB) / 2.6, 2)) * 235;
    const g3 = Math.exp(-Math.pow((i - peakC) / 1.9, 2)) * 245;
    const val = Math.round(Math.max(g1, g2, g3));
    return val < 22 ? 0 : Math.min(255, val);
  });

  return {
    ledValues,
    mailbox,
    timestamp: Date.now(),
    status: "demo",
    packetId: `DEMO-${String(Math.floor(1000 + Math.random() * 9000))}`,
  };
}

/**
 * Persists the latest 30-CH ESP32 payload to localStorage and broadcasts it live
 * to any open `/esp32-test` tab via BroadcastChannel.
 */
export function publishEsp32Payload(
  ledValues: number[],
  mailbox: MailboxNumber,
  status: Esp32LightPayload["status"] = "sampled"
): Esp32LightPayload {
  const payload: Esp32LightPayload = {
    ledValues: normalize30Channels(ledValues),
    mailbox,
    timestamp: Date.now(),
    status,
    packetId: `PKT-${String(Date.now()).slice(-5)}`,
  };

  if (typeof window === "undefined") return payload;

  try {
    window.localStorage.setItem(ESP32_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore private-browsing or quota failures
  }

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(ESP32_BROADCAST_CHANNEL);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {
    // Ignore BroadcastChannel unavailability
  }

  return payload;
}

/**
 * Reads the most recently stored ESP32 payload from localStorage (returns null if none).
 */
export function readStoredEsp32Payload(): Esp32LightPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ESP32_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Esp32LightPayload>;
    if (!Array.isArray(parsed.ledValues) || parsed.ledValues.length === 0) {
      return null;
    }
    const mb = parsed.mailbox;
    const validMailbox: MailboxNumber =
      mb === 1 || mb === 2 || mb === 3 || mb === 4 || mb === 5 ? mb : 1;
    return {
      ledValues: normalize30Channels(parsed.ledValues),
      mailbox: validMailbox,
      timestamp:
        typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      status:
        parsed.status === "dispatched" ||
        parsed.status === "sampled" ||
        parsed.status === "demo"
          ? parsed.status
          : "sampled",
      packetId:
        typeof parsed.packetId === "string" ? parsed.packetId : "PKT-00000",
    };
  } catch {
    return null;
  }
}

/**
 * Subscribes to live ESP32 payloads sent from the main page across browser tabs
 * (via both BroadcastChannel and localStorage `storage` events).
 */
export function subscribeEsp32Payloads(
  onReceive: (payload: Esp32LightPayload) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let bc: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(ESP32_BROADCAST_CHANNEL);
      bc.onmessage = (event: MessageEvent) => {
        const data = event.data as Partial<Esp32LightPayload> | null;
        if (data && Array.isArray(data.ledValues)) {
          const mb = data.mailbox;
          const validMailbox: MailboxNumber =
            mb === 1 || mb === 2 || mb === 3 || mb === 4 || mb === 5 ? mb : 1;
          onReceive({
            ledValues: normalize30Channels(data.ledValues),
            mailbox: validMailbox,
            timestamp:
              typeof data.timestamp === "number" ? data.timestamp : Date.now(),
            status:
              data.status === "dispatched" ||
              data.status === "sampled" ||
              data.status === "demo"
                ? data.status
                : "sampled",
            packetId:
              typeof data.packetId === "string" ? data.packetId : "PKT-LIVE",
          });
        }
      };
    }
  } catch {
    bc = null;
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== ESP32_STORAGE_KEY) return;
    const latest = readStoredEsp32Payload();
    if (latest) onReceive(latest);
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
    if (bc) {
      bc.close();
    }
  };
}
