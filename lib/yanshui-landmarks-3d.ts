import * as THREE from "three";
import { createSeededRng } from "@/lib/hand-drawn-utils";

/**
 * ============================================================================
 * 3D BLACK-LINE WAX-CRAYON YANSHUI LANDMARKS (HOLLOW TRANSPARENT INTERIOR +
 * PROGRESSIVE 0% -> 80% UNFOLD SKETCHING)
 * ----------------------------------------------------------------------------
 * - Hollow interior (`colorWrite: false, depthWrite: true` invisible 3D depth
 *   occluder): lets the stationery's hand-drawn square paper grid shine right
 *   through the middle of every building, bridge & beehive rack while keeping
 *   clean 3D hidden-line occlusion so back walls never tangle with front lines!
 * - Blunt-ended grainy black wax-crayon strokes (`#222220`) with cotton-paper
 *   tooth pores (`discard`) & 8 FPS boiling (`floor(uTime * 8.0) / 8.0`).
 * - Progressive stroke-by-stroke sketching driven by `drawProgress ∈ [0..1]`
 *   (mapped from Z-Fold unfold 2% -> 80%, so all landmarks finish drawing right
 *   at 80% unfold!).
 * - Faithful real-world Yanshui architecture:
 *     1. Top-Right    — 鹽水八角樓 (double-slope tiled gable roof + curved
 *                       horse-back gable walls 馬背山牆 + lower octagonal
 *                       chamfered veranda eave + 3-faceted louvered 2nd floor
 *                       + vertical timber balustrades + stepped corbels)
 *     2. Bottom-Left  — 月津港水月橋 (3-arch semicircular stone bridge, pier
 *                       corbels, square balustrade posts, fan-shell reliefs &
 *                       Yuejin canal ripples)
 *     3. Top-Left & Bottom-Right — 鹽水蜂炮城 (rockets shoot directly OUT OF
 *                       THE FRONT HONEYCOMB GRID FACE in lively fanning arcs:
 *                       forward-up, forward-side, and forward-down!)
 * ============================================================================
 */

