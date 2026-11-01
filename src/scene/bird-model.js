// The needle-felted bird: geometry and pose, no behaviour.
//
//   const model = buildBirdModel();          // { root, body, head, tail, wingR, wingL, eyes, beakLow, proxy }
//   poseBird(model, pose);                   // writes every joint from one pose record
//
// Bird frame: feet at the origin, +y up, faces +z, about 0.82 tall and 0.64 wide (a hero letter is 1.4 tall).
// Scene graph: root (the owner places and rotates it) > body (squash and breathing about the feet) >
// head / tail / wings, plus an invisible hit proxy on root.
// pose = { squashY, squashXZ, wingOpen 0..1, flap -1..1, tail (rad, added to the rest angle),
//          headYaw, headPitch, headRoll (rad), blink 0..1, sleep 0..1, breath, beak (rad) }
// Units: world units, radians.
import * as THREE from "three";
import { P } from "./layout.js";
import { feltMaterial } from "./materials.js";
import { addFuzz } from "./yarn/fuzz.js";

// ---- tunables ----------------------------------------------------------------------------------
const COLOR = {
  back: "#a9c0de", // powder blue
  wing: "#90a9cb",
  belly: P.cream,
  cheek: "#f4a79d",
  beak: "#f0a247",
  leg: "#e0893d",
  eye: "#1b1513",
};
const FUZZ = { length: 0.028, density: 60, layers: 8, lighten: 0.2 };
const HEAD_Y = 0.58;
const HEAD_Z = 0.07;
const TAIL_REST = 0.3; // tail pitch up from horizontal
const WING_FOLD = -1.05; // right wing: tip hangs down along the body
const WING_FLAP_CENTER = 0.15;
const WING_FLAP_AMP = 0.85;
const WING_SWEEP_FOLD = 0.4; // folded wings lie back along the body
const WING_SWEEP_OPEN = 0.05;
const HIT_RADIUS = 0.5;

const sstep = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const felts = new Map();
function felt(c) {
  if (!felts.has(c)) felts.set(c, feltMaterial(c));
  return felts.get(c);
}

// a felt ball (ellipsoid via scale) with a fiber halo
function puff(parent, { r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, fuzz = true }) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 18), felt(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  if (fuzz) {
    const tint = new THREE.Color(color).lerp(new THREE.Color(P.white), FUZZ.lighten);
    addFuzz(mesh, { color: tint, length: FUZZ.length, density: FUZZ.density, layers: FUZZ.layers });
  }
  parent.add(mesh);
  return mesh;
}

function wing(side) {
  const pivot = new THREE.Group();
  pivot.rotation.order = "YZX"; // sweep back about y, then flap about z
  pivot.position.set(side * 0.27, 0.44, -0.02);
  puff(pivot, { r: 0.15, color: COLOR.wing, x: side * 0.14, sx: 1.45, sy: 0.4, sz: 1.1 });
  pivot.userData.side = side;
  return pivot;
}

