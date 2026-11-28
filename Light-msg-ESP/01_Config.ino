// ============================================================================
// 01_Config.ino - 硬體腳位、雙 MCP23017 30-CH 對應表、W5500 網路與動畫參數
// ============================================================================

// ----------------------------------------------------------------------------
// 1. I2C 與雙 MCP23017 設定（0x20 控制 LED 1~16，0x21 控制 LED 17~30）
// ----------------------------------------------------------------------------
#define I2C_SDA_PIN    21
#define I2C_SCL_PIN    22
#define I2C_CLOCK_HZ   800000    // MCP23017 最高支援 1.7MHz（若長線干擾可改 400000）

static const uint8_t MCP_ADDR_1   = 0x20;
static const uint8_t MCP_ADDR_2   = 0x21;
static const uint8_t MCP_ADDRS[2] = { MCP_ADDR_1, MCP_ADDR_2 };

// MOSFET 驅動極性：N-MOS 低邊驅動通常 HIGH 點亮；若為低電位觸發請改為 false
static const bool LED_ACTIVE_HIGH = true;

// ----------------------------------------------------------------------------
// 2. W5500 乙太網 SPI 腳位與網路設定（VSPI 預設腳位，避開 I2C 21/22）
// ----------------------------------------------------------------------------
#define W5500_SCK_PIN  18
#define W5500_MISO_PIN 19
#define W5500_MOSI_PIN 23
#define W5500_CS_PIN   5

byte W5500_MAC[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0x4C, 0x01 };

// 無 DHCP 時的備用靜態固定 IP（背景仍會每 10 秒自動重試 DHCP）
IPAddress W5500_LOCAL_IP(192, 168, 1, 21);
IPAddress W5500_GATEWAY(192, 168, 1, 1);
IPAddress W5500_SUBNET(255, 255, 255, 0);
IPAddress W5500_DNS(8, 8, 8, 8);

const uint16_t NET_COLD_BOOT_WAIT_MS = 1200;   // 冷開機先等 W5500 內部穩壓喚醒
const uint8_t  NET_INIT_MAX_RETRIES  = 3;      // 開機初始化最多重試次數
const uint16_t NET_LINK_WAIT_MS      = 2500;   // 等待 PHY Link Up 逾時
const uint32_t NET_BG_RETRY_DHCP_MS  = 10000;  // 背景自動重試 DHCP 間隔 (10 秒)

// ----------------------------------------------------------------------------
// 3. Socket.IO v4 伺服器設定（AWS Elastic Beanstalk Port 80）
// ----------------------------------------------------------------------------
const char*    SOCKET_HOST         = "light-msg-env.eba-yxa2kk5q.us-east-1.elasticbeanstalk.com";
const uint16_t SOCKET_PORT         = 80;
const char*    SOCKET_PATH         = "/socket.io/?EIO=4&transport=websocket";
const char*    SOCKET_EVENT_NAME   = "esp-msg";
const uint32_t SOCKET_RECONNECT_MS = 3000;

// ----------------------------------------------------------------------------
// 4. 30 通道實體 LED 腳位查表（0-based index 0..29 對應實體 CH.01..CH.30）
//    - MCP23017 #1 (0x20): A0..A7 -> LED  1.. 8, B0..B7 -> LED  9..16
//    - MCP23017 #2 (0x21): A0..A6 -> LED 17..23, B0..B6 -> LED 24..30 (A7/B7 不用)
// ----------------------------------------------------------------------------
static const uint8_t NUM_LEDS = 30;

struct LedPinMap {
  uint8_t chip; // 0 = MCP #1 (0x20), 1 = MCP #2 (0x21)
  uint8_t port; // 0 = Port A (GPA),  1 = Port B (GPB)
  uint8_t bit;  // 0..7
};

static const LedPinMap LED_MAP[NUM_LEDS] = {
  // MCP23017 #1 (0x20) — Port A: A0..A7 -> LED 1..8
  {0, 0, 0}, {0, 0, 1}, {0, 0, 2}, {0, 0, 3},
  {0, 0, 4}, {0, 0, 5}, {0, 0, 6}, {0, 0, 7},
  // MCP23017 #1 (0x20) — Port B: B0..B7 -> LED 9..16
  {0, 1, 0}, {0, 1, 1}, {0, 1, 2}, {0, 1, 3},
  {0, 1, 4}, {0, 1, 5}, {0, 1, 6}, {0, 1, 7},
  // MCP23017 #2 (0x21) — Port A: A0..A6 -> LED 17..23 (A7 保留不用)
  {1, 0, 0}, {1, 0, 1}, {1, 0, 2}, {1, 0, 3},
  {1, 0, 4}, {1, 0, 5}, {1, 0, 6},
  // MCP23017 #2 (0x21) — Port B: B0..B6 -> LED 24..30 (B7 保留不用)
  {1, 1, 0}, {1, 1, 1}, {1, 1, 2}, {1, 1, 3},
  {1, 1, 4}, {1, 1, 5}, {1, 1, 6},
};