const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute_3(vec3 x) { return mod289_3(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
   -0.577350269189626,
    0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

  i = mod289_2(i);
  vec3 p = permute_3(
    permute_3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

// ---------------------------------------------------------------------------
// 1. UNCLIPPED INVISIBLE 3D DEPTH-ONLY OCCLUDER (`colorWrite: false, depthWrite: true`)
//    Never clipped during progressive drawing -> ZERO dark back-wall blotches!
//    Leaves interiors 100% hollow so the stationery grid shines cleanly through
//    while occluding rear 3D edges behind front architectural walls!
// ---------------------------------------------------------------------------
const DEPTH_OCCLUDER_VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;
  float w = snoise(position.xy * 5.0 + vec2(position.z * 4.2, boilTime * 1.9 + uSeed));
  vec3 pos = position + normal * (w * 0.0025);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const DEPTH_OCCLUDER_FRAG = /* glsl */ `
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
}
`;

// ---------------------------------------------------------------------------
// 2. BLUNT-ENDED GRAINY 0x777777 WAX-CRAYON RIBBON SHADER (STROKE-BY-STROKE!)
//    Every single structural 3D edge AND architectural detail is rendered as a
//    genuine grainy crayon line with sequential `aStrokeOrder ∈ [0..1]`, so
//    lines sketch themselves slowly and cleanly with ZERO filled black blobs!
// ---------------------------------------------------------------------------
const CRAYON_RIBBON_VERT = /* glsl */ `
attribute vec3 aTangent;
attribute float aSide;
attribute float aStrokeT;
attribute float aStrokeSeed;
attribute float aWidthScale;
attribute float aStrokeOrder;

uniform float uTime;
uniform float uSeed;
uniform float uBaseHalfWidth;

varying float vStrokeT;
varying float vSide;
varying float vStrokeSeed;
varying float vBrushNoise;
varying float vStrokeOrder;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;
  float sId = aStrokeSeed + uSeed;

  float jx = snoise(vec2(aStrokeT * 3.8 + sId, boilTime * 2.1));
  float jy = snoise(vec2(aStrokeT * 3.8 - sId, boilTime * 2.1 + 17.3));
  float jz = snoise(vec2(aStrokeT * 3.2 + sId * 0.7, boilTime * 1.9 + 31.1));
  vec3 localPos = position + vec3(jx, jy, jz) * 0.0042;

  vec4 mvPos = modelViewMatrix * vec4(localPos, 1.0);
  vec3 mvTan = normalize(mat3(modelViewMatrix) * aTangent);
  vec3 viewDir = normalize(-mvPos.xyz);
  vec3 rawPerp = cross(viewDir, mvTan);
  float perpLen = length(rawPerp);
  vec3 perp = perpLen > 1e-4 ? (rawPerp / perpLen) : vec3(1.0, 0.0, 0.0);

  // Blunt rounded crayon width (never needle-sharp!)
  float bluntEnd = 0.86 + 0.14 * smoothstep(0.0, 0.06, aStrokeT) * smoothstep(1.0, 0.94, aStrokeT);
  float crayonPress = 0.82 + 0.34 * (0.5 + 0.5 * snoise(vec2(aStrokeT * 4.8 + sId, boilTime * 1.7)));

  // Slight camera-facing bias so visible front edges sit cleanly above the invisible depth occluder
  mvPos.z += 0.011;
  mvPos.xyz += perp * (aSide * uBaseHalfWidth * aWidthScale * bluntEnd * crayonPress);

  vStrokeT = aStrokeT;
  vSide = aSide;
  vStrokeSeed = sId;
  vBrushNoise = crayonPress;
  vStrokeOrder = aStrokeOrder;
  gl_Position = projectionMatrix * mvPos;
}
`;

const CRAYON_RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDrawProgress;
uniform float uRevealStart;
uniform float uRevealEnd;
uniform vec3 uInkColor;
uniform vec3 uDustColor;

varying float vStrokeT;
varying float vSide;
varying float vStrokeSeed;
varying float vBrushNoise;
varying float vStrokeOrder;

${GLSL_NOISE}

void main() {
  if (uDrawProgress <= 0.004) discard;

  // Smooth progressive hand-drawn sketching across uDrawProgress ∈ [0..1]
  float strokeSpan = 0.28;
  float startP = vStrokeOrder * (1.0 - strokeSpan);
  float strokeProg = clamp((uDrawProgress - startP) / strokeSpan, 0.0, 1.0);
  float effEnd = min(uRevealEnd, strokeProg);

  if (vStrokeT < uRevealStart || vStrokeT > effEnd || effEnd <= uRevealStart + 0.002) {
    discard;
  }

  float boilTime = floor(uTime * 8.0) / 8.0;
  vec2 toothPx = floor(gl_FragCoord.xy * 0.9);
  float fineGrain = hash21(toothPx + vec2(boilTime * 12.1, vStrokeSeed * 3.7));
  float medGrain = 0.5 + 0.5 * snoise(gl_FragCoord.xy * 0.38 + vec2(boilTime * 2.2, vStrokeSeed));
  float strokeGrain = 0.5 + 0.5 * snoise(vec2(vStrokeT * 18.0 + vStrokeSeed * 2.3, vSide * 5.5 + boilTime * 1.5));
  float waxGrain = fineGrain * 0.46 + medGrain * 0.32 + strokeGrain * 0.22;

  float span = max(0.001, effEnd - uRevealStart);
  float localT = (vStrokeT - uRevealStart) / span;
  float endDist = min(localT, 1.0 - localT);
  float bluntCapMask = smoothstep(0.0, 0.055, endDist);
  float edgeDist = abs(vSide);

  float edgeCrumb = smoothstep(0.46, 1.0, edgeDist) * 0.56;
  float endCrumb = (1.0 - bluntCapMask) * (edgeDist * edgeDist) * 0.65;
  float cutoff = 0.23 + edgeCrumb + endCrumb - (vBrushNoise - 0.95) * 0.12;

  if (waxGrain < cutoff) {
    discard;
  }

  float pigment = smoothstep(cutoff, 0.84, waxGrain);
  vec3 col = mix(uDustColor, uInkColor, pigment);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// GEOMETRY & MATERIAL HELPERS
// ---------------------------------------------------------------------------
function attachSmoothNormals(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geom.getAttribute("normal")) {
    geom.computeVertexNormals();
  }
  const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
  const normAttr = geom.getAttribute("normal") as THREE.BufferAttribute;
  if (!posAttr || !normAttr) return geom;

  const accum = new Map<string, THREE.Vector3>();
  const keyOf = (i: number) =>
    `${Math.round(posAttr.getX(i) * 500)},${Math.round(posAttr.getY(i) * 500)},${Math.round(posAttr.getZ(i) * 500)}`;

  for (let i = 0; i < posAttr.count; i++) {
    const k = keyOf(i);
    let sum = accum.get(k);
    if (!sum) {
      sum = new THREE.Vector3();
      accum.set(k, sum);
    }
    sum.x += normAttr.getX(i);
    sum.y += normAttr.getY(i);
    sum.z += normAttr.getZ(i);
  }

  const smoothArr = new Float32Array(posAttr.count * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    const sum = accum.get(keyOf(i));
    if (sum && sum.lengthSq() > 1e-8) {
      tmp.copy(sum).normalize();
    } else {
      tmp.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)).normalize();
    }
    smoothArr[i * 3] = tmp.x;
    smoothArr[i * 3 + 1] = tmp.y;
    smoothArr[i * 3 + 2] = tmp.z;
  }

  geom.setAttribute("aSmoothNormal", new THREE.BufferAttribute(smoothArr, 3));
  return geom;
}

interface CrayonPolyline {
  pts: [number, number, number][];
  widthScale?: number;
  overshoot?: number;
  continuousT?: boolean;
  /** Optional explicit draw order [0..1]; defaults to polyline index ratio */
  drawOrder?: number;
}

function buildCrayonRibbonGeometry(
  polylines: CrayonPolyline[],
  baseSeed: number
): THREE.BufferGeometry {
  const rng = createSeededRng(baseSeed);
  const positions: number[] = [];
  const tangents: number[] = [];
  const sides: number[] = [];
  const strokeTs: number[] = [];
  const strokeSeeds: number[] = [];
  const widthScales: number[] = [];
  const strokeOrders: number[] = [];
  const indices: number[] = [];

  let baseVert = 0;
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const perpA = new THREE.Vector3();
  const perpB = new THREE.Vector3();
  const curr = new THREE.Vector3();
  const totalPolys = Math.max(1, polylines.length - 1);

  for (let li = 0; li < polylines.length; li++) {
    const poly = polylines[li];
    if (poly.pts.length < 2) continue;
    const wScale = poly.widthScale ?? 1.0;
    const ov = poly.overshoot ?? 0.005;
    const order = poly.drawOrder ?? li / totalPolys;

    if (poly.continuousT) {
      const n = poly.pts.length;
      const strokeSeed = (li * 17.3 + rng() * 19.0) % 97.0;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        curr.set(poly.pts[i][0], poly.pts[i][1], poly.pts[i][2]);
        const prevIdx = Math.max(0, i - 1);
        const nextIdx = Math.min(n - 1, i + 1);
        pA.set(poly.pts[prevIdx][0], poly.pts[prevIdx][1], poly.pts[prevIdx][2]);
        pB.set(poly.pts[nextIdx][0], poly.pts[nextIdx][1], poly.pts[nextIdx][2]);
        dir.copy(pB).sub(pA);
        if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
        else dir.normalize();

        for (const side of [-1, 1]) {
          positions.push(curr.x, curr.y, curr.z);
          tangents.push(dir.x, dir.y, dir.z);
          sides.push(side);
          strokeTs.push(t);
          strokeSeeds.push(strokeSeed);
          widthScales.push(wScale);
          strokeOrders.push(order);
        }

        if (i < n - 1) {
          const v0 = baseVert + i * 2;
          indices.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
        }
      }
      baseVert += n * 2;
      continue;
    }

    const segCount = Math.max(1, poly.pts.length - 1);
    for (let seg = 0; seg < segCount; seg++) {
      pA.set(poly.pts[seg][0], poly.pts[seg][1], poly.pts[seg][2]);
      pB.set(poly.pts[seg + 1][0], poly.pts[seg + 1][1], poly.pts[seg + 1][2]);
      dir.copy(pB).sub(pA);
      const len = dir.length();
      if (len < 1e-4) continue;
      dir.divideScalar(len);

      const startPt = pA.clone().addScaledVector(dir, -ov * (0.35 + rng() * 0.7));
      const endPt = pB.clone().addScaledVector(dir, ov * (0.35 + rng() * 0.7));

      const refUp =
        Math.abs(dir.y) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0);
      perpA.crossVectors(dir, refUp).normalize();
      perpB.crossVectors(dir, perpA).normalize();

      const bowA = (rng() - 0.5) * Math.min(0.011, len * 0.038);
      const bowB = (rng() - 0.5) * Math.min(0.008, len * 0.028);
      const subSteps = Math.max(2, Math.min(6, Math.ceil(len / 0.09)));
      const strokeSeed = (li * 13.7 + seg * 5.3 + rng() * 11.0) % 97.0;
      const segOrder = Math.min(1, order + (seg / segCount) * 0.06);

      for (let s = 0; s <= subSteps; s++) {
        const t = s / subSteps;
        curr.copy(startPt).lerp(endPt, t);
        const arch = Math.sin(t * Math.PI);
        const micro = (rng() - 0.5) * 0.0028 * arch;
        curr.addScaledVector(perpA, bowA * arch + micro);
        curr.addScaledVector(perpB, bowB * arch);

        for (const side of [-1, 1]) {
          positions.push(curr.x, curr.y, curr.z);
          tangents.push(dir.x, dir.y, dir.z);
          sides.push(side);
          strokeTs.push(t);
          strokeSeeds.push(strokeSeed);
          widthScales.push(wScale);
          strokeOrders.push(segOrder);
        }

        if (s < subSteps) {
          const v0 = baseVert + s * 2;
          indices.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
        }
      }
      baseVert += (subSteps + 1) * 2;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("aTangent", new THREE.Float32BufferAttribute(tangents, 3));
  geom.setAttribute("aSide", new THREE.Float32BufferAttribute(sides, 1));
  geom.setAttribute("aStrokeT", new THREE.Float32BufferAttribute(strokeTs, 1));
  geom.setAttribute("aStrokeSeed", new THREE.Float32BufferAttribute(strokeSeeds, 1));
  geom.setAttribute("aWidthScale", new THREE.Float32BufferAttribute(widthScales, 1));
  geom.setAttribute("aStrokeOrder", new THREE.Float32BufferAttribute(strokeOrders, 1));
  geom.setIndex(indices);
  return geom;
}

interface CrayonMaterialSet {
  depthOccluder: THREE.ShaderMaterial;
  crayonRibbon: THREE.ShaderMaterial;
  disposableGeoms: THREE.BufferGeometry[];
  minY: number;
  maxY: number;
  edgeSeedCounter: number;
}

function createHollowBlackCrayonMaterials(
  seed: number,
  disposableGeoms: THREE.BufferGeometry[],
  opts?: {
    ribbonHalfWidth?: number;
    minY?: number;
    maxY?: number;
  }
): CrayonMaterialSet {
  // Subtle, refined 0x777777 graphite-crayon gray so landmarks harmonize softly with the stationery!
  const crayonInkCol = new THREE.Color(0x777777);
  const dustGrayCol = new THREE.Color(0x9e9d99);
  const minY = opts?.minY ?? -0.4;
  const maxY = opts?.maxY ?? 0.65;

  // Pass 0: Unclipped invisible depth-only surface (ZERO black blotches, 100% hollow grid interior!)
  const depthOccluder = new THREE.ShaderMaterial({
    vertexShader: DEPTH_OCCLUDER_VERT,
    fragmentShader: DEPTH_OCCLUDER_FRAG,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    transparent: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
    },
  });

  const crayonRibbon = new THREE.ShaderMaterial({
    vertexShader: CRAYON_RIBBON_VERT,
    fragmentShader: CRAYON_RIBBON_FRAG,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed + 4.3 },
      uDrawProgress: { value: 1 },
      uBaseHalfWidth: { value: opts?.ribbonHalfWidth ?? 0.0096 },
      uRevealStart: { value: 0 },
      uRevealEnd: { value: 1 },
      uInkColor: { value: crayonInkCol },
      uDustColor: { value: dustGrayCol },
    },
  });

  return {
    depthOccluder,
    crayonRibbon,
    disposableGeoms,
    minY,
    maxY,
    edgeSeedCounter: Math.round(seed * 97),
  };
}

/**
 * Adds a hollow 3D part whose structural edges are converted into genuine
 * blunt-ended grainy `0x777777` wax-crayon strokes (using THREE.EdgesGeometry)
 * layered over an unclipped invisible depth occluder -> 100% crisp 3D hidden-line
 * sketching with ZERO dark BackSide polygon blotches!
 */
