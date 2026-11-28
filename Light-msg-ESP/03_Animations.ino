// ============================================================================
// 03_Animations.ino - 燈光狀態機、常態輕微燈流 (2~50 PWM) 與 30-CH 光訊特效
//
// 狀態總覽：
//   1. STATE_BOOT_TEST_9S  : (可選) 開機 9 秒逐一點亮再熄滅自檢（ENABLE_BOOT_TEST_9S）
//   2. STATE_AMBIENT_FLOW  : 裝置常態輕微 fade-in / fade-out 燈流（亮度 2 ~ 50 PWM）
//   3. STATE_MESSAGE_FLOW  : 收到 Socket.IO 'esp-msg' 後執行的 30 道取樣光訊燈流
//                            （1:1 對應 /esp32-test 模擬器：3 趟重疊光流 -> 目標郵筒
//                             呼吸 -> 平滑交融回常態燈流）
// ============================================================================

static uint8_t  sysState       = STATE_AMBIENT_FLOW;
static uint32_t lastAnimTickMs = 0;

// 開機 9 秒測試狀態
static uint32_t bootStartMs    = 0;

// 常態燈流計時基準
static uint32_t ambientStartMs = 0;

// 外部 esp-msg 光訊特效緩衝區（無動態記憶體配置）
static uint8_t  msgSamples[NUM_LEDS] = {0};
static uint8_t  msgTargetMailbox     = 1;            // 1..5
static uint8_t  msgTargetChannelIdx  = MAILBOX_CH[0]; // 6, 9, 17, 23, 27
static uint32_t msgTriggerMs         = 0;

// ----------------------------------------------------------------------------
// 輔助：計算單一通道在常態燈流下的目標亮度（嚴格落在 AMBIENT_MIN_PWM..AMBIENT_MAX_PWM）
// ----------------------------------------------------------------------------
static float evalAmbientChannelPwm(uint8_t ch, uint32_t elapsedMs) {
  const float posNorm = (float)ch / (float)(NUM_LEDS - 1); // 0.0 .. 1.0

  // 主光流：緩慢由左至右流動的柔和餘弦波
  const float phase1 =
    ((float)elapsedMs / AMBIENT_WAVE1_PERIOD_MS) * TWO_PI
    - posNorm * AMBIENT_SPATIAL_CYCLES * TWO_PI;
  const float wave1 = 0.5f + 0.5f * cosf(phase1); // 0.0 .. 1.0

  // 次光流：更慢的反相有機呼吸，讓亮暗起伏自然不呆板
  const float phase2 =
    ((float)elapsedMs / AMBIENT_WAVE2_PERIOD_MS) * TWO_PI
    + posNorm * 0.85f * TWO_PI;
  const float wave2 = 0.5f + 0.5f * cosf(phase2); // 0.0 .. 1.0

  // 柔和混合並做平滑 S-curve 曲線修飾（fade-in / fade-out 更絲滑）
  float mix = 0.68f * wave1 + 0.32f * wave2;
  mix = mix * mix * (3.0f - 2.0f * mix);

  const float span = (float)(AMBIENT_MAX_PWM - AMBIENT_MIN_PWM);
  return (float)AMBIENT_MIN_PWM + mix * span;
}

// ============================================================================
// Function 1：裝置常態輕微燈流特效（fade-in / fade-out，亮度浮動於 2 ~ 50）
// ============================================================================
void updateAmbientLightFlow(uint32_t nowMs) {
  const uint32_t elapsedMs = nowMs - ambientStartMs;
  for (uint8_t ch = 0; ch < NUM_LEDS; ch++) {
    float pwmF = evalAmbientChannelPwm(ch, elapsedMs);
    uint8_t pwm = (uint8_t)lroundf(
      constrain(pwmF, (float)AMBIENT_MIN_PWM, (float)AMBIENT_MAX_PWM)
    );
    setLedPwm(ch, pwm);
  }
}

