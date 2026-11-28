"use client";

import { io, Socket } from "socket.io-client";
import { normalize30Channels } from "@/lib/esp32-light-channel";
import type { MailboxNumber } from "@/lib/image-library-api";

const DEFAULT_SOCKET_SERVER_URL = "https://light-msg-server.nosidehere.space";

let sharedSocket: Socket | null = null;

export function getLightSocketServerUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_SOCKET_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  return configured || DEFAULT_SOCKET_SERVER_URL;
}

function getOrCreateSocket(): Socket | null {
  if (typeof window === "undefined") return null;
  if (!sharedSocket) {
    sharedSocket = io(getLightSocketServerUrl(), {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
      timeout: 10000,
    });
  }
  return sharedSocket;
}

/**
 * Quietly pre-warms the Socket.IO connection so swipe-up dispatch has minimal latency.
 */
export function prewarmLightSocket(): void {
  const socket = getOrCreateSocket();
  if (socket && !socket.connected) {
    socket.connect();
  }
}

export interface ClientMsgPayload {
  mailbox: MailboxNumber;
  ledValues: number[];
}

/**
 * Emits `client-msg` to the Socket.IO server with the 30-CH sampled values (0..255)
 * and chosen target mailbox (1..5). The server relays it to ESP32 via `esp-msg`.
 */
export function emitClientLightMessage(
  ledValues: number[],
  mailbox: MailboxNumber
): void {
  const socket = getOrCreateSocket();
  if (!socket) return;

  const payload: ClientMsgPayload = {
    mailbox,
    ledValues: normalize30Channels(ledValues),
  };

  if (!socket.connected) {
    socket.connect();
  }
  socket.emit("client-msg", payload);
}
