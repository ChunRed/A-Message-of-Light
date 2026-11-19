"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface TargetPaperRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ZFoldLetterSceneProps {
  dateStamp: string;
  targetBoxRect: TargetPaperRect | null;
  isFadingOut: boolean;
  onUnfolded: () => void;
}

const UNFOLD_THRESHOLD = 0.62;
const MAX_FOLD_ANGLE = 2.48;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Draws subtle Muji square graph grid lines on a panel texture.
 */
function drawSubtleGrid(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 44
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(34, 34, 34, 0.065)";
  ctx.lineWidth = 1.4;

  for (let y = y0; y <= y1; y += step) {
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y) + 0.5);
    ctx.lineTo(x1, Math.round(y) + 0.5);
    ctx.stroke();
  }
  for (let x = x0; x <= x1; x += step) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, y0);
    ctx.lineTo(Math.round(x) + 0.5, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Generates crisp high-DPI flat 2D illustration textures for each of the 3 Z-fold panels.
 * Matches the unfolded 2D grid stationery seamlessly so zooming in feels like writing on the model.
 */
function createPanelTexture(
  panelIndex: 0 | 1 | 2,
  dateStamp: string
): THREE.CanvasTexture {
  const w = 1024;
  const h = 584;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    // Pure flat Muji warm paper fill
    ctx.fillStyle = "#FAF9F6";
    ctx.fillRect(0, 0, w, h);

    // Subtle paper fiber speckles
    for (let i = 0; i < 550; i++) {
      const sx = (((i * 7919) % 10000) / 10000) * w;
      const sy = (((i * 104729) % 10000) / 10000) * h;
      ctx.fillStyle = "rgba(34, 34, 34, 0.015)";
      ctx.fillRect(sx, sy, 2, 2);
    }

    const padX = 72;

    if (panelIndex === 0) {
      // TOP PANEL (Upper Back Card when folded; top third of unfolded stationery):
      // Subtle top corner crop marks
      ctx.strokeStyle = "rgba(34, 34, 34, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(26, 52);
      ctx.lineTo(26, 26);
      ctx.lineTo(52, 26);
      ctx.moveTo(w - 52, 26);
      ctx.lineTo(w - 26, 26);
      ctx.lineTo(w - 26, 52);
      ctx.stroke();

      // Top-left monospace date metadata
      ctx.fillStyle = "#8C8C8A";
      ctx.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`DATE // ${dateStamp}`, padX, 58);

      // Top-right minimalist perforated postage stamp & wavy postmark
      const sx = w - padX - 80;
      const sy = 40;
      const sw = 80;
      const sh = 98;
      ctx.strokeStyle = "#BDBDB7";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
      ctx.strokeStyle = "#E2E2DE";
      ctx.strokeRect(sx + 10, sy + 10, sw - 20, sh - 20);

      const sunX = sx + sw / 2;
      const sunY = sy + sh / 2;
      ctx.strokeStyle = "#8C8C8A";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 9.5, 0, Math.PI * 2);
      ctx.stroke();
      for (let a = 0; a < 8; a++) {
        const rad = (a * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(sunX + Math.cos(rad) * 14.5, sunY + Math.sin(rad) * 14.5);
        ctx.lineTo(sunX + Math.cos(rad) * 21, sunY + Math.sin(rad) * 21);
        ctx.stroke();
      }

      // Wavy postmark lines
      ctx.strokeStyle = "rgba(140, 140, 138, 0.45)";
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const wy = sy + 30 + k * 18;
        ctx.beginPath();
        ctx.moveTo(sx - 68, wy);
        ctx.bezierCurveTo(sx - 48, wy - 7, sx - 28, wy + 7, sx - 8, wy);
        ctx.stroke();
      }

      // Subtle square graph grid across lower body of top panel
      drawSubtleGrid(ctx, padX, 174, w - padX, h - 8, 44);
    } else if (panelIndex === 1) {
      // MIDDLE PANEL (Diagonal Connecting Fold; center third of unfolded stationery)
      drawSubtleGrid(ctx, padX, 12, w - padX, h - 12, 44);
    } else {
      // BOTTOM PANEL (Front Overlapping Card when folded; bottom third when unfolded):
      // Subtle square graph grid
      drawSubtleGrid(ctx, padX, 12, w - padX, h - 120, 44);

      // MAIN TITLE positioned in the lower-left / front area (exact circled location in Ref 1)
      ctx.fillStyle = "#222222";
      ctx.font = '400 46px "Noto Sans TC", -apple-system, sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("一則光的訊息", padX, h - 82);

      ctx.fillStyle = "#8C8C8A";
      ctx.font = '400 18px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText("A MESSAGE OF LIGHT", padX + 2, h - 46);

      // Bottom corner crop marks
      ctx.strokeStyle = "rgba(34, 34, 34, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(26, h - 52);
      ctx.lineTo(26, h - 26);
      ctx.lineTo(52, h - 26);
      ctx.moveTo(w - 52, h - 26);
      ctx.lineTo(w - 26, h - 26);
      ctx.lineTo(w - 26, h - 52);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Flat elliptical floor shadow texture matching the minimalist 2D illustration style.
 */
function createFlatShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.08,
      size / 2,
      size / 2,
      size * 0.48
    );
    grad.addColorStop(0, "rgba(34, 34, 34, 0.095)");
    grad.addColorStop(0.6, "rgba(34, 34, 34, 0.05)");
    grad.addColorStop(1, "rgba(34, 34, 34, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function ZFoldLetterScene({
  dateStamp,
  targetBoxRect,
  isFadingOut,
  onUnfolded,
}: ZFoldLetterSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [uiProgress, setUiProgress] = useState<number>(0);
  const [isDraggingPull, setIsDraggingPull] = useState<boolean>(false);

  const targetRectRef = useRef<TargetPaperRect | null>(targetBoxRect);
  useEffect(() => {
    targetRectRef.current = targetBoxRect;
  }, [targetBoxRect]);

  const onUnfoldedRef = useRef(onUnfolded);
  useEffect(() => {
    onUnfoldedRef.current = onUnfolded;
  }, [onUnfolded]);

  const stateRef = useRef({
    targetProgress: 0,
    currentProgress: 0,
    targetRotY: -0.34,
    targetRotX: 0.08,
    currentRotY: -0.34,
    currentRotX: 0.08,
    isPointerDown: false,
    gestureMode: "none" as "none" | "orbit" | "pull",
    pointerStartX: 0,
    pointerStartY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    startProgress: 0,
    isCompleting: false,
    hasTriggeredUnfold: false,
  });

  const triggerSmoothOpen = useCallback(() => {
    const st = stateRef.current;
    if (st.isCompleting) return;
    st.isCompleting = true;
    st.targetProgress = 1;
    st.targetRotX = 0;
    st.targetRotY = 0;
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const fovDeg = 22;
    const fovRad = THREE.MathUtils.degToRad(fovDeg);

    const camera = new THREE.PerspectiveCamera(fovDeg, width / height, 0.1, 100);
    camera.position.set(0, 0, 11.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const panelW = 2.6;
    const panelH = 1.48;
    const totalUnfoldedH = panelH * 3;
    const panelGeom = new THREE.PlaneGeometry(panelW, panelH);
    const edgeGeom = new THREE.EdgesGeometry(panelGeom);

    const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
    const backPaperMat = new THREE.MeshBasicMaterial({
      color: 0xf2f1ec,
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const textures: THREE.CanvasTexture[] = [];
    const materials: THREE.Material[] = [lineMat, backPaperMat];

    const buildPanelMesh = (index: 0 | 1 | 2): THREE.Group => {
      const group = new THREE.Group();
      const tex = createPanelTexture(index, dateStamp);
      textures.push(tex);

      const frontMat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      materials.push(frontMat);

      const frontMesh = new THREE.Mesh(panelGeom, frontMat);
      const backMesh = new THREE.Mesh(panelGeom, backPaperMat);
      backMesh.position.z = -0.003;

      const outlineFront = new THREE.LineSegments(edgeGeom, lineMat);
      const outlineBack = new THREE.LineSegments(edgeGeom, lineMat);
      outlineFront.position.z = 0.004;
      outlineBack.position.z = -0.005;

      group.add(frontMesh, backMesh, outlineFront, outlineBack);
      return group;
    };

    const letterRoot = new THREE.Group();
    scene.add(letterRoot);

    const midGroup = new THREE.Group();
    const midPanel = buildPanelMesh(1);
    midGroup.add(midPanel);
    letterRoot.add(midGroup);

    const topHinge = new THREE.Group();
    topHinge.position.set(0, panelH / 2, 0);
    const topPanel = buildPanelMesh(0);
    topPanel.position.set(0, panelH / 2, 0);
    topHinge.add(topPanel);
    midGroup.add(topHinge);

    const botHinge = new THREE.Group();
    botHinge.position.set(0, -panelH / 2, 0);
    const botPanel = buildPanelMesh(2);
    botPanel.position.set(0, -panelH / 2, 0);
    botHinge.add(botPanel);
    midGroup.add(botHinge);

    // Subtle flat elliptical shadow directly beneath the folded letter
    const shadowTex = createFlatShadowTexture();
    textures.push(shadowTex);
    const shadowGeom = new THREE.PlaneGeometry(3.2, 0.56);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    materials.push(shadowMat);

    const shadowMesh = new THREE.Mesh(shadowGeom, shadowMat);
    shadowMesh.position.set(0, -1.62, -0.5);
    scene.add(shadowMesh);

    let vpW = width;
    let vpH = height;

    const handleResize = () => {
      if (!container) return;
      vpW = Math.max(1, container.clientWidth);
      vpH = Math.max(1, container.clientHeight);
      camera.aspect = vpW / vpH;
      camera.updateProjectionMatrix();
      renderer.setSize(vpW, vpH);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    let rafId = 0;
    let lastUiRounded = -1;
    const startClock = performance.now();

    const animate = (now: number) => {
      rafId = window.requestAnimationFrame(animate);
      const st = stateRef.current;
      const elapsed = (now - startClock) / 1000;

      // Smooth damped physics without harsh snapping
      const progressLerp = st.isCompleting
        ? 0.085
        : st.isPointerDown
          ? 0.24
          : 0.12;
      st.currentProgress +=
        (st.targetProgress - st.currentProgress) * progressLerp;
      if (Math.abs(st.targetProgress - st.currentProgress) < 0.0006) {
        st.currentProgress = st.targetProgress;
      }

      const p = st.currentProgress;

      // Stage A (0.00 -> 0.72): Smoothly rotate frontal & unfold all 3 panels completely flat
      const unfoldPhase = easeInOutCubic(clamp01(p / 0.72));
      // Stage B (0.30 -> 1.00): Smoothly zoom camera in & align pixel-for-pixel onto 2D paper slot
      const zoomPhase = easeInOutCubic(clamp01((p - 0.3) / 0.7));

      // Rotate letter smoothly to pure frontal (0, 0) during Stage A
      const rotRemain = 1 - unfoldPhase;
      st.currentRotY += (st.targetRotY * rotRemain - st.currentRotY) * 0.14;
      st.currentRotX += (st.targetRotX * rotRemain - st.currentRotX) * 0.14;

      const foldAngle = (1 - unfoldPhase) * MAX_FOLD_ANGLE;
      midGroup.rotation.x = -foldAngle;
      topHinge.rotation.x = foldAngle;
      botHinge.rotation.x = foldAngle;

      // Compute exact camera z & position so at p = 1.0 the 3D letter's 4 corners
      // match the 2D interactive letter canvas box pixel-for-pixel!
      const narrowBoost = camera.aspect < 0.78 ? 2.4 : 0;
      const zFolded = 10.6 + narrowBoost;

      const box = targetRectRef.current;
      let zTarget = 11.4;
      let worldCenterX = 0;
      let worldCenterY = 0;
      let targetScaleX = 1;

      if (box && box.width > 10 && box.height > 10 && vpW > 10 && vpH > 10) {
        const tanHalfFov = Math.tan(fovRad / 2);
        // Solve exact camera distance where world height `totalUnfoldedH` equals `box.height` px
        zTarget = (totalUnfoldedH * vpH) / (2 * box.height * tanHalfFov);
        const visHAtTarget = 2 * zTarget * tanHalfFov;
        const visWAtTarget = visHAtTarget * (vpW / vpH);

        const boxCenterX = box.left + box.width / 2;
        const boxCenterY = box.top + box.height / 2;
        const ndcX = (boxCenterX / vpW) * 2 - 1;
        const ndcY = 1 - (boxCenterY / vpH) * 2;

        worldCenterX = ndcX * (visWAtTarget / 2);
        worldCenterY = ndcY * (visHAtTarget / 2);

        const targetWorldW = (box.width / vpW) * visWAtTarget;
        targetScaleX = targetWorldW / panelW;
      }

      const idleBob = Math.sin(elapsed * 1.35) * 0.045 * (1 - unfoldPhase);

      letterRoot.position.x = worldCenterX * zoomPhase;
      letterRoot.position.y =
        (idleBob + 0.08) * (1 - zoomPhase) + worldCenterY * zoomPhase;
      letterRoot.scale.x = 1 + (targetScaleX - 1) * zoomPhase;
      letterRoot.rotation.y = st.currentRotY;
      letterRoot.rotation.x = st.currentRotX;

      camera.position.z = zFolded + (zTarget - zFolded) * zoomPhase;
      camera.position.x = 0;
      camera.position.y = 0;
      camera.lookAt(0, 0, 0);

      // Gently fade flat elliptical shadow as the letter opens
      shadowMat.opacity = Math.max(0, 0.92 * (1 - unfoldPhase * 1.35));
      const shadowScale = 1 - idleBob * 0.9;
      shadowMesh.scale.set(shadowScale, shadowScale, 1);

      renderer.render(scene, camera);

      const pct = Math.round(p * 100);
      if (pct !== lastUiRounded) {
        lastUiRounded = pct;
        setUiProgress(pct);
      }

      // Hand off seamlessly only when completely settled at exact alignment
      if (
        st.isCompleting &&
        p >= 0.996 &&
        Math.abs(st.currentRotY) < 0.004 &&
        Math.abs(st.currentRotX) < 0.004 &&
        !st.hasTriggeredUnfold
      ) {
        st.hasTriggeredUnfold = true;
        onUnfoldedRef.current();
      }
    };

    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      panelGeom.dispose();
      edgeGeom.dispose();
      shadowGeom.dispose();
      textures.forEach((t) => t.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, [dateStamp]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, forcePull = false) => {
      const st = stateRef.current;
      if (st.isCompleting) return;

      e.currentTarget.setPointerCapture(e.pointerId);
      st.isPointerDown = true;
      st.gestureMode = forcePull ? "pull" : "none";
      st.pointerStartX = e.clientX;
      st.pointerStartY = e.clientY;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;
      st.startProgress = st.targetProgress;
      if (forcePull) setIsDraggingPull(true);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = stateRef.current;
      if (!st.isPointerDown || st.isCompleting) return;

      const totalDx = e.clientX - st.pointerStartX;
      const totalDy = e.clientY - st.pointerStartY;
      const stepDx = e.clientX - st.lastPointerX;
      const stepDy = e.clientY - st.lastPointerY;
      st.lastPointerX = e.clientX;
      st.lastPointerY = e.clientY;

      if (st.gestureMode === "none" && Math.hypot(totalDx, totalDy) > 8) {
        if (totalDy > 10 && Math.abs(totalDy) > Math.abs(totalDx) * 1.2) {
          st.gestureMode = "pull";
          setIsDraggingPull(true);
        } else {
          st.gestureMode = "orbit";
        }
      }

      if (st.gestureMode === "pull") {
        const nextP = Math.max(0, Math.min(1, st.startProgress + totalDy / 210));
        st.targetProgress = nextP;
        st.targetRotY = Math.max(
          -0.6,
          Math.min(0.6, st.targetRotY + stepDx * 0.002)
        );
      } else if (st.gestureMode === "orbit") {
        st.targetRotY = Math.max(
          -0.95,
          Math.min(0.95, st.targetRotY + stepDx * 0.0075)
        );
        st.targetRotX = Math.max(
          -0.48,
          Math.min(0.55, st.targetRotX + stepDy * 0.0065)
        );
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const st = stateRef.current;
      if (!st.isPointerDown) return;

      st.isPointerDown = false;
      setIsDraggingPull(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (st.isCompleting) return;

      if (st.gestureMode === "pull") {
        if (st.targetProgress >= UNFOLD_THRESHOLD) {
          st.isCompleting = true;
          st.targetProgress = 1;
          st.targetRotX = 0;
          st.targetRotY = 0;
        } else {
          st.targetProgress = 0;
        }
      }

      st.gestureMode = "none";
    },
    []
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const st = stateRef.current;
    if (st.isCompleting) return;

    const delta = e.deltaY * 0.0016;
    const nextP = Math.max(0, Math.min(1, st.targetProgress + delta));
    st.targetProgress = nextP;

    if (nextP >= UNFOLD_THRESHOLD) {
      st.isCompleting = true;
      st.targetProgress = 1;
      st.targetRotX = 0;
      st.targetRotY = 0;
    }
  }, []);

  const chromeOpacity = Math.max(0, 1 - uiProgress / 45);

  return (
    <div
      onWheel={handleWheel}
      className={`fixed inset-0 z-20 transition-opacity duration-300 ${
        isFadingOut ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Full-viewport 3D Canvas for 1:1 pixel alignment with target 2D letter slot */}
      <div
        ref={mountRef}
        onPointerDown={(e) => handlePointerDown(e, false)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: "none" }}
        className={`absolute inset-0 h-full w-full select-none bg-[#FAF9F6]/65 ${
          isDraggingPull ? "cursor-grabbing" : "cursor-grab"
        }`}
        aria-label="3D Z 字折疊空白信紙，可旋轉檢視或向下拉動展開"
      />

      {/* Quiet desktop flanking typography (fades smoothly as user pulls) */}
      <div
        aria-hidden="true"
        style={{ opacity: chromeOpacity }}
        className="pointer-events-none absolute inset-x-10 top-1/2 hidden -translate-y-1/2 items-center justify-between transition-opacity duration-150 md:flex"
      >
        <span className="text-lg font-normal tracking-[0.22em] text-[#222222]">
          寫一則光的訊息
        </span>
        <span className="font-mono text-xs tracking-[0.2em] text-[#222222]">
          a message of light
        </span>
      </div>

      {/* Top Monospace Header (fades smoothly as letter unfolds) */}
      <div
        style={{ opacity: chromeOpacity }}
        className="pointer-events-none absolute top-6 right-6 left-6 flex items-center justify-between font-mono text-[10px] tracking-[0.22em] text-[#8C8C8A] transition-opacity duration-150 sm:top-8 sm:right-10 sm:left-10"
      >
        <span>NO. 001 // Z-FOLD</span>
        <span className="hidden sm:inline">
          DRAG TO ORBIT · PULL DOWN TO UNFOLD
        </span>
        <span>{dateStamp}</span>
      </div>

      {/* Bottom Pull-to-Unfold Indicator (fades smoothly once zooming in) */}
      <div
        style={{ opacity: Math.max(0, 1 - Math.max(0, uiProgress - 55) / 35) }}
        className="pointer-events-none absolute right-0 bottom-7 left-0 flex flex-col items-center gap-2.5 px-5 transition-opacity duration-150 sm:bottom-9"
      >
        <div className="relative h-[3px] w-44 bg-[#E6E6E1]">
          <span
            aria-hidden="true"
            className="absolute -top-1 bottom-0 h-2.5 w-[1px] bg-[#8C8C8A]"
            style={{ left: `${UNFOLD_THRESHOLD * 100}%` }}
          />
          <div
            className="h-full bg-[#222222] transition-[width] duration-75"
            style={{ width: `${uiProgress}%` }}
          />
        </div>

        <div
          onPointerDown={(e) => handlePointerDown(e, true)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: "none" }}
          className="pointer-events-auto flex items-center gap-2"
        >
          <button
            type="button"
            onClick={triggerSmoothOpen}
            className="group inline-flex items-center gap-2.5 rounded-full border border-[#222222] bg-white px-4 py-1.5 transition-all duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-[#FAF9F6] active:scale-[0.97]"
          >
            <svg
              width="12"
              height="14"
              viewBox="0 0 12 14"
              fill="none"
              className="text-[#222222] transition-transform duration-300 group-hover:translate-y-0.5"
              aria-hidden="true"
            >
              <path
                d="M6 1.5V12M6 12L2.5 8.5M6 12L9.5 8.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-mono text-[10.5px] tracking-[0.2em] text-[#222222]">
              PULL TO OPEN
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[#8C8C8A]">
              {String(uiProgress).padStart(2, "0")}%
            </span>
          </button>
        </div>

        <p className="font-sans text-[11px] font-light tracking-[0.2em] text-[#8C8C8A]">
          向下拉動信紙展開書寫，或拖曳旋轉檢視
        </p>
      </div>
    </div>
  );
}
