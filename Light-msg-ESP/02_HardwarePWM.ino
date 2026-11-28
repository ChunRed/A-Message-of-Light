// ============================================================================
// 02_HardwarePWM.ino - 雙 MCP23017 驅動 + Core 0 獨立 120Hz 事件驅動線性軟體 PWM
//
// 設計重點：
//   1. 直接使用 Wire 3-byte 連續寫入 OLATA+OLATB（免額外 MCP 函式庫，速度最快）。
//   2. 採「事件驅動線性軟體 PWM (Sorted-Edge Linear PWM)」：
//      - 固定 120 Hz 單一連續脈波（週期 8333 us，人眼與相機皆無閃爍）。
//      - 在低亮度 2~50 PWM 區間（65us ~ 1634us）具細膩線性解析度，fade-in/out 極平滑。
//      - 同微秒區間（55us 內）的熄滅事件自動合併為單次 I2C 寫入，且僅寫入狀態有變化的晶片。
//   3. 釘選於 Core 0 獨立 FreeRTOS 任務執行，與 Core 1 上的 W5500 網路完全隔離。
// ============================================================================

static const uint8_t MCP_REG_IODIRA = 0x00;
static const uint8_t MCP_REG_IODIRB = 0x01;
static const uint8_t MCP_REG_IOCON  = 0x0A;
static const uint8_t MCP_REG_OLATA  = 0x14;

// 30 通道即時目標亮度緩衝區（0 = 全暗，2~50 = 常態燈流，0~255 = 光訊特效）
volatile uint8_t ledPwmTarget[NUM_LEDS] = {0};

static const uint32_t PWM_PERIOD_US = 8333; // 120 Hz 固定週期 (us)
static const uint32_t EDGE_MERGE_US = 55;   // 55us 內的關閉事件合併為單次 I2C 寫入
static const uint32_t MIN_PULSE_US  = 55;   // 最短脈波略大於單次 I2C 寫入耗時

static bool         mcpOnline[2]   = { false, false };
static uint16_t     mcpLastMask[2] = { 0xFFFF, 0xFFFF };
static TaskHandle_t pwmTaskHandle  = NULL;

struct PwmOffEvent {
  uint32_t offUs;
  uint16_t clearMask[2]; // [0]=chip 0x20 (lo=PortA, hi=PortB), [1]=chip 0x21
};

