"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MailboxNumber } from "@/lib/image-library-api";
import {
  createDemoEsp32Payload,
  ELEVATION_PILLAR_XS,
  ESP32_PHYSICAL_NODES,
  Esp32LightPayload,
  MAILBOX_LED_CHANNEL_MAP,
  PhysicalNodeKind,
  readStoredEsp32Payload,
  subscribeEsp32Payloads,
} from "@/lib/esp32-light-channel";
import {
  createEsp32FirmwareState,
  Esp32FirmwareState,
  esp32LoadPacket,
  esp32LoopTick,
  esp32Stop,
  esp32Trigger,
  generateArduinoEsp32Code,
  NUM_CHANNELS,
} from "@/lib/esp32-firmware-engine";

type LayoutMode = "elevation" | "linear";

const MAILBOX_NUMBERS: MailboxNumber[] = [1, 2, 3, 4, 5];

function getNodePalette(kind: PhysicalNodeKind): {
  coreRgb: string;
  glowRgb: string;
  idleStroke: string;
  labelColor: string;
} {
  switch (kind) {
    case "start":
      return {
        coreRgb: "118, 245, 152",
        glowRgb: "74, 222, 128",
        idleStroke: "rgba(74, 222, 128, 0.65)",
        labelColor: "rgba(134, 239, 172, 0.9)",
      };
    case "orange-box":
      return {
        coreRgb: "255, 206, 118",
        glowRgb: "251, 146, 60",
        idleStroke: "rgba(251, 146, 60, 0.72)",
        labelColor: "rgba(253, 186, 116, 0.95)",
      };
    case "gray-box":
      return {
        coreRgb: "242, 242, 245",
        glowRgb: "212, 212, 220",
        idleStroke: "rgba(161, 161, 170, 0.42)",
        labelColor: "rgba(161, 161, 170, 0.62)",
      };
    case "plate":
    default:
      return {
        coreRgb: "255, 248, 232",
        glowRgb: "243, 217, 139",
        idleStroke: "rgba(228, 228, 231, 0.3)",
        labelColor: "rgba(212, 212, 216, 0.5)",
      };
  }
}

