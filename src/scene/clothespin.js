// Wooden clothespin. Origin = where the line passes through the jaws; the pin stands along +y,
// faces +z. Whatever it holds starts at y = PIN_GRIP_Y (the bottom of the jaws).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { woodMaterial, steelMaterial } from "./materials.js";

export const PIN_GRIP_Y = -0.2;

const W = 0.13; // x
const H = 0.56; // y
const LEAF = 0.055; // z thickness of one leaf
const GAP = 0.03; // between the leaves at the line

let geos;
function geometries() {
  geos ??= {
    leaf: new RoundedBoxGeometry(W, H, LEAF, 2, 0.02).translate(0, 0.06, 0),
    spring: new THREE.TorusGeometry(0.035, 0.009, 6, 16).rotateY(Math.PI / 2),
  };
  return geos;
}

export function makeClothespin() {
  const g = geometries();
  const pin = new THREE.Group();
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(g.leaf, woodMaterial());
    leaf.position.z = s * (GAP + LEAF) / 2;
    leaf.castShadow = true;
    pin.add(leaf);
  }
  const spring = new THREE.Mesh(g.spring, steelMaterial());
  spring.position.y = 0.12;
  pin.add(spring);
  return pin;
}
