// The stage: renderer, lights, cream backdrop, camera, depth of field and the scroll mapping.
// One fixed canvas sits behind the page; the page scrolls natively and the camera moves down the
// world 1:1 with it (units: world units, px = CSS pixels), so DOM and scene never drift apart.
//   unitsPerPx = visible height at z = 0 / view height in px
//   camera.y   = CAMERA_START_Y - scrollY * unitsPerPx
//   page height is set so the view's bottom edge reaches CONTENT_BOTTOM at max scroll.
// Lights, background, backdrop colour and exposure blend between a day and a night look by daynight.night.
// ?still=1 (or prefers-reduced-motion): steady breeze, no petals, frozen window light.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { DofPass, makeDepthTarget } from "./yarn/dof.js";
import { unlockAudio } from "./yarn/sound.js";
import { createInteraction } from "./interaction.js";
import { createBreeze } from "./breeze.js";
import { createPetals } from "./petals.js";
import { createDayNight } from "./daynight.js";
import { createWindowLight } from "./window-light.js";
import {
  P,
  BACKDROP_Z,
  CAMERA_FOV,
  HERO_FIT_WIDTH,
  MIN_CAMERA_Z,
  CAMERA_START_Y,
  CONTENT_BOTTOM,
} from "./layout.js";

// tunables
const MSAA_SAMPLES = 4; // on the scene target; set 0 if the depth of field misbehaves
const SHADOW_MAP = 2048;
const SHADOW_RADIUS = 8; // texels of PCF blur
const SUN_DISTANCE = 30;
const DOF = { aperture: 0.0016, maxblur: 0.004, focusRange: 0.06 }; // focus = camera distance
const FOLD_DEPTH = 0.35; // backdrop relief in z; shapes the shadows
const FOLD_SHADE = 0.3; // how much the folds brighten / darken the cream
const FOLD_LIGHT = [-0.3, 0.39]; // xy direction the folds are lit from (upper left)
// day: warm golden afternoon sun from the upper left; night: cool pale moonlight, lower but still readable
const LOOK = {
  day: {
    sunColor: new THREE.Color("#ffe6c4"),
    sunIntensity: 3.4,
    sunDir: new THREE.Vector3(-0.14, 0.19, 1).normalize(), // from upper left, mostly in front: the wall is deep, a steeper sun throws the shadows far
    hemiSky: new THREE.Color("#fde8d2"),
    hemiGround: new THREE.Color("#7a6a5c"),
    hemiIntensity: 0.55,
    env: 0.25,
    exposure: 1.0,
    shadowColor: new THREE.Color("#7a5a44"),
    shadowOpacity: 0.3,
  },
  night: {
    sunColor: new THREE.Color("#a9bdf2"),
    sunIntensity: 1.5,
    sunDir: new THREE.Vector3(-0.22, 0.22, 1).normalize(),
    hemiSky: new THREE.Color("#7f8cc8"),
    hemiGround: new THREE.Color("#2c2744"),
    hemiIntensity: 1.0,
    env: 0.14,
    exposure: 1.15,
    shadowColor: new THREE.Color("#0a0918"),
    shadowOpacity: 0.4,
  },
};
const lerp = (a, b, n) => a + (b - a) * n;
const SCROLL_PUSH = 1.5; // breeze strength added per second at SCROLL_REF px/s
const SCROLL_REF = 2000;
const MAX_PIXEL_RATIO = 1.5; // 2x retina doubles the fuzz-shell and depth-of-field fill cost for little visible gain
const MIN_FPS = 40; // below this the pixel ratio steps down
const PIXEL_RATIO_STEP = 0.25;

// soft diagonal folds, smooth over tens of world units
function fold(x, y) {
  return (
    0.5 * Math.sin(0.18 * x + 0.11 * y + 1.3) * Math.sin(0.07 * x - 0.16 * y + 0.4) +
    0.25 * Math.sin(0.31 * x - 0.05 * y + 2.1) +
    0.25 * Math.sin(0.05 * x + 0.23 * y)
  );
}

