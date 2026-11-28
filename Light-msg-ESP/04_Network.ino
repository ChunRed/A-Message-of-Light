// ============================================================================
// 04_Network.ino - W5500 有線乙太網初始化與背景自動重連 DHCP
//
// 承襲 900MHz-ESP 穩定實戰策略：
//   1. 冷開機啟動前先等待 NET_COLD_BOOT_WAIT_MS (1200ms) 讓 W5500 電源與 RC 重置穩定。
//   2. 初始化時最多重試 3 次偵測晶片與等待 PHY Link Up。
//   3. 即使開機當下未插線或尚未取得 DHCP，絕不阻塞或放棄網路：
//      Core 1 於背景每 10 秒自動檢查 Link 狀態並重新取得 DHCP
//      （Core 0 雙 MCP23017 燈光 PWM 完全不受影響）。
// ============================================================================

static bool     networkReady       = false;
static bool     networkHasDhcp     = false;
static uint32_t lastDhcpRetryMs    = 0;
static bool     forceDhcpRetryFlag = false;

bool isNetworkReady() {
  return networkReady;
}

void networkRequestDhcpRetry() {
  forceDhcpRetryFlag = true;
}

static bool tryBringUpW5500(uint32_t dhcpTimeoutMs) {
  SPI.begin(W5500_SCK_PIN, W5500_MISO_PIN, W5500_MOSI_PIN, W5500_CS_PIN);
  Ethernet.init(W5500_CS_PIN);
  delay(80);

  uint32_t linkStart = millis();
  while (Ethernet.linkStatus() == LinkOFF && (millis() - linkStart < NET_LINK_WAIT_MS)) {
    delay(100);
  }

  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("[W5500] 尚未偵測到 W5500 晶片（將於背景持續重試）");
    return false;
  }

  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("[W5500] 尚未偵測到乙太網連線 (LinkOFF)，將於背景持續重試...");
    return false;
  }

  Serial.println("[W5500] LinkON！正在透過 DHCP 取得 IP...");
  if (Ethernet.begin(W5500_MAC, dhcpTimeoutMs, 1000) != 0) {
    networkReady       = true;
    networkHasDhcp     = true;
    forceDhcpRetryFlag = false;
    Serial.println("[W5500] DHCP 取得 IP 成功！");
    Serial.print("[W5500] 本機 IP 位址: ");
    Serial.println(Ethernet.localIP());
    Serial.print("[W5500] 預設閘道 (Gateway): ");
    Serial.println(Ethernet.gatewayIP());
    Serial.print("[W5500] DNS 伺服器: ");
    Serial.println(Ethernet.dnsServerIP());
    return true;
  }

  Serial.println("[W5500] DHCP 逾時，先暫用備用靜態 IP（背景每 10 秒自動重試 DHCP）...");
  Ethernet.begin(W5500_MAC, W5500_LOCAL_IP, W5500_DNS, W5500_GATEWAY, W5500_SUBNET);
  networkReady   = true;
  networkHasDhcp = false;
  return false;
}

void networkInit() {
  Serial.printf("[W5500] 冷開機緩衝 %u ms 等待 W5500 穩壓喚醒 (CS=%d)...\n",
                NET_COLD_BOOT_WAIT_MS, W5500_CS_PIN);
  delay(NET_COLD_BOOT_WAIT_MS);

  for (uint8_t attempt = 1; attempt <= NET_INIT_MAX_RETRIES; attempt++) {
    Serial.printf("[W5500] 第 %u/%u 次初始化嘗試...\n", attempt, NET_INIT_MAX_RETRIES);
    if (tryBringUpW5500(4000)) {
      lastDhcpRetryMs = millis();
      return;
    }
    if (attempt < NET_INIT_MAX_RETRIES) {
      delay(600);
    }
  }

  lastDhcpRetryMs = millis();
  Serial.println("[W5500] 開機階段尚未完成 DHCP，將維持常態燈流並於背景每 10 秒自動重試！");
}

void networkTick() {
  if (networkReady && networkHasDhcp) {
    Ethernet.maintain();
  }

  if (networkReady && Ethernet.linkStatus() == LinkOFF) {
    if (networkHasDhcp) {
      Serial.println("[W5500] 偵測到網路線斷開 (LinkOFF)，等待恢復後自動重新 DHCP...");
    }
    networkReady   = false;
    networkHasDhcp = false;
  }

  bool needRetry = (!networkReady) || (!networkHasDhcp) || forceDhcpRetryFlag;
  if (needRetry && (millis() - lastDhcpRetryMs >= NET_BG_RETRY_DHCP_MS)) {
    lastDhcpRetryMs = millis();
    Serial.println("[W5500] 背景自動重試初始化與 DHCP...");
    if (tryBringUpW5500(3000)) {
      socketIoNotifyNetworkRecovered();
    }
  }
}
