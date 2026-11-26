import { MAILBOX_LED_CHANNEL_MAP } from "@/lib/esp32-light-channel";
import type { MailboxNumber } from "@/lib/image-library-api";

/**
 * ============================================================================
 * 1:1 ESP32 ARDUINO C++ LIGHT CONTROL ENGINE (TypeScript Mirror)
 * ----------------------------------------------------------------------------
 * Designed with ZERO per-frame heap allocations, fixed Uint8Array(30) buffers,
 * integer millis() timing, and continuous overlapping layers (no hard cuts):
 *
 *   Layer A: 3 overlapping passes of the user's exact 30-CH sampled data
 *            streaming smoothly from CH.01 (Green Start) -> CH.30, preserving
 *            crisp bright/dark contrast of the original drawing.
 *   Layer B: Overlapping crossfade into continuous breathing on the chosen
 *            orange QR mailbox channel (begins ramping in BEFORE pass #3
 *            finishes exiting so transitions feel seamless & non-segmented).
 * ============================================================================
 */

export const NUM_CHANNELS = 30;
export const STREAM_PASS_COUNT = 3;

/** Duration (ms) for one full 30-sample pattern to travel across all 30 LEDs */
export const PASS_DURATION_MS = 3900;
/**
 * Stride (ms) between consecutive stream passes.
 * Because PASS_STRIDE_MS < PASS_DURATION_MS, the next pass enters at CH.01
 * while the previous pass's tail is still exiting CH.12..CH.30 (seamless overlap,
 * zero dead gaps, and zero sample collision!).
 */
export const PASS_STRIDE_MS = 2500;
/** Breathing cycle duration (ms) on the target orange mailbox */
export const BREATH_PERIOD_MS = 2600;
/** Smooth crossfade ramp-in (ms) overlapping with Pass #3 */
export const BREATH_FADE_IN_MS = 1400;
/** Total stream tail end timestamp (ms) when Pass #3 fully exits CH.30 */
export const ALL_PASSES_END_MS =
  (STREAM_PASS_COUNT - 1) * PASS_STRIDE_MS + PASS_DURATION_MS;

/** Fixed C++-style controller state (maps directly to an Arduino struct) */
export interface Esp32FirmwareState {
  active: boolean;
  triggerMillis: number;
  targetMailbox: MailboxNumber;
  /** 0-based channel index [6, 9, 17, 23, 27] for orange mailbox 1..5 */
  targetChannelIdx: number;
  /** Incoming 30-CH artwork sample array [0..255] */
  inputSamples: Uint8Array;
  /** Live computed 30-CH PWM output array [0..255] (maps to ledcWrite) */
  pwmOutput: Uint8Array;
  /** Continuous normalized telemetry [0..1] for UI indicators */
  streamLayerMix: number;
  breathLayerMix: number;
  currentPassNumber: number; // 0 = standby, 1..3 = streaming pass, 4 = breathing
}

export function createEsp32FirmwareState(
  initialValues?: number[],
  mailbox: MailboxNumber = 3
): Esp32FirmwareState {
  const inputSamples = new Uint8Array(NUM_CHANNELS);
  if (initialValues) {
    for (let i = 0; i < NUM_CHANNELS; i++) {
      inputSamples[i] = Math.max(0, Math.min(255, Math.round(initialValues[i] ?? 0)));
    }
  }
  return {
    active: false,
    triggerMillis: 0,
    targetMailbox: mailbox,
    targetChannelIdx: MAILBOX_LED_CHANNEL_MAP[mailbox],
    inputSamples,
    pwmOutput: new Uint8Array(NUM_CHANNELS),
    streamLayerMix: 0,
    breathLayerMix: 0,
    currentPassNumber: 0,
  };
}

/**
 * Loads new 30-CH samples & target mailbox into fixed buffers (equivalent to
 * receiving a WebSocket / Serial / MQTT packet on ESP32).
 */
