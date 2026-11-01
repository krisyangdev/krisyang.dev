// One string-light bulb: a felt-covered bead on a small socket, a soft additive glow sprite and an
// invisible hit proxy. The group's origin is the point on the wire; the bead hangs below it.
//
//   const bulb = createBulb({ bead, capMaterial, glowColor });
//   bulb.group (add to the scene), bulb.material (emissive is driven per frame), bulb.sprite,
//   bulb.spriteMaterial (opacity), bulb.proxy (register with interaction)
//
// Units: world units.
import * as THREE from "three";

export const BULB_RADIUS = 0.1;
const CAP_RADIUS = 0.048;
const CAP_HEIGHT = 0.07;
const PROXY_RADIUS = 0.24; // generous so a finger can find it
export const GLOW_SIZE = 1.1; // sprite diameter at full strength

const PROXY_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

let shared;
function parts() {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.22, "rgba(255,255,255,0.5)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  shared = {
    glow,
    bead: new THREE.SphereGeometry(BULB_RADIUS, 16, 12),
    cap: new THREE.CylinderGeometry(CAP_RADIUS * 0.8, CAP_RADIUS, CAP_HEIGHT, 8),
    proxy: new THREE.SphereGeometry(PROXY_RADIUS, 8, 6),
  };
  return shared;
}

// distance from the wire point down to the bead's center
export const BEAD_DROP = CAP_HEIGHT * 0.7 + BULB_RADIUS * 0.85;

export function createBulb({ bead, capMaterial, glowColor }) {
  const geo = parts();
  const group = new THREE.Group();

  const material = bead.clone(); // own emissive per bulb, same shader program
  const sphere = new THREE.Mesh(geo.bead, material);
  sphere.position.y = -BEAD_DROP;
  sphere.castShadow = true;
  sphere.raycast = () => {};

  const cap = new THREE.Mesh(geo.cap, capMaterial);
  cap.position.y = -CAP_HEIGHT / 2;
  cap.raycast = () => {};

  const spriteMaterial = new THREE.SpriteMaterial({
    map: geo.glow,
    color: glowColor,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.position.y = -BEAD_DROP;
  sprite.scale.setScalar(GLOW_SIZE);
  sprite.raycast = () => {};

  const proxy = new THREE.Mesh(geo.proxy, PROXY_MATERIAL);
  proxy.position.y = -BEAD_DROP;

  group.add(sphere, cap, sprite, proxy);
  return { group, material, sprite, spriteMaterial, proxy };
}
