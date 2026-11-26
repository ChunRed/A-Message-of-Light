import * as THREE from "three";
import { createSeededRng } from "@/lib/hand-drawn-utils";

/**
 * ============================================================================
 * 3D HAND-DRAWN INK-LINE DOODLE MAILBOXES & MINI LETTERS DIORAMA
 * ----------------------------------------------------------------------------
 * Inspired directly by minimalist monochrome pen-and-ink doodle illustrations:
 *  - NO heavy color fills: pure 100% opaque warm paper-white hidden-line fill
 *    (#FDFCF9) + crisp hand-drawn charcoal ink outlines (#222220) + subtle
 *    noise-driven pen-hatch ticks ONLY in deep shadow crevices.
 *  - Custom GLSL hand-drawn brush shaders using Simplex Noise, seeded random
 *    jitter, variable pen-nib pressure, natural corner overshoots, and 8 FPS
 *    boiling (`floor(uTime * 8.0) / 8.0`).
 *  - 7 sculptural 3D doodle models surrounding the central Z-Fold letter:
 *      3 Mini Mailboxes:
 *        1) Classic Cylindrical Pillar Postbox (圓筒柱狀郵筒)
 *        2) Rural Arch Barrel Mailbox with Signal Flag (美式拱頂信箱＋旗標)
 *        3) Four-Legged Classic Box Postbox (方形四腳郵筒)
 *      4 Mini Letters / Envelopes:
 *        4) Sealed Back-Flap Envelope (三角封口信封)
 *        5) Open Envelope with Lined Letter Peeking Out (打開露出信紙的信封)
 *        6) 3D Origami Folded Paper Airplane (立體紙飛機)
 *        7) Stamped Postcard with Wavy Postmark (郵票波浪郵戳明信片)
 *  - Unified Camera-Like Orbit: all 7 3D objects sit inside ONE shared
 *    3D world group centered on the foreground Z-Fold letter and rotate
 *    rigidly WITH it (like orbiting a camera around the scene, NEVER spinning
 *    individually!).
 * ============================================================================
 */

const GLSL_NOISE = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

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

mat2 rot2d(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}
`;

// ---------------------------------------------------------------------------
// 1. OPAQUE PAPER-WHITE HIDDEN-LINE SURFACE SHADER WITH GRAINY CRAYON SHADING
//    Pure warm paper fill (#FDFCF9) so objects read as delicate colored-pencil
//    / wax-crayon doodles with real 3D occlusion & soft grainy shadow tooth!
// ---------------------------------------------------------------------------
const DOODLE_PAPER_VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;

varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec2 vHatchPlane;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;

  // Gentle 8 FPS organic hand-drawn wobble on surface vertices
  float w = snoise(position.xy * 5.2 + vec2(position.z * 4.4, boilTime * 1.9 + uSeed));
  vec3 pos = position + normal * (w * 0.004);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vLocalPos = position;

  vec3 vRight = normalize(vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]));
  vec3 vUp    = normalize(vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]));
  vHatchPlane = vec2(dot(position, vRight), dot(position, vUp));

  gl_Position = projectionMatrix * mvPos;
}
`;

const DOODLE_PAPER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uLightDir;
uniform vec3 uPaperColor;
uniform vec3 uInkColor;

varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec2 vHatchPlane;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;
  vec3 N = normalize(vWorldNormal);
  float ndotl = dot(N, normalize(uLightDir));

  // Pure warm paper-white base (100% opaque, no flat heavy color fill)
  vec3 col = uPaperColor;

  // Cotton paper tooth micro-variation
  vec2 toothPx = floor(gl_FragCoord.xy * 0.8);
  float toothSpeck = hash21(toothPx + vec2(boilTime * 7.3, uSeed * 5.1));
  float paperGrain = snoise(gl_FragCoord.xy * 0.42 + vec2(boilTime * 2.1, uSeed * 3.0));
  col += vec3(paperGrain * 0.008);

  // Soft grainy colored-pencil / wax-crayon shadow strokes ONLY in deep shadow crevices
  vec2 hCoord = rot2d(0.62) * vHatchPlane;
  float hatchWobble = snoise(vec2(hCoord.x * 4.0 + uSeed, hCoord.y * 2.0 + boilTime * 1.1)) * 0.018;
  float linePhase = fract((hCoord.y + hatchWobble) * 19.0);
  float isCrayonBand = 1.0 - smoothstep(0.12, 0.34, abs(linePhase - 0.5));

  float strokeBreak = snoise(vec2(hCoord.x * 4.8 + uSeed * 1.7, floor((hCoord.y + hatchWobble) * 19.0) * 1.3 + boilTime * 0.6));
  float shadowMask = smoothstep(-0.12, -0.52, ndotl + strokeBreak * 0.14);

  // Granular colored-pencil tooth speckle inside shaded bands
  float crayonTooth = smoothstep(0.32, 0.78, toothSpeck * 0.62 + (0.5 + 0.5 * paperGrain) * 0.38);
  float shadeAmt = isCrayonBand * shadowMask * smoothstep(-0.12, 0.36, strokeBreak) * crayonTooth;
  col = mix(col, uInkColor, shadeAmt * 0.55);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// 2. COLORED-PENCIL / WAX-CRAYON SILHOUETTE SHADER (THREE.BackSide, 100% OPAQUE)
//    Soft muted #999999 strokes with gritty paper-tooth grain inside the line,
//    uneven wax pressure, crooked hand jitter, and 8 FPS boiling!
// ---------------------------------------------------------------------------
const DOODLE_OUTLINE_VERT = /* glsl */ `
attribute vec3 aSmoothNormal;

uniform float uTime;
uniform float uSeed;
uniform float uOutlineWidth;

varying vec3 vLocalPos;
varying float vPressure;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;

  // Soft blunt wax-crayon pressure & crooked hand jitter from Simplex Noise
  float press = snoise(position.xy * 5.8 + vec2(position.z * 4.9, boilTime * 2.0 + uSeed));
  float wobble = snoise(position.yz * 8.2 + vec2(position.x * 6.5, boilTime * 2.4 - uSeed));

  float widthMult = 0.8 + 0.42 * (0.5 + 0.5 * press);
  vec3 extrudeDir = normalize(aSmoothNormal);
  vec3 pos = position + extrudeDir * (uOutlineWidth * widthMult) + normal * (wobble * 0.0028);

  vLocalPos = position;
  vPressure = press;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const DOODLE_OUTLINE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uPaperColor;
uniform vec3 uInkColor;

varying vec3 vLocalPos;
varying float vPressure;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;

  // Dual-scale paper-tooth grain (colored pencil / wax crayon speckles inside stroke!)
  vec2 toothPx = floor(gl_FragCoord.xy * 0.85);
  float fineGrain = hash21(toothPx + vec2(boilTime * 11.7, uSeed * 4.3));
  float medGrain = 0.5 + 0.5 * snoise(gl_FragCoord.xy * 0.34 + vec2(boilTime * 2.3, uSeed * 1.9));
  float objGrain = 0.5 + 0.5 * snoise(vLocalPos.xy * 26.0 + vec2(vLocalPos.z * 23.0, boilTime * 1.6 + uSeed));
  float waxGrain = fineGrain * 0.44 + medGrain * 0.34 + objGrain * 0.22;

  // Scatter natural cotton-paper tooth pores through the crayon silhouette (100% opaque!)
  float poreCutoff = 0.24 - vPressure * 0.07;
  if (waxGrain < poreCutoff) {
    discard;
  }

  // Modulate pigment density between dusty paper highlight & #999999 crayon tone
  float pigment = smoothstep(poreCutoff, 0.78, waxGrain);
  vec3 col = mix(mix(uPaperColor, uInkColor, 0.46), uInkColor, pigment);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// 3. COLORED-PENCIL / WAX-CRAYON RIBBON SHADER (BLUNT ENDS + INTERNAL GRAIN)
//    Draws blunt-ended (never pointed!) #999999 crayon/pencil strokes filled
//    with crumbly paper-tooth grain & 8 FPS hand-drawn boiling!
// ---------------------------------------------------------------------------
const DOODLE_INK_RIBBON_VERT = /* glsl */ `
attribute vec3 aTangent;
attribute float aSide;
attribute float aStrokeT;
attribute float aStrokeSeed;
attribute float aWidthScale;

uniform float uTime;
uniform float uSeed;
uniform float uBaseHalfWidth;

