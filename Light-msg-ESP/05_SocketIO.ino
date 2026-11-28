// ============================================================================
// 05_SocketIO.ino - W5500 原生 RFC 6455 WebSocket + Socket.IO v4 Client
//
//   - 連線至 light-msg-env.eba-yxa2kk5q.us-east-1.elasticbeanstalk.com:80
//   - 路徑 /socket.io/?EIO=4&transport=websocket
//   - 收到 Engine.IO "0{...}" 自動回覆 "40" 完成 Socket.IO v4 命名空間握手
//   - 收到心跳 "2" 自動回覆 "3"
//   - 監聽 'esp-msg' 事件，格式：
//       42["esp-msg",{"mailbox":3,"ledValues":[29,49,97,...,0]}]
//     收到後立即將 30 道取樣數據與郵筒編號送進 triggerMessageLightFlow()
// ============================================================================

static EthernetClient socketClient;
static bool           socketConnected       = false;
static bool           socketNamespaceReady  = false;
static uint32_t       lastSocketReconnectMs = 0;
static uint8_t        socketFailCount       = 0;

void socketIoNotifyNetworkRecovered() {
  socketClient.stop();
  socketConnected       = false;
  socketNamespaceReady  = false;
  socketFailCount       = 0;
  lastSocketReconnectMs = millis() - SOCKET_RECONNECT_MS;
}

static void sendWebSocketText(const String &msg) {
  if (!socketClient.connected()) return;

  size_t len = msg.length();
  uint8_t mask[4] = { 0x33, 0x77, 0xAA, 0xEE };

  socketClient.write((uint8_t)0x81); // FIN + Text Frame

  if (len <= 125) {
    socketClient.write((uint8_t)(0x80 | len));
  } else if (len <= 65535) {
    socketClient.write((uint8_t)(0x80 | 126));
    socketClient.write((uint8_t)((len >> 8) & 0xFF));
    socketClient.write((uint8_t)(len & 0xFF));
  } else {
    return;
  }

  socketClient.write(mask, 4);
  for (size_t i = 0; i < len; i++) {
    socketClient.write((uint8_t)(msg[i] ^ mask[i % 4]));
  }
}

static bool waitSocketBytes(size_t needed, uint32_t timeoutMs) {
  uint32_t startMs = millis();
  while ((size_t)socketClient.available() < needed) {
    if (!socketClient.connected() || (millis() - startMs >= timeoutMs)) {
      return false;
    }
    delay(1);
  }
  return true;
}

static bool connectSocketIoWebSocket() {
  if (!isNetworkReady()) return false;

  Serial.printf("[Socket.IO] 正在透過 W5500 連線至 %s:%u%s\n",
                SOCKET_HOST, SOCKET_PORT, SOCKET_PATH);

  if (!socketClient.connect(SOCKET_HOST, SOCKET_PORT)) {
    socketFailCount++;
    Serial.printf("[Socket.IO] TCP 連線失敗 (連續第 %u 次)，%lu ms 後重試...\n",
                  socketFailCount, (unsigned long)SOCKET_RECONNECT_MS);
    if (socketFailCount >= 3) {
      socketFailCount = 0;
      networkRequestDhcpRetry();
    }
    return false;
  }

  socketClient.print("GET ");
  socketClient.print(SOCKET_PATH);
  socketClient.println(" HTTP/1.1");
  socketClient.print("Host: ");
  socketClient.println(SOCKET_HOST);
  socketClient.println("Upgrade: websocket");
  socketClient.println("Connection: Upgrade");
  socketClient.println("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==");
  socketClient.println("Sec-WebSocket-Version: 13");
  socketClient.println();

  uint32_t deadline = millis() + 6000;
  bool is101 = false;
  while (millis() < deadline) {
    if (socketClient.available()) {
      String line = socketClient.readStringUntil('\n');
      line.trim();
      if (line.indexOf("101") >= 0) {
        is101 = true;
      }
      if (line.length() == 0) {
        break;
      }
    }
    delay(2);
  }

  if (is101) {
    socketConnected      = true;
    socketNamespaceReady = false;
    socketFailCount      = 0;
    Serial.println("[Socket.IO] WebSocket 握手成功 (101 Switching Protocols)！");
    return true;
  }

  socketFailCount++;
  Serial.println("[Socket.IO] WebSocket 握手失敗 (未收到 101 回應)");
  socketClient.stop();
  if (socketFailCount >= 3) {
    socketFailCount = 0;
    networkRequestDhcpRetry();
  }
  return false;
}

