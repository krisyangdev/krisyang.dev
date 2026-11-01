// The wall's lighting pattern, painted in the backdrop's shader: a slanted window of light with muntins
// (golden afternoon sun by day, pale moonlight by night) and a swaying layer of leaf / branch shadows.
// Two patches live on the wall in world space: the main one behind the hero and a fainter one lower
// down, so the page does not go flat while scrolling. Masks are canvases generated at startup (no image files).
// Units: world units (backdrop local xy equals world xy, the backdrop group only moves in z), seconds.
// The material returns the lit wall colour; the caller still overlays the shadow-map shadows on top of it.
import * as THREE from "three";

// tunables
const PATCHES = [
  { center: [-3, 2.6], scale: 1, strength: 1 }, // behind the hero
  { center: [3.5, -10.4], scale: 0.85, strength: 0.4 }, // fainter, behind the wall lines
];
const WIN_SIZE = [12.8, 7.2]; // world size of the window mask canvas (glass is inset, see below)
const SLOPE = -0.3; // dy/dx of the window's horizontal edges: projected from the upper left they fall to the right
const LEAN = 0.08; // dx per dy: vertical edges lean slightly
const GLOW_R = [9, 6]; // dappled sun around the window: gaussian radii
const GLOW_GAIN = 0.6; // how much of the full sun the surroundings get (through the leaves)
const LEAF_SIZE = [20, 12.5]; // world size of the leaf layer
const LEAF_OFFSET = [-2.5, 1.0]; // leaf layer centre relative to the patch centre (upper left)
const REACH = [20, 13]; // beyond this distance from a patch centre it adds nothing (the glow is below 1% there)
const LEAF_DAY = 0.9; // how much a leaf shadow removes of the sun
const LEAF_NIGHT = 0.65;
const WIND_X = [-6, 2]; // where the breeze is sampled
const WIND_REST = 0.4; // steady breeze strength that counts as no gust
const WIND_SMOOTH = 3; // 1/s
const WIND_SHIFT = 0.03; // leaf layer uv shift per unit of gust strength
const SWAY = 0.004; // uv amplitude of the slow idle sway
const DAY = { wall: new THREE.Color("#e4cdb0"), sun: new THREE.Color(0.75, 0.55, 0.22) }; // sun = extra light, as a fraction of the wall colour
const NIGHT = { wall: new THREE.Color("#3d3853"), sun: new THREE.Color(0.8, 1.3, 1.8) };

// ---- masks ----

const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

// blurs the alpha channel with a canvas shadow (ctx.filter is missing in some browsers)
function blurAlpha(src, blur) {
  const out = canvas(src.width, src.height);
  const ctx = out.getContext("2d");
  const off = src.width + 64;
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = off;
  ctx.drawImage(src, -off, 0);
  return out;
}

// the window: 3 x 2 panes inside a padded canvas, soft edges
function windowCanvas() {
  const c = canvas(1024, 576);
  const ctx = c.getContext("2d");
  const [x0, y0, x1, y1] = [64, 80, 960, 496];
  const bar = 30;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 1; i < 3; i++) ctx.fillRect(x0 + ((x1 - x0) * i) / 3 - bar / 2, y0, bar, y1 - y0);
  ctx.fillRect(x0, (y0 + y1) / 2 - bar / 2, x1 - x0, bar);
  return blurAlpha(c, 14);
}

// deterministic random so the leaves look the same every load
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leaf(ctx, x, y, angle, len) {
  const wid = len * 0.36;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.4, wid, len, 0);
  ctx.quadraticCurveTo(len * 0.4, -wid, 0, 0);
  ctx.fill();
  ctx.restore();
}

