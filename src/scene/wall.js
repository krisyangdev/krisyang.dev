// The works wall: two knitted clotheslines with three felt polaroid cards each, then a garland of felt charms.
// Units: world units, everything in the z = 0 plane facing +z. Positions come from WALL in layout.js
// (the anchors sit at WALL.lines[i].y; the middle of each line sags LINE_SAG below that).
//
//   const wall = await createWall({ scene, camera, interaction, breeze });
//   stage.onUpdate((dt, t) => wall.update(dt, t));
//
// Cards: hover lifts and wiggles, click opens the link (or twirls when there is none), drag pulls the
// line by the nearest peg and flings it on release. Charms: hover spins and plays a note, click spins more.
// The whole wall stops simulating (and drawing) while it is scrolled out of view.
import * as THREE from "three";
import { WALL } from "./layout.js";
import { works } from "../data/works.js";
import { WallStrand } from "./wall-strand.js";
import { Card, createCardAssets, loadLabelFont } from "./wall-card.js";
import { Charm, CHARM_SPECS } from "./wall-charms.js";
import { unlockAudio, playElastic } from "./yarn/sound.js";

// ---- tunables
const PER_LINE = 3;
const LINE_SAG = 0.8; // how far the middle of a card line hangs below its anchors
const LINE_RADIUS = 0.05;
const GARLAND_SAG = 0.7;
const GARLAND_RADIUS = 0.04;
const GARLAND_HALF_WIDTH = 7; // charms are spread evenly over x = -7 .. 7
const CARD_WIND = 6; // card push at wind strength 1 (world units / s^2); the flip leans about atan(this * dir.z / 9.8)
const CHARM_WIND = 8;
const DRAG_MAX_PULL = 2.4; // farthest a peg follows the pointer
const FLING_GAIN = 0.5; // pointer velocity -> impulse on the line
const FLING_MAX = 14; // world units/s
const CALM_WIND = 0.4; // wind and kicks with prefers-reduced-motion
const CALM_MOTION = 0.45;
const VISIBLE_MARGIN = 1.2; // keep simulating this far (world units) outside the view

