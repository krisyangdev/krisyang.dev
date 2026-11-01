// String lights on the hero clothesline: felt-covered bulbs on a thin green wire that wraps the line
// and swoops down to every bulb, plus a few warm point lights that make the letters glow at night.
//
//   createNightLights({ scene, interaction, breeze, daynight, hero }) -> { update(dt, t) }
//
// Everything is placed from the hero rope's particles every frame (rope.pos), so the lights move
// when the line is pulled or bounced. Each wire sample and bulb is pinned to a fractional particle
// index chosen once, from where it sits on the line at rest.
// Day: dull beads and the wire. Night (daynight.night 0..1): beads glow (emissive + additive sprite) with
// an uneven twinkle, and the point lights fade in.
// Touch: hover brightens a bulb at night; click sends a ripple of brightness along the string with a
// rising plink arpeggio.
// Units: world units, seconds.
import * as THREE from "three";
import { feltMaterial } from "./materials.js";
import { Spring } from "./yarn/spring.js";
import { playPlink } from "./yarn/sound.js";
import { createWire } from "./night-lights-wire.js";
import { createBulb, GLOW_SIZE } from "./night-lights-bulb.js";

// ---- tunables ----------------------------------------------------------------------------------
// layout
const BULBS = 22;
const X_FROM = -11.5; // first and last bulb on the line at rest
const X_TO = 11.5;
const DROOP = 0.2; // the wire hangs this far below the rope at each bulb
const FRONT = 0.26; // and this far in front of it (clear of the letters, whose front face is ~0.17)
const WRAP_RADIUS = 0.08; // between bulbs the wire winds around the rope
const WRAP_PITCH = 0.7; // x length of one turn
const SAMPLES_PER_GAP = 8; // wire samples between two bulbs (even, so a sample sits on every bulb)
const WIRE_RADIUS = 0.013;

// look
const WIRE_COLOR = "#4f6b54";
const BULB_COLOR = "#f0d296"; // felt bead by day
const GLOW_COLOR = "#ffcf8a";
const EMISSIVE_PEAK = 1.5; // emissive intensity at full brightness
const GLOW_OPACITY = 0.85;
const TWINKLE_BASE = 0.86;
const TWINKLE_A = 0.1;
const TWINKLE_B = 0.05;
const INTRO_START = 0.6; // s, bulbs pop in left to right
const INTRO_STEP = 0.045;
const INTRO_TIME = 0.4;

// sway
const BREEZE_LEAN = 0.12; // rad per unit of breeze
const IDLE_SWAY = 0.04; // rad
const TRAIL = 0.12; // rad per unit/s of the wire point's horizontal speed (bulbs trail a moving line)
const REDUCED_SCALE = 0.35;

// point lights that light the letters
const LIGHT_XS = [-8, -4, 0, 4, 8];
const LIGHT_Z = 0.6;
const LIGHT_DROP = 0.7; // below the line
const LIGHT_COLOR = "#ffcf8a";
const LIGHT_INTENSITY = 1.6;
const LIGHT_DISTANCE = 4.5;
const LIGHT_DECAY = 1.2;

// touch
const HOVER_RATE = 10; // 1/s
const HOVER_GAIN = 0.7; // extra brightness while hovered
const RIPPLE_SPEED = 16; // bulbs/s
const RIPPLE_TAIL = 2.5; // bulbs, how far the glow trails behind the front
const RIPPLE_GAIN = 1.1;
const RIPPLE_SLOTS = 3;
const NOTE_EVERY = 2; // bulbs between plinks
const NOTES = 8;
const PENTA = [1, 1.122, 1.26, 1.498, 1.682, 2, 2.245, 2.52];
const PITCH_BASE = 0.9;

const TAU = Math.PI * 2;
const SAMPLES = BULBS * SAMPLES_PER_GAP + 1;
const HALF = SAMPLES_PER_GAP / 2;

const clamp = THREE.MathUtils.clamp;
const hash = (n) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
const easeOutBack = (x) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;