function addHollowCrayonPart(
  parent: THREE.Group,
  geom: THREE.BufferGeometry,
  mats: CrayonMaterialSet,
  pos: [number, number, number],
  rot?: [number, number, number],
  withEdges = true,
  edgeThresholdDeg = 17
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  if (rot) g.rotation.set(rot[0], rot[1], rot[2]);

  const depthMesh = new THREE.Mesh(geom, mats.depthOccluder);
  depthMesh.renderOrder = 0;
  g.add(depthMesh);

  if (withEdges) {
    const edgesGeom = new THREE.EdgesGeometry(geom, edgeThresholdDeg);
    const posAttr = edgesGeom.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (posAttr && posAttr.count >= 2) {
      const spanY = Math.max(0.001, mats.maxY - mats.minY);
      const polylines: CrayonPolyline[] = [];
      for (let i = 0; i < posAttr.count; i += 2) {
        const ax = posAttr.getX(i);
        const ay = posAttr.getY(i);
        const az = posAttr.getZ(i);
        const bx = posAttr.getX(i + 1);
        const by = posAttr.getY(i + 1);
        const bz = posAttr.getZ(i + 1);
        const midY = pos[1] + (ay + by) * 0.5;
        const midX = pos[0] + (ax + bx) * 0.5;
        const ny = Math.max(0, Math.min(1, (midY - mats.minY) / spanY));
        const nx = Math.max(0, Math.min(1, midX * 0.45 + 0.5));
        const drawOrder = Math.max(0.02, Math.min(0.92, ny * 0.65 + nx * 0.3));
        polylines.push({
          pts: [
            [ax, ay, az],
            [bx, by, bz],
          ],
          widthScale: 0.96,
          overshoot: 0.004,
          drawOrder,
        });
      }
      edgesGeom.dispose();

      if (polylines.length > 0) {
        mats.edgeSeedCounter += 19;
        const edgeRib = buildCrayonRibbonGeometry(polylines, mats.edgeSeedCounter);
        mats.disposableGeoms.push(edgeRib);
        const edgeMesh = new THREE.Mesh(edgeRib, mats.crayonRibbon);
        edgeMesh.renderOrder = 1;
        g.add(edgeMesh);
      }
    } else {
      edgesGeom.dispose();
    }
  }
  parent.add(g);
  return g;
}

// ===========================================================================
// 1. 鹽水八角樓 (YANSHUI BAJIAOLOU — FAITHFUL TO AERIAL + FRONT/SIDE PHOTOS!)
//    Real architectural form:
//      - Long double-sloped tiled gable roof (雙坡紅瓦屋頂) with straight main
//        ridge (正脊) and NO spiky cones!
//      - Authentic curved Horse-Back Gables (圓形金形馬背山牆) on both ends,
//        with graceful arched crest & stepped low corner shoulders!
//      - Iconic octagonal chamfered 2nd-floor cantilevered timber veranda
//        (3-faceted beveled front-left/front/front-right bay with lower skirt
//        eave roof 下簷披水, dense wooden balustrades, louvered wooden shutters,
//        and stepped wooden corbel brackets 斗拱 underneath)!
//      - 1st floor recessed porch, stone corner pillar & openwork brick wall!
// ===========================================================================
interface BajiaolouBuilt {
  root: THREE.Group;
  lanterns: THREE.Group[];
  mats: CrayonMaterialSet;
}

function buildOctagonalChamferedShape(
  halfW: number,
  halfD: number,
  chamfer: number
): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-halfW + chamfer, -halfD);
  s.lineTo(halfW - chamfer, -halfD);
  s.lineTo(halfW, -halfD + chamfer);
  s.lineTo(halfW, halfD - chamfer);
  s.lineTo(halfW - chamfer, halfD);
  s.lineTo(-halfW + chamfer, halfD);
  s.lineTo(-halfW, halfD - chamfer);
  s.lineTo(-halfW, -halfD + chamfer);
  s.closePath();
  return s;
}

