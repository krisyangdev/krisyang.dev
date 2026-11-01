// Felt petals and tiny flowers drifting down and sideways with the breeze, tumbling as they go.
// Instanced (one draw call each for petals, flower petals, flower centers), no shadows.
// At night (daynight.night -> 1) the petals shrink away and a few tiny warm fireflies drift and blink instead.
// They live in a box around the camera view at their own depth and wrap around when they leave it,
// so they exist at any scroll position. Units: world units, seconds, radians.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { P, CAMERA_FOV } from "./layout.js";
import { feltMaterial } from "./materials.js";

const PETALS = 14;
const FLOWERS = 5;
const Z_RANGE = [-1.5, 5];
const MARGIN = 1.5; // world units beyond the view edge before wrapping
const FALL = [0.25, 0.55]; // units/s
const WIND_GAIN = 1.6; // units/s of sideways drift per unit of wind strength
const LANE_PULL = 0.4; // 1/s, spring toward the petal's own depth
const FOLLOW = 1.5; // 1/s, how fast velocity catches up with the wind
const FIREFLIES = 12;
const FLY_Z = [-0.8, 3];
const FLY_SPEED = 0.12; // units/s of slow drift
const FLY_WOBBLE = 0.35; // units of looping around the drift path
const FLY_BLINK = [0.35, 0.9]; // rad/s
const FLY_SIZE = 1.1; // point size; about 0.27 world units each (size * tan(fov / 2))
const FLY_COLOR = "#ffd27a";
const PETAL_COLORS = ["coral", "pink", "pink", "white", "mustard"];
const FLOWER_COLORS = ["white", "pink", "coral"];

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

// teardrop petal, pointed at the bottom, cupped slightly
function petalGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.55, -0.25, 0.5, 0.4, 0, 0.5);
  s.bezierCurveTo(-0.5, 0.4, -0.55, -0.25, 0, -0.5);
  return cup(extrude(s), 0.6);
}

// five round petals around a center
function flowerGeometry() {
  const s = new THREE.Shape();
  s.absellipse(0, 0.3, 0.2, 0.32, 0, Math.PI * 2, false, 0);
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(cup(extrude(s), 0.5).rotateZ((i * Math.PI * 2) / 5));
  return mergeGeometries(parts);
}

function extrude(shape) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 8,
  });
  return g.translate(0, 0, -0.04);
}

// bend z up with distance from the axis, so the piece reads as a cupped bit of felt
function cup(geometry, amount) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + amount * pos.getX(i) ** 2);
  geometry.computeVertexNormals();
  return geometry;
}

function feltInstances(geometry, count, color = "#ffffff") {
  const material = feltMaterial(color);
  material.side = THREE.DoubleSide;
  material.emissive.copy(material.color).multiplyScalar(0.3); // edge-on and back-lit petals would go muddy brown
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false; // instances move far from the origin bounds
  return mesh;
}

