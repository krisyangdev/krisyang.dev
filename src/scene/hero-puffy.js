// Shared geometry finishing for the plush letters and the felt tags.
//
// ExtrudeGeometry / TextGeometry output is non-indexed with flat normals. This welds the vertices and
// recomputes smooth normals (a rounded, stuffed look), then writes fresh uvs. Units: world units.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// uv = (x, y) in the extrusion plane, pushed outward along the surface normal by how far the vertex is
// from the front / back face, so bevels and side walls continue the front texture instead of smearing it.
// tileU / tileV = world size of one uv unit (one texture tile).
export function finishPuffy(source, tileU, tileV, offU = 0, offV = 0) {
  source.deleteAttribute("normal");
  source.deleteAttribute("uv");
  const geo = mergeVertices(source);
  source.dispose();
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  const { min, max } = geo.boundingBox;
  const zc = (min.z + max.z) / 2;
  const zh = (max.z - min.z) / 2;
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const l = Math.hypot(nx, ny);
    const roll = l > 1e-3 ? (zh - Math.abs(pos.getZ(i) - zc)) / l : 0;
    uv[i * 2] = (pos.getX(i) + nx * roll + offU) / tileU;
    uv[i * 2 + 1] = (pos.getY(i) + ny * roll + offV) / tileV;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}
