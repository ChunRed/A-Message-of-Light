"use client";

import React, { useEffect, useRef } from "react";
import { eraseIntroDecalSegment } from "@/lib/paper-decal";
import {
  drawYanshuiPerimeterMotifs,
  sampleIllustrationEraserSweep,
  YanshuiCelebrationSystem,
} from "@/lib/yanshui-illustration";

export interface YanshuiPaperIllustrationProps {
  /** Visible while the Z-fold letter is flat in 2D mode (before sending/sampling) */
  isVisible: boolean;
  /** Incrementing cycle token that triggers the 100%-open celebratory firework burst once per unfold */
  celebrationTriggerId: number;
  /** Active while wiping preset illustrations off the paper right after the user clicks "開始創作" */
  isErasing: boolean;
  /** True once drawing mode is unlocked — preset illustrations remain completely erased for pure blank drawing */
  isErased: boolean;
}

/** ~6.9 FPS boiling-line cadence (classic 6–8 FPS hand-drawn feel) */
const BOIL_FRAME_INTERVAL_MS = 145;
/** Synchronized with PaperPencilGuide's 1.65s rubber-eraser sweep */
const ERASE_SWEEP_DURATION_MS = 1580;

/**
 * Procedural, hand-drawn bold oil-pastel & gouache Yanshui illustration overlay layered:
 * - ABOVE the paper grid & fold shadows (3D ZFoldLetterScene at z-10)
 * - AROUND the central blessing typography (never covering central text)
 * - BELOW the user's interactive 2D drawing canvas (z-10 inside paperVisualRef)
 *
 * When the user clicks "開始創作", an organic back-and-forth rubber-eraser sweep
 * physically scrubs all preset illustrations (蜂炮, 八角樓, 水月橋) clean off the paper,
 * leaving a crisp blank sheet ready for freehand creation.
 */
