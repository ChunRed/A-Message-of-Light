"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { eraseIntroDecalSegment } from "@/lib/paper-decal";
import { sampleIllustrationEraserSweep } from "@/lib/yanshui-illustration";
import {
  createYanshuiLandmarks3DScene,
  type YanshuiLandmarks3DHandle,
} from "@/lib/yanshui-landmarks-3d";

export interface YanshuiIllustrationHandle {
  /**
   * Renders one frame of the 3D black-crayon landmarks at the given `elapsedSec`
   * and progressive `drawProgress ∈ [0..1]` (mapped from 2% -> 80% unfold) and
   * returns the live WebGL canvas so ZFoldLetterScene can hardware-blit it right
   * onto the unfolding 3D Z-Fold letter panels!
   */
  renderUnfoldFrame: (
    elapsedSec: number,
    drawProgress: number
  ) => HTMLCanvasElement | null;
}

export interface YanshuiPaperIllustrationProps {
  /** Visible while the Z-fold letter is flat in 2D mode (before sending/sampling) */
  isVisible: boolean;
  /** Cycle reset token (0 resets cleanly on new letter loop) */
  celebrationTriggerId: number;
  /** Active while wiping preset illustrations off the paper right after the user clicks "開始創作" */
  isErasing: boolean;
  /** True once drawing mode is unlocked — preset illustrations remain completely erased for pure blank drawing */
  isErased: boolean;
}

/** Synchronized with PaperPencilGuide's 1.65s rubber-eraser sweep */
const ERASE_SWEEP_DURATION_MS = 1580;

/**
 * 3D Hollow Black-Line Wax-Crayon Yanshui Landmark Overlay:
 * - While unfolding (0% -> 80% -> 100%): renders on-demand via `renderUnfoldFrame`
 *   so the landmarks sketch themselves stroke-by-stroke onto the bending Z-Fold
 *   letter panels (reaching 100% drawn right at 80% unfold!), with transparent
 *   interiors letting the stationery paper grid shine cleanly through!
 * - Once flat (`isVisible = true`): takes over seamlessly at 60fps using the exact
 *   same WebGL scene & clock phase with ZERO jump or double-render.
 * - On clicking "開始創作" (`isErasing = true`): snapshots the current 3D frame onto
 *   a 2D canvas so the organic rubber eraser scrubs all 3D crayon landmarks cleanly
 *   off the paper, then disposes GPU resources once `isErased = true`.
 */
export const YanshuiPaperIllustration = forwardRef<
  YanshuiIllustrationHandle,
  YanshuiPaperIllustrationProps