function buildBajiaolou3D(
  disposableGeoms: THREE.BufferGeometry[],
  disposableMats: THREE.Material[]
): BajiaolouBuilt {
  const mats = createHollowBlackCrayonMaterials(11.3, disposableGeoms, {
    ribbonHalfWidth: 0.009,
    minY: -0.42,
    maxY: 0.68,
  });
  disposableMats.push(mats.depthOccluder, mats.crayonRibbon);

  const root = new THREE.Group();

  // 1st Floor stone plinth + brick/plaster core
  const plinth = attachSmoothNormals(new THREE.BoxGeometry(1.06, 0.055, 0.62));
  const firstFloor = attachSmoothNormals(new THREE.BoxGeometry(0.92, 0.35, 0.46));

  // 2nd Floor iconic octagonal chamfered cantilevered wooden veranda (Photo 1, 2, 3!)
  const verandaPlan = buildOctagonalChamferedShape(0.58, 0.34, 0.14);
  const verandaDeck = new THREE.ExtrudeGeometry(verandaPlan, {
    depth: 0.042,
    bevelEnabled: false,
  });
  verandaDeck.rotateX(-Math.PI * 0.5);
  verandaDeck.translate(0, -0.021, 0);
  attachSmoothNormals(verandaDeck);

  const verandaBody = new THREE.ExtrudeGeometry(
    buildOctagonalChamferedShape(0.55, 0.315, 0.13),
    { depth: 0.34, bevelEnabled: false }
  );
  verandaBody.rotateX(-Math.PI * 0.5);
  verandaBody.translate(0, -0.17, 0);
  attachSmoothNormals(verandaBody);

  // Lower Octagonal Chamfered Skirt Eave Roof (八角斜切下簷披水 — Photo 1, 2, 3!)
  // Uses safe positive outward bevel so all bevel normals remain cleanly outward-facing!
  const skirtBase = buildOctagonalChamferedShape(0.58, 0.34, 0.14);
  const skirtEave = new THREE.ExtrudeGeometry(skirtBase, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.026,
    bevelSize: 0.052,
    bevelSegments: 2,
  });
  skirtEave.rotateX(-Math.PI * 0.5);
  skirtEave.translate(0, -0.018, 0);
  attachSmoothNormals(skirtEave);

  // Main Double-Sloped Gable Roof (雙坡紅瓦屋頂 — Photo 3 aerial & Photo 4!)
  // Clean triangular-pitch saddle roof running along X, sloping gently front/back (Z)
  const gableCross = new THREE.Shape();
  gableCross.moveTo(-0.34, 0);
  gableCross.lineTo(-0.32, 0.03);
  gableCross.quadraticCurveTo(-0.15, 0.125, 0, 0.21);
  gableCross.quadraticCurveTo(0.15, 0.125, 0.32, 0.03);
  gableCross.lineTo(0.34, 0);
  gableCross.closePath();

  const mainRoof = new THREE.ExtrudeGeometry(gableCross, {
    depth: 1.04,
    bevelEnabled: false,
    curveSegments: 8,
  });
  mainRoof.center();
  mainRoof.rotateY(Math.PI * 0.5);
  attachSmoothNormals(mainRoof);

  // Authentic Taiwanese Horse-Back Gable End Wall (圓形金形馬背山牆 — Photo 1, 2, 3, 4!)
  // Rounded central arch crest stepping gently down to flat-curved shoulders — NO spiky cones!
  const horseBackShape = new THREE.Shape();
  horseBackShape.moveTo(-0.34, -0.01);
  horseBackShape.lineTo(-0.34, 0.045);
  horseBackShape.quadraticCurveTo(-0.26, 0.045, -0.21, 0.095);
  horseBackShape.quadraticCurveTo(-0.14, 0.145, -0.095, 0.195);
  // Graceful rounded 金形馬背 central arch peak
  horseBackShape.quadraticCurveTo(0, 0.275, 0.095, 0.195);
  horseBackShape.quadraticCurveTo(0.14, 0.145, 0.21, 0.095);
  horseBackShape.quadraticCurveTo(0.26, 0.045, 0.34, 0.045);
  horseBackShape.lineTo(0.34, -0.01);
  horseBackShape.closePath();

  const horseBackGable = new THREE.ExtrudeGeometry(horseBackShape, {
    depth: 0.055,
    bevelEnabled: false,
    curveSegments: 10,
  });
  horseBackGable.translate(0, 0, -0.0275);
  horseBackGable.rotateY(Math.PI * 0.5);
  attachSmoothNormals(horseBackGable);

  // Iconic low brick courtyard wall, stone corner pillar, wooden corbel brackets & lanterns
  const lowWall = attachSmoothNormals(new THREE.BoxGeometry(0.62, 0.15, 0.055));
  const cornerPillar = attachSmoothNormals(new THREE.BoxGeometry(0.075, 0.35, 0.075));
  const corbel = attachSmoothNormals(new THREE.BoxGeometry(0.055, 0.09, 0.095));
  const lanternBody = attachSmoothNormals(new THREE.SphereGeometry(0.03, 9, 7));
  lanternBody.scale(1.06, 0.88, 1.06);

  disposableGeoms.push(
    plinth,
    firstFloor,
    verandaDeck,
    verandaBody,
    skirtEave,
    mainRoof,
    horseBackGable,
    lowWall,
    cornerPillar,
    corbel,
    lanternBody
  );

  // Assemble 八角樓
  addHollowCrayonPart(root, plinth, mats, [0, -0.37, 0.01]);
  addHollowCrayonPart(root, firstFloor, mats, [0, -0.17, -0.01]);
  addHollowCrayonPart(root, verandaDeck, mats, [0, 0.02, 0]);
  addHollowCrayonPart(root, verandaBody, mats, [0, 0.2, 0]);
  addHollowCrayonPart(root, skirtEave, mats, [0, 0.385, 0]);
  addHollowCrayonPart(root, mainRoof, mats, [0, 0.515, 0]);

  // Left & Right Horse-Back Gable Walls (馬背山牆) capping both ends of the main saddle roof!
  addHollowCrayonPart(root, horseBackGable, mats, [-0.495, 0.415, 0]);
  addHollowCrayonPart(root, horseBackGable, mats, [0.495, 0.415, 0]);

  // Stepped wooden corbel brackets supporting the cantilevered 2nd floor (Photo 1 & 2!)
  for (const cx of [-0.42, -0.16, 0.16, 0.42]) {
    addHollowCrayonPart(root, corbel, mats, [cx, -0.03, 0.24]);
  }
  addHollowCrayonPart(root, corbel, mats, [-0.49, -0.03, -0.12]);
  addHollowCrayonPart(root, corbel, mats, [-0.49, -0.03, 0.12]);

  // Low front-right courtyard brick wall + corner stone pillar (Photo 1 & 4!)
  addHollowCrayonPart(root, cornerPillar, mats, [-0.34, -0.17, 0.27]);
  addHollowCrayonPart(root, lowWall, mats, [0.07, -0.27, 0.28]);

  // Swaying hanging lanterns under the 1st-floor porch eaves (clean hand-drawn round crayon loops!)
  const lanternCirclePts: [number, number, number][] = [];
  for (let s = 0; s <= 12; s++) {
    const a = (s / 12) * Math.PI * 2;
    lanternCirclePts.push([Math.cos(a) * 0.032, Math.sin(a) * 0.027, 0]);
  }
  const lanternRingGeom = buildCrayonRibbonGeometry(
    [
      { pts: lanternCirclePts, widthScale: 0.85, continuousT: true, drawOrder: 0.24 },
      { pts: [[0, 0.048, 0], [0, 0.027, 0]], widthScale: 0.65, drawOrder: 0.22 },
    ],
    8177
  );
  disposableGeoms.push(lanternRingGeom);

  const lanterns: THREE.Group[] = [];
  for (const lx of [-0.22, -0.05, 0.12, 0.29]) {
    const lPivot = new THREE.Group();
    lPivot.position.set(lx, 0.0, 0.22);
    addHollowCrayonPart(lPivot, lanternBody, mats, [0, -0.048, 0], undefined, false);
    const ringMesh = new THREE.Mesh(lanternRingGeom, mats.crayonRibbon);
    ringMesh.position.set(0, -0.048, 0.012);
    ringMesh.renderOrder = 2;
    lPivot.add(ringMesh);
    root.add(lPivot);
    lanterns.push(lPivot);
  }

  // Hand-drawn black wax-crayon architectural details (ordered bottom -> top for smooth 0->80% sketch!)
  const strokes: CrayonPolyline[] = [];
  const zFront = 0.324;

  // A. Low courtyard brick wall + hollow lattice cutouts (bottom, drawOrder ~0.08..0.22)
  const zWall = 0.315;
  strokes.push({ pts: [[-0.23, -0.23, zWall], [0.37, -0.23, zWall]], widthScale: 0.65, drawOrder: 0.08 });
  strokes.push({ pts: [[-0.23, -0.29, zWall], [0.37, -0.29, zWall]], widthScale: 0.65, drawOrder: 0.12 });
  for (const lx of [-0.04, 0.22]) {
    strokes.push({
      pts: [
        [lx - 0.045, -0.21, zWall + 0.004],
        [lx + 0.045, -0.21, zWall + 0.004],
        [lx + 0.045, -0.31, zWall + 0.004],
        [lx - 0.045, -0.31, zWall + 0.004],
        [lx - 0.045, -0.21, zWall + 0.004],
      ],
      widthScale: 0.78,
      drawOrder: 0.16,
    });
    strokes.push({
      pts: [[lx - 0.038, -0.22, zWall + 0.005], [lx + 0.038, -0.3, zWall + 0.005]],
      widthScale: 0.58,
      drawOrder: 0.18,
    });
    strokes.push({
      pts: [[lx + 0.038, -0.22, zWall + 0.005], [lx - 0.038, -0.3, zWall + 0.005]],
      widthScale: 0.58,
      drawOrder: 0.2,
    });
  }

  // B. 2nd-floor front & beveled-corner dense wooden balustrade railings (drawOrder ~0.28..0.52)
  strokes.push({ pts: [[-0.42, 0.165, zFront], [0.42, 0.165, zFront]], widthScale: 1.05, drawOrder: 0.28 });
  strokes.push({ pts: [[-0.42, 0.045, zFront], [0.42, 0.045, zFront]], widthScale: 0.98, drawOrder: 0.3 });
  for (let i = 0; i <= 13; i++) {
    const x = -0.4 + (i / 13) * 0.8;
    strokes.push({ pts: [[x, 0.045, zFront], [x, 0.162, zFront]], widthScale: 0.58, drawOrder: 0.32 + (i / 13) * 0.14 });
  }

  // Left 45° octagonal chamfer corner bay railing + louvers (signature 八角樓 detail!)
  const chamPtsTop: [number, number, number][] = [[-0.558, 0.165, 0.185], [-0.422, 0.165, zFront]];
  const chamPtsBot: [number, number, number][] = [[-0.558, 0.045, 0.185], [-0.422, 0.045, zFront]];
  strokes.push({ pts: chamPtsTop, widthScale: 1.0, drawOrder: 0.35 });
  strokes.push({ pts: chamPtsBot, widthScale: 0.95, drawOrder: 0.37 });
  for (let i = 1; i <= 3; i++) {
    const f = i / 4;
    const cx = -0.558 + (-0.422 - -0.558) * f;
    const cz = 0.185 + (zFront - 0.185) * f;
    strokes.push({ pts: [[cx, 0.045, cz], [cx, 0.162, cz]], widthScale: 0.58, drawOrder: 0.4 });
  }

  // Left side wall continuous balustrade (visible in 3/4 view just like Photo 1 & 4!)
  const xLeft = -0.558;
  strokes.push({ pts: [[xLeft, 0.165, -0.185], [xLeft, 0.165, 0.185]], widthScale: 1.0, drawOrder: 0.36 });
  strokes.push({ pts: [[xLeft, 0.045, -0.185], [xLeft, 0.045, 0.185]], widthScale: 0.95, drawOrder: 0.38 });
  for (let i = 0; i <= 6; i++) {
    const z = -0.17 + (i / 6) * 0.34;
    strokes.push({ pts: [[xLeft, 0.045, z], [xLeft, 0.162, z]], widthScale: 0.58, drawOrder: 0.42 });
  }

  // C. 2nd-floor upper wooden louvered shutter windows (drawOrder ~0.48..0.64)
  for (const wx of [-0.26, 0.0, 0.26]) {
    strokes.push({
      pts: [
        [wx - 0.1, 0.345, zFront - 0.004],
        [wx + 0.1, 0.345, zFront - 0.004],
        [wx + 0.1, 0.195, zFront - 0.004],
        [wx - 0.1, 0.195, zFront - 0.004],
        [wx - 0.1, 0.345, zFront - 0.004],
      ],
      widthScale: 0.78,
      drawOrder: 0.5,
    });
    for (let s = 1; s <= 3; s++) {
      const sy = 0.195 + (s / 4) * 0.15;
      strokes.push({
        pts: [[wx - 0.085, sy, zFront - 0.001], [wx + 0.085, sy, zFront - 0.001]],
        widthScale: 0.5,
        drawOrder: 0.54 + s * 0.025,
      });
    }
  }

  // D. Main double-sloped gable roof ridge (正脊), tile ribs (瓦隴) & Horse-Back Gable outlines (馬背山牆)!
  strokes.push({ pts: [[-0.51, 0.625, 0], [0.51, 0.625, 0]], widthScale: 1.32, drawOrder: 0.72 });
  for (let r = 0; r <= 9; r++) {
    const rx = -0.44 + (r / 9) * 0.88;
    strokes.push({
      pts: [[rx, 0.618, 0.02], [rx, 0.44, 0.335]],
      widthScale: 0.58,
      drawOrder: 0.74 + (r / 9) * 0.14,
    });
  }

  // Crisp hand-drawn Horse-Back Gable arch curves on left & right roof ends (Photo 1 & 2!)
  for (const gx of [-0.528, 0.528]) {
    const gableArc: [number, number, number][] = [
      [gx, 0.455, -0.33],
      [gx, 0.505, -0.21],
      [gx, 0.595, -0.1],
      [gx, 0.665, 0.0],
      [gx, 0.595, 0.1],
      [gx, 0.505, 0.21],
      [gx, 0.455, 0.33],
    ];
    strokes.push({ pts: gableArc, widthScale: 1.2, continuousT: true, drawOrder: 0.84 });
  }

  // Lower octagonal chamfered skirt eave ridge ribs (垂脊)
  strokes.push({ pts: [[-0.46, 0.425, 0.36], [0.46, 0.425, 0.36]], widthScale: 1.05, drawOrder: 0.88 });
  strokes.push({ pts: [[-0.62, 0.425, 0.21], [-0.46, 0.425, 0.36]], widthScale: 1.0, drawOrder: 0.9 });
  strokes.push({ pts: [[0.46, 0.425, 0.36], [0.62, 0.425, 0.21]], widthScale: 1.0, drawOrder: 0.92 });

  const ribGeom = buildCrayonRibbonGeometry(strokes, 8101);
  disposableGeoms.push(ribGeom);
  const ribMesh = new THREE.Mesh(ribGeom, mats.crayonRibbon);
  ribMesh.renderOrder = 2;
  root.add(ribMesh);

  return { root, lanterns, mats };
}

