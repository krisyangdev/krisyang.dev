// The homepage bird: a small needle-felted bluebird that lives on the hero clothesline.
//
//   createBird({ scene, camera, interaction, daynight, hero }) -> { update(dt, t), bounce(), state, accel }
//   main.js calls update after hero.update, so the rope is already at this frame's positions.
//
// Files: bird-model (geometry + pose), bird-perch (spots on the line), bird-feather (the drifting feather).
//
// States (day):  away -> fly (enter) -> perch <-> hop;  perch -> circle (startled) -> fly -> perch | exit -> away
//   perch  stands on the rope (a fractional particle index, so it rides every wiggle), blinks, tilts its
//          head toward the nearest letter or the cursor, bobs its tail, hops to another gap now and then
//   hop    short arc to a nearby spot (also the happy hop on hover and the flutter when poked)
//   fly    bezier flight to a spot or off screen; flaps, banks, flares before landing
//   circle the startle: bursts up, loops once with a feather falling, then flies on (or leaves)
// Night: it goes to the spot between the last letter and the first tag and sleeps (eyes shut, puffed up,
// breathing). A poke wakes it, it flutters in place and falls asleep again.
//
// Rope coupling: BIRD_WEIGHT is added to rope.accel under its feet. hero.update rewrites accel every frame
// before rope.update, so a load added after hero.update would be wiped; rope.update is wrapped to add it.
// The bird measures the acceleration of the rope at its feet; above STARTLE_ACCEL it is bounced off.
// Units: world units, seconds, radians. 3 startles within STARTLE_WINDOW s and it leaves for a while.
import * as THREE from "three";
import { Spring } from "./yarn/spring.js";
import { unlockAudio, playPlink, playPop } from "./yarn/sound.js";
import { buildBirdModel, poseBird } from "./bird-model.js";
import { createFeathers } from "./bird-feather.js";
import { createPerches } from "./bird-perch.js";

// ---- tunables ----------------------------------------------------------------------------------
// arrival and absence
const ENTER_DELAY = 4; // s after load before it flies in
const AWAY_RANGE = [15, 30]; // s away after being scared off
const NIGHT_RETURN = [1, 2.5]; // s until it comes home when night falls while it is away

// rope coupling
const BIRD_WEIGHT = 22; // extra downward acceleration on the particles under the feet
const WEIGHT_RAMP = 0.35; // s to fade the weight in after landing
const LAND_PULSE = 70; // short extra push down when it lands (a letter landing is 260)
const TAKEOFF_PULSE = 45; // and a push up when it leaves
const PULSE_TIME = 0.06;
const STARTLE_ACCEL = 45; // rope acceleration at the feet (units/s^2) that bounces it off; calibrate in the browser
const ACCEL_SMOOTH = 18; // 1/s
const LAND_GRACE = 1.0; // s after a landing in which the rope's own jolt is ignored
const HOP_GRACE = 0.5;
const STARTLE_WINDOW = 8; // s; three startles inside it send the bird away
const LEAN_GAIN = 0.006; // body lean per unit of horizontal rope acceleration (rad)

// look
const FACE_YAW = 0.55; // body turn toward the letters when perched (3/4 view)
const FLY_YAW = 0.85;
const HEAD_H = 0.6; // head height above the feet
const LETTER_MID = 0.9; // letter center below the peg
const LOOK_RANGE = 3.5; // the cursor this close makes it look
const CURSOR_ACTIVE = 2.5; // s after the last cursor move that it keeps looking

// idle
const HOP_EVERY = [5, 11];
const HOP_DIST = [0.5, 1.5];
const HOP_TIME = 0.38;
const HOP_ARC = 0.35; // apex height of a hop inside a gap
const HOP_ARC_OVER = 0.8; // hopping over a clothespin
const BLINK_EVERY = [2, 5];
const BLINK_TIME = 0.17;
const GAZE_EVERY = [3, 6.5];
const TAIL_EVERY = [3.5, 8];
const TAIL_KICK = 5;
const HOVER_COOLDOWN = 1.6;