varying float vStrokeT;
varying float vSide;
varying float vStrokeSeed;
varying float vBrushNoise;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;
  float sId = aStrokeSeed + uSeed;

  // Hand-drawn crayon tremor + organic curve wobble at 8 FPS
  float jx = snoise(vec2(aStrokeT * 3.8 + sId, boilTime * 2.1));
  float jy = snoise(vec2(aStrokeT * 3.8 - sId, boilTime * 2.1 + 17.3));
  float jz = snoise(vec2(aStrokeT * 3.2 + sId * 0.7, boilTime * 1.9 + 31.1));
  vec3 localPos = position + vec3(jx, jy, jz) * 0.0052;

  vec4 mvPos = modelViewMatrix * vec4(localPos, 1.0);
  vec3 mvTan = normalize(mat3(modelViewMatrix) * aTangent);
  vec3 viewDir = normalize(-mvPos.xyz);
  vec3 rawPerp = cross(viewDir, mvTan);
  float perpLen = length(rawPerp);
  vec3 perp = perpLen > 1e-4 ? (rawPerp / perpLen) : vec3(1.0, 0.0, 0.0);

  // BLUNT colored-pencil / wax-crayon stroke width (NO sharp tapered needle tips!)
  // Keeps full rounded blunt width right to both ends with gentle hand pressure variation.
  float bluntEnd = 0.86 + 0.14 * smoothstep(0.0, 0.06, aStrokeT) * smoothstep(1.0, 0.94, aStrokeT);
  float crayonPress = 0.82 + 0.34 * (0.5 + 0.5 * snoise(vec2(aStrokeT * 4.8 + sId, boilTime * 1.7)));

  // Pull ribbon minutely toward camera so front crayon strokes never z-fight paper surface
  mvPos.z += 0.008;
  mvPos.xyz += perp * (aSide * uBaseHalfWidth * aWidthScale * bluntEnd * crayonPress);

  vStrokeT = aStrokeT;
  vSide = aSide;
  vStrokeSeed = sId;
  vBrushNoise = crayonPress;
  gl_Position = projectionMatrix * mvPos;
}
`;

const DOODLE_INK_RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uPaperColor;
uniform vec3 uInkColor;

varying float vStrokeT;
varying float vSide;
varying float vStrokeSeed;
varying float vBrushNoise;

${GLSL_NOISE}

void main() {
  float boilTime = floor(uTime * 8.0) / 8.0;

  // Dual-scale paper-tooth grain inside every crayon / colored-pencil stroke!
  vec2 toothPx = floor(gl_FragCoord.xy * 0.85);
  float fineGrain = hash21(toothPx + vec2(boilTime * 12.1, vStrokeSeed * 3.7));
  float medGrain = 0.5 + 0.5 * snoise(gl_FragCoord.xy * 0.36 + vec2(boilTime * 2.2, vStrokeSeed));
  float strokeGrain = 0.5 + 0.5 * snoise(vec2(vStrokeT * 18.0 + vStrokeSeed * 2.3, vSide * 5.5 + boilTime * 1.5));
  float waxGrain = fineGrain * 0.46 + medGrain * 0.32 + strokeGrain * 0.22;

  // Softly rounded blunt endcap grain (chalky blunt tip, never pointed!)
  float endDist = min(vStrokeT, 1.0 - vStrokeT);
  float bluntCapMask = smoothstep(0.0, 0.045, endDist);
  float edgeDist = abs(vSide);

  // Crumbly dry-crayon outer edges + internal cotton-paper tooth speckles
  float edgeCrumb = smoothstep(0.46, 1.0, edgeDist) * 0.56;
  float endCrumb = (1.0 - bluntCapMask) * (edgeDist * edgeDist) * 0.65;
  float cutoff = 0.19 + edgeCrumb + endCrumb - (vBrushNoise - 0.95) * 0.12;

  if (waxGrain < cutoff) {
    discard;
  }

  // Dusty colored-pencil pigment density variation inside the stroke
  float pigment = smoothstep(cutoff, 0.82, waxGrain);
  vec3 col = mix(mix(uPaperColor, uInkColor, 0.44), uInkColor, pigment);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// GEOMETRY BUILDERS & HAND-INK POLYLINE RIBBON GENERATOR
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

interface InkPolyline {
  pts: [number, number, number][];
  widthScale?: number;
  overshoot?: number;
}

/**
 * Converts a set of hand-drawn 3D polylines into one batched, camera-facing,
 * jittered, tapered ink-brush ribbon geometry (supports slight human corner
 * overshoots & organic mid-stroke waviness!).
 */
function buildHandInkRibbonGeometry(
  polylines: InkPolyline[],
  baseSeed: number
): THREE.BufferGeometry {
  const rng = createSeededRng(baseSeed);
  const positions: number[] = [];
  const tangents: number[] = [];
  const sides: number[] = [];
  const strokeTs: number[] = [];
  const strokeSeeds: number[] = [];
  const widthScales: number[] = [];
  const indices: number[] = [];

  let baseVert = 0;
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const perpA = new THREE.Vector3();
  const perpB = new THREE.Vector3();
  const curr = new THREE.Vector3();

  for (let li = 0; li < polylines.length; li++) {
    const poly = polylines[li];
    if (poly.pts.length < 2) continue;
    const wScale = poly.widthScale ?? 1.0;
    const ov = poly.overshoot ?? 0.008;

    // Emit each straight segment as a subtly subdivided, hand-wobbled ink stroke
    for (let seg = 0; seg < poly.pts.length - 1; seg++) {
      pA.set(poly.pts[seg][0], poly.pts[seg][1], poly.pts[seg][2]);
      pB.set(poly.pts[seg + 1][0], poly.pts[seg + 1][1], poly.pts[seg + 1][2]);
      dir.copy(pB).sub(pA);
      const len = dir.length();
      if (len < 1e-4) continue;
      dir.divideScalar(len);

      // Slight organic hand overshoot at endpoints
      const startPt = pA.clone().addScaledVector(dir, -ov * (0.4 + rng() * 0.8));
      const endPt = pB.clone().addScaledVector(dir, ov * (0.4 + rng() * 0.8));

      // Construct orthogonal wobble axes
      const refUp =
        Math.abs(dir.y) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, 1, 0);
      perpA.crossVectors(dir, refUp).normalize();
      perpB.crossVectors(dir, perpA).normalize();

      const bowA = (rng() - 0.5) * Math.min(0.016, len * 0.045);
      const bowB = (rng() - 0.5) * Math.min(0.012, len * 0.035);
      const subSteps = Math.max(3, Math.min(7, Math.ceil(len / 0.08)));
      const strokeSeed = (li * 13.7 + seg * 5.3 + rng() * 11.0) % 97.0;

      for (let s = 0; s <= subSteps; s++) {
        const t = s / subSteps;
        curr.copy(startPt).lerp(endPt, t);
        const arch = Math.sin(t * Math.PI);
        const micro = (rng() - 0.5) * 0.004 * arch;
        curr.addScaledVector(perpA, bowA * arch + micro);
        curr.addScaledVector(perpB, bowB * arch);

        for (const side of [-1, 1]) {
          positions.push(curr.x, curr.y, curr.z);
          tangents.push(dir.x, dir.y, dir.z);
          sides.push(side);
          strokeTs.push(t);
          strokeSeeds.push(strokeSeed);
          widthScales.push(wScale);
        }

        if (s < subSteps) {
          const v0 = baseVert + s * 2;
          const v1 = v0 + 1;
          const v2 = v0 + 2;
          const v3 = v0 + 3;
          indices.push(v0, v1, v2, v2, v1, v3);
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
  geom.setIndex(indices);
  return geom;
}

const NOOP_RAYCAST = () => {};

interface DoodleMaterials {
  paperSurface: THREE.ShaderMaterial;
  inkOutline: THREE.ShaderMaterial;
  inkRibbon: THREE.ShaderMaterial;
}

function createDoodleMaterialSet(seed: number): DoodleMaterials {
  const lightDir = new THREE.Vector3(-0.55, 0.72, 0.6).normalize();
  const paperCol = new THREE.Color("#FDFCF9");
  // Muted 0x999999 colored-pencil / wax-crayon gray so background doodles stay subtle
  const inkCol = new THREE.Color(0x999999);

  const paperSurface = new THREE.ShaderMaterial({
    vertexShader: DOODLE_PAPER_VERT,
    fragmentShader: DOODLE_PAPER_FRAG,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uLightDir: { value: lightDir },
      uPaperColor: { value: paperCol },
      uInkColor: { value: inkCol },
    },
  });

  const inkOutline = new THREE.ShaderMaterial({
    vertexShader: DOODLE_OUTLINE_VERT,
    fragmentShader: DOODLE_OUTLINE_FRAG,
    side: THREE.BackSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uOutlineWidth: { value: 0.0155 },
      uPaperColor: { value: paperCol },
      uInkColor: { value: inkCol },
    },
  });

  const inkRibbon = new THREE.ShaderMaterial({
    vertexShader: DOODLE_INK_RIBBON_VERT,
    fragmentShader: DOODLE_INK_RIBBON_FRAG,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed + 4.7 },
      uBaseHalfWidth: { value: 0.0102 },
      uPaperColor: { value: paperCol },
      uInkColor: { value: inkCol },
    },
  });

  return { paperSurface, inkOutline, inkRibbon };
}

// ===========================================================================
// 7 DISTINCT 3D DOODLE MODELS (3 MINI MAILBOXES + 4 MINI LETTERS/ENVELOPES)
// ===========================================================================

function addPaperPart(
  parent: THREE.Group,
  geom: THREE.BufferGeometry,
  mats: DoodleMaterials,
  pos: [number, number, number],
  rot?: [number, number, number],
  withOutline = true
) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  if (rot) g.rotation.set(rot[0], rot[1], rot[2]);

  const m = new THREE.Mesh(geom, mats.paperSurface);
  m.raycast = NOOP_RAYCAST;
  g.add(m);

  if (withOutline) {
    const o = new THREE.Mesh(geom, mats.inkOutline);
    o.raycast = NOOP_RAYCAST;
    g.add(o);
  }
  parent.add(g);
}

/** 1. Classic Cylindrical Pillar Postbox (Image 2 top-center!) */
function buildPillarPostbox(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const body = attachSmoothNormals(new THREE.CylinderGeometry(0.16, 0.165, 0.56, 16, 2));
  const cap = attachSmoothNormals(new THREE.CylinderGeometry(0.11, 0.21, 0.09, 16, 1));
  const collar = attachSmoothNormals(new THREE.CylinderGeometry(0.185, 0.185, 0.04, 16, 1));
  const foot = attachSmoothNormals(new THREE.CylinderGeometry(0.18, 0.2, 0.09, 16, 1));
  disposableGeoms.push(body, cap, collar, foot);

  addPaperPart(grp, body, mats, [0, 0, 0]);
  addPaperPart(grp, cap, mats, [0, 0.32, 0]);
  addPaperPart(grp, collar, mats, [0, 0.26, 0]);
  addPaperPart(grp, foot, mats, [0, -0.31, 0]);

  const zF = 0.168;
  const strokes: InkPolyline[] = [
    // Curved front mail slot slit (bold!)
    { pts: [[-0.085, 0.17, zF], [0, 0.178, zF + 0.008], [0.085, 0.17, zF]], widthScale: 1.5 },
    // Small front nameplate box
    {
      pts: [
        [-0.065, 0.08, zF],
        [0.065, 0.08, zF],
        [0.065, -0.02, zF],
        [-0.065, -0.02, zF],
        [-0.065, 0.08, zF],
      ],
      widthScale: 0.85,
    },
    // Tiny text lines inside plate
    { pts: [[-0.04, 0.045, zF + 0.004], [0.04, 0.045, zF + 0.004]], widthScale: 0.65 },
    { pts: [[-0.032, 0.012, zF + 0.004], [0.032, 0.012, zF + 0.004]], widthScale: 0.65 },
    // Collar & base decorative hand-sketched seam rings
    { pts: [[-0.175, 0.24, 0.05], [0, 0.23, 0.19], [0.175, 0.24, 0.05]], widthScale: 0.9 },
    { pts: [[-0.18, -0.265, 0.05], [0, -0.275, 0.19], [0.18, -0.265, 0.05]], widthScale: 0.95 },
    // Short sketchy vertical shading ribs on foot (Image 2 pillar postbox detail!)
    { pts: [[-0.12, -0.28, 0.14], [-0.125, -0.345, 0.15]], widthScale: 0.7 },
    { pts: [[-0.05, -0.285, 0.18], [-0.052, -0.35, 0.19]], widthScale: 0.7 },
    { pts: [[0.06, -0.285, 0.18], [0.062, -0.35, 0.19]], widthScale: 0.7 },
    { pts: [[0.13, -0.28, 0.14], [0.135, -0.345, 0.15]], widthScale: 0.7 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 2. Rural Arch Barrel Mailbox with Raised Signal Flag (Image 2 top-left!) */
function buildRuralFlagMailbox(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const w = 0.28;
  const hw = w * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -0.1);
  shape.lineTo(hw, -0.1);
  shape.lineTo(hw, 0.08);
  shape.absarc(0, 0.08, hw, 0, Math.PI, false);
  shape.closePath();

  const barrel = new THREE.ExtrudeGeometry(shape, {
    depth: 0.44,
    bevelEnabled: false,
    curveSegments: 14,
  });
  barrel.center();
  attachSmoothNormals(barrel);

  const post = attachSmoothNormals(new THREE.BoxGeometry(0.055, 0.34, 0.055));
  const shelf = attachSmoothNormals(new THREE.BoxGeometry(0.32, 0.032, 0.48));
  const flagArm = attachSmoothNormals(new THREE.BoxGeometry(0.022, 0.22, 0.022));
  const flagTab = attachSmoothNormals(new THREE.BoxGeometry(0.024, 0.07, 0.1));
  disposableGeoms.push(barrel, post, shelf, flagArm, flagTab);

  addPaperPart(grp, barrel, mats, [0, 0.08, 0]);
  addPaperPart(grp, shelf, mats, [0, -0.1, 0]);
  addPaperPart(grp, post, mats, [0, -0.28, 0]);

  const flagGrp = new THREE.Group();
  flagGrp.position.set(0.155, 0.06, 0.06);
  flagGrp.rotation.set(-0.22, 0, -0.12);
  addPaperPart(flagGrp, flagArm, mats, [0, 0.1, 0]);
  addPaperPart(flagGrp, flagTab, mats, [0, 0.19, 0.045]);
  grp.add(flagGrp);

  const strokes: InkPolyline[] = [
    // Front door latch handle
    { pts: [[-0.055, 0.15, 0.226], [0.055, 0.15, 0.226]], widthScale: 1.45 },
    // Front arch rim seam
    {
      pts: [
        [-0.135, -0.07, 0.224],
        [-0.135, 0.09, 0.224],
        [-0.08, 0.2, 0.224],
        [0, 0.23, 0.224],
        [0.08, 0.2, 0.224],
        [0.135, 0.09, 0.224],
        [0.135, -0.07, 0.224],
      ],
      widthScale: 0.9,
    },
    // Side short vertical doodle shading ticks (exact Image 2 rural mailbox style!)
    { pts: [[0.145, 0.13, -0.14], [0.145, 0.02, -0.14]], widthScale: 0.65 },
    { pts: [[0.145, 0.12, -0.06], [0.145, 0.03, -0.06]], widthScale: 0.65 },
    { pts: [[0.145, 0.11, 0.14], [0.145, 0.01, 0.14]], widthScale: 0.65 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 3. Classic Four-Legged Arch-Top Street Postbox (Image 2 bottom-left!) */
function buildFourLeggedPostbox(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const w = 0.36;
  const hw = w * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -0.2);
  shape.lineTo(hw, -0.2);
  shape.lineTo(hw, 0.16);
  shape.quadraticCurveTo(0, 0.28, -hw, 0.16);
  shape.closePath();

  const body = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28,
    bevelEnabled: false,
    curveSegments: 10,
  });
  body.center();
  attachSmoothNormals(body);

  const leg = attachSmoothNormals(new THREE.BoxGeometry(0.065, 0.11, 0.065));
  disposableGeoms.push(body, leg);

  addPaperPart(grp, body, mats, [0, 0.03, 0]);
  addPaperPart(grp, leg, mats, [-0.14, -0.23, 0.1]);
  addPaperPart(grp, leg, mats, [0.14, -0.23, 0.1]);
  addPaperPart(grp, leg, mats, [-0.14, -0.23, -0.1]);
  addPaperPart(grp, leg, mats, [0.14, -0.23, -0.1]);

  const zF = 0.146;
  const strokes: InkPolyline[] = [
    // Recessed pull-down mail slot box at top
    {
      pts: [
        [-0.12, 0.18, zF],
        [0.12, 0.18, zF],
        [0.12, 0.105, zF],
        [-0.12, 0.105, zF],
        [-0.12, 0.18, zF],
      ],
      widthScale: 0.95,
    },
    { pts: [[-0.075, 0.145, zF + 0.004], [0.075, 0.145, zF + 0.004]], widthScale: 1.4 },
    // Front collection schedule frame + little ink lines
    {
      pts: [
        [-0.095, 0.04, zF],
        [0.095, 0.04, zF],
        [0.095, -0.09, zF],
        [-0.095, -0.09, zF],
        [-0.095, 0.04, zF],
      ],
      widthScale: 0.85,
    },
    { pts: [[-0.06, 0.0, zF + 0.004], [0.06, 0.0, zF + 0.004]], widthScale: 0.68 },
    { pts: [[-0.055, -0.045, zF + 0.004], [0.05, -0.045, zF + 0.004]], widthScale: 0.68 },
    // Crisp front vertical corner sketch ribs
    { pts: [[-0.178, -0.18, zF], [-0.178, 0.14, zF]], widthScale: 0.95 },
    { pts: [[0.178, -0.18, zF], [0.178, 0.14, zF]], widthScale: 0.95 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 4. 3D Sealed Triangular-Flap Envelope (Image 1 top-left & bottom-right!) */
function buildSealedEnvelope(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();
  const w = 0.54;
  const h = 0.35;
  const d = 0.028;
  const body = attachSmoothNormals(new THREE.BoxGeometry(w, h, d, 2, 2, 1));
  disposableGeoms.push(body);
  addPaperPart(grp, body, mats, [0, 0, 0]);

  const hw = w * 0.5;
  const hh = h * 0.5;
  const zF = d * 0.5 + 0.005;
  const zB = -zF;

  const strokes: InkPolyline[] = [
    // Front (+Z): Classic triangular back-flap V + bottom diagonal folds
    { pts: [[-hw + 0.01, hh - 0.01, zF], [0, -0.03, zF], [hw - 0.01, hh - 0.01, zF]], widthScale: 1.05 },
    { pts: [[-hw + 0.01, -hh + 0.01, zF], [-0.07, 0.015, zF]], widthScale: 0.9 },
    { pts: [[hw - 0.01, -hh + 0.01, zF], [0.07, 0.015, zF]], widthScale: 0.9 },
    // Outer jittered ink border on front
    {
      pts: [
        [-hw, -hh, zF],
        [hw, -hh, zF],
        [hw, hh, zF],
        [-hw, hh, zF],
        [-hw, -hh, zF],
      ],
      widthScale: 0.95,
    },
    // Back (-Z): Stamp square + 3 short address lines (visible when camera orbits 180°!)
    {
      pts: [
        [hw - 0.13, hh - 0.04, zB],
        [hw - 0.04, hh - 0.04, zB],
        [hw - 0.04, hh - 0.13, zB],
        [hw - 0.13, hh - 0.13, zB],
        [hw - 0.13, hh - 0.04, zB],
      ],
      widthScale: 0.85,
    },
    { pts: [[-0.14, 0.02, zB], [0.06, 0.02, zB]], widthScale: 0.78 },
    { pts: [[-0.14, -0.035, zB], [0.1, -0.035, zB]], widthScale: 0.78 },
    { pts: [[-0.14, -0.09, zB], [0.04, -0.09, zB]], widthScale: 0.78 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 5. 3D Open Envelope with Lined Letter Peeking Out (Image 1 bottom-left!) */
function buildOpenEnvelopeWithLetter(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();
  const w = 0.48;
  const h = 0.3;
  const d = 0.032;

  const pocket = attachSmoothNormals(new THREE.BoxGeometry(w, h, d, 2, 2, 1));
  const letterSheet = attachSmoothNormals(new THREE.BoxGeometry(w * 0.84, h * 0.86, 0.016, 2, 2, 1));

  // Open triangular top flap hinged upward behind the letter
  const flapShape = new THREE.Shape();
  flapShape.moveTo(-w * 0.5, 0);
  flapShape.lineTo(w * 0.5, 0);
  flapShape.lineTo(0, 0.22);
  flapShape.closePath();
  const flapGeom = new THREE.ExtrudeGeometry(flapShape, {
    depth: 0.014,
    bevelEnabled: false,
  });
  flapGeom.translate(0, 0, -0.007);
  attachSmoothNormals(flapGeom);

  disposableGeoms.push(pocket, letterSheet, flapGeom);

  addPaperPart(grp, pocket, mats, [0, -0.06, 0.012]);
  addPaperPart(grp, letterSheet, mats, [0, 0.08, -0.008], [0, 0, 0.035]);
  addPaperPart(grp, flapGeom, mats, [0, 0.09, -0.025], [-0.18, 0, 0]);

  const hw = w * 0.5;
  const zP = 0.033;
  const zL = 0.005;
  const zBack = -0.022;
  const strokes: InkPolyline[] = [
    // Front pocket V-seam folds
    { pts: [[-hw + 0.01, 0.085, zP], [0, -0.075, zP], [hw - 0.01, 0.085, zP]], widthScale: 1.0 },
    { pts: [[-hw + 0.01, -0.205, zP], [-0.06, -0.04, zP]], widthScale: 0.85 },
    { pts: [[hw - 0.01, -0.205, zP], [0.06, -0.04, zP]], widthScale: 0.85 },
    // Horizontal handwritten ink lines on the peeking letter sheet!
    { pts: [[-0.14, 0.165, zL], [0.14, 0.175, zL]], widthScale: 0.78 },
    { pts: [[-0.14, 0.125, zL], [0.15, 0.135, zL]], widthScale: 0.78 },
    { pts: [[-0.14, 0.085, zL], [0.11, 0.095, zL]], widthScale: 0.78 },
    // Rear side pocket outline & short doodle address ticks (visible on 360° orbit!)
    {
      pts: [
        [-hw + 0.01, -0.205, zBack],
        [hw - 0.01, -0.205, zBack],
        [hw - 0.01, 0.085, zBack],
        [-hw + 0.01, 0.085, zBack],
        [-hw + 0.01, -0.205, zBack],
      ],
      widthScale: 0.85,
    },
    { pts: [[-0.11, -0.03, zBack], [0.11, -0.03, zBack]], widthScale: 0.72 },
    { pts: [[-0.08, -0.085, zBack], [0.09, -0.085, zBack]], widthScale: 0.72 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 6. 3D Origami Folded Paper Airplane (Image 1 middle-left!) */
function buildPaperAirplane(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  // Build authentic 3D folded origami wings + central keel with thin thickness
  const wingLShape = new THREE.Shape();
  wingLShape.moveTo(0.36, 0.0);    // Nose tip
  wingLShape.lineTo(-0.28, 0.22);  // Left wing tip
  wingLShape.lineTo(-0.22, 0.02);  // Inner crease
  wingLShape.closePath();

  const wingRShape = new THREE.Shape();
  wingRShape.moveTo(0.36, 0.0);
  wingRShape.lineTo(-0.22, -0.02);
  wingRShape.lineTo(-0.28, -0.22);
  wingRShape.closePath();

  const keelShape = new THREE.Shape();
  keelShape.moveTo(0.36, 0.0);
  keelShape.lineTo(-0.22, 0.0);
  keelShape.lineTo(-0.26, -0.14);
  keelShape.closePath();

  const extrudeOpts = { depth: 0.014, bevelEnabled: false };
  const wingL = new THREE.ExtrudeGeometry(wingLShape, extrudeOpts);
  wingL.translate(0, 0, -0.007);
  attachSmoothNormals(wingL);

  const wingR = new THREE.ExtrudeGeometry(wingRShape, extrudeOpts);
  wingR.translate(0, 0, -0.007);
  attachSmoothNormals(wingR);

  const keel = new THREE.ExtrudeGeometry(keelShape, extrudeOpts);
  keel.translate(0, 0, -0.007);
  attachSmoothNormals(keel);

  disposableGeoms.push(wingL, wingR, keel);

  // Angle left & right wings into crisp 3D dihedral V + vertical underside keel!
  addPaperPart(grp, wingL, mats, [0, 0, 0], [0.32, 0, 0]);
  addPaperPart(grp, wingR, mats, [0, 0, 0], [-0.32, 0, 0]);
  addPaperPart(grp, keel, mats, [0, 0, 0], [Math.PI * 0.5, 0, 0]);

  const strokes: InkPolyline[] = [
    // Sharp nose-to-tail spine crease & wing outer edges
    { pts: [[0.36, 0, 0.015], [-0.22, 0.01, 0.015]], widthScale: 1.05 },
    { pts: [[0.36, 0, 0.01], [-0.28, 0.21, 0.07]], widthScale: 0.95 },
    { pts: [[0.36, 0, 0.01], [-0.28, -0.21, 0.07]], widthScale: 0.95 },
    { pts: [[0.36, 0, -0.01], [-0.26, 0, -0.14]], widthScale: 0.9 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 7. 3D Stamped Postcard with Wavy Postmark Squiggles (Image 1 center!) */
function buildStampedPostcard(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();
  const w = 0.52;
  const h = 0.34;
  const d = 0.022;
  const card = attachSmoothNormals(new THREE.BoxGeometry(w, h, d, 2, 2, 1));
  disposableGeoms.push(card);
  addPaperPart(grp, card, mats, [0, 0, 0]);

  const hw = w * 0.5;
  const hh = h * 0.5;
  const zF = d * 0.5 + 0.005;
  const zB = -zF;

  const strokes: InkPolyline[] = [
    // Outer jittered ink postcard border
    {
      pts: [
        [-hw, -hh, zF],
        [hw, -hh, zF],
        [hw, hh, zF],
        [-hw, hh, zF],
        [-hw, -hh, zF],
      ],
      widthScale: 0.95,
    },
    // Top-right postage stamp square
    {
      pts: [
        [hw - 0.13, hh - 0.035, zF],
        [hw - 0.035, hh - 0.035, zF],
        [hw - 0.035, hh - 0.13, zF],
        [hw - 0.13, hh - 0.13, zF],
        [hw - 0.13, hh - 0.035, zF],
      ],
      widthScale: 0.95,
    },
    // Wavy cancellation postmark lines next to stamp (Image 1 signature detail!)
    {
      pts: [
        [-0.02, hh - 0.06, zF],
        [0.02, hh - 0.048, zF],
        [0.06, hh - 0.072, zF],
        [0.105, hh - 0.056, zF],
      ],
      widthScale: 0.78,
    },
    {
      pts: [
        [-0.02, hh - 0.095, zF],
        [0.02, hh - 0.083, zF],
        [0.06, hh - 0.107, zF],
        [0.105, hh - 0.091, zF],
      ],
      widthScale: 0.78,
    },
    // Left return-address doodle lines
    { pts: [[-hw + 0.045, hh - 0.06, zF], [-0.07, hh - 0.06, zF]], widthScale: 0.75 },
    { pts: [[-hw + 0.045, hh - 0.1, zF], [-0.09, hh - 0.1, zF]], widthScale: 0.75 },
    // Lower-right recipient address box lines
    { pts: [[-0.02, -0.04, zF], [hw - 0.05, -0.04, zF]], widthScale: 0.8 },
    { pts: [[-0.02, -0.085, zF], [hw - 0.07, -0.085, zF]], widthScale: 0.8 },
    { pts: [[-0.02, -0.125, zF], [hw - 0.11, -0.125, zF]], widthScale: 0.8 },
    // Back (-Z): Classic split postcard divider & doodle note lines (visible on 360° orbit!)
    {
      pts: [
        [-hw, -hh, zB],
        [hw, -hh, zB],
        [hw, hh, zB],
        [-hw, hh, zB],
        [-hw, -hh, zB],
      ],
      widthScale: 0.9,
    },
    { pts: [[0, -hh + 0.04, zB], [0, hh - 0.04, zB]], widthScale: 0.82 },
    { pts: [[-hw + 0.05, 0.06, zB], [-0.04, 0.06, zB]], widthScale: 0.72 },
    { pts: [[-hw + 0.05, 0.0, zB], [-0.06, 0.0, zB]], widthScale: 0.72 },
    { pts: [[-hw + 0.05, -0.06, zB], [-0.08, -0.06, zB]], widthScale: 0.72 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 8. Open-Door Rural Arch Mailbox with Envelopes Spilling Out (Image 7 bottom-center!) */
function buildOpenRuralMailbox(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const w = 0.28;
  const hw = w * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -0.1);
  shape.lineTo(hw, -0.1);
  shape.lineTo(hw, 0.08);
  shape.absarc(0, 0.08, hw, 0, Math.PI, false);
  shape.closePath();

  const barrel = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: false,
    curveSegments: 12,
  });
  barrel.center();
  attachSmoothNormals(barrel);

  // Open front lid folded flat forward (+Z)
  const openDoor = attachSmoothNormals(new THREE.BoxGeometry(0.27, 0.022, 0.24));
  // 2 stacked envelopes peeking out of the open mouth!
  const peekEnvA = attachSmoothNormals(new THREE.BoxGeometry(0.22, 0.024, 0.28));
  const peekEnvB = attachSmoothNormals(new THREE.BoxGeometry(0.21, 0.024, 0.26));
  const post = attachSmoothNormals(new THREE.BoxGeometry(0.052, 0.3, 0.052));
  const flagArm = attachSmoothNormals(new THREE.BoxGeometry(0.02, 0.2, 0.02));
  const flagTab = attachSmoothNormals(new THREE.BoxGeometry(0.022, 0.065, 0.095));

  disposableGeoms.push(barrel, openDoor, peekEnvA, peekEnvB, post, flagArm, flagTab);

  addPaperPart(grp, barrel, mats, [0, 0.08, 0]);
  addPaperPart(grp, openDoor, mats, [0, -0.02, 0.31], [0.14, 0, 0]);
  addPaperPart(grp, peekEnvA, mats, [-0.01, 0.02, 0.23], [0.12, 0.16, 0.06]);
  addPaperPart(grp, peekEnvB, mats, [0.015, 0.06, 0.21], [0.05, -0.14, -0.08]);
  addPaperPart(grp, post, mats, [0, -0.22, -0.02]);

  const flagGrp = new THREE.Group();
  flagGrp.position.set(0.15, 0.05, 0.04);
  flagGrp.rotation.set(-0.18, 0, -0.1);
  addPaperPart(flagGrp, flagArm, mats, [0, 0.095, 0]);
  addPaperPart(flagGrp, flagTab, mats, [0, 0.18, 0.04]);
  grp.add(flagGrp);

  const strokes: InkPolyline[] = [
    // Arch mouth rim & envelope flap V lines peeking out
    {
      pts: [
        [-0.135, -0.02, 0.215],
        [-0.135, 0.1, 0.215],
        [-0.08, 0.2, 0.215],
        [0, 0.225, 0.215],
        [0.08, 0.2, 0.215],
        [0.135, 0.1, 0.215],
        [0.135, -0.02, 0.215],
      ],
      widthScale: 0.95,
    },
    { pts: [[-0.08, 0.075, 0.34], [0.02, 0.072, 0.26], [0.1, 0.068, 0.33]], widthScale: 0.78 },
    { pts: [[0.145, 0.12, -0.12], [0.145, 0.02, -0.12]], widthScale: 0.65 },
    { pts: [[0.145, 0.11, -0.03], [0.145, 0.02, -0.03]], widthScale: 0.65 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 9. Wall-Mounted Rectangular Slanted-Lid MAIL Box (Image 7 center!) */
function buildWallMailbox(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const body = attachSmoothNormals(new THREE.BoxGeometry(0.42, 0.3, 0.18));
  const lid = attachSmoothNormals(new THREE.BoxGeometry(0.46, 0.035, 0.22));
  disposableGeoms.push(body, lid);

  addPaperPart(grp, body, mats, [0, -0.02, 0]);
  addPaperPart(grp, lid, mats, [0, 0.145, 0.015], [0.14, 0, 0]);

  const zF = 0.096;
  const strokes: InkPolyline[] = [
    // Top banner frame + horizontal mail slot
    {
      pts: [
        [-0.17, 0.105, zF],
        [0.17, 0.105, zF],
        [0.17, 0.04, zF],
        [-0.17, 0.04, zF],
        [-0.17, 0.105, zF],
      ],
      widthScale: 0.9,
    },
    { pts: [[-0.1, 0.072, zF + 0.003], [0.1, 0.072, zF + 0.003]], widthScale: 1.1 },
    // Front door panel & keyhole mark
    {
      pts: [
        [-0.14, 0.01, zF],
        [0.14, 0.01, zF],
        [0.14, -0.13, zF],
        [-0.14, -0.13, zF],
        [-0.14, 0.01, zF],
      ],
      widthScale: 0.82,
    },
    { pts: [[0, -0.035, zF + 0.003], [0, -0.075, zF + 0.003]], widthScale: 1.2 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 10. Tall Slim Street Postbox (Image 7 bottom-right!) */
function buildSlimTallPostbox(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const body = attachSmoothNormals(new THREE.BoxGeometry(0.26, 0.62, 0.22));
  const cap = attachSmoothNormals(new THREE.BoxGeometry(0.29, 0.045, 0.25));
  disposableGeoms.push(body, cap);

  addPaperPart(grp, body, mats, [0, 0, 0]);
  addPaperPart(grp, cap, mats, [0, 0.32, 0]);

  const zF = 0.116;
  const strokes: InkPolyline[] = [
    // Bold horizontal top mail slot
    { pts: [[-0.095, 0.2, zF], [0.095, 0.2, zF]], widthScale: 1.55 },
    // Mid label bar
    { pts: [[-0.075, 0.08, zF], [0.075, 0.08, zF]], widthScale: 0.85 },
    // Collection schedule box + 3 time lines
    {
      pts: [
        [-0.075, -0.02, zF],
        [0.075, -0.02, zF],
        [0.075, -0.22, zF],
        [-0.075, -0.22, zF],
        [-0.075, -0.02, zF],
      ],
      widthScale: 0.85,
    },
    { pts: [[-0.045, -0.075, zF + 0.003], [0.045, -0.075, zF + 0.003]], widthScale: 0.7 },
    { pts: [[-0.045, -0.125, zF + 0.003], [0.04, -0.125, zF + 0.003]], widthScale: 0.7 },
    { pts: [[-0.045, -0.175, zF + 0.003], [0.045, -0.175, zF + 0.003]], widthScale: 0.7 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 11. Piled Stack of Hand-Sketched Letters (Image 7 mid-left!) */
function buildLetterStack(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const sheet = attachSmoothNormals(new THREE.BoxGeometry(0.48, 0.028, 0.32));
  disposableGeoms.push(sheet);

  addPaperPart(grp, sheet, mats, [0, -0.055, 0], [0, 0.08, 0]);
  addPaperPart(grp, sheet, mats, [0.02, -0.02, 0.015], [0, -0.12, 0.02]);
  addPaperPart(grp, sheet, mats, [-0.015, 0.018, -0.01], [0, 0.15, -0.02]);
  addPaperPart(grp, sheet, mats, [0.01, 0.055, 0.008], [0, -0.06, 0.015]);

  const yTop = 0.075;
  const strokes: InkPolyline[] = [
    // Top envelope triangular flap lines on top face (+Y)
    { pts: [[-0.22, yTop, -0.14], [0.01, yTop, 0.02], [0.23, yTop, -0.12]], widthScale: 0.9 },
    // Crisp side sheet separation lines
    { pts: [[-0.22, 0.0, 0.17], [0.22, -0.005, 0.17]], widthScale: 0.72 },
    { pts: [[-0.22, -0.038, 0.168], [0.22, -0.036, 0.168]], widthScale: 0.72 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 12. Airmail Diagonal-Striped Border Envelope with Circular Postmark (Image 8 top-center!) */
function buildAirmailEnvelope(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();
  const w = 0.56;
  const h = 0.36;
  const d = 0.024;
  const body = attachSmoothNormals(new THREE.BoxGeometry(w, h, d, 2, 2, 1));
  disposableGeoms.push(body);
  addPaperPart(grp, body, mats, [0, 0, 0]);

  const hw = w * 0.5;
  const hh = h * 0.5;
  const zF = d * 0.5 + 0.005;
  const zB = -zF;

  const strokes: InkPolyline[] = [
    // Inner inset frame creating classic airmail border band
    {
      pts: [
        [-hw + 0.045, -hh + 0.042, zF],
        [hw - 0.045, -hh + 0.042, zF],
        [hw - 0.045, hh - 0.042, zF],
        [-hw + 0.045, hh - 0.042, zF],
        [-hw + 0.045, -hh + 0.042, zF],
      ],
      widthScale: 0.85,
    },
    // Circular postmark ring + wavy cancellation lines
    {
      pts: [
        [0.01, hh - 0.075, zF],
        [0.045, hh - 0.06, zF],
        [0.075, hh - 0.082, zF],
        [0.045, hh - 0.115, zF],
        [0.01, hh - 0.075, zF],
      ],
      widthScale: 0.85,
    },
    {
      pts: [
        [0.085, hh - 0.078, zF],
        [0.125, hh - 0.068, zF],
        [0.165, hh - 0.088, zF],
        [0.2, hh - 0.074, zF],
      ],
      widthScale: 0.72,
    },
    {
      pts: [
        [0.085, hh - 0.105, zF],
        [0.125, hh - 0.095, zF],
        [0.165, hh - 0.115, zF],
        [0.2, hh - 0.101, zF],
      ],
      widthScale: 0.72,
    },
    // Lower-right address lines
    { pts: [[0.03, -0.02, zF], [hw - 0.075, -0.02, zF]], widthScale: 0.75 },
    { pts: [[0.03, -0.065, zF], [hw - 0.09, -0.065, zF]], widthScale: 0.75 },
    { pts: [[0.03, -0.105, zF], [hw - 0.11, -0.105, zF]], widthScale: 0.75 },
    // Back side flap V
    { pts: [[-hw + 0.02, hh - 0.02, zB], [0, -0.02, zB], [hw - 0.02, hh - 0.02, zB]], widthScale: 0.9 },
  ];

  // Diagonal airmail border tick marks along top & bottom edges
  for (let i = 0; i < 7; i++) {
    const x = -hw + 0.06 + (i / 6) * (w - 0.12);
    strokes.push({ pts: [[x - 0.018, hh - 0.038, zF], [x + 0.018, hh - 0.005, zF]], widthScale: 0.72 });
    strokes.push({ pts: [[x - 0.018, -hh + 0.005, zF], [x + 0.018, -hh + 0.038, zF]], widthScale: 0.72 });
  }

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 13. Vertical String-Tie Kraft Document Envelope (Image 8 top-right!) */
function buildStringTieEnvelope(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();
  const w = 0.36;
  const h = 0.5;
  const d = 0.026;

  const body = attachSmoothNormals(new THREE.BoxGeometry(w, h, d, 2, 2, 1));
  const btn = attachSmoothNormals(new THREE.CylinderGeometry(0.028, 0.028, 0.016, 10));
  btn.rotateX(Math.PI * 0.5);
  disposableGeoms.push(body, btn);

  addPaperPart(grp, body, mats, [0, 0, 0]);
  // Two iconic round button-and-string fasteners!
  addPaperPart(grp, btn, mats, [0, 0.185, 0.018]);
  addPaperPart(grp, btn, mats, [0, 0.105, 0.018]);

  const hw = w * 0.5;
  const hh = h * 0.5;
  const zF = d * 0.5 + 0.005;
  const zB = -zF;

  const strokes: InkPolyline[] = [
    // Top trapezoidal closure flap
    {
      pts: [
        [-hw + 0.01, hh - 0.01, zF],
        [-hw + 0.05, hh - 0.085, zF],
        [hw - 0.05, hh - 0.085, zF],
        [hw - 0.01, hh - 0.01, zF],
      ],
      widthScale: 0.95,
    },
    // Figure-8 winding string loop connecting the two buttons!
    { pts: [[-0.015, 0.185, zF + 0.012], [0.015, 0.105, zF + 0.012]], widthScale: 0.85 },
    { pts: [[0.015, 0.185, zF + 0.012], [-0.015, 0.105, zF + 0.012]], widthScale: 0.85 },
    // Bottom fold seam
    {
      pts: [
        [-hw + 0.01, -hh + 0.01, zF],
        [-hw + 0.045, -hh + 0.06, zF],
        [hw - 0.045, -hh + 0.06, zF],
        [hw - 0.01, -hh + 0.01, zF],
      ],
      widthScale: 0.85,
    },
    // Rear document label box
    {
      pts: [
        [-0.09, 0.08, zB],
        [0.09, 0.08, zB],
        [0.09, -0.05, zB],
        [-0.09, -0.05, zB],
        [-0.09, 0.08, zB],
      ],
      widthScale: 0.8,
    },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 14. 3D Rolled Letter Scroll (Image 8 mid-right!) */
function buildRolledScroll(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();

  const tube = attachSmoothNormals(new THREE.CylinderGeometry(0.075, 0.08, 0.56, 14, 2));
  tube.rotateZ(Math.PI * 0.5);
  // Curled outer paper lip extending slightly along the top edge
  const curlLip = attachSmoothNormals(new THREE.BoxGeometry(0.54, 0.02, 0.1));
  disposableGeoms.push(tube, curlLip);

  addPaperPart(grp, tube, mats, [0, 0, 0]);
  addPaperPart(grp, curlLip, mats, [0, 0.065, 0.04], [0.22, 0, 0]);

  const strokes: InkPolyline[] = [
    // Spiral curl on right end cap (+X = 0.285)
    {
      pts: [
        [0.286, 0.065, 0.0],
        [0.286, 0.02, 0.055],
        [0.286, -0.045, 0.03],
        [0.286, -0.03, -0.035],
        [0.286, 0.02, -0.02],
        [0.286, 0.005, 0.015],
      ],
      widthScale: 0.88,
    },
    // Spiral curl on left end cap (-X = -0.285)
    {
      pts: [
        [-0.286, 0.065, 0.0],
        [-0.286, 0.02, 0.055],
        [-0.286, -0.045, 0.03],
        [-0.286, -0.03, -0.035],
        [-0.286, 0.02, -0.02],
      ],
      widthScale: 0.88,
    },
    // Rolled paper overlap seam line along the cylinder length
    { pts: [[-0.26, 0.045, 0.072], [0.26, 0.048, 0.072]], widthScale: 0.92 },
    // Short hatch ticks along curl shadow (Image 8 rolled scroll detail!)
    { pts: [[-0.16, 0.055, 0.07], [-0.14, 0.02, 0.076]], widthScale: 0.65 },
    { pts: [[-0.04, 0.055, 0.07], [-0.02, 0.02, 0.076]], widthScale: 0.65 },
    { pts: [[0.08, 0.055, 0.07], [0.1, 0.02, 0.076]], widthScale: 0.65 },
    { pts: [[0.18, 0.055, 0.07], [0.2, 0.02, 0.076]], widthScale: 0.65 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

/** 15. Open-Flap Empty Envelope with Curved Bottom Fold (Image 8 center-right!) */
function buildOpenEmptyEnvelope(
  mats: DoodleMaterials,
  disposableGeoms: THREE.BufferGeometry[],
  seed: number
): THREE.Group {
  const grp = new THREE.Group();
  const w = 0.5;
  const h = 0.32;
  const d = 0.024;

  const pocket = attachSmoothNormals(new THREE.BoxGeometry(w, h, d, 2, 2, 1));
  const flapShape = new THREE.Shape();
  flapShape.moveTo(-w * 0.5, 0);
  flapShape.lineTo(w * 0.5, 0);
  flapShape.quadraticCurveTo(0.05, 0.2, 0, 0.22);
  flapShape.quadraticCurveTo(-0.05, 0.2, -w * 0.5, 0);
  flapShape.closePath();

  const flap = new THREE.ExtrudeGeometry(flapShape, {
    depth: 0.014,
    bevelEnabled: false,
    curveSegments: 8,
  });
  flap.translate(0, 0, -0.007);
  attachSmoothNormals(flap);

  disposableGeoms.push(pocket, flap);
  addPaperPart(grp, pocket, mats, [0, -0.06, 0]);
  addPaperPart(grp, flap, mats, [0, 0.1, -0.008], [-0.24, 0, 0]);

  const hw = w * 0.5;
  const zF = d * 0.5 + 0.005;
  const zB = -zF;
  const strokes: InkPolyline[] = [
    // Inside envelope pocket diagonal seams & curved bottom flap
    { pts: [[-hw + 0.01, 0.095, zF], [0, -0.065, zF], [hw - 0.01, 0.095, zF]], widthScale: 0.95 },
    {
      pts: [
        [-hw + 0.015, -0.21, zF],
        [-0.04, -0.055, zF],
        [0, -0.045, zF],
        [0.04, -0.055, zF],
        [hw - 0.015, -0.21, zF],
      ],
      widthScale: 0.95,
    },
    // Rear outline lines
    { pts: [[-0.12, -0.04, zB], [0.12, -0.04, zB]], widthScale: 0.72 },
    { pts: [[-0.09, -0.1, zB], [0.09, -0.1, zB]], widthScale: 0.72 },
  ];

  const rib = buildHandInkRibbonGeometry(strokes, seed);
  disposableGeoms.push(rib);
  const ribMesh = new THREE.Mesh(rib, mats.inkRibbon);
  ribMesh.raycast = NOOP_RAYCAST;
  grp.add(ribMesh);

  return grp;
}

// ===========================================================================
// 15-MODEL 3D CONSTELLATION AROUND CENTRAL Z-FOLD LETTER (RIGID CAMERA ORBIT)
// Every single one of the 15 models sits cleanly outside the central letter's
// 360° clearance envelope, floating & rotating freely with ZERO fade-in/out!
// ===========================================================================

type DoodleItemKind =
  | "pillar-postbox"
  | "rural-mailbox"
  | "fourleg-postbox"
  | "sealed-envelope"
  | "open-envelope"
  | "paper-airplane"
  | "stamped-postcard"
  | "open-rural-mailbox"
  | "wall-mailbox"
  | "slim-postbox"
  | "letter-stack"
  | "airmail-envelope"
  | "string-tie-envelope"
  | "rolled-scroll"
  | "open-empty-envelope";

interface DioramaItemSpec {
  id: string;
  kind: DoodleItemKind;
  /** Local 3D anchor coordinates around central Z-Fold letter (mobile portrait) */
  portraitPos: [number, number, number];
  /** Local 3D anchor coordinates around central Z-Fold letter (desktop landscape) */
  landscapePos: [number, number, number];
  /** Initial sculptural orientation */
  fixedRot: [number, number, number];
  /** Bounded zero-gravity drift amplitude [x, y, z] (no fade-in/out!) */
  driftAmp: [number, number, number];
  /** Irrational drift angular frequencies [x, y, z] for organic non-repeating motion */
  driftFreq: [number, number, number];
  /** Free slow multi-axis tumbling angular velocity (rad/sec) */
  rotSpeed: [number, number, number];
  scale: number;
  seed: number;
}

const DIORAMA_ITEMS: readonly DioramaItemSpec[] = [
  // 1. Upper-Left: Rural Arch Barrel Mailbox with Flag
  {
    id: "doodle-rural-mailbox",
    kind: "rural-mailbox",
    portraitPos: [-1.02, 1.56, -0.45],
    landscapePos: [-1.86, 0.72, -0.52],
    fixedRot: [0.18, 0.68, -0.12],
    driftAmp: [0.1, 0.12, 0.08],
    driftFreq: [0.31, 0.43, 0.27],
    rotSpeed: [0.14, 0.22, -0.11],
    scale: 0.72,
    seed: 101,
  },
  // 2. Upper-Right: Classic Cylindrical Pillar Postbox
  {
    id: "doodle-pillar-postbox",
    kind: "pillar-postbox",
    portraitPos: [0.96, 1.64, -0.65],
    landscapePos: [1.56, 0.68, -0.82],
    fixedRot: [0.14, -0.42, 0.08],
    driftAmp: [0.1, 0.11, 0.09],
    driftFreq: [0.29, 0.37, 0.33],
    rotSpeed: [-0.12, -0.19, 0.15],
    scale: 0.7,
    seed: 202,
  },
  // 3. High-Right-Front: 3D Folded Paper Airplane
  {
    id: "doodle-paper-airplane",
    kind: "paper-airplane",
    portraitPos: [0.58, 2.34, 0.42],
    landscapePos: [-0.18, 1.04, -0.68],
    fixedRot: [0.32, -0.48, 0.2],
    driftAmp: [0.14, 0.11, 0.1],
    driftFreq: [0.41, 0.53, 0.29],
    rotSpeed: [0.18, -0.25, 0.21],
    scale: 0.64,
    seed: 303,
  },
  // 4. Lower-Right: Four-Legged Classic Postbox
  {
    id: "doodle-fourleg-postbox",
    kind: "fourleg-postbox",
    portraitPos: [0.94, -1.52, -0.35],
    landscapePos: [1.58, -0.46, -0.68],
    fixedRot: [0.12, -0.58, 0.06],
    driftAmp: [0.09, 0.11, 0.08],
    driftFreq: [0.27, 0.39, 0.31],
    rotSpeed: [0.13, -0.21, -0.14],
    scale: 0.7,
    seed: 404,
  },
  // 5. Lower-Left: Open Envelope with Lined Letter Peeking Out
  {
    id: "doodle-open-envelope",
    kind: "open-envelope",
    portraitPos: [-0.96, -1.48, 0.36],
    landscapePos: [-1.8, -0.48, 0.2],
    fixedRot: [-0.14, 0.42, -0.18],
    driftAmp: [0.11, 0.11, 0.09],
    driftFreq: [0.35, 0.47, 0.25],
    rotSpeed: [-0.17, 0.24, 0.16],
    scale: 0.66,
    seed: 505,
  },
  // 6. High-Left-Back: Stamped Postcard with Wavy Postmark
  {
    id: "doodle-stamped-postcard",
    kind: "stamped-postcard",
    portraitPos: [-0.98, 2.38, -0.82],
    landscapePos: [-1.18, 1.04, -1.12],
    fixedRot: [0.22, 0.34, 0.16],
    driftAmp: [0.11, 0.1, 0.09],
    driftFreq: [0.33, 0.41, 0.23],
    rotSpeed: [0.16, 0.27, -0.18],
    scale: 0.62,
    seed: 606,
  },
  // 7. Lower-Back: Sealed Triangular-Flap Envelope
  {
    id: "doodle-sealed-envelope",
    kind: "sealed-envelope",
    portraitPos: [-0.22, -1.88, -1.35],
    landscapePos: [0.92, -0.94, -1.18],
    fixedRot: [-0.16, -0.38, -0.15],
    driftAmp: [0.12, 0.09, 0.09],
    driftFreq: [0.37, 0.45, 0.29],
    rotSpeed: [-0.19, -0.23, 0.17],
    scale: 0.62,
    seed: 707,
  },
  // 8. Upper-Center: Open-Door Rural Mailbox with Letters Spilling Out!
  {
    id: "doodle-open-rural-mailbox",
    kind: "open-rural-mailbox",
    portraitPos: [-0.08, 1.88, -1.15],
    landscapePos: [0.68, 1.02, -1.15],
    fixedRot: [0.15, -0.52, -0.09],
    driftAmp: [0.1, 0.11, 0.09],
    driftFreq: [0.28, 0.41, 0.26],
    rotSpeed: [0.12, 0.2, -0.15],
    scale: 0.68,
    seed: 808,
  },
  // 9. Upper-Right-Far: Wall-Mounted Rectangular MAIL Box
  {
    id: "doodle-wall-mailbox",
    kind: "wall-mailbox",
    portraitPos: [1.14, 2.48, -1.25],
    landscapePos: [2.05, 0.12, -1.25],
    fixedRot: [-0.18, -0.36, 0.14],
    driftAmp: [0.1, 0.1, 0.08],
    driftFreq: [0.34, 0.36, 0.29],
    rotSpeed: [-0.15, 0.18, 0.13],
    scale: 0.62,
    seed: 909,
  },
  // 10. Lower-Left-Back: Tall Slim Street Postbox
  {
    id: "doodle-slim-postbox",
    kind: "slim-postbox",
    portraitPos: [-1.18, -1.96, -1.1],
    landscapePos: [-1.32, -0.96, -1.22],
    fixedRot: [0.14, 0.48, -0.11],
    driftAmp: [0.09, 0.1, 0.09],
    driftFreq: [0.26, 0.38, 0.32],
    rotSpeed: [0.11, -0.22, 0.14],
    scale: 0.64,
    seed: 1010,
  },
  // 11. Mid-Upper-Left-Front: Layered Stack of Envelopes
  {
    id: "doodle-letter-stack",
    kind: "letter-stack",
    portraitPos: [-0.46, 1.52, 0.68],
    landscapePos: [-2.12, 0.1, -0.22],
    fixedRot: [0.38, 0.26, -0.2],
    driftAmp: [0.11, 0.1, 0.08],
    driftFreq: [0.36, 0.44, 0.24],
    rotSpeed: [-0.14, 0.24, -0.16],
    scale: 0.64,
    seed: 1111,
  },
  // 12. High-Center: Airmail Diagonal-Striped Border Envelope
  {
    id: "doodle-airmail-envelope",
    kind: "airmail-envelope",
    portraitPos: [-0.24, 2.66, -0.22],
    landscapePos: [-0.88, 1.06, 0.34],
    fixedRot: [-0.16, 0.28, 0.18],
    driftAmp: [0.12, 0.09, 0.09],
    driftFreq: [0.32, 0.48, 0.28],
    rotSpeed: [0.17, -0.21, 0.15],
    scale: 0.6,
    seed: 1212,
  },
  // 13. Mid-Lower-Right-Front: Vertical String-Tie Document Envelope
  {
    id: "doodle-string-tie-envelope",
    kind: "string-tie-envelope",
    portraitPos: [0.54, -1.86, 0.62],
    landscapePos: [1.88, -0.82, 0.26],
    fixedRot: [0.18, -0.44, 0.15],
    driftAmp: [0.1, 0.1, 0.08],
    driftFreq: [0.3, 0.42, 0.34],
    rotSpeed: [-0.16, -0.18, -0.15],
    scale: 0.6,
    seed: 1313,
  },
  // 14. Mid-Upper-Right-Front: Rolled Paper Letter Scroll
  {
    id: "doodle-rolled-scroll",
    kind: "rolled-scroll",
    portraitPos: [0.38, 1.48, 0.72],
    landscapePos: [1.14, 0.96, 0.42],
    fixedRot: [0.24, -0.32, 0.34],
    driftAmp: [0.11, 0.1, 0.09],
    driftFreq: [0.39, 0.46, 0.3],
    rotSpeed: [0.2, 0.19, -0.22],
    scale: 0.62,
    seed: 1414,
  },
  // 15. Lower-Center-Back: Open-Flap Empty Envelope (swings cleanly on 180° orbit!)
  {
    id: "doodle-open-empty-envelope",
    kind: "open-empty-envelope",
    portraitPos: [-0.52, -1.62, -1.65],
    landscapePos: [-0.28, -1.04, -1.35],
    fixedRot: [-0.2, 0.36, -0.14],
    driftAmp: [0.12, 0.1, 0.09],
    driftFreq: [0.35, 0.4, 0.27],
    rotSpeed: [0.15, 0.25, 0.18],
    scale: 0.6,
    seed: 1515,
  },
] as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Analytic gently-underdamped spring easing (0 -> ~1.035 soft cushion -> 1.0)
 * Normalized smoothly onto exact 1.0 with zero velocity at u = 1.0.
 */
function dampedSpring01(u: number, omega: number, zeta: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const sqrtOneMinusZ2 = Math.sqrt(Math.max(1e-4, 1 - zeta * zeta));
  const wd = omega * sqrtOneMinusZ2;
  const decay = Math.exp(-zeta * omega * u);
  const raw =
    1 -
    decay *
      (Math.cos(wd * u) + (zeta / sqrtOneMinusZ2) * Math.sin(wd * u));
  const tailBlend = smoothstep(0.84, 1.0, u);
  return raw + (1 - raw) * tailBlend;
}

/**
 * Fast-to-slow damped deceleration (highest velocity at u = 0, soft cushion into 1.0).
 */
function fastToSlowDamped01(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const raw = 1 - Math.exp(-4.6 * u) * Math.cos(2.65 * u);
  const tailBlend = smoothstep(0.84, 1.0, u);
  return raw + (1 - raw) * tailBlend;
}

export interface FloatingScribbleMailboxesHandle {
  group: THREE.Group;
  update: (params: {
    elapsedSec: number;
    /** Seconds elapsed since opening animation started (items burst out smoothly starting at 2.0s!) */
    openingSec: number;
    aspect: number;
    letterPosX: number;
    letterPosY: number;
    orbitRotX: number;
    orbitRotY: number;
    unfoldPhase: number;
    isVisible: boolean;
  }) => void;
  dispose: () => void;
}

/**
 * Creates the unified 15-piece 3D crayon doodle postal diorama (mailboxes,
 * envelopes, postcards, scroll & paper airplane) that orbits rigidly around
 * the central Z-Fold letter while each piece floats & tumbles freely!
 */
export function createFloatingScribbleMailboxes(): FloatingScribbleMailboxesHandle {
  const orbitWorldGroup = new THREE.Group();
  orbitWorldGroup.name = "DoodlePostalDioramaOrbitGroup";

  const disposableGeoms: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [];

  interface BuiltDioramaItem {
    spec: DioramaItemSpec;
    node: THREE.Group;
    mats: DoodleMaterials;
  }

  const builtItems: BuiltDioramaItem[] = [];

  for (const spec of DIORAMA_ITEMS) {
    const mats = createDoodleMaterialSet(spec.seed * 0.13);
    disposableMats.push(mats.paperSurface, mats.inkOutline, mats.inkRibbon);

    let node: THREE.Group;
    switch (spec.kind) {
      case "pillar-postbox":
        node = buildPillarPostbox(mats, disposableGeoms, spec.seed);
        break;
      case "rural-mailbox":
        node = buildRuralFlagMailbox(mats, disposableGeoms, spec.seed);
        break;
      case "fourleg-postbox":
        node = buildFourLeggedPostbox(mats, disposableGeoms, spec.seed);
        break;
      case "sealed-envelope":
        node = buildSealedEnvelope(mats, disposableGeoms, spec.seed);
        break;
      case "open-envelope":
        node = buildOpenEnvelopeWithLetter(mats, disposableGeoms, spec.seed);
        break;
      case "paper-airplane":
        node = buildPaperAirplane(mats, disposableGeoms, spec.seed);
        break;
      case "stamped-postcard":
        node = buildStampedPostcard(mats, disposableGeoms, spec.seed);
        break;
      case "open-rural-mailbox":
        node = buildOpenRuralMailbox(mats, disposableGeoms, spec.seed);
        break;
      case "wall-mailbox":
        node = buildWallMailbox(mats, disposableGeoms, spec.seed);
        break;
      case "slim-postbox":
        node = buildSlimTallPostbox(mats, disposableGeoms, spec.seed);
        break;
      case "letter-stack":
        node = buildLetterStack(mats, disposableGeoms, spec.seed);
        break;
      case "airmail-envelope":
        node = buildAirmailEnvelope(mats, disposableGeoms, spec.seed);
        break;
      case "string-tie-envelope":
        node = buildStringTieEnvelope(mats, disposableGeoms, spec.seed);
        break;
      case "rolled-scroll":
        node = buildRolledScroll(mats, disposableGeoms, spec.seed);
        break;
      case "open-empty-envelope":
        node = buildOpenEmptyEnvelope(mats, disposableGeoms, spec.seed);
        break;
    }

    node.name = spec.id;
    node.rotation.set(spec.fixedRot[0], spec.fixedRot[1], spec.fixedRot[2]);
    node.scale.setScalar(spec.scale);

    orbitWorldGroup.add(node);
    builtItems.push({ spec, node, mats });
  }

  const update: FloatingScribbleMailboxesHandle["update"] = ({
    elapsedSec,
    openingSec,
    aspect,
    letterPosX,
    letterPosY,
    orbitRotX,
    orbitRotY,
    unfoldPhase,
    isVisible,
  }) => {
    // Stay 100% solid opaque while visible; slide outward cleanly as letter unfolds
    const showGroup = isVisible && unfoldPhase < 0.56;
    orbitWorldGroup.visible = showGroup;
    if (!showGroup) return;

    const landscapeBlend = smoothstep(0.68, 1.25, aspect);
    const unfoldPush = 1.0 + smoothstep(0.06, 0.54, unfoldPhase) * 1.15;

    // Anchor the ENTIRE diorama rigid group directly to the central Z-Fold letter's
    // exact center & rotation -> dragging rotates the whole world like moving a camera!
    orbitWorldGroup.position.set(letterPosX, letterPosY, 0);
    orbitWorldGroup.rotation.set(orbitRotX, orbitRotY, 0);

    // Sequential wave arrival right as the gliding letter flares into foreground:
    // Items emerge one by one (1.85s -> 3.45s) and settle smoothly into place (~3.6s -> 5.1s)!
    const BURST_BASE_START_SEC = 1.85;
    const BURST_STAGGER_SPAN_SEC = 1.55;
    const BURST_DURATION_SEC = 1.85;
    const FLOAT_OVERLAP_START_U = 0.5; // Overlap free floating smoothly during final 50% of radial cushion!
    const FLOAT_RAMP_SEC = 1.45;

    for (let i = 0; i < builtItems.length; i++) {
      const { spec, node, mats } = builtItems[i];
      const launchStart =
        BURST_BASE_START_SEC +
        (i / Math.max(1, builtItems.length - 1)) * BURST_STAGGER_SPAN_SEC;

      // Before t = 2.0s (+ subtle per-item stagger): stay tucked invisibly inside center!
      if (openingSec <= launchStart) {
        node.visible = false;
        continue;
      }
      node.visible = true;

      const bu = Math.max(
        0,
        Math.min(1, (openingSec - launchStart) / BURST_DURATION_SEC)
      );

      // Calm, gently-underdamped radial outward glide from center (0,0,0) -> resting orbit
      const radialSpring = dampedSpring01(bu, 5.8, 0.72);
      // Small -> target size with soft viscous spring damping (100% opaque, ZERO opacity fade!)
      const scaleSpring = dampedSpring01(Math.min(1, bu * 1.14), 6.2, 0.74);

      const baseLx =
        (spec.portraitPos[0] +
          (spec.landscapePos[0] - spec.portraitPos[0]) * landscapeBlend) *
        unfoldPush;
      const baseLy =
        (spec.portraitPos[1] +
          (spec.landscapePos[1] - spec.portraitPos[1]) * landscapeBlend) *
        unfoldPush;
      const baseLz =
        (spec.portraitPos[2] +
          (spec.landscapePos[2] - spec.portraitPos[2]) * landscapeBlend) *
        unfoldPush;

      // Delicate tangential swirl arc during outward flight that echoes the central letter's spin
      const swirlAngle = (1 - radialSpring) * 0.52;
      const cosSw = Math.cos(swirlAngle);
      const sinSw = Math.sin(swirlAngle);
      const orbitX = (baseLx * cosSw - baseLz * sinSw) * radialSpring;
      const orbitY = baseLy * radialSpring;
      const orbitZ = (baseLx * sinSw + baseLz * cosSw) * radialSpring;

      // C1-smooth overlapping time ramp so free zero-gravity floating & tumbling
      // accelerate seamlessly out of the tail of the outward burst (zero snap / zero pause!)
      const floatStartSec = launchStart + BURST_DURATION_SEC * FLOAT_OVERLAP_START_U;
      const rawFt = Math.max(0, openingSec - floatStartSec);
      const floatTime =
        rawFt < FLOAT_RAMP_SEC
          ? (rawFt * rawFt) / (2 * FLOAT_RAMP_SEC)
          : rawFt - FLOAT_RAMP_SEC * 0.5;
      const driftWeight = smoothstep(0.42, 0.98, bu);

      const ph = spec.seed * 0.19;
      const dx =
        (Math.sin(floatTime * spec.driftFreq[0] + ph) * spec.driftAmp[0] +
          Math.cos(floatTime * (spec.driftFreq[0] * 0.61) + ph * 1.7) *
            (spec.driftAmp[0] * 0.35)) *
        driftWeight;
      const dy =
        (Math.sin(floatTime * spec.driftFreq[1] + ph * 2.1 + 1.2) *
          spec.driftAmp[1] +
          Math.cos(floatTime * (spec.driftFreq[1] * 0.57) + ph * 0.9) *
            (spec.driftAmp[1] * 0.3)) *
        driftWeight;
      const dz =
        Math.cos(floatTime * spec.driftFreq[2] + ph * 1.4 + 2.4) *
        spec.driftAmp[2] *
        driftWeight;

      node.position.set(orbitX + dx, orbitY + dy, orbitZ + dz);
      node.scale.setScalar(spec.scale * Math.max(0.02, scaleSpring));

      // Outward launch spin (fast -> slow) melts seamlessly into eternal free tumbling!
      const spinDir = i % 2 === 0 ? 1 : -1;
      const burstSpinRemain = (1 - fastToSlowDamped01(bu)) * 2.1 * spinDir;
      node.rotation.set(
        spec.fixedRot[0] +
          burstSpinRemain * 0.35 +
          floatTime * spec.rotSpeed[0] +
          Math.sin(floatTime * 0.38 + ph) * 0.16 * driftWeight,
        spec.fixedRot[1] + burstSpinRemain + floatTime * spec.rotSpeed[1],
        spec.fixedRot[2] +
          burstSpinRemain * 0.28 +
          floatTime * spec.rotSpeed[2] +
          Math.cos(floatTime * 0.34 + ph * 1.3) * 0.14 * driftWeight
      );

      // Update 8 FPS hand-drawn boiling time on all crayon shaders (100% opaque!)
      mats.paperSurface.uniforms.uTime.value = elapsedSec;
      mats.inkOutline.uniforms.uTime.value = elapsedSec;
      mats.inkRibbon.uniforms.uTime.value = elapsedSec;
    }
  };

  const dispose = () => {
    disposableGeoms.forEach((g) => g.dispose());
    disposableMats.forEach((m) => m.dispose());
  };

  return { group: orbitWorldGroup, update, dispose };
}
