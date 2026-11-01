// Shared helpers for the works wall (cards, charms, strands).
// Units: world units. Geometry helpers build felt shapes: extruded outlines with a rounded bevel,
// smoothed so they shade like stuffed felt instead of cut cardboard.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { addFuzz } from "./yarn/fuzz.js";

export const TAU = Math.PI * 2;
export const noop = () => {};

// rounded rectangle centered on the origin
export function roundedRectShape(w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// ExtrudeGeometry -> welded, smooth-shaded geometry with planar uv = (x * su, y * sv) (fuzz and bump need uv)
export function plush(geometry, su = 1, sv = su) {
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  const g = mergeVertices(geometry, 1e-4);
  geometry.dispose();
  g.computeVertexNormals();
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * su;
    uv[i * 2 + 1] = p.getY(i) * sv;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

// fuzz shells are never pickable (they would multiply the raycast cost for nothing)
export function fuzzOn(mesh, options) {
  const fuzz = addFuzz(mesh, options);
  fuzz.raycast = noop;
  return fuzz;
}

// ---- felt grain ---------------------------------------------------------------------------

const GRAIN_TILE = 3.8; // world units covered by one repeat of the grain texture
let grain;

function grainTexture() {
  if (grain) return grain;
  const N = 128;
  const G = 16;
  const cells = new Float32Array(G * G);
  for (let i = 0; i < cells.length; i++) cells[i] = Math.random();
  const smooth = (t) => t * t * (3 - 2 * t);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (x / N) * G;
      const gy = (y / N) * G;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const c = (cx, cy) => cells[(cy % G) * G + (cx % G)];
      const top = c(x0, y0) * (1 - fx) + c(x0 + 1, y0) * fx;
      const bottom = c(x0, y0 + 1) * (1 - fx) + c(x0 + 1, y0 + 1) * fx;
      const v = (top * (1 - fy) + bottom * fy) * 0.65 + Math.random() * 0.35;
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(v * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grain = new THREE.CanvasTexture(canvas);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  return grain;
}

// bump texture for a face that spans sizeX x sizeY world units over uv 0..1
export function feltBump(sizeX, sizeY) {
  const tex = grainTexture().clone();
  tex.repeat.set(sizeX / GRAIN_TILE, sizeY / GRAIN_TILE);
  tex.needsUpdate = true;
  return tex;
}

// ---- acceleration probe -------------------------------------------------------------------

const VEL_RESPONSE = 25; // 1/s, low pass on the finite-difference velocity
const ACC_RESPONSE = 15; // 1/s, low pass on the acceleration
const ACC_MAX = 40;

// Smoothed world acceleration of a moving point (a peg on the rope), fed to Hang. No allocation per call.
export class AccelProbe {
  constructor() {
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.a = new THREE.Vector3();
    this.primed = false;
  }

  update(dt, x, y, z) {
    if (dt <= 0) return this.a;
    if (!this.primed) {
      this.p.set(x, y, z);
      this.primed = true;
      return this.a;
    }
    const kv = 1 - Math.exp(-dt * VEL_RESPONSE);
    const ka = 1 - Math.exp(-dt * ACC_RESPONSE);
    const { p, v, a } = this;
    const nx = v.x + ((x - p.x) / dt - v.x) * kv;
    const ny = v.y + ((y - p.y) / dt - v.y) * kv;
    const nz = v.z + ((z - p.z) / dt - v.z) * kv;
    a.x += (THREE.MathUtils.clamp((nx - v.x) / dt, -ACC_MAX, ACC_MAX) - a.x) * ka;
    a.y += (THREE.MathUtils.clamp((ny - v.y) / dt, -ACC_MAX, ACC_MAX) - a.y) * ka;
    a.z += (THREE.MathUtils.clamp((nz - v.z) / dt, -ACC_MAX, ACC_MAX) - a.z) * ka;
    v.set(nx, ny, nz);
    p.set(x, y, z);
    return a;
  }
}

// once a spring that animates whole turns has settled, drop the full turns from its numbers (the pose is the same)
export function normalizeTurns(spring) {
  if (!spring.settled) return;
  const w = Math.round(spring.target / TAU) * TAU;
  if (w !== 0) {
    spring.value -= w;
    spring.target -= w;
  }
}