// soft round glow with a small bright core
function glowTexture() {
  const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,246,214,1)");
  g.addColorStop(0.12, "rgba(255,222,150,0.95)");
  g.addColorStop(0.4, "rgba(255,180,80,0.22)");
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function createFireflies({ scene, camera }) {
  const positions = new Float32Array(FIREFLIES * 3);
  const colors = new Float32Array(FIREFLIES * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: FLY_SIZE,
    map: glowTexture(),
    vertexColors: true, // brightness = colour, so the blink needs no per-point alpha
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  const warm = new THREE.Color(FLY_COLOR);
  const camY0 = camera.position.y;
  const flies = [];
  for (let i = 0; i < FIREFLIES; i++) {
    const heading = Math.random() * Math.PI * 2;
    flies.push({
      x: (Math.random() - 0.5) * 22,
      y: camY0 + (Math.random() - 0.5) * 11,
      z: FLY_Z[0] + Math.random() * (FLY_Z[1] - FLY_Z[0]),
      vx: Math.cos(heading) * FLY_SPEED * (0.5 + Math.random()),
      vy: Math.sin(heading) * FLY_SPEED * (0.5 + Math.random()),
      loop: 0.3 + Math.random() * 0.4, // rad/s of the wobble
      blink: FLY_BLINK[0] + Math.random() * (FLY_BLINK[1] - FLY_BLINK[0]),
      phase: Math.random() * Math.PI * 2,
    });
  }

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  const wrap = (v, half) => ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half;

  return {
    update(dt, t, night) {
      points.visible = night > 0.002;
      if (!points.visible) return;
      const camY = camera.position.y;
      const camZ = camera.position.z;
      for (let i = 0; i < FIREFLIES; i++) {
        const f = flies[i];
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        const halfH = (camZ - f.z) * tanHalf + MARGIN;
        const halfW = halfH * camera.aspect;
        f.x = wrap(f.x, halfW);
        f.y = camY + wrap(f.y - camY, halfH);
        const a = t * f.loop + f.phase;
        positions[i * 3] = f.x + Math.sin(a) * FLY_WOBBLE;
        positions[i * 3 + 1] = f.y + Math.cos(a * 1.3) * FLY_WOBBLE;
        positions[i * 3 + 2] = f.z;
        // gentle blink: mostly lit, dims toward dark for a moment
        const b = 0.5 + 0.5 * Math.sin(t * f.blink + f.phase * 2);
        const glow = night * (0.15 + 0.85 * b * b);
        colors[i * 3] = warm.r * glow;
        colors[i * 3 + 1] = warm.g * glow;
        colors[i * 3 + 2] = warm.b * glow;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

export function createPetals({ scene, camera, breeze, daynight }) {
  const fireflies = createFireflies({ scene, camera });
  const petalMesh = feltInstances(petalGeometry(), PETALS);
  const flowerMesh = feltInstances(flowerGeometry(), FLOWERS);
  const centerGeo = new THREE.SphereGeometry(0.15, 12, 8).scale(1, 1, 0.5).translate(0, 0, 0.04);
  const centerMesh = feltInstances(centerGeo, FLOWERS, "mustard");
  scene.add(petalMesh, flowerMesh, centerMesh);

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  const camY0 = camera.position.y;

  const particles = [];
  for (let i = 0; i < PETALS + FLOWERS; i++) {
    const flower = i >= PETALS;
    const list = flower ? FLOWER_COLORS : PETAL_COLORS;
    const mesh = flower ? flowerMesh : petalMesh;
    const index = flower ? i - PETALS : i;
    mesh.setColorAt(index, tmpColor.set(P[list[Math.floor(Math.random() * list.length)]]));
    // start spread over the first view; the wrap keeps them in the box afterwards
    const z = Z_RANGE[0] + Math.random() * (Z_RANGE[1] - Z_RANGE[0]);
    particles.push({
      flower,
      index,
      x: (Math.random() - 0.5) * 20,
      y: camY0 + (Math.random() - 0.5) * 12,
      z,
      lane: z,
      vx: 0,
      vy: 0,
      vz: 0,
      fall: FALL[0] + Math.random() * (FALL[1] - FALL[0]),
      scale: flower ? 0.55 + Math.random() * 0.2 : 0.3 + Math.random() * 0.2,
      rx: Math.random() * Math.PI * 2,
      ry: Math.random() * Math.PI * 2,
      rz: Math.random() * Math.PI * 2,
      sx: (Math.random() - 0.5) * 2.4,
      sy: (Math.random() - 0.5) * 2.4,
      sz: (Math.random() - 0.5) * 1.6,
      phase: Math.random() * Math.PI * 2,
    });
  }
  for (const m of [petalMesh, flowerMesh]) m.instanceColor.needsUpdate = true;

  // wrap v into [-half, half) around 0
  const wrap = (v, half) => ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half;

  return {
    update(dt, t) {
      const night = daynight.night;
      fireflies.update(dt, t, night);
      const day = 1 - night; // petals shrink away at night
      const shown = day > 0.002;
      petalMesh.visible = flowerMesh.visible = centerMesh.visible = shown;
      if (!shown) return;
      const camY = camera.position.y;
      const camZ = camera.position.z;
      for (const p of particles) {
        const wind = breeze.at(p.x);
        const k = Math.min(1, FOLLOW * dt);
        p.vx += (wind * WIND_GAIN * breeze.dir.x - p.vx) * k;
        // the wind pushes slightly toward -z; a weak spring keeps each petal near its depth lane
        p.vz += (wind * WIND_GAIN * breeze.dir.z + (p.lane - p.z) * LANE_PULL - p.vz) * k;
        // sinking speed flutters a little as the petal tumbles
        p.vy += (-p.fall * (1 + 0.5 * Math.sin(t * 1.3 + p.phase)) - 0.15 * wind - p.vy) * k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rx += p.sx * dt * (0.6 + wind);
        p.ry += p.sy * dt * (0.6 + wind);
        p.rz += p.sz * dt;

        // view box at this depth
        const halfH = (camZ - p.z) * tanHalf + MARGIN;
        const halfW = halfH * camera.aspect;
        p.x = wrap(p.x, halfW);
        p.y = camY + wrap(p.y - camY, halfH);

        tmp.position.set(p.x, p.y, p.z);
        tmp.rotation.set(p.rx, p.ry, p.rz);
        tmp.scale.setScalar(p.scale * day);
        tmp.updateMatrix();
        if (p.flower) {
          flowerMesh.setMatrixAt(p.index, tmp.matrix);
          centerMesh.setMatrixAt(p.index, tmp.matrix);
        } else {
          petalMesh.setMatrixAt(p.index, tmp.matrix);
        }
      }
      petalMesh.instanceMatrix.needsUpdate = true;
      flowerMesh.instanceMatrix.needsUpdate = true;
      centerMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
