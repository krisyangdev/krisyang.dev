// A thin tube whose centerline is rewritten every frame (the wire of the string lights).
//
//   const wire = createWire({ samples, material });
//   scene.add(wire.mesh);
//   // each frame: write wire.centers (x, y, z per sample, world units), then
//   wire.rebuild();
//
// The number of samples is fixed, so nothing allocates after creation.
// Units: world units.
import * as THREE from "three";

export function createWire({ samples, radius = 0.013, sides = 5, material }) {
  const centers = new Float32Array(samples * 3);
  const positions = new THREE.BufferAttribute(new Float32Array(samples * sides * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const normals = new THREE.BufferAttribute(new Float32Array(samples * sides * 3), 3).setUsage(THREE.DynamicDrawUsage);

  const index = new Uint32Array((samples - 1) * sides * 6);
  let w = 0;
  for (let r = 0; r < samples - 1; r++) {
    for (let j = 0; j < sides; j++) {
      const a = r * sides + j;
      const b = r * sides + ((j + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      index[w++] = a;
      index[w++] = b;
      index[w++] = c;
      index[w++] = b;
      index[w++] = d;
      index[w++] = c;
    }
  }

  const cs = new Float32Array(sides);
  const sn = new Float32Array(sides);
  for (let k = 0; k < sides; k++) {
    cs[k] = Math.cos((k / sides) * Math.PI * 2);
    sn[k] = Math.sin((k / sides) * Math.PI * 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  geometry.setAttribute("normal", normals);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // the box moves every frame
  mesh.raycast = () => {};

  function rebuild() {
    const p = positions.array;
    const nn = normals.array;
    const last = samples - 1;
    for (let i = 0; i < samples; i++) {
      const a = Math.max(0, i - 1) * 3;
      const e = Math.min(last, i + 1) * 3;
      let tx = centers[e] - centers[a];
      let ty = centers[e + 1] - centers[a + 1];
      let tz = centers[e + 2] - centers[a + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // normal = t x z, binormal = t x normal; the wire is round, so the frame may twist freely
      let nx = ty;
      let ny = -tx;
      let nz = 0;
      let nl = Math.hypot(nx, ny);
      if (nl < 1e-5) {
        nx = 0;
        ny = 1;
        nl = 1;
      }
      nx /= nl;
      ny /= nl;
      const bx = ty * nz - tz * ny;
      const by = tz * nx - tx * nz;
      const bz = tx * ny - ty * nx;
      const cx = centers[i * 3];
      const cy = centers[i * 3 + 1];
      const cz = centers[i * 3 + 2];
      let o = i * sides * 3;
      for (let k = 0; k < sides; k++) {
        const dx = nx * cs[k] + bx * sn[k];
        const dy = ny * cs[k] + by * sn[k];
        const dz = nz * cs[k] + bz * sn[k];
        p[o] = cx + dx * radius;
        p[o + 1] = cy + dy * radius;
        p[o + 2] = cz + dz * radius;
        nn[o] = dx;
        nn[o + 1] = dy;
        nn[o + 2] = dz;
        o += 3;
      }
    }
    positions.needsUpdate = true;
    normals.needsUpdate = true;
  }

  return { mesh, centers, rebuild };
}