>(function YanshuiPaperIllustration(
  { isVisible, celebrationTriggerId, isErasing, isErased },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraseCacheRef = useRef<HTMLCanvasElement | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const landmarksRef = useRef<YanshuiLandmarks3DHandle | null>(null);

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
    startClockMs: 0,
    lastUnfoldElapsedSec: 0,
    eraseSnapshotTaken: false,
    eraseDone: false,
    eraseStartMs: 0,
    eraseLastP: 0,
    eraseLastX: 0,
    eraseLastY: 0,
    eraseWasErasing: false,
    eraseSeed: 1,
  });

  const ensureCanvasSized = () => {
    const host = hostRef.current;
    const renderer = rendererRef.current;
    const landmarks = landmarksRef.current;
    const eraseCanvas = eraseCanvasRef.current;
    const eraseCache = eraseCacheRef.current;
    if (!host || !renderer || !landmarks || !eraseCanvas || !eraseCache) {
      return false;
    }

    const rect = host.getBoundingClientRect();
    // Fallback to classic stationery aspect (512 x 724) if measured before layout settles
    const nextW = rect.width >= 32 ? Math.floor(rect.width) : 512;
    const nextH = rect.height >= 32 ? Math.floor(rect.height) : 724;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const prev = sizeRef.current;

    if (prev.width !== nextW || prev.height !== nextH || prev.dpr !== dpr) {
      sizeRef.current = { width: nextW, height: nextH, dpr };
      renderer.setPixelRatio(dpr);
      renderer.setSize(nextW, nextH, false);
      landmarks.resize(nextW, nextH);

      eraseCanvas.width = Math.round(nextW * dpr);
      eraseCanvas.height = Math.round(nextH * dpr);
      eraseCache.width = Math.round(nextW * dpr);
      eraseCache.height = Math.round(nextH * dpr);
    }
    return true;
  };

  useImperativeHandle(
    ref,
    () => ({
      renderUnfoldFrame: (elapsedSec: number, drawProgress: number) => {
        if (propsRef.current.isErased) return null;
        const renderer = rendererRef.current;
        const landmarks = landmarksRef.current;
        const glCanvas = glCanvasRef.current;
        if (!renderer || !landmarks || !glCanvas) return null;
        if (!ensureCanvasSized()) return null;

        stateRef.current.lastUnfoldElapsedSec = elapsedSec;
        landmarks.update(elapsedSec, drawProgress);
        renderer.render(landmarks.scene, landmarks.camera);
        return glCanvas;
      },
    }),
    []
  );

  useEffect(() => {
    const prevErasing = propsRef.current.isErasing;
    const prevVisible = propsRef.current.isVisible;
    propsRef.current = { isVisible, celebrationTriggerId, isErasing, isErased };
    const st = stateRef.current;

    if (celebrationTriggerId === 0) {
      st.startClockMs = 0;
      st.lastUnfoldElapsedSec = 0;
      st.eraseSnapshotTaken = false;
      st.eraseDone = false;
    }

    // Sync clock seamlessly when handing off from ZFold unfold (p=100%) to live flat view!
    if (isVisible && !prevVisible) {
      st.startClockMs = performance.now() - st.lastUnfoldElapsedSec * 1000;
    }

    if (isErasing && !prevErasing) {
      st.eraseSnapshotTaken = false;
      st.eraseDone = false;
      st.eraseStartMs = performance.now();
      st.eraseLastP = 0;
      st.eraseWasErasing = false;
      st.eraseSeed = 1;
    }

    if (!isVisible || isErased) {
      const eraseCanvas = eraseCanvasRef.current;
      if (eraseCanvas && eraseCanvas.width > 0 && eraseCanvas.height > 0) {
        const ctx = eraseCanvas.getContext("2d");
        if (ctx) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, eraseCanvas.width, eraseCanvas.height);
          ctx.restore();
        }
      }
    }
  }, [celebrationTriggerId, isErased, isErasing, isVisible]);

  // Keep lightweight WebGL renderer ready while `!isErased` (for BOTH 0%->80% unfold
  // progressive sketching AND opened flat 60fps loop). Dispose immediately once erased!
  useEffect(() => {
    if (isErased) return;

    const host = hostRef.current;
    const glCanvas = glCanvasRef.current;
    const eraseCanvas = eraseCanvasRef.current;
    if (!host || !glCanvas || !eraseCanvas) return;

    if (!eraseCacheRef.current) {
      eraseCacheRef.current = document.createElement("canvas");
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const landmarks = createYanshuiLandmarks3DScene();
    landmarksRef.current = landmarks;

    sizeRef.current = { width: 0, height: 0, dpr: 1 };
    const handleResize = () => {
      ensureCanvasSized();
    };
    handleResize();

    const ro = new ResizeObserver(handleResize);
    ro.observe(host);
    window.addEventListener("resize", handleResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      landmarks.dispose();
      renderer.dispose();
      landmarksRef.current = null;
      rendererRef.current = null;
      sizeRef.current = { width: 0, height: 0, dpr: 1 };
    };
  }, [isErased]);

  // Live 60fps animation loop runs ONLY while opened flat (`isVisible && !isErased`)
  // (Zero background CPU/GPU while folded!)
  const shouldRunLoop = isVisible && !isErased;

  useEffect(() => {
    if (!shouldRunLoop) return;

    const glCanvas = glCanvasRef.current;
    const eraseCanvas = eraseCanvasRef.current;
    const eraseCache = eraseCacheRef.current;
    const renderer = rendererRef.current;
    const landmarks = landmarksRef.current;
    if (!glCanvas || !eraseCanvas || !eraseCache || !renderer || !landmarks) {
      return;
    }

    const st = stateRef.current;
    if (st.startClockMs === 0) {
      st.startClockMs = performance.now() - st.lastUnfoldElapsedSec * 1000;
    }

    let rafId = 0;

    const renderFrame = (nowMs: number) => {
      if (!ensureCanvasSized()) return;
      const { width: w, height: h, dpr } = sizeRef.current;
      if (w < 16 || h < 16) return;

      // =====================================================================
      // MODE A: ORGANIC RUBBER-ERASER SWEEP WIPING THE 3D CRAYON ART OFF PAPER
      // =====================================================================
      if (propsRef.current.isErasing) {
        if (st.eraseDone) return;

        const ctx = eraseCanvas.getContext("2d");
        const cacheCtx = eraseCache.getContext("2d");
        if (!ctx || !cacheCtx) return;

        if (!st.eraseSnapshotTaken) {
          st.eraseSnapshotTaken = true;
          const elapsedSec = Math.max(0, (nowMs - st.startClockMs) / 1000);
          landmarks.update(elapsedSec, 1);
          renderer.render(landmarks.scene, landmarks.camera);

          cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          cacheCtx.clearRect(0, 0, w, h);
          cacheCtx.drawImage(glCanvas, 0, 0, w, h);
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

        ctx.drawImage(
          eraseCache,
          0,
          0,
          eraseCache.width,
          eraseCache.height,
          0,
          0,
          w,
          h
        );
        return;
      }

      // =====================================================================
      // MODE B: LIVE 60FPS 3D HOLLOW BLACK-CRAYON LANDMARK ANIMATION
      // =====================================================================
      const elapsedSec = Math.max(0, (nowMs - st.startClockMs) / 1000);
      st.lastUnfoldElapsedSec = elapsedSec;
      landmarks.update(elapsedSec, 1);
      renderer.render(landmarks.scene, landmarks.camera);
    };

    renderFrame(performance.now());

    const tick = (nowMs: number) => {
      if (!propsRef.current.isVisible || propsRef.current.isErased) return;
      renderFrame(nowMs);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [shouldRunLoop]);

  const showContainer = isVisible && !isErased;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[5] select-none ${
        showContainer ? "opacity-100" : "opacity-0"
      }`}
    >
      <canvas
        ref={glCanvasRef}
        className={`absolute inset-0 block h-full w-full ${
          isErasing ? "opacity-0" : "opacity-100"
        }`}
      />
      <canvas
        ref={eraseCanvasRef}
        className={`absolute inset-0 block h-full w-full ${
          isErasing ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
});