// ============================================================================
// Function 2：9 秒逐一點亮再熄滅自檢（0~4.5s 逐一亮，4.5~9.0s 逐一滅）
// ============================================================================
static bool updateBootSequential9s(uint32_t nowMs) {
  const uint32_t elapsedMs = nowMs - bootStartMs;
  if (elapsedMs >= BOOT_CYCLE_DURATION_MS) {
    return false;
  }

  const uint8_t step = (uint8_t)(elapsedMs / BOOT_STEP_DURATION_MS);
  if (step < NUM_LEDS) {
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      setLedPwm(i, (i <= step) ? BOOT_TEST_ON_PWM : 0);
    }
  } else {
    const uint8_t offCount = (uint8_t)(step - NUM_LEDS + 1);
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      setLedPwm(i, (i >= offCount) ? BOOT_TEST_ON_PWM : 0);
    }
  }
  return true;
}

// ============================================================================
// Function 3：收到 esp-msg 之 30 道取樣光訊燈流（1:1 對應 /esp32-test）
// ----------------------------------------------------------------------------
//   Layer A : 3 趟重疊光流將使用者 30 道筆跡取樣由 CH.01 -> CH.30 完整流過，
//             以線性插值 + Gamma(1.32) 保留清晰亮暗對比。
//   Layer B : 第 3 趟經過目標橘色郵筒 (CH.07/10/18/24/28) 時無縫交疊淡入
//             餘弦呼吸光，持續 3 個呼吸週期後以 2 秒平滑交融回到常態燈流。
// ============================================================================
static float sampleStreamBrightness(const uint8_t *samples, float samplePos) {
  if (samplePos <= -1.0f || samplePos >= (float)NUM_LEDS) {
    return 0.0f;
  }

  // 波前與波尾 1 通道羽化，避免硬切感
  float edgeEnv = 1.0f;
  if (samplePos < 0.0f) {
    edgeEnv = samplePos + 1.0f;
  } else if (samplePos > (float)(NUM_LEDS - 1)) {
    edgeEnv = (float)NUM_LEDS - samplePos;
  }

  float clamped = constrain(samplePos, 0.0f, (float)(NUM_LEDS - 1));
  int i0        = (int)floorf(clamped);
  int i1        = (i0 + 1 < NUM_LEDS) ? (i0 + 1) : i0;
  float frac    = clamped - (float)i0;

  float rawNorm = ((float)samples[i0] * (1.0f - frac) + (float)samples[i1] * frac) / 255.0f;
  // 保留原筆跡的高對比（暗部乾淨歸零、亮部清晰突出）
  float shaped  = (rawNorm <= 0.04f) ? 0.0f : powf(rawNorm, 1.32f);
  return shaped * edgeEnv;
}

static bool updateMessageLightFlow(uint32_t nowMs) {
  const uint32_t elapsedMs = nowMs - msgTriggerMs;
  if (elapsedMs >= MSG_TOTAL_DURATION_MS) {
    return false;
  }

  const float totalTravel = (float)(NUM_LEDS * 2);

  // 第 3 趟光流抵達目標郵筒通道時開始淡入呼吸光
  const uint32_t pass3StartMs      = (STREAM_PASS_COUNT - 1) * PASS_STRIDE_MS;
  const float    targetArrivalFrac = (float)msgTargetChannelIdx / totalTravel;
  const uint32_t breathStartMs     = pass3StartMs + (uint32_t)(PASS_DURATION_MS * (targetArrivalFrac + 0.16f));

  float breathLevel = 0.0f;
  if (elapsedMs >= breathStartMs) {
    const uint32_t breathElapsed = elapsedMs - breathStartMs;
    float fade       = min(1.0f, (float)breathElapsed / (float)BREATH_FADE_IN_MS);
    float smoothFade = fade * fade * (3.0f - 2.0f * fade);
    float wave       = 0.5f - 0.5f * cosf(((float)breathElapsed / (float)BREATH_PERIOD_MS) * TWO_PI);
    breathLevel      = smoothFade * (0.14f + 0.86f * wave);
  }

  // 結尾 2 秒平滑交融回常態燈流（0.0 = 純訊息燈流，1.0 = 純常態燈流）
  const uint32_t blendStartMs = ALL_PASSES_END_MS + MSG_BREATH_HOLD_MS;
  float returnBlend = 0.0f;
  if (elapsedMs > blendStartMs) {
    float t = min(1.0f, (float)(elapsedMs - blendStartMs) / (float)MSG_RETURN_BLEND_MS);
    returnBlend = t * t * (3.0f - 2.0f * t);
  }

  const uint32_t ambientElapsedMs = nowMs - ambientStartMs;

  for (uint8_t ch = 0; ch < NUM_LEDS; ch++) {
    float streamVal = 0.0f;

    // Layer A: 3 趟重疊 30-CH 光流由 CH.01 -> CH.30
    for (uint8_t pass = 0; pass < STREAM_PASS_COUNT; pass++) {
      int32_t passElapsed = (int32_t)elapsedMs - (int32_t)(pass * PASS_STRIDE_MS);
      if (passElapsed < 0 || passElapsed > (int32_t)PASS_DURATION_MS) continue;

      float u         = (float)passElapsed / (float)PASS_DURATION_MS;
      float headPos   = u * totalTravel;
      float samplePos = headPos - (float)ch;
      float v         = sampleStreamBrightness(msgSamples, samplePos);
      if (v > streamVal) {
        streamVal = v;
      }
    }

    // Layer B: 目標郵筒持續呼吸重疊混合
    float outNorm = streamVal;
    if (ch == msgTargetChannelIdx && breathLevel > outNorm) {
      outNorm = breathLevel;
    }

    float msgPwm = constrain(outNorm, 0.0f, 1.0f) * 255.0f;

    // 若處於結尾淡出期，平滑過渡至常態燈流（2~50 PWM）
    float finalPwm = msgPwm;
    if (returnBlend > 0.0f) {
      float ambPwm = evalAmbientChannelPwm(ch, ambientElapsedMs);
      finalPwm = msgPwm * (1.0f - returnBlend) + ambPwm * returnBlend;
    }

    setLedPwm(ch, (uint8_t)lroundf(constrain(finalPwm, 0.0f, 255.0f)));
  }

  return true;
}

