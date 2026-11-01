// Homepage hero: a knitted yarn clothesline with the name K R I S  Y A N G pegged on it in plush knit
// letters, and a felt badge with the owner's avatar hanging in the word space. Everything hangs in the z = 0 plane.
//
//   createHero({ scene, interaction, breeze }) -> { update(dt, t), letters, items (letters + badge), badge (its Hung), rope }
//
// Pieces: hero-letters (glyph geometry), avatar-badge (the avatar badge), hero-line (the rope and its sag
// calibration), hero-hung (one pegged item: pin, pendulum, squash springs, intro fall).
// Touch: hover = happy wiggle + plink (pitch follows the letter, so a sweep plays a melody), click = a full
// spin around the line + cloth whoosh, drag = grab the line at that peg, let go = it springs back and everything
// on the line bounces (a fast flick spins the letter). The badge uses the same handlers at a lower pitch.
// Units: world units, seconds.
import * as THREE from "three";
import { HERO } from "./layout.js";
import { createLine } from "./hero-line.js";
import { buildLetters, loadFont, makeLetterContent } from "./hero-letters.js";
import { buildBadge, BADGE_LENGTH } from "./avatar-badge.js";
import { Hung } from "./hero-hung.js";
import { unlockAudio, playPop, playPlink, playWhoosh, playElastic } from "./yarn/sound.js";

// ---- tunables ----------------------------------------------------------------------------------
const FONT_URL = `${import.meta.env.BASE_URL}fonts/fredoka-700.typeface.json`;

// layout
const BADGE_GAP = 0.35; // clear space between the badge and the K / Y beside it
const FIT_WIDTH = 18.2; // word + badge are centered as one group; tracking tightens (to MIN) until it fits this
const TRACK_MIN = 0.3; // world units; the bevel and fuzz stick out ~0.17 past each glyph edge
const TRACK_MAX = 0.4;

// weights (extra downward acceleration on the rope at the peg) and wind
const LETTER_WEIGHT = 110;
const BADGE_WEIGHT = 100;
const BADGE_WIND = 0.7;
const HANG_WIND = 2.5; // pendulum push per unit of breeze (units/s^2)
const REDUCED_WIND = 0.35; // wind scale when the visitor prefers reduced motion

// intro
const INTRO_START = 0.2; // s after the first frame
const LETTER_STEP = 0.08; // s between letters
const BADGE_AFTER = 0.15; // pause between the last letter and the badge dropping in

// touch feel
const WIGGLE = 0.5; // hover flip kick, in units of the pendulum's natural frequency
const SPIN = 3.2; // click flip kick; ~3x natural frequency carries it once over the top
const FLICK_SPEED = 9; // units/s of horizontal release speed that turns a drag into a spin
const HOVER_COOLDOWN = 0.2; // s
const PENTA = [1, 1.122, 1.26, 1.498, 1.682, 2, 2.245, 2.52]; // plink scale across the eight letters
const PITCH_BASE = 0.75;
const BADGE_PITCH = 0.6; // plink note of the badge, below the letters' scale
const BADGE_LAND_PITCH = 0.7;
const BADGE_WHOOSH_PITCH = 0.8;

const G = 9.8;
const PROXY_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// the word with the badge in its space; returns where each piece sits on the line (x of its peg), centered as a group
function layout(letters, tracking, slotWidth) {
  const spots = [];
  let pen = 0;
  let left = 0;
  let right = 0;
  let badgeX = 0;
  for (const l of letters) {
    if (!l) {
      badgeX = pen + slotWidth / 2;
      pen += slotWidth;
      continue;
    }
    if (spots.length === 0) left = pen + l.xMin;
    spots.push({ letter: l, pen });
    right = pen + l.xMax;
    pen += l.advance + tracking;
  }
  return { spots, badgeX, shift: -(left + right) / 2, span: right - left };
}

