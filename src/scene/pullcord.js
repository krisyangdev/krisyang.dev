// A yarn pull cord with a cream pompom hanging from the top right corner of the hero view.
// Pull it down past a click and let go: the day / night switch flips and the cord springs back.
//
//   createPullCord({ scene, camera, interaction, breeze, daynight }) -> { update(dt, t) }
//
// The cord is a short Rope anchored above the top edge of the view (at scroll 0), its last particle
// carries the pompom. It lives in the world, so it scrolls away with the page. The anchor follows the
// camera framing (aspect and distance), so on any screen the cord hangs near the top right corner.
// Pulling: the pointer grabs the last particle through a rubber curve (resistance grows with the pull),
// and the cord's rest segment length grows so the cord stretches a little. Past PULL_CLICK it clicks;
// on release the stretch springs back (the cord bounces) and the switch flips. A plain click tugs once
// and flips it. Hover wiggles the pompom; the breeze sways the whole cord.
// Units: world units, seconds.
import * as THREE from "three";
import { Rope } from "./yarn/rope.js";
import { Spring } from "./yarn/spring.js";
import { addFuzz } from "./yarn/fuzz.js";
import { strandMaterial, feltMaterial } from "./materials.js";
import { CAMERA_FOV, CAMERA_START_Y, P } from "./layout.js";
import { playCreak, playPop, playChime, playPlink } from "./yarn/sound.js";

// ---- tunables ----------------------------------------------------------------------------------
// layout
const INSET_X = 0.95; // pompom center from the right edge of the view at scroll 0
const DROP = 2.2; // top edge of the view -> pompom center
const ABOVE = 1.0; // the anchor sits this far above the top edge
const SEGMENT = 0.1;
const CORD_RADIUS = 0.036;
const POM_RADIUS = 0.36;
const POM_OFFSET = POM_RADIUS * 0.8; // last cord particle -> pompom center

// physics
const ITERATIONS = 40;
const AIR_DAMPING = 0.8; // less than the default, so the cord keeps swinging
const POM_WEIGHT = 70; // extra downward acceleration on the last two particles
const CORD_WIND = 1.1; // acceleration per unit of breeze, whole cord
const POM_WIND = 10; // and the pompom catches more
const REDUCED_WIND = 0.35;

// pulling
const PULL_MAX = 0.65; // the cord never gives more than this, however far the pointer goes
const PULL_CLICK = 0.6; // pointer pull that clicks
const PULL_REARM = 0.45; // pull back above this to un-click
const SIDE_MAX = 0.7; // sideways give
const MAX_STRETCH = 0.3; // largest rest-length growth
const MAX_SLACK = 0.04; // rest-length shrink while it bounces back
const STRETCH_SPRING = [150, 7]; // stiffness, damping of the snap back
const TUG_PULL = 0.7; // pointer-equivalent pull of a plain click
const TUG_TIME = 0.28;

// hover wiggle
const HOVER_COOLDOWN = 0.4;
const KICK_ACCEL = 60;
const KICK_TIME = 0.12;

// hit proxy: at least this big in world units and in px, so a fingertip finds it
const PROXY_MIN = 0.55;
const PROXY_MIN_PX = 28;

const TAN_HALF = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = THREE.MathUtils.clamp;
const resist = (raw) => PULL_MAX * (1 - Math.exp(-Math.max(raw, 0) / PULL_MAX));

