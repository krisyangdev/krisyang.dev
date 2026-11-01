// A felt polaroid card pegged to a wall line with two wooden clothespins.
// Units: world units. Card-local space: origin on the line (between the two pegs), x along the line,
// y up, z toward the camera; the felt frame hangs below at y < 0.
//
// A card follows its two rope particles every frame: position = their midpoint, roll = the segment's angle.
// A Hang drives the flip about the line (tip toward / away from the camera) from the pegs' acceleration and wind.
import * as THREE from "three";
import { P, WALL } from "./layout.js";
import { feltMaterial } from "./materials.js";
import { makeClothespin, PIN_GRIP_Y } from "./clothespin.js";
import { Hang } from "./hang.js";
import { Spring } from "./yarn/spring.js";
import { playTick, playWindchime, playPop } from "./yarn/sound.js";
import { TAU, noop, roundedRectShape, plush, fuzzOn, feltBump, AccelProbe, normalizeTurns } from "./wall-geo.js";

// ---- tunables
const FRAME_COLOR = "white";
const FRAME_CORNER = 0.22; // plan corner radius of the felt slab
const FRAME_BEVEL = 0.03; // rounded edge; slab thickness = FRAME_DEPTH + 2 * FRAME_BEVEL
const FRAME_DEPTH = 0.03;
const FRAME_FUZZ = { length: 0.022, density: 170, layers: 8, opacity: 0.85 };
const PHOTO_MARGIN = 0.2; // photo = cardWidth - 2 * margin, a square
const PHOTO_TOP = 0.3; // felt above the photo
const PHOTO_RISE = 0.02; // how far the print sits in front of the felt surface (keeps it clear of the fuzz)
const PHOTO_DEPTH = 0.04;
const PHOTO_CORNER = 0.07;
const PEG_INSET = 0.55; // peg center from the card's side edge
const PIN_SCALE = 1.35; // makeClothespin() is small; chunkier pegs read better at page scale
const PIN_LEAF = 0.055; // leaf thickness in clothespin.js
const PEG_BITE = 0.26; // how far the pegs' jaws reach down over the card's top edge
const HANG_WEIGHT = 25; // downward acceleration added to the line around each peg
const HANG_LENGTH = 1.1; // flip pendulum length; shorter = quicker flip
const SWAY_GAIN = 0.25; // share of the hang's in-plane swing the card shows
const LIFT_Z = 0.25; // hover: toward the camera
const LIFT_SCALE = 0.03;
const TWIRL = { stiffness: 70, damping: 7 };
const ANISOTROPY = 16; // the renderer clamps this to the GPU's maximum
const LABEL_W = 1024;
const DOODLES = ["heart", "smile", "star"];

// ---- shared assets ------------------------------------------------------------------------

export async function loadLabelFont() {
  try {
    const font = new FontFace("Fredoka", `url(${import.meta.env.BASE_URL}fonts/fredoka-600.woff)`, { weight: "600" });
    document.fonts.add(await font.load());
  } catch (err) {
    console.warn("wall: label font failed to load, using the fallback", err);
  }
}