export function buildBirdModel() {
  const root = new THREE.Group();
  root.rotation.order = "ZYX"; // roll with the rope, then turn, then pitch

  const body = new THREE.Group();
  root.add(body);

  puff(body, { r: 0.31, color: COLOR.back, y: 0.4, z: -0.02, sx: 1, sy: 0.97, sz: 1.08 });
  puff(body, { r: 0.27, color: COLOR.belly, y: 0.37, z: 0.1, sx: 0.97, sy: 0.98, sz: 0.9 });

  // legs and toes
  const legMat = new THREE.MeshStandardMaterial({ color: COLOR.leg, roughness: 0.7 });
  const legGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.12, 6);
  const toeGeo = new THREE.SphereGeometry(0.03, 8, 6);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(sx * 0.09, 0.07, 0.06);
    body.add(leg);
    const toe = new THREE.Mesh(toeGeo, legMat);
    toe.position.set(sx * 0.09, 0.015, 0.09);
    toe.scale.set(1, 0.45, 1.7);
    body.add(toe);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.3, -0.27);
  tail.rotation.x = TAIL_REST;
  puff(tail, { r: 0.09, color: COLOR.wing, z: -0.1, sx: 0.85, sy: 0.28, sz: 1.7 });
  body.add(tail);

  const wingR = wing(1);
  const wingL = wing(-1);
  body.add(wingR, wingL);

  // head: blue ball with a cream lower face, bead eyes, pink cheeks and a two-part beak
  const head = new THREE.Group();
  head.position.set(0, HEAD_Y, HEAD_Z);
  head.rotation.order = "YXZ"; // turn, nod, then tilt about the forward axis
  puff(head, { r: 0.255, color: COLOR.back, sy: 0.95 });
  puff(head, { r: 0.17, color: COLOR.belly, y: -0.1, z: 0.12, sx: 1.15, sy: 0.8, sz: 0.95 });
  body.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: COLOR.eye, roughness: 0.2 });
  const glintMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const beadGeo = new THREE.SphereGeometry(0.043, 14, 10);
  const glintGeo = new THREE.SphereGeometry(0.013, 8, 6);
  const lidGeo = new THREE.TorusGeometry(0.042, 0.0085, 6, 14, Math.PI);
  const eyes = [];
  for (const sign of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sign * 0.115, 0.045, 0.2);
    eye.rotation.y = sign * 0.5; // faces out along the head surface
    const bead = new THREE.Mesh(beadGeo, eyeMat);
    bead.position.z = 0.03;
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.set(0.013, 0.017, 0.032);
    bead.add(glint);
    // closed eye: a small U, shown only when asleep
    const lid = new THREE.Mesh(lidGeo, eyeMat);
    lid.rotation.z = Math.PI;
    lid.position.set(0, 0.018, 0.034);
    lid.scale.setScalar(0.001);
    eye.add(bead, lid);
    head.add(eye);
    eyes.push({ bead, lid });
  }

  for (const sign of [-1, 1]) {
    const cheek = puff(head, { r: 0.065, color: COLOR.cheek, x: sign * 0.176, y: -0.043, z: 0.176, sx: 1, sy: 0.8, sz: 0.4, fuzz: false });
    cheek.rotation.y = sign * 0.78;
  }

  const beakMat = new THREE.MeshStandardMaterial({ color: COLOR.beak, roughness: 0.7 });
  const beakGeo = new THREE.ConeGeometry(0.045, 0.1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.05);
  const beakUp = new THREE.Mesh(beakGeo, beakMat);
  beakUp.position.set(0, -0.015, 0.25);
  beakUp.scale.set(1, 0.75, 1);
  head.add(beakUp);
  const beakLow = new THREE.Group(); // hinge at the beak base; opens when it chirps
  beakLow.position.set(0, -0.042, 0.245);
  const lowMesh = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.075, 10).rotateX(Math.PI / 2).translate(0, 0, 0.0375), beakMat);
  lowMesh.scale.set(1, 0.7, 1);
  beakLow.add(lowMesh);
  head.add(beakLow);

  // invisible hit proxy, a little bigger than the bird
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(HIT_RADIUS, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.set(0, 0.42, 0.05);
  root.add(proxy);

  // shadows from every solid piece (fuzz shells, glints and the proxy stay out)
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o !== proxy && o.material !== glintMat) o.castShadow = true;
  });

  return { root, body, head, tail, wingR, wingL, eyes, beakLow, proxy };
}

export function poseBird(m, p) {
  const sl = p.sleep;
  // asleep: puffed up rounder, head tucked, breathing
  const k = 1 + 0.08 * sl + p.breath;
  m.body.scale.set(p.squashXZ * k, p.squashY * (1 + 0.02 * sl + 0.6 * p.breath), p.squashXZ * k);
  m.head.position.set(0, HEAD_Y - 0.08 * sl, HEAD_Z - 0.02 * sl);
  m.head.scale.setScalar(1 + 0.06 * sl);
  m.head.rotation.set(p.headPitch + 0.32 * sl, p.headYaw * (1 - 0.6 * sl), p.headRoll * (1 - 0.5 * sl) + 0.12 * sl);
  m.tail.rotation.x = TAIL_REST + p.tail - 0.1 * sl;

  const open = p.wingOpen;
  const beat = WING_FLAP_CENTER + WING_FLAP_AMP * p.flap;
  const a = WING_FOLD + (beat - WING_FOLD) * open - 0.1 * sl;
  const sweep = WING_SWEEP_FOLD * (1 - open) + WING_SWEEP_OPEN * open;
  m.wingR.rotation.set(0, sweep, a);
  m.wingL.rotation.set(0, -sweep, -a);

  // eyes: blink squashes the bead, sleep closes it and shows the curved line
  const close = Math.max(clamp01(p.blink), sstep(clamp01(sl / 0.6)));
  const lid = sstep(clamp01((sl - 0.55) / 0.45));
  for (const e of m.eyes) {
    e.bead.scale.set(1, Math.max(0.04, 1 - close), 1);
    e.bead.visible = close < 0.97;
    e.lid.scale.setScalar(Math.max(0.001, lid));
    e.lid.visible = lid > 0.01;
  }
  m.beakLow.rotation.x = p.beak;
}