export async function createHero({ scene, interaction, breeze }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const windScale = reduced ? REDUCED_WIND : 1;
  const rng = mulberry32(20261101);

  const font = await loadFont(FONT_URL);
  const letterData = buildLetters(font, HERO.text, rng);
  const count = letterData.filter(Boolean).length;
  const badge = buildBadge();
  const slotWidth = badge.box.max.x - badge.box.min.x + 2 * BADGE_GAP;
  let plan = layout(letterData, 0, slotWidth);
  const tracking = THREE.MathUtils.clamp((FIT_WIDTH - plan.span) / Math.max(1, count - 1), TRACK_MIN, TRACK_MAX);
  plan = layout(letterData, tracking, slotWidth);

  const meanArea = plan.spots.reduce((s, p) => s + p.letter.area, 0) / count;
  const items = [];
  const letters = [];

  plan.spots.forEach(({ letter, pen }, m) => {
    const colorName = HERO.letterColors[HERO.text.indexOf(letter.ch)] ?? "coral";
    const item = new Hung({
      kind: "letter",
      x: plan.shift + pen + letter.gripX,
      content: makeLetterContent(letter, colorName),
      length: letter.length * (0.95 + 0.1 * rng()),
      weight: LETTER_WEIGHT * THREE.MathUtils.clamp(letter.area / meanArea, 0.7, 1.3),
      windGain: 0.8 + 0.4 * rng(),
      swingDamping: 1.2 + 0.5 * rng(),
      flipDamping: 0.9 + 0.3 * rng(),
      delay: INTRO_START + m * LETTER_STEP,
    });
    item.m = m;
    addProxy(item, letter.box, 0);
    items.push(item);
    letters.push(item);
  });

  const badgeItem = new Hung({
    kind: "badge",
    x: plan.shift + plan.badgeX,
    content: badge.content,
    length: BADGE_LENGTH,
    weight: BADGE_WEIGHT,
    windGain: BADGE_WIND,
    swingDamping: 1.3,
    flipDamping: 1,
    delay: INTRO_START + count * LETTER_STEP + BADGE_AFTER,
  });
  addProxy(badgeItem, badge.box, 0);
  items.push(badgeItem);

  // small random rest phases so nothing swings in lockstep
  for (const it of items) {
    it.hang.swing = (rng() - 0.5) * 0.06;
    it.hang.swingVel = (rng() - 0.5) * 0.5;
    it.hang.flip = (rng() - 0.5) * 0.06;
    it.hang.flipVel = (rng() - 0.5) * 0.4;
  }

  const line = createLine({ anchorX: HERO.anchorX, y: HERO.lineY, sag: HERO.sag });
  const rope = line.rope;
  line.setup(items, reduced);
  if (reduced) for (const it of items) it.skipIntro();

  scene.add(rope.mesh);
  for (const it of items) scene.add(it.pin, it.pivot);

  // ---- touch -------------------------------------------------------------------------------------
  const target = new THREE.Vector3();
  const pitchOf = (it) => (it.kind === "badge" ? BADGE_PITCH : PITCH_BASE * PENTA[Math.min(it.m, PENTA.length - 1)]);
  const natural = (it) => Math.sqrt(G / it.hang.length);
  const randomSign = () => (rng() < 0.5 ? -1 : 1);

  function wiggle(it) {
    it.cool = HOVER_COOLDOWN;
    const s = randomSign();
    const k = reduced ? 0.4 : 1;
    it.hang.kick(s * 0.6 * k, s * WIGGLE * natural(it) * k);
    it.squash(1.07, 0.97);
    playPlink({ pitch: pitchOf(it) });
  }

  function spin(it, strength = 1) {
    const s = randomSign();
    const k = reduced ? 0.6 : SPIN * strength * (0.95 + 0.1 * rng());
    it.hang.kick(s, s * k * natural(it));
    it.squash(0.82, 1.12);
    playWhoosh({ pitch: it.kind === "badge" ? BADGE_WHOOSH_PITCH : 0.9 + 0.25 * (it.m / (PENTA.length - 1)) });
  }

  function press(it, hit) {
    unlockAudio();
    it.pull = 0;
    it.start.copy(it.peg);
    it.dragOff.set(it.peg.x - hit.point.x, it.peg.y - hit.point.y, 0);
    it.squash(0.95, 1.03);
  }

  function dragTo(it, point) {
    if (it.phase !== "hung") return;
    if (!it.grab) {
      it.grab = rope.grab(Math.round(it.i + it.t));
      if (!it.grab) return;
    }
    target.set(point.x + it.dragOff.x, point.y + it.dragOff.y, 0);
    it.grab.move(target);
    it.pull = Math.max(it.pull, target.distanceTo(it.start));
  }

  function letGo(it, v) {
    if (!it.grab) return;
    it.grab.release();
    it.grab = null;
    const vx = v.x;
    const vy = v.y;
    it.hang.kick(THREE.MathUtils.clamp(vx * 0.25, -4, 4), THREE.MathUtils.clamp(vy * 0.2, -3, 3));
    it.squash(1.15, 0.93);
    if (!reduced && it.kind === "letter" && Math.abs(vx) > FLICK_SPEED) {
      const s = Math.sign(vx);
      it.hang.kick(0, s * SPIN * THREE.MathUtils.clamp(Math.abs(vx) / 20, 0.8, 1.2) * natural(it));
    }
    const far = THREE.MathUtils.clamp(it.pull / 3, 0, 1);
    if (it.pull > 0.25) playElastic({ pitch: 1.15 - 0.3 * far });
    else playPlink({ pitch: pitchOf(it) });
  }

  for (const it of items) {
    interaction.add(it.proxy, {
      cursor: "grab",
      hover(on) {
        if (on && it.phase === "hung" && it.cool <= 0) wiggle(it);
      },
      down(hit) {
        if (it.phase === "hung") press(it, hit);
      },
      drag(point) {
        dragTo(it, point);
      },
      up(v) {
        letGo(it, v);
      },
      click() {
        if (it.phase !== "hung") return;
        unlockAudio();
        spin(it);
      },
    });
  }

  // ---- intro landing -----------------------------------------------------------------------------
  function land(it) {
    it.squash(0.78, 1.14);
    it.hang.kick((rng() - 0.5) * 2.4, (rng() - 0.5) * 3.2);
    playPop({ pitch: it.kind === "badge" ? BADGE_LAND_PITCH : 0.9 + 0.05 * it.m });
  }

  // ---- frame -------------------------------------------------------------------------------------
  let clock = 0;
  const wind = { breeze, scale: windScale };

  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (!(dt > 0)) return;
    clock += dt;
    for (const it of items) if (it.tick(dt, clock)) land(it);
    line.writeLoads(items, wind);
    rope.update(dt);
    const dir = breeze.dir;
    for (const it of items) {
      const w = breeze.at(it.peg.x) * HANG_WIND * windScale;
      it.follow(rope, dt, w * dir.x, w * dir.z);
    }
  }

  function addProxy(item, box, pad) {
    const size = box.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x + pad, size.y + pad, Math.max(size.z, 0.4)), PROXY_MATERIAL);
    box.getCenter(proxy.position);
    item.body.add(proxy);
    item.proxy = proxy;
  }

  return { update, letters, items, badge: badgeItem, rope };
}