export function createPullCord({ scene, camera, interaction, breeze, daynight }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const windScale = reduced ? REDUCED_WIND : 1;
  const calm = reduced ? 0.4 : 1;

  const rope = new Rope({
    groundAt: () => -1e3,
    material: strandMaterial("cream"),
    maxPoints: 80,
    segment: SEGMENT,
    radius: CORD_RADIUS,
    twist: CORD_RADIUS * 5.5,
    radialSegments: 8,
    iterations: ITERATIONS,
    airDamping: AIR_DAMPING,
    bend: 0.3,
  });
  scene.add(rope.mesh);

  // ---- pompom -------------------------------------------------------------------------------------
  const pom = new THREE.Group(); // at the pompom center, tilted along the cord
  const body = new THREE.Group(); // squash and stretch
  const ball = new THREE.Mesh(new THREE.SphereGeometry(POM_RADIUS, 32, 24), feltMaterial("cream"));
  ball.castShadow = true;
  ball.receiveShadow = true;
  ball.raycast = () => {};
  const fuzz = addFuzz(ball, { color: P.cream, length: 0.09, density: 150, layers: 14 });
  fuzz.raycast = () => {};
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  body.add(ball, proxy);
  pom.add(body);
  scene.add(pom);

  const sy = new Spring(260, 12, 1);
  const sxz = new Spring(260, 12, 1);

  // ---- layout -------------------------------------------------------------------------------------
  const anchor = new THREE.Vector3();
  const restTail = new THREE.Vector3(); // last particle at rest
  const restCenter = new THREE.Vector3(); // pompom center at rest
  const path = [new THREE.Vector3(), new THREE.Vector3()];
  let base = SEGMENT; // rest segment length, no stretch
  let laidZ = NaN;
  let laidAspect = NaN;

  const stretch = new Spring(STRETCH_SPRING[0], STRETCH_SPRING[1], 0); // growth of the rest segment length
  let mode = "idle"; // idle | press | drag | tug
  let grab = null;

  function endGrab() {
    grab?.release();
    grab = null;
    stretch.target = 0;
  }

  // the camera's framing changes with the window: hang the cord at the top right of the view at scroll 0
  function layout() {
    laidZ = camera.position.z;
    laidAspect = camera.aspect;
    if (mode !== "idle") {
      endGrab();
      mode = "idle";
    }
    const halfH = laidZ * TAN_HALF;
    const halfW = halfH * laidAspect;
    const top = CAMERA_START_Y + halfH;
    anchor.set(halfW - INSET_X, top + ABOVE, 0);

    const length = ABOVE + DROP - POM_OFFSET;
    const segments = Math.max(4, Math.round(length / SEGMENT));
    base = length / segments;
    rope.segment = base;
    path[0].copy(anchor);
    path[1].set(anchor.x, anchor.y - length - 0.01, 0); // one extra point so the last particle exists
    rope.setPath(path);
    rope.setAnchor(anchor);
    stretch.snap(0);
    writeLoads(true);
    rope.settle(3);

    const k = (rope.count - 1) * 3;
    restTail.set(rope.pos[k], rope.pos[k + 1], rope.pos[k + 2]);
    restCenter.set(restTail.x, restTail.y - POM_OFFSET, restTail.z);
    placePompom();

    const pxPerUnit = innerHeight / (2 * halfH);
    proxy.scale.setScalar(Math.max(PROXY_MIN, PROXY_MIN_PX / pxPerUnit));
  }

  // ---- per frame ----------------------------------------------------------------------------------
  let kickDir = 1;
  let kickTime = 0;
  let cool = 0;

  function writeLoads(still = false) {
    const { accel, pos, count } = rope;
    accel.fill(0, 0, count * 3);
    const d = breeze.dir;
    const g = still ? 0 : CORD_WIND * windScale;
    for (let k = 0; k < count; k++) {
      const w = breeze.at(pos[k * 3]) * g;
      accel[k * 3] = w * d.x;
      accel[k * 3 + 2] = w * d.z;
    }
    // the pompom: weight, extra wind and the hover kick act on the last two particles
    for (let q = 1; q <= 2; q++) {
      const k = (count - q) * 3;
      accel[k + 1] -= POM_WEIGHT;
      if (still) continue;
      const w = breeze.at(pos[k]) * POM_WIND * windScale;
      accel[k] += w * d.x;
      accel[k + 2] += w * d.z;
      if (kickTime > 0) accel[k] += kickDir * KICK_ACCEL * calm;
    }
    rope.wake();
  }

  const dir = new THREE.Vector3();
  function placePompom() {
    const { pos, count } = rope;
    const k = (count - 1) * 3;
    const k2 = (count - 3) * 3;
    dir.set(pos[k] - pos[k2], pos[k + 1] - pos[k2 + 1], pos[k + 2] - pos[k2 + 2]);
    if (dir.lengthSq() < 1e-8) dir.copy(DOWN);
    dir.normalize();
    pom.position.set(pos[k] + dir.x * POM_OFFSET, pos[k + 1] + dir.y * POM_OFFSET, pos[k + 2] + dir.z * POM_OFFSET);
    pom.quaternion.setFromUnitVectors(DOWN, dir);
  }

  // ---- pulling ------------------------------------------------------------------------------------
  const target = new THREE.Vector3();
  const off = new THREE.Vector3(); // pompom center minus the pointer, at the press

  // move the grabbed tail to rest + (lateral, -resist(rawY)); grow the rest length so it can get there
  function pullTo(lateral, rawY) {
    target.set(restTail.x + lateral, restTail.y - resist(rawY), restTail.z);
    grab.move(target);
    const want = target.distanceTo(anchor) / ((rope.count - 1) * rope.reachFactor);
    stretch.snap(clamp(want / base - 1, 0, MAX_STRETCH));
  }

  function flip() {
    daynight.toggle();
    playPop({ pitch: 1.05 });
    playChime({ pitch: daynight.isNight ? 0.85 : 1.25 });
    sy.kick(3.5);
    sxz.kick(-2);
  }

  function wiggle() {
    cool = HOVER_COOLDOWN;
    kickDir = Math.random() < 0.5 ? -1 : 1;
    kickTime = KICK_TIME;
    sy.kick(2.2 * calm);
    sxz.kick(-1.2 * calm);
    playPlink({ pitch: 1.8 });
  }

  let pastClick = false;
  let tugTime = 0;
  let tugFlipped = false;

  function stepTug(dt) {
    tugTime += dt;
    const u = Math.min(tugTime / TUG_TIME, 1);
    pullTo(0, TUG_PULL * Math.sin(Math.PI * u));
    if (!tugFlipped && u >= 0.5) {
      tugFlipped = true;
      playCreak({ pitch: 1.3 });
      flip();
    }
    if (u >= 1) {
      endGrab();
      mode = "idle";
    }
  }

  interaction.add(proxy, {
    cursor: "grab",
    hover(on) {
      if (on && mode === "idle" && cool <= 0) wiggle();
    },
    down(hit) {
      if (mode !== "idle") return;
      mode = "press";
      pastClick = false;
      off.copy(pom.position).sub(hit.point);
      sy.target = 1.05;
      sxz.target = 0.97;
    },
    drag(point) {
      if (mode !== "press" && mode !== "drag") return;
      if (!grab) {
        grab = rope.grab(rope.count - 1);
        if (!grab) return;
      }
      mode = "drag";
      const rawY = restCenter.y - (point.y + off.y);
      const rawX = point.x + off.x - restCenter.x;
      pullTo(SIDE_MAX * Math.tanh(rawX / SIDE_MAX), rawY);
      if (!pastClick && rawY >= PULL_CLICK) {
        pastClick = true;
        playCreak({ pitch: 1.3 });
        sy.kick(-3);
        sxz.kick(2);
      } else if (pastClick && rawY < PULL_REARM) {
        pastClick = false;
      }
    },
    up() {
      if (mode !== "drag") return;
      endGrab();
      mode = "idle";
      sy.target = 1;
      sxz.target = 1;
      if (pastClick) flip();
      else playPlink({ pitch: 0.7 });
      pastClick = false;
    },
    click() {
      if (mode !== "press") return;
      grab = rope.grab(rope.count - 1);
      sy.target = 1;
      sxz.target = 1;
      if (!grab) {
        mode = "idle";
        return;
      }
      mode = "tug";
      tugTime = 0;
      tugFlipped = false;
    },
  });

  // a cancelled touch (the browser took it for a scroll) never reaches `up`
  const abort = () => {
    if (mode !== "press" && mode !== "drag") return;
    endGrab();
    mode = "idle";
    sy.target = 1;
    sxz.target = 1;
  };
  addEventListener("pointercancel", abort);
  addEventListener("blur", abort);

  // ---- frame --------------------------------------------------------------------------------------
  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (!(dt > 0)) return;
    if (camera.position.z !== laidZ || camera.aspect !== laidAspect) layout();
    cool -= dt;
    kickTime -= dt;

    if (mode === "tug") stepTug(dt);
    // while the pointer holds the cord it sets the stretch itself
    if (mode === "idle" || mode === "press") stretch.update(dt);
    rope.segment = base * (1 + clamp(stretch.value, -MAX_SLACK, MAX_STRETCH));

    writeLoads();
    rope.update(dt);
    placePompom();

    body.scale.set(sxz.update(dt), sy.update(dt), sxz.value);
  }

  layout();
  return { update };
}