// 5 座觀眾 QR 橘色郵筒對應的 0-based 通道索引（對應實體立面圖 CH.07, 10, 18, 24, 28）
static const uint8_t MAILBOX_COUNT = 5;
static const uint8_t MAILBOX_CH[MAILBOX_COUNT] = { 6, 9, 17, 23, 27 };

// ----------------------------------------------------------------------------
// 5. 動畫與特效時間參數
// ----------------------------------------------------------------------------
static const uint16_t ANIM_UPDATE_INTERVAL_MS = 16;   // ~60 FPS 動畫運算更新

// 可選：開機是否先執行一次「9 秒逐一點亮再熄滅」硬體自檢（true=開機先跑 9 秒測試）
static const bool     ENABLE_BOOT_TEST_9S     = false;
static const uint32_t BOOT_CYCLE_DURATION_MS  = 9000UL;
static const uint8_t  BOOT_TOTAL_STEPS        = NUM_LEDS * 2;                     // 60 步
static const uint32_t BOOT_STEP_DURATION_MS   = BOOT_CYCLE_DURATION_MS / BOOT_TOTAL_STEPS; // 150ms
static const uint8_t  BOOT_TEST_ON_PWM        = 120;

// 常態輕微燈流特效參數（亮度平滑浮動於 2 ~ 50 PWM）
static const uint8_t  AMBIENT_MIN_PWM          = 2;
static const uint8_t  AMBIENT_MAX_PWM          = 50;
static const float    AMBIENT_WAVE1_PERIOD_MS  = 11000.0f; // 主光流緩慢漂移週期 (11s)
static const float    AMBIENT_WAVE2_PERIOD_MS  = 17300.0f; // 次波有機呼吸週期 (17.3s)
static const float    AMBIENT_SPATIAL_CYCLES   = 1.65f;    // 橫跨 30 燈的溫柔波峰數

// 收到 esp-msg 後的 30-CH 光訊燈流參數（1:1 對應 /esp32-test 模擬器引擎）
static const uint8_t  STREAM_PASS_COUNT        = 3;        // 3 次重疊光流傳送
static const uint32_t PASS_DURATION_MS         = 3900UL;   // 單趟 30 取樣橫跨 30 燈時間
static const uint32_t PASS_STRIDE_MS           = 2500UL;   // 趟次重疊間距（無空窗）
static const uint32_t BREATH_PERIOD_MS         = 2600UL;   // 目標郵筒呼吸週期
static const uint32_t BREATH_FADE_IN_MS        = 1400UL;   // 目標郵筒平滑淡入時間
static const uint32_t ALL_PASSES_END_MS        = (STREAM_PASS_COUNT - 1) * PASS_STRIDE_MS + PASS_DURATION_MS; // 8900ms

// 光流跑完後，目標郵筒持續呼吸 3 個週期再柔和淡出回常態燈流
static const uint32_t MSG_BREATH_HOLD_MS       = BREATH_PERIOD_MS * 3; // 7800ms
static const uint32_t MSG_RETURN_BLEND_MS      = 2000UL;               // 2.0s 平滑交融回常態
static const uint32_t MSG_TOTAL_DURATION_MS    = ALL_PASSES_END_MS + MSG_BREATH_HOLD_MS + MSG_RETURN_BLEND_MS;

enum SystemState : uint8_t {
  STATE_BOOT_TEST_9S = 0, // 可選開機 9 秒逐一點亮再熄滅測試
  STATE_AMBIENT_FLOW,     // 裝置常態：輕微 fade-in / fade-out 燈流 (2 ~ 50 PWM)
  STATE_MESSAGE_FLOW      // 收到 esp-msg：30-CH 光訊燈流 + 目標郵筒呼吸 -> 平滑回常態
};

void printStartupBanner() {
  Serial.println();
  Serial.println("====================================================");
  Serial.println("  一則光的訊息 (Light-msg-ESP) 30-CH 郵筒燈控啟動");
  Serial.printf("  MCP23017 : 0x%02X (LED 1~16) & 0x%02X (LED 17~30)\n",
                MCP_ADDR_1, MCP_ADDR_2);
  Serial.printf("  Server   : http://%s:%u\n", SOCKET_HOST, SOCKET_PORT);
  Serial.printf("  Event    : %s | Ambient PWM: %u~%u\n",
                SOCKET_EVENT_NAME, AMBIENT_MIN_PWM, AMBIENT_MAX_PWM);
  Serial.println("====================================================");
}