export function Esp32LightTestConsole() {
  const [payload, setPayload] = useState<Esp32LightPayload>(() =>
    createDemoEsp32Payload(3)
  );
  const [hasLiveLetterData, setHasLiveLetterData] = useState<boolean>(false);
  const [liveToast, setLiveToast] = useState<string | null>(null);
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxNumber>(3);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("elevation");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [statusLabel, setStatusLabel] = useState<string>("待機中（按下觸發開始 3 次燈流）");
  const [showCppCode, setShowCppCode] = useState<boolean>(false);
  const [copiedType, setCopiedType] = useState<"none" | "ino" | "json">("none");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasBoxRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const layoutModeRef = useRef<LayoutMode>("elevation");

  // Single 1:1 ESP32 C++-style controller state (zero per-frame heap allocation)
  const fwRef = useRef<Esp32FirmwareState>(createEsp32FirmwareState(undefined, 3));

  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  useEffect(() => {
    esp32LoadPacket(fwRef.current, payload.ledValues, selectedMailbox);
  }, [payload.ledValues, selectedMailbox]);

  const flashToast = useCallback((msg: string) => {
    setLiveToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setLiveToast(null);
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  // Hydrate latest stored 30-CH letter payload from `/`
  useEffect(() => {
    const stored = readStoredEsp32Payload();
    if (!stored) return;
    const rafId = window.requestAnimationFrame(() => {
      setPayload(stored);
      setSelectedMailbox(stored.mailbox);
      setHasLiveLetterData(stored.status !== "demo");
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  // Listen for live cross-tab payloads whenever the user sends a letter on `/`
  useEffect(() => {
    const unsubscribe = subscribeEsp32Payloads((incoming) => {
      setPayload(incoming);
      setSelectedMailbox(incoming.mailbox);
      setHasLiveLetterData(incoming.status !== "demo");
      const chNum = MAILBOX_LED_CHANNEL_MAP[incoming.mailbox] + 1;
      flashToast(
        incoming.status === "dispatched"
          ? `已即時接收信件光訊 → 橘色郵筒 #${incoming.mailbox} (CH.${String(chNum).padStart(2, "0")})`
          : `已同步最新 30-CH 取樣數據 (${incoming.packetId})`
      );
    });

    return () => {
      unsubscribe();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [flashToast]);

  const handleTrigger = useCallback(() => {
    esp32LoadPacket(fwRef.current, payload.ledValues, selectedMailbox);
    esp32Trigger(fwRef.current, performance.now());
    setIsRunning(true);
    setStatusLabel("燈流第 1 / 3 輪流動中⋯");
  }, [payload.ledValues, selectedMailbox]);

  const handleStop = useCallback(() => {
    esp32Stop(fwRef.current);
    setIsRunning(false);
    setStatusLabel("待機中（按下觸發開始 3 次燈流）");
  }, []);

  const handleLoadRandomDemo = useCallback(() => {
    const next = createDemoEsp32Payload(selectedMailbox);
    setPayload(next);
    setHasLiveLetterData(false);
    flashToast("已生成高對比 30-CH 測試波形");
  }, [flashToast, selectedMailbox]);

  const arduinoCode = useMemo(
    () => generateArduinoEsp32Code(payload.ledValues, selectedMailbox),
    [payload.ledValues, selectedMailbox]
  );

  const handleCopyArduinoIno = useCallback(() => {
    navigator.clipboard
      ?.writeText(arduinoCode)
      .then(() => {
        setCopiedType("ino");
        window.setTimeout(() => setCopiedType("none"), 1800);
      })
      .catch(() => {});
  }, [arduinoCode]);

  const handleCopyEsp32Json = useCallback(() => {
    const targetCh = MAILBOX_LED_CHANNEL_MAP[selectedMailbox] + 1;
    const packet = {
      protocol: "LIGHT_MSG_ESP32_30CH",
      packetId: payload.packetId,
      mailbox: selectedMailbox,
      targetChannel: targetCh,
      orangeMailboxChannels: [7, 10, 18, 24, 28],
      channels: payload.ledValues,
    };
    navigator.clipboard
      ?.writeText(JSON.stringify(packet, null, 2))
      .then(() => {
        setCopiedType("json");
        window.setTimeout(() => setCopiedType("none"), 1800);
      })
      .catch(() => {});
  }, [payload.ledValues, payload.packetId, selectedMailbox]);

  // =========================================================================
  // 60FPS PURE 2D EMISSION RENDERER DRIVEN 1:1 BY `esp32LoopTick`
  // =========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = canvasBoxRef.current;
    if (!canvas || !box) return;

    let size = { w: 1, h: 1, dpr: 1 };
    const syncSize = () => {
      const rect = box.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(box);
    window.addEventListener("resize", syncSize);

    let rafId = 0;
    let lastUiStateKey = "";

    const renderFrame = (nowMs: number) => {
      rafId = window.requestAnimationFrame(renderFrame);
      const { w, h, dpr } = size;
      if (w < 40 || h < 40) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const fw = fwRef.current;
      // Execute the exact 1:1 ESP32 Arduino loop tick
      esp32LoopTick(fw, nowMs);

      // Update lightweight UI telemetry only when status changes
      let uiKey = "standby";
      let nextStatus = "待機中（按下觸發開始 3 次燈流）";
      if (fw.active) {
        if (fw.currentPassNumber <= 3 && fw.breathLayerMix > 0.01) {
          uiKey = `overlap-${fw.currentPassNumber}`;
          nextStatus = `燈流第 3 / 3 輪尾段 × 郵筒 #${fw.targetMailbox} 呼吸燈無縫重疊交接`;
        } else if (fw.currentPassNumber <= 3) {
          uiKey = `pass-${fw.currentPassNumber}`;
          nextStatus = `30-CH 原始畫作燈流第 ${fw.currentPassNumber} / 3 輪流過中`;
        } else {
          uiKey = `breath-${fw.targetMailbox}`;
          nextStatus = `橘色郵筒 #${fw.targetMailbox}（CH.${String(
            fw.targetChannelIdx + 1
          ).padStart(2, "0")}）持續呼吸閃爍中`;
        }
      }
      if (uiKey !== lastUiStateKey) {
        lastUiStateKey = uiKey;
        setStatusLabel(nextStatus);
      }

      // ---------------------------------------------------------------------
      // 1. PURE PITCH-BLACK BACKGROUND + ARCHITECTURAL ELEVATION GUIDES
      // ---------------------------------------------------------------------
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#040507";
      ctx.fillRect(0, 0, w, h);

      const mode = layoutModeRef.current;
      const isCompact = w < 560;
      const scale = Math.max(0.45, Math.min(1, w / 860));
      const padX = isCompact ? 12 : Math.max(24, w * 0.03);
      const usableW = Math.max(160, w - padX * 2);

      // Subtle dark architectural elevation pillars & ground datum line (in elevation mode)
      if (mode === "elevation") {
        ctx.save();
        const pillarW = isCompact ? 4 : 8;
        for (const pxNorm of ELEVATION_PILLAR_XS) {
          const px = padX + pxNorm * usableW;
          ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
          ctx.fillRect(px - pillarW * 0.5, 0, pillarW, h - 18);
        }
        // Subtle floor line matching the bottom of the stands
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX * 0.5, h - 20);
        ctx.lineTo(w - padX * 0.5, h - 20);
        ctx.stroke();
        ctx.restore();
      } else {
        // Clean single horizontal baseline in 1D linear mode
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, h * 0.52);
        ctx.lineTo(w - padX, h * 0.52);
        ctx.stroke();
        ctx.restore();
      }

      // ---------------------------------------------------------------------
      // 2. RENDER ALL 30 FLAT 2D EMISSION LIGHT POINTS (FITS 1 MOBILE SCREEN!)
      // ---------------------------------------------------------------------
      const topY = isCompact ? 26 : 34;
      const botY = isCompact ? h - 28 : h - 38;
      const usableH = Math.max(70, botY - topY);

      for (let i = 0; i < NUM_CHANNELS; i++) {
        const spec = ESP32_PHYSICAL_NODES[i];
        const pwm = fw.pwmOutput[i];
        const norm = pwm / 255.0;
        const isTarget = i === fw.targetChannelIdx;
        const pal = getNodePalette(spec.kind);

        const x =
          mode === "elevation"
            ? padX + spec.nx * usableW
            : padX + (i / (NUM_CHANNELS - 1)) * usableW;
        const y =
          mode === "elevation" ? topY + spec.ny * usableH : h * 0.52;

        // Clean flat 2D dot radius scaled smoothly so all 30 fit on 1 mobile viewport
        const rawBaseR =
          spec.kind === "orange-box" || spec.kind === "start"
            ? 8.5
            : spec.kind === "gray-box"
              ? 7.0
              : 5.2;
        const baseR = Math.max(
          spec.kind === "orange-box" || spec.kind === "start" ? 4.4 : 3.0,
          rawBaseR * scale
        );

        // A. Pure 2D symmetric additive radial emission halo (glows directly with PWM!)
        if (norm > 0.015) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const emissionRadius =
            baseR * (2.8 + norm * (spec.kind === "orange-box" ? 4.8 : 3.4));
          const grad = ctx.createRadialGradient(
            x,
            y,
            baseR * 0.2,
            x,
            y,
            emissionRadius
          );
          grad.addColorStop(
            0,
            `rgba(${pal.coreRgb}, ${(norm * 0.9).toFixed(3)})`
          );
          grad.addColorStop(
            0.32,
            `rgba(${pal.glowRgb}, ${(norm * 0.54).toFixed(3)})`
          );
          grad.addColorStop(
            0.7,
            `rgba(${pal.glowRgb}, ${(norm * 0.15).toFixed(3)})`
          );
          grad.addColorStop(1, `rgba(${pal.glowRgb}, 0)`);

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, emissionRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // B. Flat 2D unlit position outline ring (keeps spatial map clear when pwm == 0)
        ctx.save();
        ctx.strokeStyle = isTarget
          ? "rgba(251, 146, 60, 0.92)"
          : pal.idleStroke;
        ctx.lineWidth = isTarget ? (isCompact ? 1.25 : 1.5) : 0.9;
        ctx.beginPath();
        ctx.arc(
          x,
          y,
          baseR + (isTarget ? (isCompact ? 2.2 : 3.2) : 0.7),
          0,
          Math.PI * 2
        );
        ctx.stroke();

        // C. Pure flat 2D solid emissive core disc (NO 3D off-center bevel or dome!)
        if (norm > 0.01) {
          ctx.fillStyle = `rgba(${pal.coreRgb}, ${Math.min(1, 0.12 + norm * 0.92).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, baseR, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Dim dark unlit fixture indicator
          ctx.fillStyle =
            spec.kind === "start"
              ? "rgba(74, 222, 128, 0.16)"
              : spec.kind === "orange-box"
                ? "rgba(251, 146, 60, 0.18)"
                : "rgba(255, 255, 255, 0.06)";
          ctx.beginPath();
          ctx.arc(x, y, baseR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // D. Crisp 2D Labels tailored for both full desktop & compact single-screen mobile
        ctx.save();
        ctx.textAlign = "center";
        if (spec.kind === "orange-box" && spec.mailbox) {
          ctx.textBaseline = "bottom";
          ctx.font = `${isTarget ? "600" : "500"} ${isCompact ? 8.5 : 10}px "Noto Sans TC", sans-serif`;
          ctx.fillStyle = isTarget ? "#FDBA74" : "rgba(251, 146, 60, 0.78)";
          ctx.fillText(
            isCompact ? `M${spec.mailbox}` : `郵筒${spec.mailbox}`,
            x,
            y - baseR - (isCompact ? 4 : 6)
          );
        } else if (spec.kind === "start") {
          ctx.textBaseline = "bottom";
          ctx.font = `500 ${isCompact ? 8.5 : 10}px "Noto Sans TC", sans-serif`;
          ctx.fillStyle = "rgba(134, 239, 172, 0.88)";
          ctx.fillText(isCompact ? "起" : "起頭", x, y - baseR - (isCompact ? 4 : 5));
        }

        // On compact mobile linear row, show key/even numbers so zero digits collide
        const showChannelNum =
          !isCompact ||
          mode === "elevation" ||
          spec.kind === "start" ||
          spec.kind === "orange-box" ||
          spec.channel % 5 === 0 ||
          spec.channel === 30;
        if (showChannelNum) {
          ctx.textBaseline = "top";
          ctx.font = `400 ${isCompact ? 7 : 9}px "IBM Plex Mono", ui-monospace, monospace`;
          ctx.fillStyle =
            norm > 0.3
              ? "rgba(255, 255, 255, 0.92)"
              : isTarget
                ? "rgba(253, 186, 116, 0.88)"
                : pal.labelColor;
          ctx.fillText(String(spec.channel), x, y + baseR + (isCompact ? 3 : 5));
        }
        ctx.restore();
      }
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, []);

  const targetChannelNum = MAILBOX_LED_CHANNEL_MAP[selectedMailbox] + 1;

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-[#040507] text-[#FAF9F6] selection:bg-[#FB923C]/30">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-7">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.04] px-3 py-1 font-mono text-[11px] tracking-[0.14em] text-[#FAF9F6]/85 transition-colors hover:border-[#FDBA74]/60 hover:text-[#FDBA74]"
          >
            <span aria-hidden="true">←</span>
            <span>返回信紙</span>
          </Link>
          <div className="flex flex-col">
            <span className="font-mono text-[11px] tracking-[0.22em] text-[#FDBA74]">
              ESP32 // 30-CH 2D EMISSION TESTER
            </span>
            <span className="text-[11px] tracking-[0.1em] text-white/50">
              實體 30 燈點立面擺設・3 次重疊燈流・橘色郵筒呼吸燈（Arduino C++ 對應架構）
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              hasLiveLetterData
                ? "border-[#4ADE80]/45 bg-[#4ADE80]/10 text-[#86EFAC]"
                : "border-white/15 bg-white/[0.04] text-white/60"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                hasLiveLetterData
                  ? "animate-dot-pulse bg-[#4ADE80]"
                  : "bg-white/40"
              }`}
            />
            {hasLiveLetterData
              ? `已接收主頁光訊 · ${payload.packetId}`
              : `測試波形待機 · ${payload.packetId}`}
          </span>
        </div>
      </header>

      {liveToast && (
        <div className="mx-auto mt-3 px-4">
          <div className="rounded-full border border-[#FB923C]/50 bg-[#FB923C]/12 px-4 py-1.5 text-center text-xs tracking-[0.12em] text-[#FDBA74]">
            {liveToast}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto flex w-full max-w-[1220px] flex-1 flex-col justify-center gap-4 px-4 py-4 sm:px-7">
        {/* Status Bar + Legend + Layout Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-[11px] tracking-[0.1em]">
            <span className="inline-flex items-center gap-1.5 text-[#86EFAC]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#4ADE80]" />
              起頭 (#1)
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#FDBA74]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#FB923C]" />
              橘色郵筒 QR (#7, 10, 18, 24, 28)
            </span>
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <span className="h-2.5 w-2.5 rounded-full border border-zinc-400 bg-zinc-400/30" />
              灰色郵筒 (#5, 6, 13, 17, 21, 25)
            </span>
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <span className="h-2 w-2 rounded-full border border-zinc-300/60" />
              門牌 (18 處)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLayoutMode("elevation")}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] tracking-[0.1em] transition-colors ${
                layoutMode === "elevation"
                  ? "border-[#FDBA74]/70 bg-[#FB923C]/18 text-[#FDBA74]"
                  : "border-white/15 text-white/55 hover:text-white"
              }`}
            >
              實體立面位置
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("linear")}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] tracking-[0.1em] transition-colors ${
                layoutMode === "linear"
                  ? "border-[#FDBA74]/70 bg-[#FB923C]/18 text-[#FDBA74]"
                  : "border-white/15 text-white/55 hover:text-white"
              }`}
            >
              水平一直排
            </button>
          </div>
        </div>

        {/* Pure Black 2D Emission Stage (Single Panoramic Row 1..30) */}
        <section
          aria-label="ESP32 30 通道 2D 發光點位模擬區"
          className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#040507]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-2 font-mono text-[10.5px] tracking-[0.14em]">
            <span className="text-white/75">{statusLabel}</span>
            <span className="text-[#FDBA74]">
              TARGET // 橘色郵筒 #{selectedMailbox} (CH.
              {String(targetChannelNum).padStart(2, "0")})
            </span>
          </div>

          {/* Fits 100% inside a single mobile screen width (zero horizontal scrolling!) */}
          <div
            ref={canvasBoxRef}
            className="relative h-[200px] w-full sm:h-[260px] md:h-[290px]"
          >
            <canvas
              ref={canvasRef}
              className="block h-full w-full select-none"
            />
          </div>
        </section>

        {/* Controls & 30-CH High-Contrast Input Inspector */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Trigger & 5 Orange QR Mailboxes Selector */}
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 lg:col-span-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleTrigger}
                className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#FB923C] px-5 py-2.5 text-sm font-medium tracking-[0.14em] text-[#090A0D] shadow-[0_0_24px_rgba(251,146,60,0.34)] transition-all hover:bg-[#FDBA74] active:scale-[0.98]"
              >
                <span aria-hidden="true">▶</span>
                <span>{isRunning ? "重新觸發 3 次燈流" : "觸發燈光測試"}</span>
              </button>

              <button
                type="button"
                onClick={handleStop}
                disabled={!isRunning}
                className="inline-flex cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/[0.04] px-4 py-2.5 text-xs tracking-[0.14em] text-white/80 transition-colors hover:border-white/45 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                ■ 歸零
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] tracking-[0.12em] text-white/60">
                <span>選擇目標橘色郵筒（3 次燈流後持續呼吸閃爍）</span>
                <span className="font-mono text-[#FDBA74]">
                  CH.{String(targetChannelNum).padStart(2, "0")}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {MAILBOX_NUMBERS.map((mb) => {
                  const isSel = selectedMailbox === mb;
                  const chNum = MAILBOX_LED_CHANNEL_MAP[mb] + 1;
                  return (
                    <button
                      key={mb}
                      type="button"
                      onClick={() => setSelectedMailbox(mb)}
                      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border py-2 transition-all ${
                        isSel
                          ? "border-[#FB923C] bg-[#FB923C]/20 text-[#FDBA74] shadow-[0_0_16px_rgba(251,146,60,0.22)]"
                          : "border-white/12 bg-white/[0.03] text-white/65 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      <span className="text-xs font-medium tracking-[0.06em]">
                        郵筒 {mb}
                      </span>
                      <span className="mt-0.5 font-mono text-[9.5px] opacity-75">
                        #{chNum}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: 30-CH Raw Sampled Brightness Profile & ESP32 C++ Export */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10.5px] tracking-[0.16em] text-white/65">
                INPUT 30-CH SAMPLED BRIGHTNESS (0–255)
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleLoadRandomDemo}
                  className="cursor-pointer rounded-full border border-white/18 bg-white/[0.04] px-3 py-1 text-[11px] tracking-[0.08em] text-white/75 transition-colors hover:border-[#FDBA74]/50 hover:text-[#FDBA74]"
                >
                  高對比示範波形
                </button>
                <button
                  type="button"
                  onClick={handleCopyEsp32Json}
                  className="cursor-pointer rounded-full border border-white/18 bg-white/[0.04] px-3 py-1 font-mono text-[10.5px] tracking-[0.08em] text-white/75 transition-colors hover:border-[#FDBA74]/50 hover:text-[#FDBA74]"
                >
                  {copiedType === "json" ? "✓ COPIED JSON" : "COPY JSON"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCppCode((v) => !v)}
                  className={`cursor-pointer rounded-full border px-3 py-1 font-mono text-[10.5px] tracking-[0.08em] transition-colors ${
                    showCppCode
                      ? "border-[#FDBA74]/70 bg-[#FB923C]/18 text-[#FDBA74]"
                      : "border-white/18 bg-white/[0.04] text-white/75 hover:border-[#FDBA74]/50 hover:text-[#FDBA74]"
                  }`}
                >
                  {showCppCode ? "隱藏 Arduino C++" : "檢視 Arduino C++ (.ino)"}
                </button>
              </div>
            </div>

            {/* Crisp 30-bar histogram showing bright peaks & dark gaps of inputSamples[0..29] */}
            <div className="flex h-[74px] items-end gap-[3px] rounded-xl border border-white/8 bg-[#040507] px-2.5 pt-3 pb-2">
              {payload.ledValues.map((val, idx) => {
                const spec = ESP32_PHYSICAL_NODES[idx];
                const isTgt = idx === targetChannelNum - 1;
                const pct = val <= 10 ? 2 : Math.max(5, Math.round((val / 255) * 100));
                return (
                  <div
                    key={idx}
                    title={`#${spec.channel} (${spec.kind}): ${val}`}
                    className="flex h-full flex-1 flex-col items-center justify-end"
                  >
                    <div
                      style={{ height: `${pct}%` }}
                      className={`w-full rounded-t-[2px] transition-all duration-200 ${
                        val <= 10
                          ? "bg-white/10"
                          : isTgt
                            ? "bg-[#FB923C]"
                            : spec.kind === "start"
                              ? "bg-[#4ADE80]/80"
                              : spec.kind === "orange-box"
                                ? "bg-[#FDBA74]/80"
                                : "bg-[#F3D98B]/60"
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tracking-[0.08em] text-white/45">
              <span>
                uint8_t inputSamples[30] = &#123;
                {payload.ledValues.slice(0, 8).join(", ")}, …&#125;
              </span>
              <span>
                {payload.status === "dispatched"
                  ? "SOURCE: LETTER DISPATCHED"
                  : payload.status === "sampled"
                    ? "SOURCE: LETTER SAMPLED"
                    : "SOURCE: DEMO WAVEFORM"}
              </span>
            </div>
          </div>
        </section>

        {/* Expandable 1:1 Arduino IDE C++ (.ino) Firmware Panel */}
        {showCppCode && (
          <section className="overflow-hidden rounded-2xl border border-white/12 bg-[#080A0F]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
              <div className="flex flex-col">
                <span className="font-mono text-[11px] tracking-[0.16em] text-[#FDBA74]">
                  ARDUINO IDE // ESP32 C++ FIRMWARE MIRROR (.ino)
                </span>
                <span className="text-[11px] text-white/50">
                  與本測試頁 `esp32LoopTick()` 採 1:1 相同演算法、Uint8 陣列與無分段重疊混色邏輯，可直接貼入 Arduino IDE
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyArduinoIno}
                className="cursor-pointer rounded-full border border-[#FB923C]/60 bg-[#FB923C]/16 px-3.5 py-1 font-mono text-[11px] tracking-[0.1em] text-[#FDBA74] transition-colors hover:bg-[#FB923C]/28"
              >
                {copiedType === "ino" ? "✓ 已複製 .ino 程式碼" : "複製 Arduino C++"}
              </button>
            </div>
            <pre className="max-h-[400px] overflow-auto p-4 font-mono text-[11.5px] leading-[1.6] text-zinc-200">
              <code>{arduinoCode}</code>
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}