// twigs that enter from the upper left and grow toward the lower right, with leaves on both sides.
// Edges stay empty so clamped sampling outside the layer finds no shadow.
function foliageCanvas({ seed, twigs, steps, leaves, leafLen, twigWidth }) {
  const w = 1024;
  const h = 640;
  const margin = 40;
  const rand = rng(seed);
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";

  function grow(x, y, angle, n, width, depth) {
    for (let i = 0; i < n; i++) {
      const step = 22 + rand() * 12;
      const nx = x + Math.cos(angle) * step;
      const ny = y + Math.sin(angle) * step;
      if (nx < margin || nx > w - margin || ny < margin || ny > h - margin) return;
      ctx.lineWidth = width * (1 - (i / n) * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // fewer leaves toward the right edge, where the branch thins out
      const keep = 1 - (nx / w) * 0.75;
      for (let k = 0; k < leaves; k++) {
        if (rand() > keep) continue;
        const side = rand() < 0.5 ? -1 : 1;
        leaf(ctx, nx, ny, angle + side * (0.5 + rand() * 0.8), leafLen * (0.7 + rand() * 0.6));
      }
      if (depth < 2 && rand() < 0.14) grow(nx, ny, angle + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5), Math.floor(n * 0.5), width * 0.7, depth + 1);
      angle += (rand() - 0.5) * 0.4 + 0.02;
      x = nx;
      y = ny;
    }
    leaf(ctx, x, y, angle, leafLen);
  }

  for (let t = 0; t < twigs; t++) {
    const fromLeft = rand() < 0.6;
    const x = fromLeft ? margin : margin + rand() * w * 0.5;
    const y = fromLeft ? margin + rand() * h * 0.7 : margin;
    grow(x, y, 0.2 + rand() * 0.9, steps + Math.floor(rand() * 8), twigWidth, 0);
  }
  return blurAlpha(c, 6);
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---- shader ----

const vec2 = (v) => `vec2(${v[0].toFixed(3)}, ${v[1].toFixed(3)})`;

const VERT = /* glsl */ `
  attribute float shade;
  varying vec2 vW;
  varying float vShade;
  void main() {
    vW = position.xy;
    vShade = shade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uWindow;
  uniform sampler2D uLeavesDay;
  uniform sampler2D uLeavesNight;
  uniform vec3 uWall;
  uniform vec3 uSun;
  uniform vec4 uPatch0; // centre xy, scale, strength
  uniform vec4 uPatch1;
  uniform vec2 uWind;
  uniform float uTime;
  uniform float uNight;
  uniform float uLeaf;
  varying vec2 vW;
  varying float vShade;

  const vec2 WIN_SIZE = ${vec2(WIN_SIZE)};
  const vec2 GLOW_R = ${vec2(GLOW_R)};
  const vec2 LEAF_SIZE = ${vec2(LEAF_SIZE)};
  const vec2 LEAF_OFFSET = ${vec2(LEAF_OFFSET)};
  const vec2 REACH = ${vec2(REACH)};
  const float SLOPE = ${SLOPE.toFixed(3)};
  const float LEAN = ${LEAN.toFixed(3)};
  const float GLOW_GAIN = ${GLOW_GAIN.toFixed(3)};
  const float WIND_SHIFT = ${WIND_SHIFT.toFixed(4)};
  const float SWAY = ${SWAY.toFixed(4)};

  // fraction of full sun (0..1) this patch lets through at wall point w
  float sunAt(vec2 w, vec4 p, float flip) {
    vec2 d = w - p.xy;
    if (abs(d.x) > REACH.x * p.z || abs(d.y) > REACH.y * p.z) return 0.0;

    vec2 q = vec2(d.x + LEAN * d.y, d.y - SLOPE * d.x) / (WIN_SIZE * p.z) + 0.5;
    float win = texture2D(uWindow, q).a;
    vec2 g = d / (GLOW_R * p.z);
    float lit = win + (1.0 - win) * GLOW_GAIN * exp(-dot(g, g));

    vec2 lq = (d - LEAF_OFFSET * p.z) / (LEAF_SIZE * p.z) + 0.5;
    lq.x = mix(lq.x, 1.0 - lq.x, flip);
    // the gust sweeps across the patch: mix the two breeze samples by x
    float wnd = mix(uWind.x, uWind.y, smoothstep(-8.0, 4.0, w.x));
    lq += vec2(-wnd * WIND_SHIFT, wnd * WIND_SHIFT * 0.3);
    lq += SWAY * vec2(sin(uTime * 0.45 + lq.y * 6.0), cos(uTime * 0.38 + lq.x * 5.0));
    lq.x += sin(lq.y * 22.0 + uTime * 2.3) * wnd * 0.004; // flutter during a gust
    float shadow = mix(texture2D(uLeavesDay, lq).a, texture2D(uLeavesNight, lq).a, uNight);
    return lit * (1.0 - uLeaf * shadow) * p.w;
  }

  void main() {
    float sun = sunAt(vW, uPatch0, 0.0) + sunAt(vW, uPatch1, 1.0);
    float fold = 1.0 + (vShade - 1.0) * (1.0 - 0.5 * uNight);
    gl_FragColor = vec4(uWall * fold * (1.0 + uSun * sun), 1.0);
  }
`;

// still: freeze time and wind (screenshots, reduced motion)
export function createWindowLight({ breeze, still = false }) {
  const wall = new THREE.Color().copy(DAY.wall); // current in-shade wall colour; the stage copies it to the scene background
  const wind = new THREE.Vector2();
  const patch = (p) => new THREE.Vector4(p.center[0], p.center[1], p.scale, p.strength);
  const uniforms = {
    uWindow: { value: texture(windowCanvas()) },
    uLeavesDay: { value: texture(foliageCanvas({ seed: 7, twigs: 15, steps: 22, leaves: 2, leafLen: 40, twigWidth: 4 })) },
    uLeavesNight: { value: texture(foliageCanvas({ seed: 31, twigs: 6, steps: 16, leaves: 1, leafLen: 48, twigWidth: 6 })) },
    uWall: { value: wall },
    uSun: { value: new THREE.Color().copy(DAY.sun) },
    uPatch0: { value: patch(PATCHES[0]) },
    uPatch1: { value: patch(PATCHES[1]) },
    uWind: { value: wind },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uLeaf: { value: LEAF_DAY },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG });

  return {
    material,
    wall,
    update(dt, t, night) {
      if (!still) {
        const k = 1 - Math.exp(-WIND_SMOOTH * dt);
        wind.x += (breeze.at(WIND_X[0]) - WIND_REST - wind.x) * k;
        wind.y += (breeze.at(WIND_X[1]) - WIND_REST - wind.y) * k;
        uniforms.uTime.value = t;
      }
      uniforms.uNight.value = night;
      uniforms.uLeaf.value = LEAF_DAY + (LEAF_NIGHT - LEAF_DAY) * night;
      wall.lerpColors(DAY.wall, NIGHT.wall, night);
      uniforms.uSun.value.lerpColors(DAY.sun, NIGHT.sun, night);
    },
  };
}