// ============================================================================
// 公開狀態機控制函式
// ============================================================================

void triggerMessageLightFlow(const uint8_t *samples, uint8_t mailbox1to5) {
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    msgSamples[i] = samples[i];
  }
  uint8_t mb = constrain(mailbox1to5, (uint8_t)1, MAILBOX_COUNT);
  msgTargetMailbox    = mb;
  msgTargetChannelIdx = MAILBOX_CH[mb - 1];
  msgTriggerMs        = millis();
  sysState            = STATE_MESSAGE_FLOW;

  Serial.printf("[Anim] 啟動 30-CH 光訊燈流 -> 郵筒 #%u (CH.%02u)，預計 %.1f 秒後回常態燈流\n",
                msgTargetMailbox,
                (unsigned)(msgTargetChannelIdx + 1),
                (float)MSG_TOTAL_DURATION_MS / 1000.0f);
}

void animationsInit() {
  uint32_t nowMs = millis();
  lastAnimTickMs = nowMs;
  bootStartMs    = nowMs;
  ambientStartMs = nowMs;

  if (ENABLE_BOOT_TEST_9S) {
    sysState = STATE_BOOT_TEST_9S;
    Serial.println("[Anim] 啟動開機 9 秒逐一點亮再熄滅測試...");
  } else {
    sysState = STATE_AMBIENT_FLOW;
    Serial.printf("[Anim] 進入常態輕微燈流模式 (PWM %u~%u)\n",
                  AMBIENT_MIN_PWM, AMBIENT_MAX_PWM);
  }
}

void animationsTick() {
  uint32_t nowMs = millis();
  if (nowMs - lastAnimTickMs < ANIM_UPDATE_INTERVAL_MS) {
    return;
  }
  lastAnimTickMs = nowMs;

  switch (sysState) {
    case STATE_BOOT_TEST_9S:
      if (!updateBootSequential9s(nowMs)) {
        ambientStartMs = nowMs;
        sysState = STATE_AMBIENT_FLOW;
        Serial.println("[Anim] 9 秒開機測試完成 -> 進入常態輕微燈流模式");
      }
      break;

    case STATE_MESSAGE_FLOW:
      if (!updateMessageLightFlow(nowMs)) {
        sysState = STATE_AMBIENT_FLOW;
        Serial.println("[Anim] 光訊燈流播放完畢 -> 已自動回到常態輕微燈流");
      }
      break;

    case STATE_AMBIENT_FLOW:
    default:
      updateAmbientLightFlow(nowMs);
      break;
  }
}
