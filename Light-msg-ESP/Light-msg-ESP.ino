#include <Wire.h>
#include <SPI.h>
#include <Ethernet.h>
#include <math.h>

// ============================================================================
// 一則光的訊息 (Light-msg-ESP) — ESP32 30-CH 郵筒燈控與 W5500 Socket.IO 多分頁韌體
//
// Arduino IDE 分頁架構總覽：
//   - Light-msg-ESP.ino : 主程式進入點 (setup / loop)
//   - 01_Config.ino     : I2C / MCP23017 (0x20, 0x21)、30-CH 腳位表、5 郵筒通道、
//                         W5500 網路、Socket.IO Server 與動畫時間參數
//   - 02_HardwarePWM.ino: 雙 MCP23017 驅動 + Core 0 獨立 120Hz 線性軟體 PWM（無閃爍）
//   - 03_Animations.ino : 狀態機、常態輕微燈流 (2~50 PWM)、收到 esp-msg 之 30-CH
//                         光訊燈流特效（1:1 對應 /esp32-test）與開機 9 秒測試
//   - 04_Network.ino    : W5500 冷開機緩衝重試 + 背景每 10 秒自動重連 DHCP
//   - 05_SocketIO.ino   : W5500 原生 RFC 6455 WebSocket + Socket.IO v4 監聽 'esp-msg'
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(100);
  randomSeed((uint32_t)esp_random());

  printStartupBanner();

  // 1. 初始化雙 MCP23017 (0x20, 0x21) 並於 Core 0 啟動 120Hz 獨立線性軟體 PWM
  //    （與 Core 1 上的 W5500 網路連線／斷線重連完全隔離，燈光不卡頓）
  hardwarePwmInit();

  // 2. 初始化動畫狀態機（先讓燈光立即上線，不等網路 DHCP）
  animationsInit();

  // 3. 初始化 W5500 有線乙太網（含冷開機等待重試）與 Socket.IO v4 連線
  networkInit();
  socketIoInit();
}

void loop() {
  // 1. 維護 W5500 DHCP 租約與背景自動重連
  networkTick();

  // 2. 維護 Socket.IO v4 連線並持續監聽 'esp-msg' 事件
  socketIoTick();

  // 3. 更新燈光狀態機與 60 FPS 動畫（實際 PWM 輸出由 Core 0 獨立執行）
  animationsTick();
}
