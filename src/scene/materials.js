// Material helpers on top of the yarn world's procedural knit textures.
import * as THREE from "three";
import { yarnMaterial } from "./yarn/knit.js";
import { P } from "./layout.js";

const color = (c) => P[c] ?? c;

// knitted fabric; repeat = stitch tiles across the mesh's uv range (one tile = 4 x 5 stitches)
export function knitMaterial(c, repeat = [4, 4], stitch = "stockinette") {
  return yarnMaterial({ color: color(c), stitch, repeat });
}

// twisted strand for Rope tubes (Rope maps u along the twist, so repeat stays [1, 1])
export function strandMaterial(c) {
  return yarnMaterial({ color: color(c), stitch: "strand", repeat: [1, 1] });
}

// needle felt: matte, soft sheen at grazing angles; pair with addFuzz for the fiber halo
export function feltMaterial(c) {
  const base = new THREE.Color(color(c));
  return new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: 1,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: base.clone().lerp(new THREE.Color("#ffffff"), 0.5),
  });
}

let wood;
export function woodMaterial() {
  wood ??= new THREE.MeshStandardMaterial({ color: P.wood, roughness: 0.65, metalness: 0 });
  return wood;
}

let steel;
export function steelMaterial() {
  steel ??= new THREE.MeshStandardMaterial({ color: "#9a9590", roughness: 0.35, metalness: 0.8 });
  return steel;
}