export function esp32LoadPacket(
  state: Esp32FirmwareState,
  values: number[],
  mailbox: MailboxNumber
): void {
  for (let i = 0; i < NUM_CHANNELS; i++) {
    const v = values[i] ?? 0;
    state.inputSamples[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  state.targetMailbox = mailbox;
  state.targetChannelIdx = MAILBOX_LED_CHANNEL_MAP[mailbox];
}

/** Triggers the 3-pass overlapping stream -> continuous target mailbox breath */
export function esp32Trigger(state: Esp32FirmwareState, nowMs: number): void {
  state.active = true;
  state.triggerMillis = nowMs;
  state.pwmOutput.fill(0);
  state.streamLayerMix = 0;
  state.breathLayerMix = 0;
  state.currentPassNumber = 1;
}

/** Immediately turns off all 30 LED PWM outputs */
export function esp32Stop(state: Esp32FirmwareState): void {
  state.active = false;
  state.pwmOutput.fill(0);
  state.streamLayerMix = 0;
  state.breathLayerMix = 0;
  state.currentPassNumber = 0;
}

/**
 * Samples the 30-CH input array at a floating position `samplePos` in [0..29]
 * with linear interpolation and crisp gamma contrast shaping so bright strokes
 * pop unmistakably and dark gaps stay genuinely dark as the wave flows.
 */
function sampleStreamBrightness(
  inputSamples: Uint8Array,
  samplePos: number
): number {
  if (samplePos <= -1.0 || samplePos >= NUM_CHANNELS) {
    return 0.0;
  }

  // Soft 1-channel feather at leading and trailing edges of the 30-sample wave
  let edgeEnv = 1.0;
  if (samplePos < 0.0) {
    edgeEnv = samplePos + 1.0;
  } else if (samplePos > NUM_CHANNELS - 1) {
    edgeEnv = NUM_CHANNELS - samplePos;
  }

  const clamped =
    samplePos < 0
      ? 0
      : samplePos > NUM_CHANNELS - 1
        ? NUM_CHANNELS - 1
        : samplePos;
  const i0 = Math.floor(clamped);
  const i1 = i0 + 1 < NUM_CHANNELS ? i0 + 1 : i0;
  const frac = clamped - i0;

  const rawNorm =
    (inputSamples[i0] * (1.0 - frac) + inputSamples[i1] * frac) / 255.0;

  // Preserve crisp bright/dark contrast of the user's drawing (dark stays dark!)
  const shaped = rawNorm <= 0.04 ? 0.0 : Math.pow(rawNorm, 1.32);
  return shaped * edgeEnv;
}

/**
 * Exact 1:1 equivalent of ESP32 Arduino `void updateLightEngine(uint32_t nowMs)`.
 * Computes `state.pwmOutput[0..29]` in-place with ZERO heap allocations!
 */
export function esp32LoopTick(
  state: Esp32FirmwareState,
  nowMs: number
): void {
  if (!state.active) {
    state.pwmOutput.fill(0);
    state.streamLayerMix = 0;
    state.breathLayerMix = 0;
    state.currentPassNumber = 0;
    return;
  }

  const elapsedMs = nowMs - state.triggerMillis;
  if (elapsedMs < 0) return;

  // Total travel distance for one pass: head moves from 0.0 -> (2 * NUM_CHANNELS)
  // so sample[0] enters CH.01 at u=0 and sample[29] exits CH.30 at u=1.
  const totalTravel = NUM_CHANNELS * 2;

  // Start the target mailbox breathing crossfade OVERLAPPING with Pass #3:
  // right as Pass #3's leading wave reaches the target mailbox channel!
  const pass3StartMs = (STREAM_PASS_COUNT - 1) * PASS_STRIDE_MS;
  const targetArrivalFrac = state.targetChannelIdx / totalTravel;
  const breathStartMs =
    pass3StartMs + Math.round(PASS_DURATION_MS * (targetArrivalFrac + 0.16));

  let maxStreamSeen = 0.0;

  // Compute breathing layer for the target orange mailbox (continuous, overlapping)
  let breathLevel = 0.0;
  let breathFade = 0.0;
  if (elapsedMs >= breathStartMs) {
    const breathElapsed = elapsedMs - breathStartMs;
    breathFade = Math.min(1.0, breathElapsed / BREATH_FADE_IN_MS);
    // Smooth ease-in-out S-curve for fade-in
    const smoothFade = breathFade * breathFade * (3.0 - 2.0 * breathFade);
    // Smooth cosine breathing [0.14 .. 1.0]
    const wave =
      0.5 - 0.5 * Math.cos((breathElapsed / BREATH_PERIOD_MS) * Math.PI * 2.0);
    breathLevel = smoothFade * (0.14 + 0.86 * wave);
  }

  // Evaluate every channel independently (exact hardware per-channel loop)
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    let streamVal = 0.0;

    // Layer A: Sum / max-blend all 3 overlapping 30-CH light stream passes
    for (let pass = 0; pass < STREAM_PASS_COUNT; pass++) {
      const passElapsed = elapsedMs - pass * PASS_STRIDE_MS;
      if (passElapsed < 0 || passElapsed > PASS_DURATION_MS) continue;

      const u = passElapsed / PASS_DURATION_MS;
      const headPos = u * totalTravel;
      // Channel `ch` displays sample `(headPos - ch)` so the exact 30-CH artwork
      // sequence flows faithfully left-to-right (CH.01 -> CH.30)!
      const samplePos = headPos - ch;
      const v = sampleStreamBrightness(state.inputSamples, samplePos);
      if (v > streamVal) {
        streamVal = v;
      }
    }

    if (streamVal > maxStreamSeen) {
      maxStreamSeen = streamVal;
    }

    // Layer B: Overlap target orange mailbox continuous breathing seamlessly
    let outNorm = streamVal;
    if (ch === state.targetChannelIdx && breathLevel > outNorm) {
      outNorm = breathLevel;
    }

    // Quantize to 8-bit hardware PWM [0..255]
    const pwm = Math.round(Math.max(0.0, Math.min(1.0, outNorm)) * 255.0);
    state.pwmOutput[ch] = pwm;
  }

  state.streamLayerMix = maxStreamSeen;
  state.breathLayerMix = breathFade;

  if (elapsedMs < PASS_STRIDE_MS) {
    state.currentPassNumber = 1;
  } else if (elapsedMs < PASS_STRIDE_MS * 2) {
    state.currentPassNumber = 2;
  } else if (elapsedMs < ALL_PASSES_END_MS) {
    state.currentPassNumber = 3;
  } else {
    state.currentPassNumber = 4;
  }
}

/**
 * Generates ready-to-compile Arduino IDE C++ (.ino) firmware code matching
 * `esp32LoopTick` line-for-line, pre-populated with the live 30-CH samples
 * and target orange mailbox!
 */
export function generateArduinoEsp32Code(
  ledValues: number[],
  mailbox: MailboxNumber
): string {
  const safeValues = Array.from({ length: NUM_CHANNELS }, (_, i) =>
    Math.max(0, Math.min(255, Math.round(ledValues[i] ?? 0)))
  );
  const row1 = safeValues.slice(0, 15).join(", ");
  const row2 = safeValues.slice(15, 30).join(", ");

  return `// ============================================================================
// 《一則光的訊息》ESP32 30-CH LED Light Control Firmware (Arduino IDE C++)
// 1:1 mirror of /esp32-test web simulator (3 overlapping passes -> breathing)
// ============================================================================
#include <Arduino.h>
#include <math.h>

constexpr uint8_t  NUM_CHANNELS       = ${NUM_CHANNELS};
constexpr uint8_t  STREAM_PASS_COUNT  = ${STREAM_PASS_COUNT};
constexpr uint32_t PASS_DURATION_MS   = ${PASS_DURATION_MS};
constexpr uint32_t PASS_STRIDE_MS     = ${PASS_STRIDE_MS};   // Overlaps next pass smoothly
constexpr uint32_t BREATH_PERIOD_MS   = ${BREATH_PERIOD_MS};
constexpr uint32_t BREATH_FADE_IN_MS  = ${BREATH_FADE_IN_MS};

// 0-based channel indices of the 5 orange QR mailboxes (CH.07, 10, 18, 24, 28)
constexpr uint8_t MAILBOX_CH[5] = { 6, 9, 17, 23, 27 };

struct LightEngineState {
  bool     active           = false;
  uint32_t triggerMillis    = 0;
  uint8_t  targetMailbox    = ${mailbox}; // 1..5
  uint8_t  targetChannelIdx = MAILBOX_CH[${mailbox - 1}];
  uint8_t  inputSamples[NUM_CHANNELS] = {
    ${row1},
    ${row2}
  };
  uint8_t  pwmOutput[NUM_CHANNELS] = { 0 };
};

LightEngineState gLight;

// High-contrast interpolated sample reader (preserves bright peaks & dark gaps)
float sampleStreamBrightness(const uint8_t* samples, float samplePos) {
  if (samplePos <= -1.0f || samplePos >= (float)NUM_CHANNELS) return 0.0f;

  float edgeEnv = 1.0f;
  if (samplePos < 0.0f) {
    edgeEnv = samplePos + 1.0f;
  } else if (samplePos > (float)(NUM_CHANNELS - 1)) {
    edgeEnv = (float)NUM_CHANNELS - samplePos;
  }

  float clamped = constrain(samplePos, 0.0f, (float)(NUM_CHANNELS - 1));
  int   i0      = (int)floorf(clamped);
  int   i1      = (i0 + 1 < NUM_CHANNELS) ? (i0 + 1) : i0;
  float frac    = clamped - (float)i0;

  float rawNorm = ((float)samples[i0] * (1.0f - frac) + (float)samples[i1] * frac) / 255.0f;
  float shaped  = (rawNorm <= 0.04f) ? 0.0f : powf(rawNorm, 1.32f);
  return shaped * edgeEnv;
}

void triggerLightShow(const uint8_t samples[NUM_CHANNELS], uint8_t mailbox1to5) {
  memcpy(gLight.inputSamples, samples, NUM_CHANNELS);
  uint8_t mb              = constrain(mailbox1to5, 1, 5);
  gLight.targetMailbox    = mb;
  gLight.targetChannelIdx = MAILBOX_CH[mb - 1];
  gLight.triggerMillis    = millis();
  gLight.active           = true;
}

// Call inside loop() at ~60Hz (every 16ms) -> writes 0..255 to gLight.pwmOutput[]
void updateLightEngine(uint32_t nowMs) {
  if (!gLight.active) {
    memset(gLight.pwmOutput, 0, NUM_CHANNELS);
    return;
  }

  uint32_t elapsedMs = nowMs - gLight.triggerMillis;
  const float totalTravel = (float)(NUM_CHANNELS * 2);

  // Target orange mailbox breathing overlaps seamlessly with Pass #3
  uint32_t pass3StartMs      = (STREAM_PASS_COUNT - 1) * PASS_STRIDE_MS;
  float    targetArrivalFrac = (float)gLight.targetChannelIdx / totalTravel;
  uint32_t breathStartMs     = pass3StartMs + (uint32_t)(PASS_DURATION_MS * (targetArrivalFrac + 0.16f));

  float breathLevel = 0.0f;
  if (elapsedMs >= breathStartMs) {
    uint32_t breathElapsed = elapsedMs - breathStartMs;
    float fade       = min(1.0f, (float)breathElapsed / (float)BREATH_FADE_IN_MS);
    float smoothFade = fade * fade * (3.0f - 2.0f * fade);
    float wave       = 0.5f - 0.5f * cosf(((float)breathElapsed / (float)BREATH_PERIOD_MS) * TWO_PI);
    breathLevel      = smoothFade * (0.14f + 0.86f * wave);
  }

  for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
    float streamVal = 0.0f;

    // 3 overlapping passes streaming faithfully CH.01 -> CH.30
    for (uint8_t pass = 0; pass < STREAM_PASS_COUNT; pass++) {
      int32_t passElapsed = (int32_t)elapsedMs - (int32_t)(pass * PASS_STRIDE_MS);
      if (passElapsed < 0 || passElapsed > (int32_t)PASS_DURATION_MS) continue;

      float u         = (float)passElapsed / (float)PASS_DURATION_MS;
      float headPos   = u * totalTravel;
      float samplePos = headPos - (float)ch;
      float v         = sampleStreamBrightness(gLight.inputSamples, samplePos);
      if (v > streamVal) streamVal = v;
    }

    float outNorm = streamVal;
    if (ch == gLight.targetChannelIdx && breathLevel > outNorm) {
      outNorm = breathLevel;
    }
    gLight.pwmOutput[ch] = (uint8_t)lroundf(constrain(outNorm, 0.0f, 1.0f) * 255.0f);
  }
}

// Replace with your physical LED driver (PCA9685 / TLC5947 / LEDC / DMX)
void flushToHardwarePwm() {
  for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
    // Example: pca9685.setPWM(ch, 0, gLight.pwmOutput[ch] * 16);
    // Example: ledcWrite(LED_PINS[ch], gLight.pwmOutput[ch]);
    (void)ch;
  }
}

void setup() {
  Serial.begin(115200);
  // Start immediately with the loaded 30-CH test waveform
  triggerLightShow(gLight.inputSamples, gLight.targetMailbox);
}

void loop() {
  static uint32_t lastFrameMs = 0;
  uint32_t nowMs = millis();
  if (nowMs - lastFrameMs >= 16) { // ~60 FPS deterministic tick
    lastFrameMs = nowMs;
    updateLightEngine(nowMs);
    flushToHardwarePwm();
  }
}
`;
}