// ===========================================================================
// 2. 鹽水月津港水月橋 (SHUIYUE BRIDGE — 3-ARCH BRIDGE WITH HOLLOW INTERIOR!)
// ===========================================================================
interface ShuiyueBridgeBuilt {
  root: THREE.Group;
  waterWaves: THREE.Group[];
  mats: CrayonMaterialSet;
}

function buildShuiyueBridge3D(
  disposableGeoms: THREE.BufferGeometry[],
  disposableMats: THREE.Material[]
): ShuiyueBridgeBuilt {
  const mats = createHollowBlackCrayonMaterials(23.7, disposableGeoms, {
    ribbonHalfWidth: 0.009,
    minY: -0.36,
    maxY: 0.36,
  });
  disposableMats.push(mats.depthOccluder, mats.crayonRibbon);

  const root = new THREE.Group();

  const halfLen = 0.88;
  const deckY = 0.16;
  const baseY = -0.16;
  const bridgeShape = new THREE.Shape();
  bridgeShape.moveTo(-halfLen, deckY - 0.025);
  bridgeShape.quadraticCurveTo(0, deckY + 0.04, halfLen, deckY - 0.025);
  bridgeShape.lineTo(halfLen, baseY);

  bridgeShape.lineTo(0.58 + 0.18, baseY);
  bridgeShape.absarc(0.58, baseY, 0.18, 0, Math.PI, false);

  bridgeShape.lineTo(0.25, baseY);
  bridgeShape.absarc(0, baseY, 0.25, 0, Math.PI, false);

  bridgeShape.lineTo(-0.58 + 0.18, baseY);
  bridgeShape.absarc(-0.58, baseY, 0.18, 0, Math.PI, false);

  bridgeShape.lineTo(-halfLen, baseY);
  bridgeShape.closePath();

  const bridgeBody = new THREE.ExtrudeGeometry(bridgeShape, {
    depth: 0.34,
    bevelEnabled: false,
    curveSegments: 14,
  });
  bridgeBody.translate(0, 0, -0.17);
  attachSmoothNormals(bridgeBody);

  const deckSlab = attachSmoothNormals(new THREE.BoxGeometry(1.82, 0.042, 0.42));
  const pillarPost = attachSmoothNormals(new THREE.BoxGeometry(0.056, 0.155, 0.056));
  const topRail = attachSmoothNormals(new THREE.BoxGeometry(1.78, 0.026, 0.036));
  const pierCorbel = attachSmoothNormals(new THREE.BoxGeometry(0.055, 0.11, 0.048));

  disposableGeoms.push(bridgeBody, deckSlab, pillarPost, topRail, pierCorbel);

  addHollowCrayonPart(root, bridgeBody, mats, [0, 0, 0]);
  addHollowCrayonPart(root, deckSlab, mats, [0, deckY + 0.02, 0]);
  addHollowCrayonPart(root, topRail, mats, [0, deckY + 0.165, 0.185]);
  addHollowCrayonPart(root, topRail, mats, [0, deckY + 0.165, -0.185]);

  const postXs = [-0.84, -0.5, -0.17, 0.17, 0.5, 0.84];
  for (const px of postXs) {
    const liftY = (1 - (px / 0.88) * (px / 0.88)) * 0.015;
    addHollowCrayonPart(root, pillarPost, mats, [px, deckY + 0.105 + liftY, 0.185]);
    addHollowCrayonPart(root, pillarPost, mats, [px, deckY + 0.105 + liftY, -0.185]);
  }

  for (const cx of [-0.34, -0.28, 0.28, 0.34, -0.79, 0.79]) {
    addHollowCrayonPart(root, pierCorbel, mats, [cx, 0.06, 0.182]);
  }

  const strokes: CrayonPolyline[] = [];
  const zF = 0.205;

  // Arch rings first (drawOrder 0.15..0.38)
  const arches = [
    { cx: -0.58, r: 0.185 },
    { cx: 0.0, r: 0.255 },
    { cx: 0.58, r: 0.185 },
  ];
  arches.forEach((arch, aIdx) => {
    const arcPts: [number, number, number][] = [];
    for (let s = 0; s <= 12; s++) {
      const a = (s / 12) * Math.PI;
      arcPts.push([
        arch.cx + Math.cos(a) * arch.r,
        baseY + Math.sin(a) * arch.r,
        0.178,
      ]);
    }
    strokes.push({
      pts: arcPts,
      widthScale: 1.15,
      continuousT: true,
      drawOrder: 0.16 + aIdx * 0.08,
    });
  });

  // Balustrade fan-shell relief panels (drawOrder 0.45..0.88)
  for (let i = 0; i < postXs.length - 1; i++) {
    const x0 = postXs[i] + 0.045;
    const x1 = postXs[i + 1] - 0.045;
    const xm = (x0 + x1) * 0.5;
    const yBot = deckY + 0.045;
    const yTop = deckY + 0.148;
    const panelOrder = 0.46 + (i / 5) * 0.36;

    strokes.push({
      pts: [
        [x0, yBot, zF],
        [x1, yBot, zF],
        [x1, yTop, zF],
        [x0, yTop, zF],
        [x0, yBot, zF],
      ],
      widthScale: 0.78,
      drawOrder: panelOrder,
    });

    const rays = 5;
    for (let r = 0; r < rays; r++) {
      const ang = Math.PI * (0.18 + (r / (rays - 1)) * 0.64);
      const rx = xm + Math.cos(ang) * ((x1 - x0) * 0.42);
      const ry = yBot + Math.sin(ang) * (yTop - yBot - 0.012);
      strokes.push({
        pts: [[xm, yBot + 0.008, zF + 0.003], [rx, ry, zF + 0.003]],
        widthScale: 0.58,
        drawOrder: Math.min(0.95, panelOrder + 0.06),
      });
    }
  }

  for (const bx of [-0.33, 0.33]) {
    strokes.push({ pts: [[bx - 0.06, -0.04, 0.178], [bx + 0.06, -0.04, 0.178]], widthScale: 0.55, drawOrder: 0.35 });
    strokes.push({ pts: [[bx - 0.05, -0.1, 0.178], [bx + 0.05, -0.1, 0.178]], widthScale: 0.55, drawOrder: 0.38 });
  }

  const ribGeom = buildCrayonRibbonGeometry(strokes, 8202);
  disposableGeoms.push(ribGeom);
  const ribMesh = new THREE.Mesh(ribGeom, mats.crayonRibbon);
  ribMesh.renderOrder = 2;
  root.add(ribMesh);

  // Undulating water waves underneath arches (sketch in early: drawOrder 0.06..0.24)
  const waterWaves: THREE.Group[] = [];
  const waveRows = [
    { y: baseY - 0.05, z: 0.18, len: 1.55, amp: 0.022, cycles: 3.2 },
    { y: baseY - 0.13, z: 0.24, len: 1.28, amp: 0.02, cycles: 2.6 },
    { y: baseY - 0.21, z: 0.28, len: 0.92, amp: 0.018, cycles: 2.0 },
  ];

  waveRows.forEach((row, idx) => {
    const wg = new THREE.Group();
    const pts: [number, number, number][] = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (t - 0.5) * row.len;
      const y = row.y + Math.sin(t * Math.PI * 2 * row.cycles + idx) * row.amp;
      pts.push([x, y, row.z]);
    }
    const wGeom = buildCrayonRibbonGeometry(
      [{ pts, widthScale: 0.95 - idx * 0.1, continuousT: true, drawOrder: 0.08 + idx * 0.07 }],
      8300 + idx * 31
    );
    disposableGeoms.push(wGeom);
    const wm = new THREE.Mesh(wGeom, mats.crayonRibbon);
    wm.renderOrder = 2;
    wg.add(wm);
    root.add(wg);
    waterWaves.push(wg);
  });

  return { root, waterWaves, mats };
}

// ===========================================================================
// 3. 鹽水蜂炮 (FRONT-GRID BEEHIVE LAUNCHER — MATCHES USER'S RED-ARROW DIAGRAM!)
//    Rockets shoot DIRECTLY OUT OF THE FRONT HONEYCOMB GRID CELLS (+Z face of
//    rackNode!) in energetic fanning curves: forward-upward, forward-sideways,
//    and forward-downward, complete with grid-mouth ignition flashes & bursts!
// ===========================================================================
interface RocketAnimItem {
  trailMat: THREE.ShaderMaterial;
  burstGroup: THREE.Group;
  burstMat: THREE.ShaderMaterial;
  muzzleFlash: THREE.Group;
  cycleSec: number;
  phaseOffset: number;
}