// 輕量級整數解析器（免 ArduinoJson 依賴）
static bool parseNextInt(const String &src, int &idx, int &outVal) {
  int n = src.length();
  while (idx < n) {
    char c = src[idx];
    if ((c >= '0' && c <= '9') || c == '-') break;
    idx++;
  }
  if (idx >= n) return false;

  bool neg = false;
  if (src[idx] == '-') {
    neg = true;
    idx++;
  }
  if (idx >= n || src[idx] < '0' || src[idx] > '9') return false;

  int val = 0;
  while (idx < n && src[idx] >= '0' && src[idx] <= '9') {
    val = val * 10 + (src[idx] - '0');
    idx++;
  }
  outVal = neg ? -val : val;
  return true;
}

// 解析並處理 'esp-msg' 事件：
//   42["esp-msg",{"mailbox":3,"ledValues":[v0,v1,...,v29]}]
static void handleEspMsgPayload(const String &payload) {
  String eventKey = String("\"") + SOCKET_EVENT_NAME + "\"";
  int eventIdx = payload.indexOf(eventKey);
  if (eventIdx < 0) return;

  int searchStart = eventIdx + eventKey.length();

  // 1. 解析 mailbox (1..5)，若未帶則預設 1
  int mailbox = 1;
  int mbKeyIdx = payload.indexOf("\"mailbox\"", searchStart);
  if (mbKeyIdx >= 0) {
    int p = mbKeyIdx + 9;
    int parsedMb = 1;
    if (parseNextInt(payload, p, parsedMb)) {
      mailbox = constrain(parsedMb, 1, (int)MAILBOX_COUNT);
    }
  }

  // 2. 尋找 30 道取樣陣列（支援 "ledValues":[...] 或 "values":[...]）
  int arrKeyIdx = payload.indexOf("\"ledValues\"", searchStart);
  if (arrKeyIdx < 0) {
    arrKeyIdx = payload.indexOf("\"values\"", searchStart);
  }
  if (arrKeyIdx < 0) {
    Serial.println("[Socket.IO] esp-msg 缺少 ledValues 陣列，已略過。");
    return;
  }

  int arrOpen = payload.indexOf('[', arrKeyIdx);
  if (arrOpen < 0) {
    Serial.println("[Socket.IO] esp-msg 格式異常：找不到 '['");
    return;
  }

  uint8_t samples[NUM_LEDS] = {0};
  int p = arrOpen + 1;
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    int val = 0;
    if (!parseNextInt(payload, p, val)) {
      Serial.printf("[Socket.IO] esp-msg 第 %u 道取樣數值解析失敗\n", (unsigned)(i + 1));
      return;
    }
    samples[i] = (uint8_t)constrain(val, 0, 255);
  }

  Serial.println("==============================================");
  Serial.printf("[Socket.IO] 收到 '%s' -> 郵筒 #%d (CH.%02u)\n",
                SOCKET_EVENT_NAME, mailbox, (unsigned)(MAILBOX_CH[mailbox - 1] + 1));
  Serial.print("[Socket.IO] 30-CH 取樣數據: [");
  for (uint8_t i = 0; i < NUM_LEDS; i++) {
    Serial.print(samples[i]);
    if (i + 1 < NUM_LEDS) Serial.print(", ");
  }
  Serial.println("]");
  Serial.println("==============================================");

  triggerMessageLightFlow(samples, (uint8_t)mailbox);
}

