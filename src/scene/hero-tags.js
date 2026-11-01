// Felt hang tags with an embroidered link icon (X, GitHub, email) for the hero line.
//
// The tag is a notched-ribbon outline extruded into puffy white felt (local origin = top center, the
// grip point; it extends down -y). The icon and the dashed running-stitch border are drawn once into a
// canvas texture and shown on two thin planes, one on each face.
// Units: world units; canvas drawn in the same units (y up, origin at the top center of the tag).
import * as THREE from "three";
import { P } from "./layout.js";
import { feltMaterial } from "./materials.js";
import { addFuzz } from "./yarn/fuzz.js";
import { finishPuffy } from "./hero-puffy.js";

export const TAG_W = 0.84;
export const TAG_H = 1.14;
export const TAG_LENGTH = 0.55; // grip -> center of mass, for Hang

const NOTCH = 0.22; // depth of the swallowtail cut
const CORNER = 0.12; // top corner radius
const THICK = 0.01; // flat extrusion; bevels add 2 * BEVEL
const BEVEL = 0.025;
const PX_PER_UNIT = 600; // canvas resolution
const STITCH_INSET = 0.07;
const ICON_SIZE = 0.46;
const ICON_Y = -0.5;
const PLANE_LIFT = 0.004; // icon plane above the felt face

// simple-icons paths, 24 x 24 box, y down
const ICON_PATH = {
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12.297c0-6.627-5.373-12-12-12",
};

// Ribbon outline, drawn on a THREE.Shape or a 2D canvas context (both have moveTo / lineTo /
// quadraticCurveTo). y up, top edge at `top`; bottom edge has a swallowtail notch.
function outline(p, x0, x1, top, bot, r, notch) {
  const mx = (x0 + x1) / 2;
  const c = 0.07; // rounding of the two bottom tips
  const f = 0.1; // how far along the notch edge the rounding ends
  p.moveTo(x0 + r, top);
  p.lineTo(x1 - r, top);
  p.quadraticCurveTo(x1, top, x1, top - r);
  p.lineTo(x1, bot + c);
  p.quadraticCurveTo(x1, bot, x1 + (mx - x1) * f, bot + notch * f);
  p.lineTo(mx, bot + notch);
  p.lineTo(x0 + (mx - x0) * f, bot + notch * f);
  p.quadraticCurveTo(x0, bot, x0, bot + c);
  p.lineTo(x0, top - r);
  p.quadraticCurveTo(x0, top, x0 + r, top);
}

// satin-stitched filled icon: fill, light and dark thread hatching clipped to the glyph, dark outline
function stitchedIcon(ctx, d, cy) {
  const path = new Path2D(d);
  ctx.save();
  ctx.translate(0, cy);
  ctx.scale(ICON_SIZE / 24, -ICON_SIZE / 24);
  ctx.translate(-12, -12);
  ctx.fillStyle = P.thread;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = 0.22;
  for (const [style, shift] of [
    ["rgba(255, 228, 200, 0.3)", 0],
    ["rgba(40, 22, 14, 0.28)", 0.31],
  ]) {
    ctx.strokeStyle = style;
    ctx.beginPath();
    for (let k = -26; k < 26; k += 0.62) {
      ctx.moveTo(k + shift, -1);
      ctx.lineTo(k + shift + 26, 25);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(60, 36, 26, 0.7)";
  ctx.lineWidth = 0.3;
  ctx.stroke(path);
  ctx.restore();
}

// envelope in running stitch
function stitchedEnvelope(ctx, cy) {
  const w = 0.6;
  const h = 0.4;
  const x0 = -w / 2;
  const y0 = cy - h / 2;
  ctx.strokeStyle = P.thread;
  ctx.lineWidth = 0.03;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([0.055, 0.035]);
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 0.04);
  ctx.moveTo(x0 + 0.02, y0 + h - 0.02);
  ctx.lineTo(0, cy + 0.01);
  ctx.lineTo(x0 + w - 0.02, y0 + h - 0.02);
  ctx.moveTo(x0 + 0.03, y0 + 0.03);
  ctx.lineTo(-0.1, cy + 0.0);
  ctx.moveTo(x0 + w - 0.03, y0 + 0.03);
  ctx.lineTo(0.1, cy + 0.0);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTexture(id) {
  const width = Math.round(TAG_W * PX_PER_UNIT);
  const height = Math.round(TAG_H * PX_PER_UNIT);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(PX_PER_UNIT, 0, 0, -PX_PER_UNIT, width / 2, 0);

  ctx.strokeStyle = P.thread;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 0.016;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([0.045, 0.035]);
  ctx.beginPath();
  const i = STITCH_INSET;
  outline(ctx, -TAG_W / 2 + i, TAG_W / 2 - i, -i, -TAG_H + i, CORNER - 0.03, NOTCH + i * 0.8);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  if (id === "email") stitchedEnvelope(ctx, ICON_Y);
  else stitchedIcon(ctx, ICON_PATH[id], ICON_Y);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// returns { content, box }; content's origin is the tag's top center
export function buildTag(id, colorName) {
  const shape = new THREE.Shape();
  outline(shape, -TAG_W / 2, TAG_W / 2, 0, -TAG_H, CORNER, NOTCH);
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: THICK,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 3,
  });
  const geometry = finishPuffy(raw, 1, 1);
  geometry.computeBoundingBox();
  const zc = (geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2;
  geometry.translate(0, 0, -zc);
  geometry.computeBoundingBox();
  const half = geometry.boundingBox.max.z;

  const mesh = new THREE.Mesh(geometry, feltMaterial(colorName));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  const fuzz = addFuzz(mesh, { color: P[colorName] ?? colorName, length: 0.014, density: 70, layers: 6, opacity: 0.8 });
  fuzz.raycast = () => {};

  const material = new THREE.MeshStandardMaterial({
    map: drawTexture(id),
    transparent: true,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const plane = new THREE.PlaneGeometry(TAG_W, TAG_H).translate(0, -TAG_H / 2, 0);
  const front = new THREE.Mesh(plane, material);
  front.position.z = half + PLANE_LIFT;
  const back = new THREE.Mesh(plane, material);
  back.position.z = -half - PLANE_LIFT;
  back.rotation.y = Math.PI;
  front.raycast = back.raycast = () => {};

  const content = new THREE.Group();
  content.add(mesh, front, back);
  return { content, box: geometry.boundingBox.clone() };
}