export function createCardAssets() {
  const cw = WALL.cardWidth;
  const ch = WALL.cardHeight;
  const photo = cw - PHOTO_MARGIN * 2;

  let frameGeo = new THREE.ExtrudeGeometry(roundedRectShape(cw - FRAME_BEVEL * 2, ch - FRAME_BEVEL * 2, FRAME_CORNER), {
    depth: FRAME_DEPTH,
    bevelEnabled: true,
    bevelThickness: FRAME_BEVEL,
    bevelSize: FRAME_BEVEL,
    bevelSegments: 4,
    curveSegments: 10,
  });
  frameGeo.translate(0, 0, -FRAME_DEPTH / 2);
  frameGeo = plush(frameGeo, 1 / cw, 1 / ch);

  const frameMat = feltMaterial(FRAME_COLOR);
  frameMat.bumpMap = feltBump(cw, ch);
  frameMat.bumpScale = 0.5;

  const photoGeo = new THREE.ExtrudeGeometry(roundedRectShape(photo, photo, PHOTO_CORNER), {
    depth: PHOTO_DEPTH,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // uv 0..1 across the print (side walls just sample the edge pixels)
  const p = photoGeo.attributes.position;
  const uv = photoGeo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / photo + 0.5, p.getY(i) / photo + 0.5);

  return {
    frameGeo,
    frameMat,
    photoGeo,
    photoSize: photo,
    photoBump: feltBump(photo, photo),
    labelGeo: new THREE.PlaneGeometry(photo, ch - PHOTO_TOP - photo),
    proxyGeo: new THREE.BoxGeometry(cw, ch, 0.3),
    proxyMat: new THREE.MeshBasicMaterial({ visible: false }),
    textureLoader: new THREE.TextureLoader(),
  };
}

// ---- label --------------------------------------------------------------------------------

function heartPath(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.25, cy + s * 0.1, cx - s * 0.95, cy - s * 0.95, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.95, cy - s * 0.95, cx + s * 1.25, cy + s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
}

function starPath(ctx, cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? s * 0.5 : s;
    if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

// dashed light line inside the shape, like a running stitch
function stitch(ctx, path, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.7, 0.7);
  ctx.translate(-cx, -cy);
  path(ctx, cx, cy, s);
  ctx.setLineDash([8, 9]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.stroke();
  ctx.restore();
}

function drawDoodle(ctx, kind, cx, cy, size) {
  const s = size / 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (kind === "heart") {
    heartPath(ctx, cx, cy, s * 0.9);
    ctx.fillStyle = P.coral;
    ctx.fill();
    stitch(ctx, heartPath, cx, cy, s * 0.9);
  } else if (kind === "star") {
    starPath(ctx, cx, cy, s);
    ctx.fillStyle = P.mustard;
    ctx.strokeStyle = P.mustard;
    ctx.lineWidth = 10;
    ctx.fill();
    ctx.stroke();
    stitch(ctx, starPath, cx, cy, s);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.92, 0, TAU);
    ctx.fillStyle = P.mustard;
    ctx.fill();
    ctx.fillStyle = P.thread;
    for (const ex of [-0.33, 0.33]) {
      ctx.beginPath();
      ctx.arc(cx + s * ex, cy - s * 0.15, s * 0.1, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.08, s * 0.45, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.strokeStyle = P.thread;
    ctx.lineWidth = 7;
    ctx.stroke();
  }
}

function makeLabelTexture(title, doodle, aspect) {
  const W = LABEL_W;
  const H = Math.round(W * aspect);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const family = 'Fredoka, "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", sans-serif';
  const doodleSize = H * 0.36;
  const gap = H * 0.13;
  let font = H * 0.4;
  let textW;
  do {
    ctx.font = `600 ${font}px ${family}`;
    textW = ctx.measureText(title).width;
    font *= 0.95;
  } while (textW + gap + doodleSize > W - 90 && font > 30);
  const x0 = (W - (textW + gap + doodleSize)) / 2;
  const y = H / 2 + H * 0.02;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)"; // pressed-in highlight under the ink
  ctx.fillText(title, x0 + 2, y + 3);
  ctx.fillStyle = P.thread;
  ctx.fillText(title, x0, y);
  drawDoodle(ctx, doodle, x0 + textW + gap + doodleSize / 2, y, doodleSize);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  return tex;
}

// ---- card ---------------------------------------------------------------------------------

const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);
const qRoll = new THREE.Quaternion();
const qFlip = new THREE.Quaternion();

export class Card {
  constructor({ work, index, centerX, strand, assets, motion }) {
    const cw = WALL.cardWidth;
    const ch = WALL.cardHeight;
    this.work = work;
    this.strand = strand;
    this.motion = motion; // 1, or less with prefers-reduced-motion
    this.tilt = (index % 2 ? -1 : 1) * (0.018 + 0.008 * (index % 3)); // rest roll, rad

    const half = (cw - PEG_INSET * 2) / 2;
    this.iL = strand.nearest(centerX - half);
    this.iR = strand.nearest(centerX + half);
    strand.addLoad(this.iL, HANG_WEIGHT);
    strand.addLoad(this.iR, HANG_WEIGHT);

    this.hang = new Hang({ length: HANG_LENGTH, swingDamping: 1.6, flipDamping: 0.9 });
    this.lift = new Spring(160, 15, 0);
    this.twirlSpring = new Spring(TWIRL.stiffness, TWIRL.damping, 0);
    this.probe = new AccelProbe();
    this.hovered = false;

    this.pivot = new THREE.Group(); // on the line, takes the hang's rotation
    this.body = new THREE.Group(); // lifts and scales on hover; interaction handlers go here
    this.pivot.add(this.body);

    const top = PIN_SCALE * (PIN_GRIP_Y - 0.02) + PEG_BITE; // y of the felt's top edge
    const slab = FRAME_DEPTH + FRAME_BEVEL * 2;

    const frame = new THREE.Mesh(assets.frameGeo, assets.frameMat);
    frame.position.y = top - ch / 2;
    frame.castShadow = true;
    frame.receiveShadow = true;
    fuzzOn(frame, { color: P.white, ...FRAME_FUZZ });
    this.body.add(frame);

    const photoY = top - PHOTO_TOP - assets.photoSize / 2;
    const printFront = slab / 2 + PHOTO_RISE;
    this.photoMat = new THREE.MeshStandardMaterial({
      color: P.oat,
      roughness: 0.85,
      metalness: 0,
      bumpMap: assets.photoBump,
      bumpScale: 0.25,
    });
    const photo = new THREE.Mesh(assets.photoGeo, this.photoMat);
    photo.position.set(0, photoY, printFront - PHOTO_DEPTH);
    photo.receiveShadow = true;
    this.body.add(photo);
    assets.textureLoader.load(work.image, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = ANISOTROPY;
      this.photoMat.map = tex;
      this.photoMat.color.set(0xffffff);
      this.photoMat.needsUpdate = true;
    });

    const labelH = ch - PHOTO_TOP - assets.photoSize;
    const label = new THREE.Mesh(
      assets.labelGeo,
      new THREE.MeshStandardMaterial({
        map: makeLabelTexture(work.title, DOODLES[index % DOODLES.length], labelH / assets.photoSize),
        transparent: true,
        roughness: 1,
        metalness: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    label.position.set(0, top - PHOTO_TOP - assets.photoSize - labelH / 2, printFront + 0.001);
    label.receiveShadow = true;
    this.body.add(label);

    // pegs: leaves straddle the felt slab instead of the thin cloth the clothespin was drawn for
    this.pins = [-1, 1].map((side) => {
      const pin = makeClothespin();
      pin.scale.setScalar(PIN_SCALE);
      const z = (slab / 2 + (PIN_LEAF * PIN_SCALE) / 2 - 0.012) / PIN_SCALE;
      pin.children[0].position.z = -z;
      pin.children[1].position.z = z;
      pin.children[2].scale.z = 1.5;
      pin.rotation.z = side * (0.04 + 0.02 * (index % 2));
      this.body.add(pin);
      return pin;
    });

    const proxy = new THREE.Mesh(assets.proxyGeo, assets.proxyMat);
    proxy.position.set(0, top - ch / 2, 0.05);
    this.body.add(proxy);
    this.body.traverse((o) => {
      if (o !== proxy) o.raycast = noop;
    });
  }

  get interactive() {
    return this.body;
  }

  // ---- reactions

  setHover(on) {
    if (on === this.hovered) return;
    this.hovered = on;
    this.lift.target = on ? 1 : 0;
    if (!on) return;
    this.hang.kick((Math.random() - 0.5) * 0.8 * this.motion, (Math.random() < 0.5 ? -1 : 1) * 2.4 * this.motion);
    playTick({ pitch: 0.9 + Math.random() * 0.2 });
  }

  // a full flip about the line (no link behind this card yet)
  twirl() {
    if (Math.abs(this.twirlSpring.target - this.twirlSpring.value) > 1.5) return;
    this.twirlSpring.target -= TAU;
    playWindchime();
  }

  // dip and spring back: the line does the dipping, see WallStrand.addImpulse
  tug() {
    this.strand.addImpulse(this.iL, 0, -3.2, 0, 3);
    this.strand.addImpulse(this.iR, 0, -3.2, 0, 3);
    this.hang.kick(0, 1.6 * this.motion);
    playPop({ pitch: 1.1 });
  }

  // the line was flung: small extra sway on top of what the pegs' motion already gives
  nudge(vx, vy) {
    this.hang.kick(vx * 0.04 * this.motion, (vy * 0.05 + (Math.random() - 0.5) * 2) * this.motion);
  }

  // world x of the peg nearer to x, as the index of its rope particle
  nearerPeg(x) {
    const pos = this.strand.rope.pos;
    return Math.abs(pos[this.iL * 3] - x) < Math.abs(pos[this.iR * 3] - x) ? this.iL : this.iR;
  }

  // ---- per frame; windX / windZ: wind push in world units/s^2 at this card

  update(dt, windX, windZ) {
    const pos = this.strand.rope.pos;
    const l = this.iL * 3;
    const r = this.iR * 3;
    const mx = (pos[l] + pos[r]) / 2;
    const my = (pos[l + 1] + pos[r + 1]) / 2;
    const mz = (pos[l + 2] + pos[r + 2]) / 2;
    const dx = pos[r] - pos[l];
    const dy = pos[r + 1] - pos[l + 1];
    const dz = pos[r + 2] - pos[l + 2];

    const { hang } = this;
    hang.update(dt, this.probe.update(dt, mx, my, mz), windX, windZ);
    this.lift.update(dt);
    this.twirlSpring.update(dt);
    normalizeTurns(this.twirlSpring);

    this.pivot.position.set(mx, my, mz);
    qRoll.setFromAxisAngle(Z, Math.atan2(dy, dx) + this.tilt + hang.swing * SWAY_GAIN);
    qFlip.setFromAxisAngle(X, hang.flip + this.twirlSpring.value);
    this.pivot.quaternion.copy(qRoll).multiply(qFlip);

    this.body.position.z = this.lift.value * LIFT_Z;
    this.body.scale.setScalar(1 + this.lift.value * LIFT_SCALE);

    const halfLen = Math.hypot(dx, dy, dz) / 2;
    this.pins[0].position.x = -halfLen;
    this.pins[1].position.x = halfLen;
  }
}
