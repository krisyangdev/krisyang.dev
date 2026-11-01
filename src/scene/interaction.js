// Pointer interaction for the 3D scene: hover, click and drag on registered objects.
// Objects are raycast recursively; the nearest hit's nearest registered ancestor gets the event.
// Registered meshes may be invisible hit proxies (material.visible = false).
// Units: world units; velocity in world units/s on the plane z = hit.point.z.
//
// handlers = {
//   cursor?: "pointer" | "grab",   // "grabbing" while a "grab" object is dragged
//   hover?(on, hit), down?(hit), drag?(point, hit), up?(velocity), click?(hit)
// }
// down starts a capture that lasts until up; drag/up only fire after the pointer moved past SLOP px,
// click only when it did not.
import * as THREE from "three";

const SLOP = 5; // px before a press becomes a drag
const VELOCITY_WINDOW = 80; // ms of pointer history for the release velocity
const HOVER_REFRESH_FRAMES = 6; // re-pick under a still pointer (objects sway, the camera scrolls)

const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

export function createInteraction({ dom, camera }) {
  const entries = new Map(); // object3D -> handlers
  const roots = [];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let havePointer = false;
  let overCanvas = false; // last pointer move landed on the canvas, not on page content above it

  let hovered = null; // { object, handlers, hit }
  let press = null; // { object, handlers, hit, x, y, dragging, samples }
  let pointerType = "mouse";
  let lastCamY = NaN;
  let moved = true;
  let frame = 0;

  dom.style.touchAction = "pan-y";

  function setNdc(e) {
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    havePointer = true;
  }

  // nearest hit that belongs to a registered object
  function pick() {
    if (!havePointer || !roots.length) return null;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      for (let o = hit.object; o; o = o.parent) {
        const handlers = entries.get(o);
        if (handlers) return { object: o, handlers, hit };
      }
    }
    return null;
  }

  function planePoint(z, out = new THREE.Vector3()) {
    if (!havePointer) return null;
    raycaster.setFromCamera(ndc, camera);
    plane.constant = -z;
    return raycaster.ray.intersectPlane(plane, out);
  }

  function setCursor() {
    let cursor = "";
    if (press?.dragging && press.handlers.cursor === "grab") cursor = "grabbing";
    else if (press) cursor = press.handlers.cursor ?? "";
    else if (hovered) cursor = hovered.handlers.cursor ?? "";
    dom.style.cursor = cursor;
  }

  function setHover(next) {
    if (next?.object !== hovered?.object) {
      if (hovered) hovered.handlers.hover?.(false, hovered.hit);
      if (next) next.handlers.hover?.(true, next.hit);
    }
    hovered = next;
    setCursor();
  }

  function refreshHover() {
    if (press || pointerType === "touch") return;
    setHover(pick());
  }

  function endPress(cancelled) {
    const p = press;
    press = null;
    document.body.style.userSelect = "";
    if (p?.dragging && !cancelled) p.handlers.up?.(releaseVelocity(p));
    setCursor();
  }

  function releaseVelocity(p) {
    const v = new THREE.Vector3();
    const s = p.samples;
    if (s.length < 2) return v;
    const last = s[s.length - 1];
    let first = last;
    for (let i = s.length - 2; i >= 0 && last.t - s[i].t <= VELOCITY_WINDOW; i--) first = s[i];
    const dt = (last.t - first.t) / 1000;
    if (dt > 0) v.copy(last.p).sub(first.p).divideScalar(dt);
    return v;
  }

  function onDown(e) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    pointerType = e.pointerType;
    setNdc(e);
    overCanvas = true;
    const target = pick();
    if (!target) return;
    press = { ...target, x: e.clientX, y: e.clientY, dragging: false, samples: [] };
    setHover(pointerType === "touch" ? null : target);
    document.body.style.userSelect = "none";
    target.handlers.down?.(target.hit);
    setCursor();
  }

  function onMove(e) {
    if (!e.isPrimary) return;
    pointerType = e.pointerType;
    if (e.pointerType === "touch" && !press) return;
    setNdc(e);
    moved = true;
    if (!press) {
      // hover only while the pointer is over the canvas itself, not over page content on top of it
      overCanvas = e.target === dom;
      if (overCanvas) refreshHover();
      else setHover(null);
      return;
    }
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= SLOP) return;
      press.dragging = true;
      setCursor();
    }
    const point = planePoint(press.hit.point.z);
    if (!point) return;
    press.samples.push({ t: e.timeStamp, p: point.clone() });
    if (press.samples.length > 12) press.samples.shift();
    press.handlers.drag?.(point, press.hit);
  }

  function onUp(e) {
    if (!press || !e.isPrimary) return;
    setNdc(e);
    const p = press;
    endPress(false);
    if (!p.dragging) p.handlers.click?.(p.hit);
    if (e.pointerType === "touch") setHover(null);
    else refreshHover();
  }

  function onCancel(e) {
    if (!press || !e.isPrimary) return;
    endPress(true);
  }

  function onLeave() {
    overCanvas = false;
    if (!press) setHover(null);
  }

  const onSelectStart = (e) => {
    if (press) e.preventDefault();
  };

  dom.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onLeave);
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("selectstart", onSelectStart);

  return {
    add(object, handlers = {}) {
      if (!entries.has(object)) roots.push(object);
      entries.set(object, handlers);
    },
    remove(object) {
      entries.delete(object);
      const i = roots.indexOf(object);
      if (i >= 0) roots.splice(i, 1);
      if (hovered?.object === object) setHover(null);
      if (press?.object === object) endPress(true);
    },
    planePoint,
    // call every frame: the camera scrolls and objects sway under a still pointer
    update() {
      if (press || pointerType === "touch" || !overCanvas) return;
      const camY = camera.position.y;
      frame++;
      if (!moved && camY === lastCamY && frame % HOVER_REFRESH_FRAMES) return;
      moved = false;
      lastCamY = camY;
      refreshHover();
    },
  };
}
