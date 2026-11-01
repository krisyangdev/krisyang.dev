// The charm garland: small felt shapes hanging on short yarn loops from a rope.
// Units: world units. Charm-local space: origin = where the loop wraps the rope, the charm hangs below at y < 0.
//
//   root (Hang rotation: swing about z, flip about the line)
//     loop mesh (yarn ring around the rope + cord)
//     spin group at the cord's end (turns about the vertical axis on hover / click)
//       felt shape
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { P } from "./layout.js";
import { feltMaterial, strandMaterial } from "./materials.js";
import { Hang } from "./hang.js";
import { Spring } from "./yarn/spring.js";
import { playPlink, playPop } from "./yarn/sound.js";
import { TAU, noop, plush, fuzzOn, AccelProbe, normalizeTurns } from "./wall-geo.js";

// ---- tunables
export const CHARM_SPECS = [
  { kind: "cloud", color: "white" },
  { kind: "star", color: "mustard" },
  { kind: "heart", color: "pink" },
  { kind: "flower", color: "lavender", center: "mustard" },
  { kind: "leaves", color: "sage" },
  { kind: "cloud", color: "sky" },
  { kind: "heart", color: "coral" },
  { kind: "flower", color: "white", center: "mustard" },
  { kind: "star", color: "lavender" },
  { kind: "leaves", color: "sage" },
];
const SEMITONES = [-7, -5, -3, 0, 2, 4, 7, 9, 12, 14]; // pentatonic, left to right
const RING_R = 0.085; // yarn ring around the rope
const CORD = 0.26; // ring center to the top of the charm
const CHARM_WEIGHT = 30;
const FUZZ = { length: 0.02, density: 70, layers: 8, opacity: 0.9 };
const SPIN = { stiffness: 80, damping: 8.5 };
const HOVER_COOLDOWN = 0.18; // s between hover spins of one charm
const YARN_TILE = 0.44; // world length of one strand texture tile (Rope uses 2 * twist)

let yarn;
const yarnMaterial = () => (yarn ??= strandMaterial("oat"));

const feltCache = new Map();
const felt = (c) => {
  if (!feltCache.has(c)) feltCache.set(c, feltMaterial(c));
  return feltCache.get(c);
};

// ---- shapes -------------------------------------------------------------------------------

function merge(geos) {
  const g = mergeGeometries(geos);
  geos.forEach((x) => x.dispose());
  return g;
}

function puffy(shape, { depth = 0.04, thickness = 0.06, size = 0.045 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: thickness,
    bevelSize: size,
    bevelSegments: 4,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return plush(g, 1, 1);
}

// center a geometry on its bounding box; returns its half height
function centered(geo) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, 0);
  geo.computeBoundingBox();
  return geo.boundingBox.max.y;
}

function part(geo, color, fuzzOptions = FUZZ) {
  const mesh = new THREE.Mesh(geo, felt(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  fuzzOn(mesh, { color: P[color] ?? color, ...fuzzOptions });
  return mesh;
}

function buildCloud({ color }) {
  const S = 0.62;
  const bumps = [
    [-0.3, -0.04, 0.17],
    [-0.14, 0.08, 0.22],
    [0.1, 0.1, 0.21],
    [0.3, -0.03, 0.17],
    [0, -0.1, 0.21],
    [-0.17, -0.12, 0.15],
    [0.17, -0.12, 0.15],
  ];
  const geo = merge(
    bumps.map(([x, y, r]) => new THREE.SphereGeometry(1, 20, 14).scale(r * S, r * S, r * S * 0.6).translate(x * S, y * S, 0)),
  );
  const halfH = centered(geo);
  return { object: part(geo, color), halfH };
}

function buildStar({ color }) {
  // rounded five-point outline: radius swings between the valleys and the tips
  const shape = new THREE.Shape();
  const N = 80;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const r = 0.1 + 0.125 * Math.pow(Math.abs(Math.cos(2.5 * (a - Math.PI / 2))), 1.5);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i) shape.lineTo(x, y);
    else shape.moveTo(x, y);
  }
  shape.closePath();
  const geo = puffy(shape, { depth: 0.04, thickness: 0.07, size: 0.05 });
  const halfH = centered(geo);
  return { object: part(geo, color), halfH };
}

function buildHeart({ color }) {
  // the three.js heart outline (y points down there), scaled to ~0.5 wide and turned upright
  const k = 0.0042;
  const pt = (x, y) => [(x - 25) * k, -(y - 47.5) * k];
  const shape = new THREE.Shape();
  shape.moveTo(...pt(25, 25));
  shape.bezierCurveTo(...pt(25, 25), ...pt(20, 0), ...pt(0, 0));
  shape.bezierCurveTo(...pt(-30, 0), ...pt(-30, 35), ...pt(-30, 35));
  shape.bezierCurveTo(...pt(-30, 55), ...pt(-10, 77), ...pt(25, 95));
  shape.bezierCurveTo(...pt(60, 77), ...pt(80, 55), ...pt(80, 35));
  shape.bezierCurveTo(...pt(80, 35), ...pt(80, 0), ...pt(50, 0));
  shape.bezierCurveTo(...pt(35, 0), ...pt(25, 25), ...pt(25, 25));
  const geo = puffy(shape, { depth: 0.04, thickness: 0.06, size: 0.04 });
  const halfH = centered(geo);
  return { object: part(geo, color), halfH };
}

