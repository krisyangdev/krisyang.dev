// Felt badge with the owner's avatar, hung in the word space of the hero line.
//
//   const badge = buildBadge();   // { content, box }; content origin = top of the disc (the grip point), hangs down -y
//
// A puffy cream felt disc; the front carries the avatar photo clipped to a circle, ringed by a running
// stitch, drawn once into a canvas texture on a plane just above the felt. The back is plain felt.
// Units: world units; the canvas is drawn in the same units (y up, origin at the disc center).
import * as THREE from "three";
import { P } from "./layout.js";
import { feltMaterial } from "./materials.js";
import { addFuzz } from "./yarn/fuzz.js";
import { finishPuffy } from "./hero-puffy.js";

// ---- tunables ----------------------------------------------------------------------------------
const IMAGE_URL = `${import.meta.env.BASE_URL}kris.webp`;
const RADIUS = 0.9; // a hero letter is 1.4 tall
const PHOTO_RADIUS = 0.73;
const STITCH_RADIUS = 0.815;
const THICK = 0.02; // flat extrusion; bevels add 2 * BEVEL
const BEVEL = 0.04;
const PX_PER_UNIT = 600;
const PLANE_LIFT = 0.02; // above the felt face, clear of the fuzz on it
const COLOR = "white";

export const BADGE_LENGTH = RADIUS; // grip -> center of mass, for Hang

function drawFace(texture, image) {
  const canvas = texture.image;
  const ctx = canvas.getContext("2d");
  const half = canvas.width / 2;
  ctx.setTransform(PX_PER_UNIT, 0, 0, -PX_PER_UNIT, half, half);
  ctx.clearRect(-RADIUS, -RADIUS, 2 * RADIUS, 2 * RADIUS);

  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, PHOTO_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.scale(1, -1); // the image is y down
    ctx.drawImage(image, -PHOTO_RADIUS, -PHOTO_RADIUS, 2 * PHOTO_RADIUS, 2 * PHOTO_RADIUS);
    ctx.restore();
  }

  ctx.strokeStyle = P.thread;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 0.018;
  ctx.lineCap = "round";
  ctx.setLineDash([0.05, 0.04]);
  ctx.beginPath();
  ctx.arc(0, 0, STITCH_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  texture.needsUpdate = true;
}

export function buildBadge() {
  const shape = new THREE.Shape();
  shape.absarc(0, -RADIUS, RADIUS, 0, Math.PI * 2, false);
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: THICK,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 4,
  });
  const geometry = finishPuffy(raw, 1, 1);
  geometry.computeBoundingBox();
  const zc = (geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2;
  geometry.translate(0, 0, -zc);
  geometry.computeBoundingBox();
  const half = geometry.boundingBox.max.z;

  const mesh = new THREE.Mesh(geometry, feltMaterial(COLOR));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  const fuzz = addFuzz(mesh, { color: P[COLOR], length: 0.014, density: 70, layers: 6, opacity: 0.8 });
  fuzz.raycast = () => {};

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(2 * RADIUS * PX_PER_UNIT);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  drawFace(texture, null);
  const image = new Image();
  image.onload = () => drawFace(texture, image);
  image.src = IMAGE_URL;

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * RADIUS, 2 * RADIUS).translate(0, -RADIUS, 0),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false }),
  );
  face.position.z = half + PLANE_LIFT;
  face.receiveShadow = true;
  face.raycast = () => {};

  const content = new THREE.Group();
  content.add(mesh, face);
  return { content, box: geometry.boundingBox.clone() };
}
