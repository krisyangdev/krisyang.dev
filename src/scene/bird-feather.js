// One or two felt feathers that drift down when the bird is startled.
//
//   const feathers = createFeathers(scene);
//   feathers.spawn(x, y, dir);   // dir = -1 | 1, sideways drift
//   feathers.update(dt);
//
// A small pool, so repeated scares reuse meshes. Units: world units, seconds.
import * as THREE from "three";
import { feltMaterial } from "./materials.js";

// ---- tunables ----------------------------------------------------------------------------------
const POOL = 2;
const LIFE = 4.5;
const FADE_IN = 0.12;
const FADE_OUT = 0.7; // shrinks to nothing over the last part of its life
const FALL_SPEED = 0.85; // terminal speed, units/s
const FALL_PULL = 2.5; // 1/s toward terminal speed
const SWAY = 0.55; // sideways drift amplitude, units/s
const SWAY_RATE = 2.3; // rad/s
const TUMBLE = 1.6; // rad/s about the vertical axis
const Z = 0.15; // in front of the letters

const sstep = (x) => x * x * (3 - 2 * x);

// pointed leaf outline, 0.4 long, 0.18 wide
function featherGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.2);
  s.quadraticCurveTo(0.14, -0.02, 0, 0.2);
  s.quadraticCurveTo(-0.14, -0.02, 0, -0.2);
  return new THREE.ShapeGeometry(s, 8);
}

export function createFeathers(scene) {
  const geo = featherGeometry();
  const mat = feltMaterial("#b4c8e2").clone();
  mat.side = THREE.DoubleSide;
  const quillMat = new THREE.MeshStandardMaterial({ color: "#f6ecdc", roughness: 0.8 });
  const quillGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.34, 5);

  const pool = Array.from({ length: POOL }, () => {
    const mesh = new THREE.Mesh(geo, mat);
    const quill = new THREE.Mesh(quillGeo, quillMat);
    quill.position.z = 0.004;
    mesh.add(quill);
    mesh.castShadow = true;
    mesh.visible = false;
    mesh.rotation.order = "YZX";
    scene.add(mesh);
    return { mesh, age: LIFE, vx: 0, vy: 0, phase: 0, tilt: 0 };
  });

  return {
    spawn(x, y, dir = 1) {
      // reuse a finished feather, else the oldest one
      let f = pool[0];
      for (const q of pool) if (q.age > f.age) f = q;
      f.age = 0;
      f.vx = 0.5 * dir;
      f.vy = 0.8; // a small upward puff first
      f.phase = Math.random() * 6.28;
      f.tilt = 0.4 * dir;
      f.mesh.position.set(x, y, Z);
      f.mesh.visible = true;
    },
    update(dt) {
      for (const f of pool) {
        if (f.age >= LIFE) {
          f.mesh.visible = false;
          continue;
        }
        f.age += dt;
        f.vy += (-FALL_SPEED - f.vy) * Math.min(1, FALL_PULL * dt);
        f.vx *= Math.exp(-1.5 * dt);
        const sway = Math.sin(f.age * SWAY_RATE + f.phase);
        const p = f.mesh.position;
        p.x += (f.vx + sway * SWAY) * dt;
        p.y += f.vy * dt;
        f.mesh.rotation.set(0.5 * Math.cos(f.age * SWAY_RATE + f.phase), f.age * TUMBLE, f.tilt + 0.6 * sway);
        const grow = sstep(Math.min(1, f.age / FADE_IN));
        const shrink = sstep(Math.min(1, (LIFE - f.age) / FADE_OUT));
        f.mesh.scale.setScalar(Math.max(0.001, grow * shrink));
      }
    },
  };
}