function buildLeaves({ color }) {
  const L = 0.36;
  const leaf = (scale, angle) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.14, 0.06, 0.14, 0.24, 0, L);
    s.bezierCurveTo(-0.14, 0.24, -0.14, 0.06, 0, 0);
    const g = puffy(s, { depth: 0.03, thickness: 0.04, size: 0.03 });
    g.scale(scale, scale, 1);
    g.rotateZ(angle);
    return g;
  };
  const geo = merge([leaf(1, Math.PI - 0.55), leaf(0.88, Math.PI + 0.6)]);
  const halfH = centered(geo);
  return { object: part(geo, color), halfH };
}

function buildFlower({ color, center }) {
  const petals = [];
  for (let i = 0; i < 6; i++) {
    petals.push(
      new THREE.SphereGeometry(1, 16, 12)
        .scale(0.105, 0.14, 0.075)
        .translate(0, 0.16, 0)
        .rotateZ((i * Math.PI) / 3),
    );
  }
  const geo = merge(petals);
  geo.computeBoundingBox();
  const halfH = geo.boundingBox.max.y;
  const group = new THREE.Group();
  group.add(part(geo, color));
  const heart = new THREE.SphereGeometry(1, 16, 12).scale(0.09, 0.09, 0.07).translate(0, 0, 0.06);
  group.add(part(heart, center, { ...FUZZ, length: 0.012 }));
  return { object: group, halfH };
}

const BUILDERS = { cloud: buildCloud, star: buildStar, heart: buildHeart, leaves: buildLeaves, flower: buildFlower };

// ---- yarn loop ----------------------------------------------------------------------------

let loopGeometry;

function tube(points, closed, radius, segments) {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  const g = new THREE.TubeGeometry(curve, segments, radius, 6, closed);
  // u runs 0..1 along the curve; stretch it so the strand texture keeps the rope's twist size
  const uv = g.attributes.uv;
  const scale = curve.getLength() / YARN_TILE;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * scale);
  return g;
}

function loop() {
  if (loopGeometry) return loopGeometry;
  const ring = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ring.push(new THREE.Vector3(0, Math.cos(a) * RING_R, Math.sin(a) * RING_R));
  }
  const cord = [new THREE.Vector3(0, -RING_R, 0), new THREE.Vector3(0, -(RING_R + CORD) / 2, 0), new THREE.Vector3(0, -CORD, 0)];
  loopGeometry = merge([tube(ring, true, 0.022, 24), tube(cord, false, 0.02, 6)]);
  return loopGeometry;
}

// ---- charm --------------------------------------------------------------------------------

export class Charm {
  constructor({ spec, index, x, strand, motion }) {
    this.strand = strand;
    this.motion = motion;
    this.i = strand.nearest(x);
    this.pitch = 2 ** (SEMITONES[index % SEMITONES.length] / 12);
    this.dir = index % 2 ? -1 : 1; // spin direction, flips every charm
    strand.addLoad(this.i, CHARM_WEIGHT);

    const { object, halfH } = BUILDERS[spec.kind](spec);
    this.root = new THREE.Group();
    const cord = new THREE.Mesh(loop(), yarnMaterial());
    cord.castShadow = true;
    this.root.add(cord);

    this.spinGroup = new THREE.Group();
    this.spinGroup.position.y = -CORD;
    object.position.y = -halfH + 0.03;
    this.spinGroup.add(object);
    this.root.add(this.spinGroup);

    const proxy = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.36, halfH + 0.12), 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.y = -CORD - halfH;
    this.root.add(proxy);
    this.root.traverse((o) => {
      if (o !== proxy) o.raycast = noop;
    });

    this.hang = new Hang({ length: CORD + halfH, swingDamping: 1.2, flipDamping: 1.0 });
    this.spin = new Spring(SPIN.stiffness, SPIN.damping, 0);
    this.lift = new Spring(200, 16, 0);
    this.pop = new Spring(220, 12, 0);
    this.probe = new AccelProbe();
    this.lastHover = -1;
    this.clock = 0;
    this.hovered = false;
  }

  get interactive() {
    return this.root;
  }

  setHover(on) {
    if (on === this.hovered) return;
    this.hovered = on;
    this.lift.target = on ? 1 : 0;
    if (!on || this.clock - this.lastHover < HOVER_COOLDOWN) return;
    this.lastHover = this.clock;
    if (Math.abs(this.spin.target - this.spin.value) < 1.5) this.spin.target += TAU * this.dir;
    this.hang.kick(this.dir * 1.2 * this.motion, 1.2 * this.motion);
    playPlink({ pitch: this.pitch });
  }

  burst() {
    this.spin.target += TAU * 2 * this.dir;
    this.pop.kick(7);
    this.hang.kick(this.dir * 2 * this.motion, -2 * this.motion);
    playPop({ pitch: this.pitch });
  }

  // windX / windZ: wind push in world units/s^2 at this charm
  update(dt, windX, windZ) {
    this.clock += dt;
    const pos = this.strand.rope.pos;
    const k = this.i * 3;
    const a = (this.i - 2) * 3;
    const b = (this.i + 2) * 3;
    const px = pos[k];
    const py = pos[k + 1];
    const pz = pos[k + 2];
    this.hang.update(dt, this.probe.update(dt, px, py, pz), windX, windZ);
    this.hang.apply(this.root, this.root.position.set(px, py, pz), Math.atan2(pos[b + 1] - pos[a + 1], pos[b] - pos[a]));

    this.spin.update(dt);
    normalizeTurns(this.spin);
    this.lift.update(dt);
    this.pop.update(dt);
    this.spinGroup.rotation.y = this.spin.value;
    this.spinGroup.scale.setScalar(1 + this.lift.value * 0.12 + this.pop.value * 0.25);
  }
}