static void processSocketIncoming() {
  if (!socketClient.connected()) {
    if (socketConnected) {
      Serial.println("[Socket.IO] 與伺服器連線已中斷");
      socketConnected      = false;
      socketNamespaceReady = false;
    }
    return;
  }

  while (socketClient.available() >= 2) {
    uint8_t b1 = socketClient.read();
    uint8_t b2 = socketClient.read();

    uint8_t  opcode     = b1 & 0x0F;
    bool     isMasked   = (b2 & 0x80) != 0;
    uint32_t payloadLen = b2 & 0x7F;

    if (payloadLen == 126) {
      if (!waitSocketBytes(2, 2000)) {
        socketClient.stop();
        socketConnected = false;
        return;
      }
      payloadLen = ((uint32_t)socketClient.read() << 8) | socketClient.read();
    } else if (payloadLen == 127) {
      if (!waitSocketBytes(8, 2000)) {
        socketClient.stop();
        socketConnected = false;
        return;
      }
      socketClient.read(); socketClient.read(); socketClient.read(); socketClient.read();
      payloadLen = ((uint32_t)socketClient.read() << 24) |
                   ((uint32_t)socketClient.read() << 16) |
                   ((uint32_t)socketClient.read() << 8)  |
                   socketClient.read();
    }

    uint8_t maskKey[4] = {0};
    if (isMasked) {
      if (!waitSocketBytes(4, 2000)) {
        socketClient.stop();
        socketConnected = false;
        return;
      }
      socketClient.readBytes(maskKey, 4);
    }

    const uint32_t MAX_FRAME_LEN = 4096;
    if (payloadLen > MAX_FRAME_LEN) {
      for (uint32_t i = 0; i < payloadLen; i++) {
        if (!waitSocketBytes(1, 500)) break;
        socketClient.read();
      }
      continue;
    }

    String payload = "";
    payload.reserve(payloadLen + 1);
    for (uint32_t i = 0; i < payloadLen; i++) {
      if (!waitSocketBytes(1, 2000)) {
        socketClient.stop();
        socketConnected = false;
        return;
      }
      uint8_t c = socketClient.read();
      if (isMasked) {
        c ^= maskKey[i % 4];
      }
      payload += (char)c;
    }

    // WebSocket Close Frame
    if (opcode == 0x8) {
      socketClient.stop();
      socketConnected      = false;
      socketNamespaceReady = false;
      return;
    }

    // WebSocket Ping -> Pong
    if (opcode == 0x9) {
      socketClient.write((uint8_t)0x8A);
      socketClient.write((uint8_t)0x80);
      socketClient.write(maskKey, 4);
      continue;
    }

    // Engine.IO Open ("0{...}") -> 送出 "40" 連線 Socket.IO 預設命名空間 '/'
    if (payload.startsWith("0")) {
      sendWebSocketText("40");
      continue;
    }

    // Socket.IO Namespace Connected ("40{...}")
    if (payload.startsWith("40")) {
      socketNamespaceReady = true;
      Serial.printf("[Socket.IO] 命名空間 '/' 連線就緒，正在監聽 '%s'...\n", SOCKET_EVENT_NAME);
      continue;
    }

    // Engine.IO Ping ("2") -> Pong ("3")
    if (payload == "2" || payload.startsWith("2")) {
      sendWebSocketText("3");
      continue;
    }

    // Socket.IO Event ("42[...]")
    if (payload.startsWith("42")) {
      if (payload.indexOf(String("\"") + SOCKET_EVENT_NAME + "\"") >= 0) {
        handleEspMsgPayload(payload);
      }
      continue;
    }
  }
}

void socketIoInit() {
  if (!isNetworkReady()) return;
  socketConnected       = false;
  socketNamespaceReady  = false;
  socketFailCount       = 0;
  lastSocketReconnectMs = millis();
  connectSocketIoWebSocket();
}

void socketIoTick() {
  if (!isNetworkReady()) return;

  if (socketConnected && socketClient.connected()) {
    processSocketIncoming();
  } else {
    if (millis() - lastSocketReconnectMs >= SOCKET_RECONNECT_MS) {
      lastSocketReconnectMs = millis();
      socketClient.stop();
      connectSocketIoWebSocket();
    }
  }
}