static bool mcpWriteReg(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

static bool mcpWriteRawPorts(uint8_t addr, uint8_t portA, uint8_t portB) {
  Wire.beginTransmission(addr);
  Wire.write(MCP_REG_OLATA);
  Wire.write(portA);
  Wire.write(portB);
  return Wire.endTransmission() == 0;
}

static inline void writeMcpChipMask(uint8_t chipIdx, uint16_t logicalOnMask) {
  if (!mcpOnline[chipIdx]) return;
  if (logicalOnMask == mcpLastMask[chipIdx]) return;

  uint16_t hwMask = LED_ACTIVE_HIGH
                      ? logicalOnMask
                      : (uint16_t)(~logicalOnMask);
  uint8_t portA = (uint8_t)(hwMask & 0xFF);
  uint8_t portB = (uint8_t)((hwMask >> 8) & 0xFF);

  mcpWriteRawPorts(MCP_ADDRS[chipIdx], portA, portB);
  mcpLastMask[chipIdx] = logicalOnMask;
}

static bool initSingleMcp23017(uint8_t chipIdx) {
  uint8_t addr = MCP_ADDRS[chipIdx];

  // 1. 確保 BANK=0, SEQOP=0（連續寫入 OLATA -> OLATB）
  if (!mcpWriteReg(addr, MCP_REG_IOCON, 0x00)) {
    return false;
  }

  // 2. 先輸出全滅電位再設為 OUTPUT，防止上電瞬間誤閃
  uint8_t offByte = LED_ACTIVE_HIGH ? 0x00 : 0xFF;
  if (!mcpWriteRawPorts(addr, offByte, offByte)) {
    return false;
  }

  // 3. Port A & Port B 全部設為輸出（0 = Output）
  if (!mcpWriteReg(addr, MCP_REG_IODIRA, 0x00)) return false;
  if (!mcpWriteReg(addr, MCP_REG_IODIRB, 0x00)) return false;

  mcpLastMask[chipIdx] = 0x0000;
  return true;
}

// 精準等待至本週期的目標微秒時刻（剩餘 >= 1.5ms 時讓出 Core 0 餵狗）
static void waitUntilCycleUs(int64_t cycleStartUs, uint32_t targetUs) {
  while (true) {
    int64_t elapsed = esp_timer_get_time() - cycleStartUs;
    if (elapsed >= (int64_t)targetUs) break;

    int64_t remaining = (int64_t)targetUs - elapsed;
    if (remaining >= 1500) {
      vTaskDelay(1);
    } else if (remaining > 20) {
      delayMicroseconds((uint32_t)(remaining - 10));
    }
  }
}

// Core 0 專屬 120Hz 雙 MCP23017 事件驅動線性軟體 PWM 任務
static void pwmCore0Task(void *pvParameters) {
  (void)pvParameters;

  PwmOffEvent events[NUM_LEDS];

  while (true) {
    int64_t cycleStartUs = esp_timer_get_time();

    uint16_t onMask[2] = { 0x0000, 0x0000 };
    uint8_t rawCount = 0;

    // 1. 原子快照本週期 30 顆 LED 的目標亮度 (0~255)
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      uint8_t v = ledPwmTarget[i];
      if (v == 0) continue;

      const LedPinMap &m = LED_MAP[i];
      uint16_t bitMask = (uint16_t)(1U << (m.port * 8 + m.bit));
      onMask[m.chip] |= bitMask;

      if (v < 255) {
        uint32_t offUs = ((uint32_t)v * PWM_PERIOD_US) / 255U;
        if (offUs < MIN_PULSE_US) offUs = MIN_PULSE_US;

        events[rawCount].offUs = offUs;
        events[rawCount].clearMask[0] = (m.chip == 0) ? bitMask : 0;
        events[rawCount].clearMask[1] = (m.chip == 1) ? bitMask : 0;
        rawCount++;
      }
    }

    // 2. 依關閉時間由小到大做插入排序（最多 30 筆，耗時極短）
    for (uint8_t i = 1; i < rawCount; i++) {
      PwmOffEvent key = events[i];
      int8_t j = (int8_t)i - 1;
      while (j >= 0 && events[j].offUs > key.offUs) {
        events[j + 1] = events[j];
        j--;
      }
      events[j + 1] = key;
    }

    // 3. 合併相近時間（EDGE_MERGE_US 內）的關閉事件，大幅降低 I2C 負載
    uint8_t mergedCount = 0;
    for (uint8_t i = 0; i < rawCount; i++) {
      if (mergedCount > 0 &&
          (events[i].offUs - events[mergedCount - 1].offUs) <= EDGE_MERGE_US) {
        events[mergedCount - 1].clearMask[0] |= events[i].clearMask[0];
        events[mergedCount - 1].clearMask[1] |= events[i].clearMask[1];
      } else {
        events[mergedCount++] = events[i];
      }
    }

    // 4. 週期起點：一次開啟兩片 MCP23017 上所有需點亮的 LED
    uint16_t currentMask[2] = { onMask[0], onMask[1] };
    writeMcpChipMask(0, currentMask[0]);
    writeMcpChipMask(1, currentMask[1]);

    // 5. 依序於各關閉時間點熄滅對應 LED（僅寫入有變化的晶片）
    for (uint8_t i = 0; i < mergedCount; i++) {
      waitUntilCycleUs(cycleStartUs, events[i].offUs);
      if (events[i].clearMask[0]) {
        currentMask[0] &= (uint16_t)(~events[i].clearMask[0]);
        writeMcpChipMask(0, currentMask[0]);
      }
      if (events[i].clearMask[1]) {
        currentMask[1] &= (uint16_t)(~events[i].clearMask[1]);
        writeMcpChipMask(1, currentMask[1]);
      }
    }

    // 6. 等待本 120Hz 週期結束（期間會自動透過 vTaskDelay(1) 餵狗）
    waitUntilCycleUs(cycleStartUs, PWM_PERIOD_US);
  }
}

void hardwarePwmInit() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setTimeOut(50);
  Wire.setClock(I2C_CLOCK_HZ);

  for (uint8_t c = 0; c < 2; c++) {
    mcpOnline[c] = initSingleMcp23017(c);
    Serial.printf("[MCP23017] 0x%02X: %s\n",
                  MCP_ADDRS[c], mcpOnline[c] ? "OK" : "NOT FOUND");
  }

  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    ledPwmTarget[i] = 0;
  }

  // 將雙 MCP23017 線性軟體 PWM 任務釘選於 Core 0（loop + W5500 執行於 Core 1）
  xTaskCreatePinnedToCore(
    pwmCore0Task,
    "MCP_DualPWM",
    4096,
    NULL,
    2,
    &pwmTaskHandle,
    0
  );

  Serial.printf("[PWM] Core 0 雙 MCP23017 120Hz 線性軟 PWM 已啟動 (I2C %lu Hz)\n",
                (unsigned long)I2C_CLOCK_HZ);
}

void setLedPwm(uint8_t ch, uint8_t pwm) {
  if (ch < NUM_LEDS) {
    ledPwmTarget[ch] = pwm;
  }
}

void setAllLedsPwm(uint8_t pwm) {
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    ledPwmTarget[i] = pwm;
  }
}

void clearAllLeds() {
  setAllLedsPwm(0);
}