export function createNightLights({ scene, interaction, breeze, daynight, hero }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const calm = reduced ? REDUCED_SCALE : 1;
  const rope = hero.rope;

  // ---- where everything sits on the rope ---------------------------------------------------------
  // x -> fractional particle index { i, t } on the line as it is now
  function locate(x, outI, outT, slot) {
    const p = rope.pos;
    const last = rope.count - 2;
    let i = 0;
    while (i < last && p[(i + 1) * 3] < x) i++;
    const x0 = p[i * 3];
    const x1 = p[(i + 1) * 3];
    outI[slot] = i;
    outT[slot] = clamp((x - x0) / (x1 - x0 || 1), 0, 1);
  }

  // bulb k sits at X_FROM + k * gap; the spacing continues past both ends for the wire's tails
  const gap = (X_TO - X_FROM) / (BULBS - 1);

  const sampleI = new Int32Array(SAMPLES);
  const sampleT = new Float32Array(SAMPLES);
  const offY = new Float32Array(SAMPLES); // wire offset from the rope point
  const offZ = new Float32Array(SAMPLES);
  for (let j = 0; j < SAMPLES; j++) {
    const g = -0.5 + j / SAMPLES_PER_GAP; // bulb k is at g = k
    const x = X_FROM + g * gap;
    locate(x, sampleI, sampleT, j);
    const c = Math.cos(Math.PI * g);
    const w = c * c; // 1 at a bulb, 0 halfway between two
    const phase = (TAU * (x - X_FROM)) / WRAP_PITCH;
    offY[j] = -DROOP * w + WRAP_RADIUS * (1 - w) * Math.cos(phase);
    offZ[j] = FRONT * w + WRAP_RADIUS * (1 - w) * Math.sin(phase);
  }

  // ---- wire ---------------------------------------------------------------------------------------
  const wireMaterial = new THREE.MeshStandardMaterial({ color: WIRE_COLOR, roughness: 0.75, metalness: 0 });
  const wire = createWire({ samples: SAMPLES, radius: WIRE_RADIUS, material: wireMaterial });
  const centers = wire.centers;
  scene.add(wire.mesh);

  function placeWire() {
    const pos = rope.pos;
    for (let j = 0; j < SAMPLES; j++) {
      const a = sampleI[j] * 3;
      const b = a + 3;
      const f = sampleT[j];
      centers[j * 3] = pos[a] + (pos[b] - pos[a]) * f;
      centers[j * 3 + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f + offY[j];
      centers[j * 3 + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * f + offZ[j];
    }
    wire.rebuild();
  }
  placeWire();

  // ---- bulbs --------------------------------------------------------------------------------------
  const bead = feltMaterial(BULB_COLOR);
  bead.emissive.set(GLOW_COLOR);
  bead.emissiveIntensity = 0;

  const bulbs = [];
  const swing = [];
  const lastX = new Float32Array(BULBS);
  const hover = new Float32Array(BULBS);
  const hoverTarget = new Float32Array(BULBS);
  const pulse = new Float32Array(BULBS);
  const level = new Float32Array(BULBS); // brightness without hover, for the point lights
  const twinkle = [];

  for (let k = 0; k < BULBS; k++) {
    const b = createBulb({ bead, capMaterial: wireMaterial, glowColor: GLOW_COLOR });
    b.group.visible = reduced;
    scene.add(b.group);
    bulbs.push(b);
    swing.push(new Spring(70, 5, 0));
    lastX[k] = centers[(k * SAMPLES_PER_GAP + HALF) * 3];
    twinkle.push({
      fa: (1.2 + 1.2 * hash(k + 1)) * calm,
      fb: (3.1 + 2.2 * hash(k + 31)) * calm,
      pa: TAU * hash(k + 61),
      pb: TAU * hash(k + 91),
      fc: 0.3 + 0.4 * hash(k + 121),
      pc: TAU * hash(k + 151),
    });
  }

  // ---- point lights -------------------------------------------------------------------------------
  const lightI = new Int32Array(LIGHT_XS.length);
  const lightT = new Float32Array(LIGHT_XS.length);
  const lightBulb = new Int32Array(LIGHT_XS.length); // nearest bulb, whose twinkle the light follows
  const lights = LIGHT_XS.map((x, m) => {
    locate(x, lightI, lightT, m);
    lightBulb[m] = clamp(Math.round((x - X_FROM) / gap), 0, BULBS - 1);
    const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, LIGHT_DECAY);
    scene.add(light);
    return light;
  });

  // ---- touch --------------------------------------------------------------------------------------
  const ripples = Array.from({ length: RIPPLE_SLOTS }, () => ({ on: false, origin: 0, time: 0, note: 0 }));
  let nextRipple = 0;

  function startRipple(origin) {
    const r = ripples[nextRipple];
    nextRipple = (nextRipple + 1) % RIPPLE_SLOTS;
    r.on = true;
    r.origin = origin;
    r.time = 0;
    r.note = 0;
  }

  bulbs.forEach((b, k) => {
    interaction.add(b.proxy, {
      cursor: "pointer",
      hover(on) {
        hoverTarget[k] = on ? 1 : 0;
      },
      click() {
        startRipple(k);
      },
    });
  });

  function stepRipples(dt) {
    pulse.fill(0);
    const maxFront = BULBS + 4 * RIPPLE_TAIL;
    for (const r of ripples) {
      if (!r.on) continue;
      r.time += dt;
      const front = RIPPLE_SPEED * r.time;
      if (front > maxFront) {
        r.on = false;
        continue;
      }
      // one plink each time the front passes a note position; pitch climbs with the distance
      while (r.note < NOTES && front >= r.note * NOTE_EVERY) {
        playPlink({ pitch: PITCH_BASE * PENTA[r.note] });
        r.note++;
      }
      for (let k = 0; k < BULBS; k++) {
        const behind = front - Math.abs(k - r.origin);
        // sharp leading edge, long soft tail
        pulse[k] += RIPPLE_GAIN * (behind >= 0 ? Math.exp(-behind / RIPPLE_TAIL) : Math.exp(-behind * behind * 2.5));
      }
    }
  }

  // ---- frame --------------------------------------------------------------------------------------
  let clock = 0;

  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (!(dt > 0)) return;
    clock += dt;
    const night = daynight.night;
    const pos = rope.pos;

    placeWire();
    stepRipples(dt);

    const dir = breeze.dir;
    const hoverStep = 1 - Math.exp(-HOVER_RATE * dt);
    for (let k = 0; k < BULBS; k++) {
      const b = bulbs[k];
      const j = k * SAMPLES_PER_GAP + HALF;
      const cx = centers[j * 3];
      b.group.position.set(cx, centers[j * 3 + 1], centers[j * 3 + 2]);

      const ap = reduced ? 1 : clamp((clock - INTRO_START - k * INTRO_STEP) / INTRO_TIME, 0, 1);
      b.group.visible = ap > 0;
      hover[k] += (hoverTarget[k] - hover[k]) * hoverStep;
      const p = pulse[k];
      b.group.scale.setScalar(easeOutBack(ap) * (1 + 0.12 * hover[k] + 0.18 * Math.min(p, 1)));

      // hangs from the wire: leans with the breeze and trails behind a moving line
      const dx = centers[(j + 1) * 3] - centers[(j - 1) * 3];
      const slope = (centers[(j + 1) * 3 + 1] - centers[(j - 1) * 3 + 1]) / (dx || 1);
      const vx = (cx - lastX[k]) / dt;
      lastX[k] = cx;
      const lean = (breeze.at(cx) * dir.x * BREEZE_LEAN + IDLE_SWAY * Math.sin(clock * 1.7 + k * 1.9)) * calm;
      const s = swing[k];
      s.target = lean + slope * 0.4 - clamp(vx * TRAIL, -0.5, 0.5);
      b.group.rotation.z = s.update(dt);

      // uneven twinkle, plus whatever the ripple adds
      const tw = twinkle[k];
      const flicker =
        TWINKLE_BASE +
        calm * (TWINKLE_A * Math.sin(clock * tw.fa + tw.pa) + TWINKLE_B * Math.sin(clock * tw.fb + tw.pb) + 0.06 * Math.sin(clock * tw.fc + tw.pc));
      level[k] = flicker + p;
      const glow = night * (level[k] + HOVER_GAIN * hover[k]);
      b.material.emissiveIntensity = EMISSIVE_PEAK * glow;
      b.sprite.visible = glow > 0.003;
      b.spriteMaterial.opacity = Math.min(1, GLOW_OPACITY * glow);
      b.sprite.scale.setScalar(GLOW_SIZE * (0.9 + 0.2 * Math.min(glow, 1.5)));
    }

    for (let m = 0; m < lights.length; m++) {
      const a = lightI[m] * 3;
      const f = lightT[m];
      const x = pos[a] + (pos[a + 3] - pos[a]) * f;
      const y = pos[a + 1] + (pos[a + 4] - pos[a + 1]) * f;
      const light = lights[m];
      light.position.set(x, y - LIGHT_DROP, LIGHT_Z);
      light.intensity = LIGHT_INTENSITY * night * (0.7 + 0.3 * Math.min(level[lightBulb[m]], 1.6));
    }
  }

  return { update };
}