export async function createWall({ scene, camera, interaction, breeze }) {
  await loadLabelFont();

  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const windGain = calm ? CALM_WIND : 1;
  const motion = calm ? CALM_MOTION : 1;

  const root = new THREE.Group();
  root.name = "wall";
  scene.add(root);

  const assets = createCardAssets();
  const strands = [];
  const cards = [];
  const charms = [];

  // ---- card lines
  WALL.lines.forEach((line, li) => {
    const strand = new WallStrand({
      y: line.y,
      color: line.color,
      anchorX: WALL.anchorX,
      sag: LINE_SAG,
      radius: LINE_RADIUS,
    });
    strands.push(strand);
    root.add(strand.mesh);

    const group = works.slice(li * PER_LINE, (li + 1) * PER_LINE);
    group.forEach((work, ci) => {
      const centerX = (ci - (group.length - 1) / 2) * (WALL.cardWidth + WALL.cardGap);
      const card = new Card({ work, index: li * PER_LINE + ci, centerX, strand, assets, motion });
      cards.push(card);
      root.add(card.pivot);
    });
  });

  // ---- charm garland
  const garland = new WallStrand({
    y: WALL.charms.y,
    color: WALL.charms.color,
    anchorX: WALL.anchorX,
    sag: GARLAND_SAG,
    radius: GARLAND_RADIUS,
  });
  strands.push(garland);
  root.add(garland.mesh);
  CHARM_SPECS.forEach((spec, i) => {
    const x = -GARLAND_HALF_WIDTH + (i / (CHARM_SPECS.length - 1)) * GARLAND_HALF_WIDTH * 2;
    const charm = new Charm({ spec, index: i, x, strand: garland, motion });
    charms.push(charm);
    root.add(charm.root);
  });

  // loads are known now: let every line settle under its weights
  for (const strand of strands) strand.settle(breeze, windGain);
  for (const card of cards) card.update(1 / 60, 0, 0); // first pose, before the first frame is drawn
  for (const charm of charms) charm.update(1 / 60, 0, 0);

  // ---- interaction
  let drag = null; // { card, strand, index, grab, down, start, target, maxPull }

  const beginDrag = (card, hit) => {
    unlockAudio();
    drag = {
      card,
      strand: card.strand,
      index: card.nearerPeg(hit.point.x),
      grab: null,
      down: hit.point.clone(),
      start: new THREE.Vector3(),
      target: new THREE.Vector3(),
      maxPull: 0,
    };
  };

  const moveDrag = (point) => {
    const d = drag;
    if (!d) return;
    if (!d.grab) {
      d.grab = d.strand.rope.grab(d.index);
      if (!d.grab) return;
      d.strand.rope.positionOf(d.index, d.start);
    }
    d.target.copy(d.start).add(point).sub(d.down);
    d.target.z = d.start.z;
    const pull = d.target.distanceTo(d.start);
    if (pull > DRAG_MAX_PULL) d.target.lerpVectors(d.start, d.target, DRAG_MAX_PULL / pull);
    d.maxPull = Math.max(d.maxPull, Math.min(pull, DRAG_MAX_PULL));
    d.strand.clampPull(d.target, d.index);
    d.grab.move(d.target);
  };

  const endDrag = (velocity) => {
    const d = drag;
    drag = null;
    if (!d?.grab) return;
    d.grab.release();
    const vx = THREE.MathUtils.clamp(velocity.x, -FLING_MAX, FLING_MAX);
    const vy = THREE.MathUtils.clamp(velocity.y, -FLING_MAX, FLING_MAX);
    d.strand.addImpulse(d.index, vx * FLING_GAIN, vy * FLING_GAIN, 0, 6, 0.08);
    for (const card of cards) if (card.strand === d.strand) card.nudge(vx, vy);
    if (d.maxPull > 0.12) playElastic({ pitch: THREE.MathUtils.clamp(1.25 - d.maxPull * 0.2, 0.75, 1.2) });
  };

  for (const card of cards) {
    const { href } = card.work;
    interaction.add(card.interactive, {
      cursor: href ? "pointer" : "grab",
      hover: (on) => card.setHover(on),
      down: (hit) => beginDrag(card, hit),
      drag: moveDrag,
      up: endDrag,
      click: () => {
        drag = null;
        if (href) {
          window.open(href, "_blank", "noopener"); // inside the click handler, so popup blockers allow it
          card.tug();
        } else {
          card.twirl();
        }
      },
    });
  }

  for (const charm of charms) {
    interaction.add(charm.interactive, {
      cursor: "pointer",
      hover: (on) => charm.setHover(on),
      down: () => unlockAudio(),
      click: () => charm.burst(),
    });
  }

  // ---- frame loop
  const top = WALL.lines[0].y + 1.6;
  const bottom = WALL.charms.y - 1.8;
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  function update(dt) {
    const halfView = tanHalfFov * Math.abs(camera.position.z);
    const cy = camera.position.y;
    const visible = cy + halfView > bottom - VISIBLE_MARGIN && cy - halfView < top + VISIBLE_MARGIN;
    if (root.visible !== visible) root.visible = visible;
    if (!visible) return;

    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    for (const strand of strands) strand.update(dt, breeze, windGain);
    for (const card of cards) {
      const w = breeze.at(card.pivot.position.x) * CARD_WIND * windGain;
      card.update(dt, w * breeze.dir.x, w * breeze.dir.z);
    }
    for (const charm of charms) {
      const w = breeze.at(charm.root.position.x) * CHARM_WIND * windGain;
      charm.update(dt, w * breeze.dir.x, w * breeze.dir.z);
    }
  }

  return { update, cards, charms, strands };
}