export function YanshuiPaperIllustration({
  isVisible,
  celebrationTriggerId,
  isErasing,
  isErased,
}: YanshuiPaperIllustrationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const perimeterCacheRef = useRef<HTMLCanvasElement | null>(null);
  const celebrationRef = useRef<YanshuiCelebrationSystem | null>(null);
  const lastTriggeredIdRef = useRef<number>(0);

  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 1,
  });

  const propsRef = useRef({
    isVisible,
    celebrationTriggerId,
    isErasing,
    isErased,
  });

  const stateRef = useRef({
    lastBoilStep: -1,
    cacheDirty: true,
    pendingCelebration: false,
    startClockMs: 0,
    // Organic rubber-eraser wipe-off state
    eraseStarted: false,
    eraseDone: false,
    eraseStartMs: 0,
    eraseLastP: 0,
    eraseLastX: 0,
    eraseLastY: 0,
    eraseWasErasing: false,
    eraseSeed: 1,
  });

  useEffect(() => {
    const prevErasing = propsRef.current.isErasing;
    propsRef.current = { isVisible, celebrationTriggerId, isErasing, isErased };
    const st = stateRef.current;

    if (celebrationTriggerId === 0) {
      lastTriggeredIdRef.current = 0;
      st.pendingCelebration = false;
      st.eraseStarted = false;
      st.eraseDone = false;
      st.cacheDirty = true;
      st.lastBoilStep = -1;
      celebrationRef.current?.clear();
    } else if (celebrationTriggerId !== lastTriggeredIdRef.current) {
      lastTriggeredIdRef.current = celebrationTriggerId;
      st.pendingCelebration = true;
      st.eraseStarted = false;
      st.eraseDone = false;
    }

    if (isErasing && !prevErasing) {
      celebrationRef.current?.clear();
      st.eraseStarted = true;
      st.eraseDone = false;
      st.eraseStartMs = performance.now();
      st.eraseLastP = 0;
      st.eraseWasErasing = false;
      st.eraseSeed = 1;
    }

    if (!isVisible || isErased) {
      celebrationRef.current?.clear();
      const canvas = canvasRef.current;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      }
      if (!isVisible) {
        st.lastBoilStep = -1;
      }
    }
  }, [celebrationTriggerId, isErased, isErasing, isVisible]);

  // Keep canvas & offscreen boiling-line cache sized crisply to the paper slot
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!perimeterCacheRef.current) {
      perimeterCacheRef.current = document.createElement("canvas");
    }
    if (!celebrationRef.current) {
      celebrationRef.current = new YanshuiCelebrationSystem();
    }

    const syncDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const prev = sizeRef.current;

      if (prev.width === nextW && prev.height === nextH && prev.dpr === dpr) {
        return;
      }

      sizeRef.current = { width: nextW, height: nextH, dpr };

      canvas.width = Math.round(nextW * dpr);
      canvas.height = Math.round(nextH * dpr);

      const cache = perimeterCacheRef.current;
      if (cache) {
        cache.width = Math.round(nextW * dpr);
        cache.height = Math.round(nextH * dpr);
      }

      stateRef.current.cacheDirty = true;
      stateRef.current.lastBoilStep = -1;
    };

    syncDimensions();
    const ro = new ResizeObserver(syncDimensions);
    ro.observe(canvas);
    window.addEventListener("resize", syncDimensions);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncDimensions);
    };
  }, []);

  // Main animation loop: active ONLY while flat AND not yet fully erased
  const shouldRunLoop = isVisible && !isErased;

  useEffect(() => {
    if (!shouldRunLoop) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!perimeterCacheRef.current) {
      perimeterCacheRef.current = document.createElement("canvas");
    }
    if (!celebrationRef.current) {
      celebrationRef.current = new YanshuiCelebrationSystem();
    }

    const st = stateRef.current;
    if (st.startClockMs === 0) {
      st.startClockMs = performance.now();
    }
    if (!propsRef.current.isErasing) {
      st.cacheDirty = true;
      st.lastBoilStep = -1;
    }

    let rafId = 0;
    let lastFrameMs = performance.now();

    const paintFrame = (nowMs: number) => {
      const { width: w, height: h, dpr } = sizeRef.current;
      if (w < 16 || h < 16) return;

      const ctx = canvas.getContext("2d");
      const cache = perimeterCacheRef.current;
      const cacheCtx = cache?.getContext("2d");
      const celebration = celebrationRef.current;
      if (!ctx || !cache || !cacheCtx || !celebration) return;

      // =====================================================================
      // MODE A: ORGANIC RUBBER-ERASER SWEEP WIPING ALL PRESET ART OFF PAPER
      // =====================================================================
      if (propsRef.current.isErasing) {
        if (st.eraseDone) return;

        // Guarantee the frozen artwork exists on cache before scrubbing
        if (st.cacheDirty) {
          st.cacheDirty = false;
          const elapsedSec = Math.max(0, (nowMs - st.startClockMs) / 1000);
          cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          cacheCtx.clearRect(0, 0, w, h);
          drawYanshuiPerimeterMotifs(
            cacheCtx,
            w,
            h,
            1,
            Math.max(0, st.lastBoilStep),
            elapsedSec,
            1
          );
        }

        const elapsedErase = Math.max(0, nowMs - st.eraseStartMs);
        const pNow = Math.max(0, Math.min(1, elapsedErase / ERASE_SWEEP_DURATION_MS));
        const pPrev = st.eraseLastP;

        cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const subSteps = Math.max(
          1,
          Math.min(10, Math.ceil((pNow - pPrev) / 0.008))
        );

        for (let s = 1; s <= subSteps; s++) {
          const ps = pPrev + ((pNow - pPrev) * s) / subSteps;
          const sample = sampleIllustrationEraserSweep(ps, w, h);
          if (sample.isErasing) {
            const x0 = st.eraseWasErasing ? st.eraseLastX : sample.x;
            const y0 = st.eraseWasErasing ? st.eraseLastY : sample.y;
            eraseIntroDecalSegment(
              cacheCtx,
              x0,
              y0,
              sample.x,
              sample.y,
              sample.diameter,
              5400 + st.eraseSeed++
            );
          }
          st.eraseLastX = sample.x;
          st.eraseLastY = sample.y;
          st.eraseWasErasing = sample.isErasing;
        }
        st.eraseLastP = pNow;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (pNow >= 1) {
          cacheCtx.clearRect(0, 0, w, h);
          st.eraseDone = true;
          return;
        }

        ctx.drawImage(cache, 0, 0, cache.width, cache.height, 0, 0, w, h);
        return;
      }

      // =====================================================================
      // MODE B: NORMAL ~6.9 FPS BOILING PERIMETER + 60FPS FIREWORK BURSTS
      // =====================================================================
      if (st.pendingCelebration) {
        st.pendingCelebration = false;
        celebration.trigger(w, h);
      }

      const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
      lastFrameMs = nowMs;

      const elapsedMs = Math.max(0, nowMs - st.startClockMs);
      const elapsedSec = elapsedMs / 1000;
      const boilStep = Math.floor(elapsedMs / BOIL_FRAME_INTERVAL_MS);

      const boilChanged = boilStep !== st.lastBoilStep || st.cacheDirty;
      const fireworksActive = celebration.isRunning();

      if (!boilChanged && !fireworksActive) {
        return;
      }

      if (boilChanged) {
        st.lastBoilStep = boilStep;
        st.cacheDirty = false;
        cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cacheCtx.clearRect(0, 0, w, h);
        drawYanshuiPerimeterMotifs(cacheCtx, w, h, 1, boilStep, elapsedSec, 1);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(cache, 0, 0, cache.width, cache.height, 0, 0, w, h);

      if (fireworksActive) {
        celebration.updateAndDraw(ctx, dt, w, h);
      }
    };

    // Paint initial frame immediately so 3D -> 2D handoff at 100% has zero blank frame
    paintFrame(performance.now());

    const tick = (nowMs: number) => {
      if (!propsRef.current.isVisible || propsRef.current.isErased) return;
      paintFrame(nowMs);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [shouldRunLoop]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[5] block h-full w-full select-none ${
        isVisible && !isErased ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