// flight
const FLY_SPEED = 6.5; // units/s
const CIRCLE_TIME = 1.1;
const CIRCLE_RX = 0.7;
const CIRCLE_RY = 0.75;
const CIRCLE_SWEEP = Math.PI * 1.1;
const CLICK_LAUNCH_DELAY = 0.22; // s between the chirp and taking off
const SPREAD_RATE = 16; // 1/s, wings opening and folding

// sound: pitch per note
const CHIRP_DAY = [2.6, 3.2];
const CHIRP_STARTLE = [3.6];
const CHIRP_POKE = [1.5];
const CHIRP_GAP = 0.12; // s between notes
const BEAK_OPEN = 0.5; // rad

// night
const POKE_AWAKE = 2.6; // s awake after a poke
const FLUTTER_TIME = 0.9;
const STRETCH_TIME = 0.9; // wings out when it wakes up in the morning
const SLEEP_IN = 1.3; // 1/s closing the eyes
const SLEEP_OUT = 6; // 1/s waking up
const SLEEP_SETTLE = 0.8; // s on the spot before it dozes
const SLEEP_HOP_MAX = 2.2; // farther than this to the sleeping spot and it flies
const BREATH_PERIOD = 3.6;

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const sstep = (x) => x * x * (3 - 2 * x);
const pulse = (t, start, len) => (t >= start && t <= start + len ? Math.sin((Math.PI * (t - start)) / len) : 0);