interface BeehiveFireworkBuilt {
  root: THREE.Group;
  rackNode: THREE.Group;
  rockets: RocketAnimItem[];
  rackMats: CrayonMaterialSet;
  allDynamicMats: THREE.ShaderMaterial[];
  moonNode?: THREE.Group;
}

interface FrontGridRocketSpec {
  /** Exact cell coordinate on the FRONT honeycomb grid face (x ∈ [-0.4..0.4], y ∈ [-0.4..0.4]) */
  gridNormX: number;
  gridNormY: number;
  /** Initial shoot-out direction directly forward out of the +Z honeycomb grid */
  ctrlOffset: [number, number, number];
  /** Sweeping end burst point relative to grid cell (can arc UP, SIDEWAYS, or DOWN!) */
  endOffset: [number, number, number];
  burstRadius: number;
  rayCount: number;
  cycleSec: number;
  phaseOffset: number;
}

function buildBeehiveFireworkCluster3D(
  opts: {
    seed: number;
    doubleTier: boolean;
    includeMoon?: boolean;
    baseYaw: number;
    rocketSpecs: FrontGridRocketSpec[];
  },
  disposableGeoms: THREE.BufferGeometry[],
  disposableMats: THREE.Material[]
): BeehiveFireworkBuilt {
  const rackMats = createHollowBlackCrayonMaterials(opts.seed, disposableGeoms, {
    ribbonHalfWidth: 0.0094,
    minY: -0.32,
    maxY: 0.25,
  });
  disposableMats.push(rackMats.depthOccluder, rackMats.crayonRibbon);

  const root = new THREE.Group();
  // rackNode holds BOTH the wooden honeycomb frame AND the rockets shooting straight
  // out of its +Z front honeycomb grid so rockets ALWAYS emerge physically from the grid!
  const rackNode = new THREE.Group();
  rackNode.rotation.y = opts.baseYaw;
  rackNode.rotation.x = 0.14;
  root.add(rackNode);

  const rackW = opts.doubleTier ? 0.36 : 0.3;
  const rackH = opts.doubleTier ? 0.3 : 0.22;
  const rackD = 0.16;

  const boxGeom = attachSmoothNormals(new THREE.BoxGeometry(rackW, rackH, rackD));
  const legGeom = attachSmoothNormals(new THREE.BoxGeometry(0.034, 0.16, 0.034));
  const topRoofBar = attachSmoothNormals(
    new THREE.BoxGeometry(rackW + 0.08, 0.034, rackD + 0.05)
  );
  disposableGeoms.push(boxGeom, legGeom, topRoofBar);

  addHollowCrayonPart(rackNode, boxGeom, rackMats, [0, 0, 0]);
  addHollowCrayonPart(rackNode, topRoofBar, rackMats, [0, rackH * 0.5 + 0.02, 0]);
  addHollowCrayonPart(rackNode, legGeom, rackMats, [-rackW * 0.42, -rackH * 0.5 - 0.06, rackD * 0.38]);
  addHollowCrayonPart(rackNode, legGeom, rackMats, [rackW * 0.42, -rackH * 0.5 - 0.06, rackD * 0.38]);
  addHollowCrayonPart(rackNode, legGeom, rackMats, [-rackW * 0.42, -rackH * 0.5 - 0.06, -rackD * 0.38]);
  addHollowCrayonPart(rackNode, legGeom, rackMats, [rackW * 0.42, -rackH * 0.5 - 0.06, -rackD * 0.38]);

  // Front Honeycomb Grid (+Z face) where all beehive rockets shoot out!
  const zRackF = rackD * 0.5 + 0.008;
  const rackStrokes: CrayonPolyline[] = [];
  const rows = opts.doubleTier ? 4 : 3;
  const cols = 4;
  for (let r = 0; r <= rows; r++) {
    const y = -rackH * 0.42 + (r / rows) * (rackH * 0.84);
    rackStrokes.push({
      pts: [[-rackW * 0.44, y, zRackF], [rackW * 0.44, y, zRackF]],
      widthScale: 0.78,
      drawOrder: 0.25 + (r / rows) * 0.35,
    });
  }
  for (let c = 0; c <= cols; c++) {
    const x = -rackW * 0.44 + (c / cols) * (rackW * 0.88);
    rackStrokes.push({
      pts: [[x, -rackH * 0.42, zRackF], [x, rackH * 0.42, zRackF]],
      widthScale: 0.78,
      drawOrder: 0.45 + (c / cols) * 0.35,
    });
  }
  rackStrokes.push({
    pts: [
      [-rackW * 0.42, -rackH * 0.5 - 0.12, rackD * 0.4],
      [rackW * 0.42, -rackH * 0.5 - 0.02, rackD * 0.4],
    ],
    widthScale: 0.65,
    drawOrder: 0.18,
  });

  const rackRib = buildCrayonRibbonGeometry(rackStrokes, Math.round(opts.seed * 100));
  disposableGeoms.push(rackRib);
  const rackRibMesh = new THREE.Mesh(rackRib, rackMats.crayonRibbon);
  rackRibMesh.renderOrder = 2;
  rackNode.add(rackRibMesh);

  // Optional 3D black-crayon hollow crescent moon floating gently near top-left beehive
  let moonNode: THREE.Group | undefined;
  if (opts.includeMoon) {
    moonNode = new THREE.Group();
    const moonShape = new THREE.Shape();
    const mr = 0.135;
    for (let i = 0; i <= 14; i++) {
      const a = -Math.PI * 0.38 + (i / 14) * Math.PI * 1.48;
      const x = Math.cos(a) * mr;
      const y = Math.sin(a) * mr;
      if (i === 0) moonShape.moveTo(x, y);
      else moonShape.lineTo(x, y);
    }
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * 1.1 - (i / 12) * Math.PI * 1.48;
      moonShape.lineTo(
        mr * 0.44 + Math.cos(a) * (mr * 0.8),
        -mr * 0.1 + Math.sin(a) * (mr * 0.8)
      );
    }
    moonShape.closePath();

    const moonGeom = new THREE.ExtrudeGeometry(moonShape, {
      depth: 0.036,
      bevelEnabled: false,
    });
    moonGeom.translate(0, 0, -0.018);
    attachSmoothNormals(moonGeom);
    disposableGeoms.push(moonGeom);
    addHollowCrayonPart(moonNode, moonGeom, rackMats, [0, 0, 0]);
    moonNode.position.set(0.56, 0.52, -0.1);
    root.add(moonNode);
  }

  // Animated 3D rockets launching DIRECTLY OUT OF THE FRONT HONEYCOMB GRID (+Z)!
  const rockets: RocketAnimItem[] = [];
  const allDynamicMats: THREE.ShaderMaterial[] = [];

  opts.rocketSpecs.forEach((spec, idx) => {
    const rng = createSeededRng(Math.round(opts.seed * 53 + idx * 131));

    // Exact launch mouth on the front honeycomb grid face (+Z)!
    const sx = spec.gridNormX * rackW * 0.78;
    const sy = spec.gridNormY * rackH * 0.76;
    const sz = zRackF + 0.01;

    // Cubic S-curve / sweeping beehive arc bursting forward (+Z) out of the grid mouth!
    const p0: [number, number, number] = [sx, sy, sz];
    const p1: [number, number, number] = [
      sx + spec.ctrlOffset[0] * 0.45,
      sy + spec.ctrlOffset[1] * 0.45,
      sz + Math.max(0.18, spec.ctrlOffset[2]),
    ];
    const p2: [number, number, number] = [
      sx + spec.ctrlOffset[0],
      sy + spec.ctrlOffset[1],
      sz + spec.ctrlOffset[2] * 1.15,
    ];
    const p3: [number, number, number] = [
      sx + spec.endOffset[0],
      sy + spec.endOffset[1],
      sz + spec.endOffset[2],
    ];

    const trailPts: [number, number, number][] = [];
    const steps = 18;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const inv = 1 - t;
      const b0 = inv * inv * inv;
      const b1 = 3 * inv * inv * t;
      const b2 = 3 * inv * t * t;
      const b3 = t * t * t;
      trailPts.push([
        b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
        b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
        b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2],
      ]);
    }

    const trailSet = createHollowBlackCrayonMaterials(
      opts.seed + 7.1 + idx * 3.7,
      disposableGeoms,
      { ribbonHalfWidth: 0.0108 }
    );
    trailSet.depthOccluder.dispose();
    const trailMat = trailSet.crayonRibbon;
    disposableMats.push(trailMat);
    allDynamicMats.push(trailMat);

    const trailGeom = buildCrayonRibbonGeometry(
      [{ pts: trailPts, widthScale: 1.05, continuousT: true, drawOrder: 0 }],
      9100 + idx * 71
    );
    disposableGeoms.push(trailGeom);
    const trailMesh = new THREE.Mesh(trailGeom, trailMat);
    trailMesh.renderOrder = 3;
    rackNode.add(trailMesh);

    // Tiny ignition spark flash right on the front grid cell when rocket shoots out!
    const muzzleFlash = new THREE.Group();
    muzzleFlash.position.set(sx, sy, sz + 0.015);
    const flashStrokes: CrayonPolyline[] = [
      { pts: [[-0.045, 0, 0], [0.045, 0, 0]], widthScale: 0.9, continuousT: true, drawOrder: 0 },
      { pts: [[0, -0.045, 0], [0, 0.045, 0]], widthScale: 0.9, continuousT: true, drawOrder: 0 },
      { pts: [[-0.032, -0.032, 0.01], [0.032, 0.032, 0.01]], widthScale: 0.78, continuousT: true, drawOrder: 0 },
    ];
    const flashGeom = buildCrayonRibbonGeometry(flashStrokes, 9250 + idx * 43);
    disposableGeoms.push(flashGeom);
    const flashMesh = new THREE.Mesh(flashGeom, rackMats.crayonRibbon);
    flashMesh.renderOrder = 3;
    muzzleFlash.add(flashMesh);
    rackNode.add(muzzleFlash);

    // 3D Starburst Bloom at the end of the rocket trajectory
    const burstGroup = new THREE.Group();
    burstGroup.position.set(p3[0], p3[1], p3[2]);
    rackNode.add(burstGroup);

    const burstSet = createHollowBlackCrayonMaterials(
      opts.seed + 19.3 + idx * 5.9,
      disposableGeoms,
      { ribbonHalfWidth: 0.01 }
    );
    burstSet.depthOccluder.dispose();
    const burstMat = burstSet.crayonRibbon;
    disposableMats.push(burstMat);
    allDynamicMats.push(burstMat);

    const rayStrokes: CrayonPolyline[] = [];
    for (let r = 0; r < spec.rayCount; r++) {
      const az = (r / spec.rayCount) * Math.PI * 2 + (rng() - 0.5) * 0.28;
      const elev = (rng() - 0.35) * 0.85;
      const len = spec.burstRadius * (0.66 + rng() * 0.42);
      const dx = Math.cos(az) * Math.cos(elev);
      const dy = Math.sin(az) * Math.cos(elev);
      const dz = Math.sin(elev) * 0.65;

      const r0 = 0.03;
      const midR = r0 + len * 0.55;
      const endR = r0 + len;
      rayStrokes.push({
        pts: [
          [dx * r0, dy * r0, dz * r0],
          [dx * midR, dy * midR + 0.02, dz * midR],
          [dx * endR, dy * endR - 0.028, dz * endR],
        ],
        widthScale: 0.86 + rng() * 0.32,
        continuousT: true,
        drawOrder: 0,
      });

      if (r % 2 === 0) {
        const ax = dx * (endR + 0.055);
        const ay = dy * (endR + 0.055) - 0.02;
        const azp = dz * (endR + 0.055);
        const dLen = 0.028;
        rayStrokes.push({
          pts: [[ax - dLen, ay, azp], [ax + dLen, ay, azp]],
          widthScale: 0.76,
          continuousT: true,
          drawOrder: 0,
        });
        rayStrokes.push({
          pts: [[ax, ay - dLen, azp], [ax, ay + dLen, azp]],
          widthScale: 0.76,
          continuousT: true,
          drawOrder: 0,
        });
      }
    }

    const burstGeom = buildCrayonRibbonGeometry(rayStrokes, 9400 + idx * 97);
    disposableGeoms.push(burstGeom);
    const burstMesh = new THREE.Mesh(burstGeom, burstMat);
    burstMesh.renderOrder = 3;
    burstGroup.add(burstMesh);

    rockets.push({
      trailMat,
      burstGroup,
      burstMat,
      muzzleFlash,
      cycleSec: spec.cycleSec,
      phaseOffset: spec.phaseOffset,
    });
  });

  return { root, rackNode, rockets, rackMats, allDynamicMats, moonNode };
}

