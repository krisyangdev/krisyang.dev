// Plush knitted letters for the hero.
//
// Fredoka Bold glyphs -> TextGeometry with a deep round bevel -> smooth normals -> knit uvs, plus a
// fuzz halo. Each letter's local origin is its grip point (the spot on the top edge where the clothespin
// bites) and it extends down -y, which is what Hang expects. The grip is the highest solid spot that is
// close to the letter's center of mass; the geometry is then rotated about the grip by the angle that
// puts the center of mass straight below it, so a letter pegged off-center (K, Y, N) hangs tilted
// the way a real one would.
// Units: world units (HERO.letterSize = cap height).
import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { HERO, P } from "./layout.js";
import { knitMaterial } from "./materials.js";
import { addFuzz } from "./yarn/fuzz.js";
import { finishPuffy } from "./hero-puffy.js";

// ---- tunables ----------------------------------------------------------------------------------
const DEPTH = 0.16; // flat extrusion between the bevels
const BEVEL_T = 0.09; // bevel reach along z
const BEVEL_S = 0.07; // bevel reach sideways; larger values miter-spike across the sharp notches of N, A, K and fill them
const STITCH = 0.09; // world size of one knit stitch
const FUZZ = { length: 0.045, density: 34, layers: 10, lighten: 0.2 };
const PIN_HALF = 0.1; // half the width of the pin jaws that has to rest on solid letter
const MAX_TILT = 0.12; // rad
export const LETTER_Z = -0.05; // z of the letter's center: pushes the body behind the pin's front jaw

export function loadFont(url) {
  return new FontLoader().loadAsync(url);
}

// cap height of the font at size 1
function capHeight(font) {
  const g = new THREE.ShapeGeometry(font.generateShapes("K", 1), 6);
  g.computeBoundingBox();
  const h = g.boundingBox.max.y - g.boundingBox.min.y;
  g.dispose();
  return h;
}

// area-weighted center of mass and bounds of the flat glyph triangles
function analyse(pos, idx) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ar = Math.abs((pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[c] - pos[a]) * (pos[b + 1] - pos[a + 1])) / 2;
    area += ar;
    cx += (ar * (pos[a] + pos[b] + pos[c])) / 3;
    cy += (ar * (pos[a + 1] + pos[b + 1] + pos[c + 1])) / 3;
    for (const k of [a, b, c]) {
      minX = Math.min(minX, pos[k]);
      maxX = Math.max(maxX, pos[k]);
      maxY = Math.max(maxY, pos[k + 1]);
    }
  }
  return { area, comX: cx / area, comY: cy / area, minX, maxX, maxY };
}

// highest solid y of the glyph on the vertical line x (-Infinity in air)
function topAt(pos, idx, x) {
  let top = -Infinity;
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const p = idx[t + e] * 3;
      const q = idx[t + ((e + 1) % 3)] * 3;
      if ((pos[p] - x) * (pos[q] - x) > 0 || pos[p] === pos[q]) continue;
      const y = pos[p + 1] + ((pos[q + 1] - pos[p + 1]) * (x - pos[p])) / (pos[q] - pos[p]);
      if (y > top) top = y;
    }
  }
  return top;
}

function makeLetter(font, ch, size, rng) {
  const k = size / font.data.resolution;
  const glyph = font.data.glyphs[ch];
  const flat = new THREE.ShapeGeometry(font.generateShapes(ch, size), 6);
  const pos = flat.attributes.position.array;
  const idx = flat.index.array;
  const a = analyse(pos, idx);

  // grip: flat plateau under the pin jaws that is high and near the center of mass
  let best = null;
  for (let x = a.minX + PIN_HALF; x <= a.maxX - PIN_HALF + 1e-6; x += 0.02) {
    const top = Math.min(topAt(pos, idx, x - PIN_HALF), topAt(pos, idx, x), topAt(pos, idx, x + PIN_HALF));
    if (top === -Infinity) continue;
    const score = Math.abs(x - a.comX) + 2.4 * (a.maxY - top);
    if (!best || score < best.score) best = { x, top, score };
  }
  best ??= { x: (a.minX + a.maxX) / 2, top: a.maxY };
  flat.dispose();

  const dx = a.comX - best.x;
  const dy = a.comY - best.top;
  const tilt = THREE.MathUtils.clamp(Math.atan(dx / dy), -MAX_TILT, MAX_TILT);

  const raw = new TextGeometry(ch, {
    font,
    size,
    depth: DEPTH,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: BEVEL_T,
    bevelSize: BEVEL_S,
    bevelOffset: -BEVEL_S, // keep the outline at the glyph's true size
    bevelSegments: 6,
  });
  const geometry = finishPuffy(raw, STITCH * 4, STITCH * 5, rng() * 4, rng() * 5);
  geometry.translate(-best.x, -best.top, 0);
  geometry.rotateZ(tilt);
  geometry.computeBoundingBox();
  const zc = (geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2;
  geometry.translate(0, 0, LETTER_Z - zc);
  geometry.computeBoundingBox();

  return {
    ch,
    geometry,
    advance: glyph.ha * k,
    xMin: glyph.x_min * k,
    xMax: glyph.x_max * k,
    gripX: best.x, // in the glyph's own frame, relative to its pen position
    length: THREE.MathUtils.clamp(Math.hypot(dx, dy), 0.45, 0.85), // grip -> center of mass
    area: a.area,
    box: geometry.boundingBox.clone(),
  };
}

// one entry per character of text; spaces are null
export function buildLetters(font, text, rng) {
  const size = HERO.letterSize / capHeight(font);
  return [...text].map((ch) => (ch === " " ? null : makeLetter(font, ch, size, rng)));
}

// knitted mesh + fuzz halo for one letter; the group's origin is the grip point
export function makeLetterContent(letter, colorName) {
  const mesh = new THREE.Mesh(letter.geometry, knitMaterial(colorName, [1, 1]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  const tint = new THREE.Color(P[colorName] ?? colorName).lerp(new THREE.Color(P.white), FUZZ.lighten);
  const fuzz = addFuzz(mesh, { color: tint, length: FUZZ.length, density: FUZZ.density, layers: FUZZ.layers });
  fuzz.raycast = () => {};
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