export function createBird({ scene, camera, interaction, daynight, hero }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rope = hero.rope;
  const perches = createPerches(hero);
  const model = buildBirdModel();
  const { root, proxy } = model;
  root.visible = false;
  scene.add(root);
  const feathers = createFeathers(scene);

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfWidth = () => tanHalf * camera.position.z * camera.aspect; // half the view width at z = 0

  // ---- state -------------------------------------------------------------------------------------
  let state = "away"; // away | perch | hop | fly | circle
  let clock = 0;
  let awayT = reduced ? 0 : ENTER_DELAY;
  let wantSleep = daynight.night > 0.5;
  let lastWant = wantSleep;
  let sleepK = 0;
  let wasAsleep = false;

  const cur = { gap: 0, f: 0.5 }; // the spot it stands in
  const dest = { gap: 0, f: 0.5 }; // where it is flying to
  const tmpSpot = { gap: 0, f: 0.5 };
  const pt = new THREE.Vector3();
  let s = 0; // feet: fractional rope particle index
  let px = 0; // feet: world position (including hop height and flight)
  let py = 0;
  let slope = 0;
  let vx = 0; // smoothed velocity of the bird itself
  let vy = 0;
  let lastPx = 0;
  let lastPy = 0;
  let airTracked = false;
  let faceDir = 1;

  let settle = 0; // s since landing
  let grace = 0;
  let pokeT = 0;
  let flutterT = 0;
  let flutterHops = 0;
  let stretchT = 0;
  let launchT = 0;
  let hopT = 0;
  let blinkT = 0;
  let blinkPhase = 1;
  let gazeT = 0;
  let tailT = rand(TAIL_EVERY[0], TAIL_EVERY[1]);
  let hovered = false;
  let hoverCool = 0;

  let chirpSeq = CHIRP_DAY;
  let chirpT = 99;
  let chirpFired = 0;

  let spread = 0;
  let fa = 0;
  let flapHz = 0;
  let flapAmp = 0.85;

  // rope load
  let loadS = 0;
  let loadK = 0;
  let pulseAmt = 0;
  let pulseT = 0;

  // rope acceleration at the feet
  let trackN = 0;
  let trX = 0;
  let trY = 0;
  let trVX = 0;
  let trVY = 0;
  let trAX = 0;
  let trAY = 0;
  let aMag = 0;

  const bounces = [-99, -99, -99];
  let bounceI = 0;

  const fl = { kind: "fly", u: 0, dur: 1, sx: 0, sy: 0, ex: 0, ey: 0, fixed: false, peak: 0, flare: 0 };
  const hop = { u: 0, dur: HOP_TIME, s0: 0, s1: 0, arc: 0, spot: { gap: 0, f: 0.5 } };
  const circ = { u: 0, cx: 0, cy: 0, dir: 1, leave: false };
  const gaze = { mode: 0, letter: 0, tilt: 0.2 }; // 0 = a letter, 1 = the camera with a cocked head
  const gz = { yaw: 0, pitch: 0, roll: 0 };

  const cursor = new THREE.Vector3();
  const lastCursor = new THREE.Vector3(1e3, 1e3, 0);
  let cursorOk = false;
  let cursorMoveT = -99;

  const sFace = new Spring(70, 10);
  const sRoll = new Spring(90, 11);
  const sPitch = new Spring(90, 11);
  const sHeadYaw = new Spring(130, 14);
  const sHeadPitch = new Spring(130, 14);
  const sHeadRoll = new Spring(110, 12);
  const sSy = new Spring(260, 12, 1);
  const sSxz = new Spring(260, 12, 1);
  const sTail = new Spring(200, 9);

  const pose = {
    squashY: 1,
    squashXZ: 1,
    wingOpen: 0,
    flap: 0,
    tail: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    blink: 0,
    sleep: 0,
    breath: 0,
    beak: 0,
  };

  // ---- rope load ---------------------------------------------------------------------------------
  const ropeUpdate = rope.update.bind(rope);
  rope.update = (dt) => {
    const amt = loadK * BIRD_WEIGHT + (pulseT > 0 ? pulseAmt : 0);
    if (amt !== 0) {
      const last = rope.count - 2;
      let i = Math.floor(loadS);
      if (i < 0) i = 0;
      else if (i > last) i = last;
      const t = clamp(loadS - i, 0, 1);
      rope.accel[i * 3 + 1] -= amt * (1 - t);
      rope.accel[(i + 1) * 3 + 1] -= amt * t;
      rope.wake();
    }
    ropeUpdate(dt);
  };

  function pushRope(amount) {
    pulseAmt = amount;
    pulseT = PULSE_TIME;
  }

  // ---- helpers -----------------------------------------------------------------------------------
  const onRope = (n) => n === "perch" || n === "hop";

  function setState(next) {
    if (onRope(state) && !onRope(next)) {
      loadK = 0;
      pushRope(-TAKEOFF_PULSE);
    }
    state = next;
    proxy.layers.set(onRope(next) ? 0 : 1); // only a bird on the line can be poked
    root.visible = next !== "away";
  }

  function squash(sy, sxz) {
    sSy.value = sy;
    sSy.velocity = 0;
    sSxz.value = sxz;
    sSxz.velocity = 0;
  }

  function startChirp(seq) {
    chirpSeq = seq;
    chirpT = 0;
    chirpFired = 0;
  }

  function placeOnRope() {
    perches.pointAt(s, pt);
    px = pt.x;
    py = pt.y;
    slope = perches.angleAt(s);
  }

  const faceToCenter = () => (perches.centerX() > px ? 1 : -1);

  function scheduleIdle() {
    hopT = rand(HOP_EVERY[0], HOP_EVERY[1]);
    blinkT = rand(0.6, 2);
    gazeT = 0.2;
  }

  // ---- flights -----------------------------------------------------------------------------------
  function flightEnd() {
    perches.pointAt(perches.sOf(dest), pt);
    fl.ex = pt.x;
    fl.ey = pt.y;
  }

  // kind: "enter" (from off screen), "fly" (spot to spot, toward dest), "exit" (off screen)
  function beginFlight(kind) {
    fl.kind = kind;
    fl.u = 0;
    fl.sx = px;
    fl.sy = py;
    fl.fixed = kind === "exit";
    if (fl.fixed) {
      fl.ex = (px < 0 ? -1 : 1) * (halfWidth() + 2.5);
      fl.ey = py + rand(3, 4.5);
    } else {
      flightEnd();
    }
    const dist = Math.hypot(fl.ex - fl.sx, fl.ey - fl.sy);
    fl.dur = clamp(0.5 + dist / FLY_SPEED, 0.9, 3.2);
    fl.peak = kind === "enter" ? 0.4 : clamp(0.5 + dist * 0.1, 0.6, 1.8);
    fl.flare = 0;
    airTracked = false;
    setState("fly");
  }

  function startEnter() {
    if (wantSleep || !perches.pick(dest)) perches.set(dest, perches.sleepGap, 0.5);
    perches.pointAt(perches.sOf(dest), pt);
    const side = Math.random() < 0.5 ? -1 : 1;
    px = side * (halfWidth() + 1.2);
    py = pt.y + rand(3, 4.5);
    vx = -side * 4;
    vy = 0;
    faceDir = -side;
    sFace.snap(faceDir * FLY_YAW);
    sRoll.snap(0);
    sPitch.snap(0);
    beginFlight("enter");
  }

  function land() {
    s = perches.sOf(dest);
    cur.gap = dest.gap;
    cur.f = dest.f;
    loadS = s;
    placeOnRope();
    faceDir = faceToCenter();
    setState("perch");
    settle = 0;
    grace = LAND_GRACE;
    trackN = 0;
    squash(0.78, 1.14);
    pushRope(LAND_PULSE);
    playPop({ pitch: 2.4 });
    scheduleIdle();
  }

  function leaveDone() {
    setState("away");
    awayT = wantSleep ? rand(NIGHT_RETURN[0], NIGHT_RETURN[1]) : rand(AWAY_RANGE[0], AWAY_RANGE[1]);
    bounces.fill(-99);
  }

  // ---- hops --------------------------------------------------------------------------------------
  function startHop(spot, arc, dur) {
    hop.s0 = s;
    hop.s1 = perches.sOf(spot);
    hop.spot.gap = spot.gap;
    hop.spot.f = spot.f;
    hop.u = 0;
    hop.arc = arc;
    hop.dur = dur;
    const dx = perches.xOf(hop.s1) - px;
    if (Math.abs(dx) > 0.25) faceDir = dx > 0 ? 1 : -1;
    setState("hop");
    pushRope(-TAKEOFF_PULSE * 0.4);
    squash(0.86, 1.1);
    airTracked = false;
    trackN = 0;
  }

  function endHop() {
    cur.gap = hop.spot.gap;
    cur.f = hop.spot.f;
    s = hop.s1;
    loadS = s;
    setState("perch");
    settle = 0;
    grace = HOP_GRACE;
    trackN = 0;
    squash(0.88, 1.08);
    pushRope(LAND_PULSE * 0.35);
    if (flutterHops > 0) {
      flutterHops--;
      startHop(cur, 0.16, 0.34);
    }
  }

  function idleHop() {
    const o = tmpSpot;
    if (!perches.pick(o, { fromX: px, minDist: HOP_DIST[0], maxDist: HOP_DIST[1] }) && !perches.pick(o, { fromX: px, minDist: 0.4, maxDist: 3 })) return false;
    startHop(o, perches.crosses(s, perches.sOf(o)) ? HOP_ARC_OVER : HOP_ARC, HOP_TIME);
    return true;
  }

  function goToSleepSpot() {
    perches.set(dest, perches.sleepGap, 0.5);
    const dx = Math.abs(perches.xOf(perches.sOf(dest)) - px);
    if (dx < SLEEP_HOP_MAX) startHop(dest, perches.crosses(s, perches.sOf(dest)) ? HOP_ARC_OVER : HOP_ARC, 0.4 + 0.15 * dx);
    else beginFlight("fly");
  }

  // ---- reactions ---------------------------------------------------------------------------------
  function startStartle() {
    bounces[bounceI] = clock;
    bounceI = (bounceI + 1) % bounces.length;
    let recent = 0;
    for (const t of bounces) if (clock - t < STARTLE_WINDOW) recent++;
    circ.leave = recent >= bounces.length;
    circ.dir = Math.random() < 0.5 ? -1 : 1;
    circ.u = 0;
    circ.cx = px;
    circ.cy = py + CIRCLE_RY;
    if (!circ.leave && !perches.pick(dest, { fromX: px, minDist: 1.2, maxDist: 7 })) perches.set(dest, cur.gap, cur.f);
    feathers.spawn(px, py + 0.5, circ.dir);
    startChirp(CHIRP_STARTLE);
    squash(0.78, 1.16);
    launchT = 0;
    airTracked = false;
    vx = vy = 0;
    setState("circle");
  }

  // night: wake up, flutter in place, doze off again
  function poke() {
    pokeT = POKE_AWAKE;
    grace = Math.max(grace, 1);
    startChirp(CHIRP_POKE);
    squash(1.12, 0.92);
    if (reduced) return;
    flutterT = FLUTTER_TIME;
    flutterHops = 1;
    if (state === "perch") startHop(cur, 0.22, 0.38);
  }

  function onHover(on) {
    hovered = on;
    if (!on || reduced || state !== "perch" || wantSleep || sleepK > 0.3 || hoverCool > 0 || launchT > 0) return;
    hoverCool = HOVER_COOLDOWN;
    startHop(cur, 0.22, 0.34);
  }

  function onClick() {
    unlockAudio();
    if (state !== "perch") return;
    if (wantSleep || sleepK > 0.3) {
      if (pokeT <= 0) poke();
      return;
    }
    startChirp(CHIRP_DAY);
    if (reduced) return;
    const side = px < perches.centerX() ? 1 : -1; // the other side of the name
    if (!perches.pick(dest, { fromX: px, minDist: 2.5, side }) && !perches.pick(dest, { fromX: px, minDist: 1.5 })) return;
    launchT = CLICK_LAUNCH_DELAY;
    squash(0.85, 1.1);
  }

  interaction.add(proxy, {
    cursor: "pointer",
    hover: onHover,
    down: unlockAudio,
    click: onClick,
  });
  proxy.layers.set(1);

  // ---- sensing -----------------------------------------------------------------------------------
  function readCursor() {
    cursorOk = !!interaction.planePoint(0, cursor);
    if (cursorOk && cursor.distanceToSquared(lastCursor) > 0.0004) {
      cursorMoveT = clock;
      lastCursor.copy(cursor);
    }
  }

  // smoothed acceleration of the rope under the feet (position second difference)
  function trackRope(dt) {
    if (trackN === 0) {
      trX = px;
      trY = py;
      trVX = trVY = trAX = trAY = 0;
      trackN = 1;
      aMag = 0;
      return;
    }
    const nvx = (px - trX) / dt;
    const nvy = (py - trY) / dt;
    trX = px;
    trY = py;
    if (trackN === 1) {
      // first velocity: no acceleration yet
      trVX = nvx;
      trVY = nvy;
      trackN = 2;
      return;
    }
    const k = 1 - Math.exp(-ACCEL_SMOOTH * dt);
    trAX += ((nvx - trVX) / dt - trAX) * k;
    trAY += ((nvy - trVY) / dt - trAY) * k;
    trVX = nvx;
    trVY = nvy;
    if (trackN < 5) trackN++;
    aMag = Math.hypot(trAX, trAY);
  }

  function updateVelocity(dt) {
    if (!airTracked) {
      lastPx = px;
      lastPy = py;
      airTracked = true;
      return;
    }
    const k = 1 - Math.exp(-10 * dt);
    vx += ((px - lastPx) / dt - vx) * k;
    vy += ((py - lastPy) / dt - vy) * k;
    lastPx = px;
    lastPy = py;
  }

  // ---- gaze --------------------------------------------------------------------------------------
  function aim(tx, ty, tilt) {
    const dx = tx - px;
    const dy = ty - (py + HEAD_H);
    gz.yaw = clamp(clamp(dx * 0.45, -1, 1) - sFace.value, -1.1, 1.1);
    gz.pitch = clamp(-dy * 0.12, -0.35, 0.5);
    gz.roll = -Math.sign(dx) * Math.min(1, Math.abs(dx)) * 0.14 * tilt;
  }

  function newGaze() {
    gazeT = rand(GAZE_EVERY[0], GAZE_EVERY[1]);
    const c = perches.centerX();
    if (Math.abs(c - px) > 0.6) faceDir = c > px ? 1 : -1;
    if (Math.random() < 0.65) {
      // one of the two nearest letters
      let a = -1;
      let b = -1;
      let da = 1e9;
      let db = 1e9;
      const letters = hero.letters;
      for (let i = 0; i < letters.length; i++) {
        if (letters[i].phase !== "hung") continue;
        const d = Math.abs(letters[i].peg.x - px);
        if (d < da) {
          b = a;
          db = da;
          a = i;
          da = d;
        } else if (d < db) {
          b = i;
          db = d;
        }
      }
      gaze.mode = 0;
      gaze.letter = a < 0 ? 0 : b >= 0 && Math.random() < 0.35 ? b : a;
    } else {
      gaze.mode = 1;
      gaze.tilt = (Math.random() < 0.5 ? -1 : 1) * rand(0.12, 0.26);
    }
  }

  function updateGaze(dt) {
    if (reduced || sleepK > 0.5) {
      gz.yaw = gz.roll = 0;
      gz.pitch = reduced ? 0.1 : 0;
      return;
    }
    gazeT -= dt;
    if (gazeT <= 0) newGaze();
    const near = hovered || (cursorOk && clock - cursorMoveT < CURSOR_ACTIVE && Math.hypot(cursor.x - px, cursor.y - (py + 0.4)) < LOOK_RANGE);
    if (near) {
      if (Math.abs(cursor.x - px) > 0.9) faceDir = cursor.x > px ? 1 : -1;
      aim(cursor.x, cursor.y, 0.7);
    } else if (gaze.mode === 0) {
      const l = hero.letters[gaze.letter];
      if (l.phase === "hung") aim(l.peg.x, l.peg.y - LETTER_MID, 1);
    } else {
      gz.yaw = -sFace.value * 0.9; // straight at the viewer
      gz.pitch = 0;
      gz.roll = gaze.tilt;
    }
  }

  // ---- state steps -------------------------------------------------------------------------------
  function stepAway(dt, nightEdge) {
    if (nightEdge && awayT > NIGHT_RETURN[1]) awayT = rand(NIGHT_RETURN[0], NIGHT_RETURN[1]);
    awayT -= dt;
    if (awayT > 0) return;
    if (reduced) {
      // no fly-in: it is just there, on the sleeping spot
      cur.gap = perches.sleepGap;
      cur.f = 0.5;
      s = perches.sOf(cur);
      loadS = s;
      placeOnRope();
      faceDir = faceToCenter();
      sFace.snap(faceDir * FACE_YAW);
      setState("perch");
      settle = 0;
      grace = 99;
      scheduleIdle();
    } else {
      startEnter();
    }
  }

  function stepPerch(dt) {
    settle += dt;
    grace -= dt;
    s = perches.sOf(cur);
    loadS = s;
    placeOnRope();
    trackRope(dt);

    if (!reduced && grace <= 0 && aMag > STARTLE_ACCEL) {
      if (wantSleep || sleepK > 0.3) {
        if (pokeT <= 0) poke();
      } else {
        startStartle();
      }
      return;
    }
    if (launchT > 0) {
      launchT -= dt;
      if (launchT <= 0) beginFlight("fly");
      return;
    }
    if (!reduced && wantSleep && pokeT <= 0 && cur.gap !== perches.sleepGap && settle > SLEEP_SETTLE) {
      goToSleepSpot();
      return;
    }

    const awake = sleepK < 0.5;
    if (!reduced && awake && !wantSleep && (hopT -= dt) <= 0) {
      hopT = rand(HOP_EVERY[0], HOP_EVERY[1]);
      if (idleHop()) return;
    }

    // blink
    blinkT -= dt;
    if (blinkPhase < 1) blinkPhase += dt / BLINK_TIME;
    else if (blinkT <= 0 && awake) {
      blinkPhase = 0;
      blinkT = Math.random() < 0.25 ? 0.22 : rand(BLINK_EVERY[0], BLINK_EVERY[1]); // now and then a double blink
    }
    // tail
    if (!reduced && awake && (tailT -= dt) <= 0) {
      tailT = rand(TAIL_EVERY[0], TAIL_EVERY[1]);
      sTail.kick(TAIL_KICK);
    }
    updateGaze(dt);
  }

  function stepHop(dt) {
    hop.u += dt / hop.dur;
    const u = Math.min(1, hop.u);
    s = hop.s0 + (hop.s1 - hop.s0) * u;
    loadS = s;
    placeOnRope();
    py += 4 * hop.arc * u * (1 - u);
    updateGaze(dt);
    if (u >= 1) endHop();
  }

  function stepFly(dt) {
    fl.u += dt / fl.dur;
    const u = Math.min(1, fl.u);
    if (!fl.fixed) flightEnd();
    // arrivals slow down into the landing, departures speed up
    const e = fl.kind === "enter" ? 1 - Math.pow(1 - u, 2.2) : fl.kind === "exit" ? u * (0.3 + 0.7 * u) : sstep(u);
    const cx = fl.sx + (fl.ex - fl.sx) * 0.5;
    const cy = Math.max(fl.sy, fl.ey) + 2 * fl.peak;
    const q = 1 - e;
    px = q * q * fl.sx + 2 * q * e * cx + e * e * fl.ex;
    py = q * q * fl.sy + 2 * q * e * cy + e * e * fl.ey;
    fl.flare = fl.kind === "exit" ? 0 : sstep(clamp((u - 0.7) / 0.3, 0, 1));
    if (u < 1) return;
    if (fl.kind === "exit") leaveDone();
    else land();
  }

  function stepCircle(dt) {
    circ.u += dt / CIRCLE_TIME;
    const u = Math.min(1, circ.u);
    const th = -Math.PI / 2 + circ.dir * CIRCLE_SWEEP * (1 - Math.pow(1 - u, 1.7)); // bursts up, then eases round
    px = circ.cx + CIRCLE_RX * Math.cos(th);
    py = circ.cy + CIRCLE_RY * Math.sin(th);
    if (u < 1) return;
    beginFlight(circ.leave ? "exit" : "fly");
  }

  // ---- pose --------------------------------------------------------------------------------------
  function drive(dt) {
    updateVelocity(dt);
    const air = state === "fly" || state === "circle";
    let spreadT = 0;
    let hz = 0;
    let amp = 0.85;

    if (air) {
      const flare = state === "fly" ? fl.flare : 0;
      if (Math.abs(vx) > 0.6) faceDir = vx > 0 ? 1 : -1;
      sFace.target = faceDir * FLY_YAW;
      sRoll.target = -clamp(vx * 0.045, -0.4, 0.4); // banks into the turn
      sPitch.target = clamp(-vy * 0.07, -0.45, 0.45) - 0.7 * flare; // nose up in the flare
      sTail.target = -0.35 - 0.3 * flare;
      gz.yaw = -sFace.value * 0.5;
      gz.pitch = -0.1;
      gz.roll = 0;
      spreadT = 1;
      hz = state === "circle" ? 13 : 9 + 5 * flare;
    } else if (state === "hop") {
      sFace.target = faceDir * FACE_YAW;
      sRoll.target = slope * 0.85 - faceDir * 0.12;
      sPitch.target = -0.15;
      sTail.target = -0.2;
      spreadT = 0.55;
      hz = 16;
      amp = 0.45;
    } else {
      sFace.target = faceDir * FACE_YAW * (1 - 0.45 * sleepK);
      const lean = trackN >= 4 ? clamp(trAX * LEAN_GAIN, -0.28, 0.28) : 0;
      sRoll.target = slope * 0.85 - lean; // leans into whatever the line does
      sPitch.target = 0;
      sTail.target = 0;
      if (flutterT > 0) {
        spreadT = 1;
        hz = 14;
        amp = 0.7;
      } else if (stretchT > 0) {
        spreadT = 0.55;
        amp = 0;
      }
    }

    spread += (spreadT - spread) * (1 - Math.exp(-SPREAD_RATE * dt));
    flapHz += (hz - flapHz) * (1 - Math.exp(-12 * dt));
    flapAmp = amp;
    fa += dt * TAU * flapHz;

    sFace.update(dt);
    sRoll.update(dt);
    sPitch.update(dt);
    sTail.update(dt);
    sHeadYaw.target = gz.yaw;
    sHeadPitch.target = gz.pitch;
    sHeadRoll.target = gz.roll;
    sHeadYaw.update(dt);
    sHeadPitch.update(dt);
    sHeadRoll.update(dt);
    sSy.update(dt);
    sSxz.update(dt);

    pose.squashY = sSy.value;
    pose.squashXZ = sSxz.value;
    pose.wingOpen = spread;
    pose.flap = Math.sin(fa) * flapAmp;
    pose.tail = sTail.value + (reduced ? 0 : 0.025 * Math.sin(clock * 1.6));
    pose.headYaw = sHeadYaw.value;
    pose.headPitch = sHeadPitch.value - (chirpT < 0.3 ? 0.18 : 0);
    pose.headRoll = sHeadRoll.value;
    pose.blink = blinkPhase < 1 ? Math.sin(Math.PI * blinkPhase) : 0;
    pose.sleep = sleepK;
    pose.breath = reduced ? sleepK * 0.02 * Math.sin((clock * TAU) / BREATH_PERIOD) : sleepK * 0.03 * Math.sin((clock * TAU) / BREATH_PERIOD) + (1 - sleepK) * 0.006 * Math.sin(clock * 2.4);
    let beak = 0;
    if (chirpT < 1) for (let i = 0; i < chirpSeq.length; i++) beak += pulse(chirpT, i * CHIRP_GAP, 0.09);
    pose.beak = BEAK_OPEN * Math.min(1, beak);
    poseBird(model, pose);

    root.position.set(px, py, 0);
    root.rotation.set(sPitch.value, sFace.value, sRoll.value);
  }

  // ---- frame -------------------------------------------------------------------------------------
  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (!(dt > 0)) return;
    clock += dt;
    wantSleep = daynight.night > 0.5;
    const nightEdge = wantSleep && !lastWant;
    lastWant = wantSleep;

    if (pulseT > 0) pulseT -= dt;
    if (pokeT > 0) pokeT -= dt;
    if (flutterT > 0) flutterT -= dt;
    if (stretchT > 0) stretchT -= dt;
    if (hoverCool > 0) hoverCool -= dt;
    if (chirpT < 1) {
      chirpT += dt;
      if (chirpFired < chirpSeq.length && chirpT >= chirpFired * CHIRP_GAP) playPlink({ pitch: chirpSeq[chirpFired++] });
    }
    readCursor();
    feathers.update(dt); // a feather keeps falling after the bird has left

    switch (state) {
      case "away":
        stepAway(dt, nightEdge);
        break;
      case "perch":
        stepPerch(dt);
        break;
      case "hop":
        stepHop(dt);
        break;
      case "fly":
        stepFly(dt);
        break;
      case "circle":
        stepCircle(dt);
        break;
    }
    if (state === "away") return;

    // sleep: only on the sleeping spot at night, quick to wake
    const dozing = state === "perch" && wantSleep && cur.gap === perches.sleepGap && pokeT <= 0 && settle > SLEEP_SETTLE;
    const rate = dozing ? SLEEP_IN : SLEEP_OUT;
    sleepK += ((dozing ? 1 : 0) - sleepK) * (1 - Math.exp(-rate * dt));
    if (sleepK > 0.95) wasAsleep = true;
    else if (wasAsleep && sleepK < 0.5) {
      wasAsleep = false;
      if (pokeT <= 0) {
        // good morning
        stretchT = STRETCH_TIME;
        squash(1.1, 0.95);
        blinkPhase = 0;
        scheduleIdle();
        hopT = rand(2, 4);
      }
    }

    loadK = onRope(state) ? Math.min(1, loadK + dt / WEIGHT_RAMP) : 0;
    drive(dt);
  }

  return {
    update,
    bounce() {
      if (state === "perch") startStartle();
    },
    get state() {
      return state;
    },
    get accel() {
      return aMag;
    },
  };
}