// ===========================================================================
// PUBLIC HANDLE: FULL 4-CORNER 3D BLACK-CRAYON YANSHUI LANDMARKS SCENE
// Supports progressive drawing across `drawProgress ∈ [0..1]` (complete at 80%
// unfold!) while keeping interiors 100% clear so the paper grid shows through!
// ===========================================================================
export interface YanshuiLandmarks3DHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: (width: number, height: number) => void;
  /** `drawProgress`: 0 (blank) -> 1 (100% sketched; mapped from unfold 2% -> 80%) */
  update: (elapsedSec: number, drawProgress: number) => void;
  dispose: () => void;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutCubic(t: number): number {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
}

export function createYanshuiLandmarks3DScene(): YanshuiLandmarks3DHandle {
  const scene = new THREE.Scene();
  const fovDeg = 28;
  const camera = new THREE.PerspectiveCamera(fovDeg, 0.72, 0.1, 60);
  camera.position.set(0, 0, 10.5);
  camera.lookAt(0, 0, 0);

  const disposableGeoms: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [];

  // 1. Top-Right: 鹽水八角樓 (faithful 馬背山牆 + 八角迴廊!)
  const bajiaolou = buildBajiaolou3D(disposableGeoms, disposableMats);
  scene.add(bajiaolou.root);

  // 2. Bottom-Left: 月津港水月橋
  const bridge = buildShuiyueBridge3D(disposableGeoms, disposableMats);
  scene.add(bridge.root);

  // 3. Top-Left: 鹽水蜂炮城 — rockets shooting straight out of front honeycomb grid (+Z)
  //    fanning forward-up, forward-right, and forward-down-right!
  const topLeftBeehive = buildBeehiveFireworkCluster3D(
    {
      seed: 31.4,
      doubleTier: false,
      includeMoon: true,
      baseYaw: 0.36, // Front grid faces slightly right toward open upper sky!
      rocketSpecs: [
        // Rocket 1: shoots forward out of upper-right grid cell -> curves UP into starburst!
        {
          gridNormX: 0.25,
          gridNormY: 0.28,
          ctrlOffset: [-0.05, 0.32, 0.36],
          endOffset: [0.08, 0.62, 0.18],
          burstRadius: 0.3,
          rayCount: 10,
          cycleSec: 2.5,
          phaseOffset: 0.0,
        },
        // Rocket 2: shoots straight forward-right out of middle grid cell!
        {
          gridNormX: 0.15,
          gridNormY: -0.02,
          ctrlOffset: [0.22, 0.08, 0.38],
          endOffset: [0.46, 0.18, 0.2],
          burstRadius: 0.22,
          rayCount: 8,
          cycleSec: 2.5,
          phaseOffset: 0.85,
        },
        // Rocket 3: shoots forward & arcs down-right out of lower grid cell!
        {
          gridNormX: -0.18,
          gridNormY: -0.25,
          ctrlOffset: [0.1, -0.05, 0.36],
          endOffset: [0.28, -0.28, 0.22],
          burstRadius: 0.18,
          rayCount: 7,
          cycleSec: 2.5,
          phaseOffset: 1.65,
        },
      ],
    },
    disposableGeoms,
    disposableMats
  );
  scene.add(topLeftBeehive.root);

  // 4. Bottom-Right: 鹽水蜂炮城 — rockets shooting straight out of front honeycomb grid (+Z)
  //    EXACTLY like user's red-arrow diagram (forward-up, forward-left, forward-down-left, forward-down)!
  const botRightBeehive = buildBeehiveFireworkCluster3D(
    {
      seed: 57.9,
      doubleTier: true,
      includeMoon: false,
      baseYaw: -0.34, // Front grid faces slightly left toward open right/lower-right space!
      rocketSpecs: [
        // Arrow 1: shoots forward out of top-right grid cell -> snakes UP into starburst!
        {
          gridNormX: 0.28,
          gridNormY: 0.3,
          ctrlOffset: [-0.14, 0.36, 0.38],
          endOffset: [-0.04, 0.74, 0.16],
          burstRadius: 0.32,
          rayCount: 11,
          cycleSec: 2.8,
          phaseOffset: 0.15,
        },
        // Arrow 2: shoots out of mid-upper grid cell -> sweeps FORWARD-LEFT!
        {
          gridNormX: 0.08,
          gridNormY: 0.1,
          ctrlOffset: [-0.26, 0.06, 0.4],
          endOffset: [-0.52, 0.28, 0.18],
          burstRadius: 0.22,
          rayCount: 8,
          cycleSec: 2.8,
          phaseOffset: 0.9,
        },
        // Arrow 3: shoots out of center-lower grid cell -> curves FORWARD-DOWN-LEFT!
        {
          gridNormX: -0.05,
          gridNormY: -0.14,
          ctrlOffset: [-0.24, -0.02, 0.4],
          endOffset: [-0.46, -0.34, 0.22],
          burstRadius: 0.19,
          rayCount: 7,
          cycleSec: 2.8,
          phaseOffset: 1.6,
        },
        // Arrow 4: shoots out of bottom-right grid cell -> zips FORWARD-DOWN!
        {
          gridNormX: 0.26,
          gridNormY: -0.28,
          ctrlOffset: [-0.08, -0.16, 0.38],
          endOffset: [-0.18, -0.44, 0.24],
          burstRadius: 0.17,
          rayCount: 6,
          cycleSec: 2.8,
          phaseOffset: 2.2,
        },
      ],
    },
    disposableGeoms,
    disposableMats
  );
  scene.add(botRightBeehive.root);

  let visHalfH = 10.5 * Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));
  let visHalfW = visHalfH * 0.72;

  const resize = (width: number, height: number) => {
    const aspect = Math.max(0.45, width / Math.max(1, height));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    visHalfH = camera.position.z * Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));
    visHalfW = visHalfH * aspect;
  };

  const animateBeehive = (
    cluster: BeehiveFireworkBuilt,
    elapsedSec: number,
    phaseBase: number,
    baseYaw: number,
    rackDrawP: number,
    fireworkDrawP: number
  ) => {
    cluster.rackMats.depthOccluder.uniforms.uTime.value = elapsedSec;
    cluster.rackMats.crayonRibbon.uniforms.uTime.value = elapsedSec;
    cluster.rackMats.crayonRibbon.uniforms.uDrawProgress.value = rackDrawP;

    for (const m of cluster.allDynamicMats) {
      m.uniforms.uTime.value = elapsedSec;
      m.uniforms.uDrawProgress.value = fireworkDrawP;
    }

    cluster.rackNode.rotation.y =
      baseYaw + Math.sin(elapsedSec * 0.55 + phaseBase) * 0.16;
    cluster.rackNode.rotation.x =
      0.14 + Math.cos(elapsedSec * 0.7 + phaseBase) * 0.04;

    if (cluster.moonNode) {
      cluster.moonNode.rotation.y = Math.sin(elapsedSec * 0.65) * 0.34;
      cluster.moonNode.rotation.z = Math.cos(elapsedSec * 0.5) * 0.12;
      cluster.moonNode.position.y = 0.5 + Math.sin(elapsedSec * 1.1) * 0.03;
    }

    // Rockets begin bursting out of the front honeycomb grid once the rack is sketched!
    const rocketsLive = fireworkDrawP > 0.05;
    for (const rk of cluster.rockets) {
      if (!rocketsLive) {
        rk.trailMat.uniforms.uRevealStart.value = 0;
        rk.trailMat.uniforms.uRevealEnd.value = 0;
        rk.burstGroup.visible = false;
        rk.muzzleFlash.visible = false;
        continue;
      }

      const cyc = ((elapsedSec + rk.phaseOffset) % rk.cycleSec) / rk.cycleSec;

      // Rocket shoots rapidly out of front grid cell (0.00 -> 0.44)
      const launchHead = clamp01(cyc / 0.42);
      const launchTail = clamp01((cyc - 0.17) / 0.42);
      rk.trailMat.uniforms.uRevealStart.value = launchTail;
      rk.trailMat.uniforms.uRevealEnd.value = launchHead;

      // Muzzle spark flash right on the front grid cell during initial ignition (0.00 -> 0.18)
      if (cyc < 0.18) {
        rk.muzzleFlash.visible = true;
        const flashP = Math.sin((cyc / 0.18) * Math.PI);
        rk.muzzleFlash.scale.setScalar(0.55 + flashP * 0.85);
        rk.muzzleFlash.rotation.z = elapsedSec * 5.0 + rk.phaseOffset;
      } else {
        rk.muzzleFlash.visible = false;
      }

      // Starburst bloom at trajectory tip (0.34 -> 0.90)
      const burstT = clamp01((cyc - 0.34) / 0.56);
      if (burstT > 0.01 && burstT < 0.99) {
        rk.burstGroup.visible = true;
        const bloomIn = 1 - Math.pow(1 - clamp01(burstT / 0.42), 3);
        rk.burstGroup.scale.setScalar(0.24 + bloomIn * 0.86);
        rk.burstGroup.rotation.y = elapsedSec * 0.35 + rk.phaseOffset;
        rk.burstGroup.rotation.z = Math.sin(elapsedSec * 0.5 + rk.phaseOffset) * 0.16;

        const rayStart = clamp01((burstT - 0.46) / 0.54);
        const rayEnd = clamp01(burstT / 0.36);
        rk.burstMat.uniforms.uRevealStart.value = rayStart;
        rk.burstMat.uniforms.uRevealEnd.value = rayEnd;
      } else {
        rk.burstGroup.visible = false;
      }
    }
  };

  const update = (elapsedSec: number, drawProgress: number) => {
    const dp = clamp01(drawProgress);
    const unitScale = Math.min(visHalfW, visHalfH * 0.78) * 0.62;

    // Staggered progressive sketch windows across drawProgress ∈ [0..1]
    // (Mapped from Z-Fold unfold 2% -> 80%, so ALL 4 landmarks are 100% drawn by 80%!)
    const bridgeDraw = easeOutCubic(clamp01(dp / 0.72));
    const archDraw = easeOutCubic(clamp01((dp - 0.1) / 0.74));
    const topRackDraw = easeOutCubic(clamp01((dp - 0.18) / 0.66));
    const topFwDraw = clamp01((dp - 0.52) / 0.48);
    const botRackDraw = easeOutCubic(clamp01((dp - 0.22) / 0.64));
    const botFwDraw = clamp01((dp - 0.55) / 0.45);

    // --- 1. Top-Right: 鹽水八角樓 (faithful 馬背山牆 + 八角迴廊!) ---
    bajiaolou.root.visible = archDraw > 0.005;
    bajiaolou.root.position.set(visHalfW * 0.5, visHalfH * 0.47, 0);
    bajiaolou.root.scale.setScalar(unitScale * 0.9);
    // Iconic 3/4 view matching Photos 1 & 4 so both 馬背山牆 and chamfered veranda shine!
    bajiaolou.root.rotation.set(
      0.16 + Math.sin(elapsedSec * 0.52) * 0.035,
      0.52 + Math.sin(elapsedSec * 0.42) * 0.14,
      Math.cos(elapsedSec * 0.36) * 0.02
    );
    bajiaolou.lanterns.forEach((l, i) => {
      l.rotation.z = Math.sin(elapsedSec * 2.1 + i * 0.9) * 0.14;
    });
    bajiaolou.mats.depthOccluder.uniforms.uTime.value = elapsedSec;
    bajiaolou.mats.crayonRibbon.uniforms.uTime.value = elapsedSec;
    bajiaolou.mats.crayonRibbon.uniforms.uDrawProgress.value = archDraw;

    // --- 2. Bottom-Left: 月津港水月橋 ---
    bridge.root.visible = bridgeDraw > 0.005;
    bridge.root.position.set(-visHalfW * 0.35, -visHalfH * 0.48, 0);
    bridge.root.scale.setScalar(unitScale * 0.9);
    bridge.root.rotation.set(
      0.2 + Math.cos(elapsedSec * 0.46) * 0.04,
      -0.36 + Math.sin(elapsedSec * 0.38 + 1.1) * 0.14,
      Math.sin(elapsedSec * 0.34) * 0.018
    );
    bridge.waterWaves.forEach((w, i) => {
      w.position.x = Math.sin(elapsedSec * (1.25 + i * 0.25) + i * 1.4) * 0.055;
      w.position.y = Math.cos(elapsedSec * (1.5 + i * 0.2) + i) * 0.012;
    });
    bridge.mats.depthOccluder.uniforms.uTime.value = elapsedSec;
    bridge.mats.crayonRibbon.uniforms.uTime.value = elapsedSec;
    bridge.mats.crayonRibbon.uniforms.uDrawProgress.value = bridgeDraw;

    // --- 3. Top-Left: 鹽水蜂炮城 ---
    topLeftBeehive.root.visible = topRackDraw > 0.005;
    topLeftBeehive.root.position.set(-visHalfW * 0.57, visHalfH * 0.36, 0);
    topLeftBeehive.root.scale.setScalar(unitScale * 0.94);
    animateBeehive(topLeftBeehive, elapsedSec, 0.2, 0.36, topRackDraw, topFwDraw);

    // --- 4. Bottom-Right: 鹽水蜂炮城 ---
    botRightBeehive.root.visible = botRackDraw > 0.005;
    botRightBeehive.root.position.set(visHalfW * 0.56, -visHalfH * 0.56, 0);
    botRightBeehive.root.scale.setScalar(unitScale * 0.94);
    animateBeehive(botRightBeehive, elapsedSec, 1.8, -0.34, botRackDraw, botFwDraw);
  };

  const dispose = () => {
    disposableGeoms.forEach((g) => g.dispose());
    disposableMats.forEach((m) => m.dispose());
  };

  return { scene, camera, resize, update, dispose };
}