// cream plane (unlit; window-light.js paints its colour and the light pattern) with a transparent shadow-catcher over it
function buildBackdrop(material) {
  const width = 60;
  const top = CAMERA_START_Y + 22;
  const bottom = CONTENT_BOTTOM - 6;
  const geo = new THREE.PlaneGeometry(width, top - bottom, 48, 40).translate(0, (top + bottom) / 2, 0);
  const pos = geo.attributes.position;
  const shades = new Float32Array(pos.count);
  const e = 0.1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, FOLD_DEPTH * fold(x, y));
    // slope toward the light brightens, away darkens
    const dx = (fold(x + e, y) - fold(x - e, y)) / (2 * e);
    const dy = (fold(x, y + e) - fold(x, y - e)) / (2 * e);
    shades[i] = 1 + FOLD_SHADE * (-FOLD_LIGHT[0] * dx - FOLD_LIGHT[1] * dy);
  }
  geo.setAttribute("shade", new THREE.BufferAttribute(shades, 1));
  geo.computeVertexNormals();

  const base = new THREE.Mesh(geo, material);
  const shadowMaterial = new THREE.ShadowMaterial({ color: LOOK.day.shadowColor, opacity: LOOK.day.shadowOpacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadow = new THREE.Mesh(geo, shadowMaterial);
  shadow.receiveShadow = true;
  const group = new THREE.Group();
  group.add(base, shadow);
  group.position.z = BACKDROP_Z;
  return { group, shadowMaterial };
}

export function createStage(canvas) {
  const params = new URLSearchParams(location.search);
  const still = params.get("still") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;

  // throws when WebGL is unavailable; main.js then shows the HTML version
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.paper);
  const daynight = createDayNight();
  const breeze = createBreeze({ gusts: !still });
  const windowLight = createWindowLight({ breeze, still });
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = LOOK.day.env;
  const hemi = new THREE.HemisphereLight(LOOK.day.hemiSky, LOOK.day.hemiGround, LOOK.day.hemiIntensity);
  scene.add(hemi);
  const backdrop = buildBackdrop(windowLight.material);
  scene.add(backdrop.group);

  const sunDir = LOOK.day.sunDir.clone(); // current light direction, blended by night
  const sun = new THREE.DirectionalLight(LOOK.day.sunColor, LOOK.day.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SUN_DISTANCE * 2;
  sun.shadow.radius = SHADOW_RADIUS;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 1, 150);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));

  const target = makeDepthTarget(1, 1);
  target.samples = MSAA_SAMPLES;
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const dof = new DofPass(camera, { focus: MIN_CAMERA_Z, ...DOF });
  composer.addPass(dof);
  composer.addPass(new OutputPass());

  const interaction = createInteraction({ dom: canvas, camera });
  const petals = still ? null : createPetals({ scene, camera, breeze, daynight });

  // keeps the document tall enough for the camera to reach CONTENT_BOTTOM; hidden with the canvas on failure
  const spacer = document.createElement("div");
  spacer.className = "scroll-spacer";
  spacer.setAttribute("aria-hidden", "true");
  document.body.append(spacer);

  // view size in px. On touch screens the height only ever grows (until the width changes), so the
  // collapsing browser toolbar does not rescale the scene mid-scroll.
  let viewW = 0;
  let viewH = 0;
  let unitsPerPx = 1;
  let shadowRadius = 1;
  let shadowStep = 1; // world y step that moves the shadow map by whole texels (no shimmer while scrolling)

  function resize() {
    const w = innerWidth;
    const h = coarse && w === viewW ? Math.max(viewH, innerHeight) : innerHeight;
    viewW = w;
    viewH = h;
    const aspect = w / h;
    camera.aspect = aspect;
    camera.position.z = Math.max(MIN_CAMERA_Z, HERO_FIT_WIDTH / aspect / (2 * tanHalf));
    camera.updateProjectionMatrix();
    dof.uniforms.focus.value = camera.position.z;

    renderer.setSize(w, h);
    composer.setSize(w, h);

    const visibleH = 2 * camera.position.z * tanHalf;
    unitsPerPx = visibleH / h;
    spacer.style.height = `${Math.ceil((CAMERA_START_Y - CONTENT_BOTTOM) / unitsPerPx + h / 2)}px`;

    // shadow box: the view at the backdrop's depth, in the light's frame
    const depthScale = (camera.position.z - BACKDROP_Z) / camera.position.z;
    const radius = Math.hypot((visibleH * aspect) / 2, visibleH / 2) * depthScale + 3;
    shadowRadius = radius;
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize);

  // blend every lighting preset by night (0 day .. 1 night); no allocations
  function applyLook(n) {
    const d = LOOK.day;
    const m = LOOK.night;
    sun.color.lerpColors(d.sunColor, m.sunColor, n);
    sun.intensity = lerp(d.sunIntensity, m.sunIntensity, n);
    sunDir.lerpVectors(d.sunDir, m.sunDir, n).normalize();
    hemi.color.lerpColors(d.hemiSky, m.hemiSky, n);
    hemi.groundColor.lerpColors(d.hemiGround, m.hemiGround, n);
    hemi.intensity = lerp(d.hemiIntensity, m.hemiIntensity, n);
    scene.environmentIntensity = lerp(d.env, m.env, n);
    renderer.toneMappingExposure = lerp(d.exposure, m.exposure, n);
    backdrop.shadowMaterial.color.lerpColors(d.shadowColor, m.shadowColor, n);
    backdrop.shadowMaterial.opacity = lerp(d.shadowOpacity, m.shadowOpacity, n);
    scene.background.copy(windowLight.wall);
  }

  const updaters = [];
  let lastScroll = scrollY;
  let lastTime = performance.now();
  let elapsed = 0;

  // step the pixel ratio down when the frame rate stays low
  let fpsFrames = 0;
  let fpsTime = 0;
  function adaptPixelRatio(rawDt) {
    if (elapsed < 3 || rawDt > 0.25) return;
    fpsFrames++;
    fpsTime += rawDt;
    if (fpsTime < 2) return;
    const fps = fpsFrames / fpsTime;
    fpsFrames = fpsTime = 0;
    const pr = renderer.getPixelRatio();
    if (fps >= MIN_FPS || pr <= 1) return;
    const next = Math.max(1, pr - PIXEL_RATIO_STEP);
    renderer.setPixelRatio(next);
    composer.setPixelRatio(next);
    resize();
  }

  function frame(now) {
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 1 / 20);
    elapsed += dt;
    daynight.update(dt);

    // scroll -> camera, exactly in step with the page
    const sy = scrollY;
    camera.position.y = CAMERA_START_Y - sy * unitsPerPx;
    camera.updateMatrixWorld();
    if (dt > 0) breeze.push(SCROLL_PUSH * Math.min(Math.abs(sy - lastScroll) / dt / SCROLL_REF, 1.5) * dt);
    lastScroll = sy;

    breeze.update(dt);
    windowLight.update(dt, elapsed, daynight.night);
    applyLook(daynight.night);

    // shadow follows the camera in whole-texel steps
    shadowStep = ((2 * shadowRadius) / SHADOW_MAP) / Math.sqrt(1 - sunDir.y * sunDir.y);
    const y = Math.round(camera.position.y / shadowStep) * shadowStep;
    sun.target.position.set(0, y, 0);
    sun.position.copy(sunDir).multiplyScalar(SUN_DISTANCE).add(sun.target.position);

    interaction.update();
    for (const fn of updaters) fn(dt, elapsed);
    petals?.update(dt, elapsed);
    composer.render(dt);
    adaptPixelRatio(rawDt);
  }

  // browsers allow audio only after a gesture; the first one anywhere unlocks it
  const unlock = () => {
    removeEventListener("pointerdown", unlock, true);
    removeEventListener("keydown", unlock, true);
    unlockAudio();
  };
  addEventListener("pointerdown", unlock, true);
  addEventListener("keydown", unlock, true);

  return {
    scene,
    camera,
    renderer,
    interaction,
    breeze,
    daynight,
    onUpdate(fn) {
      updaters.push(fn);
    },
    start() {
      lastTime = performance.now();
      renderer.setAnimationLoop(frame);
    },
  };
}
