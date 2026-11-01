// A felt link tag (X, GitHub, email) pegged to the wall garland with a wooden clothespin: the page's contact footer.
// Units: world units. The pin rides the rope at the particle nearest to x; the tag hangs from the pin's grip point.
//
//   root
//     pin   (clothespin, follows the rope)
//     pivot (Hang rotation: swing about z, flip about the line)
//       body (squash / stretch)
//         tag content + hit proxy
import * as THREE from "three";
import { Hang } from "./hang.js";
import { Spring } from "./yarn/spring.js";
import { makeClothespin, PIN_GRIP_Y } from "./clothespin.js";
import { buildTag, TAG_LENGTH } from "./link-tags.js";
import { playPlink, playBubble } from "./yarn/sound.js";
import { noop, AccelProbe } from "./wall-geo.js";

// ---- tunables
export const TAG_COLOR = "white";
export const TAG_WEIGHT = 60; // downward acceleration added to the garland around the peg (a charm weighs 30)
const PIN_SCALE = 1.35; // same chunky peg as the wall cards
const HOLD = 0.17; // how deep the tag's top edge sits inside the jaws
const HOVER_COOLDOWN = 0.2; // s between hover wiggles of one tag
const WIGGLE = 0.5; // hover flip kick, in units of the pendulum's natural frequency
const PITCH = 2.2; // hover plink, high like the hero tags
const CLICK_SPIN = 2.5; // flip kick (rad/s) on click
const TUG = { vy: -3.2, sigma: 3 }; // click: the garland dips and springs back

const G = 9.8;

export class LinkTag {
  constructor({ link, x, strand, motion }) {
    this.link = link;
    this.strand = strand;
    this.motion = motion;
    this.i = strand.nearest(x);
    strand.addLoad(this.i, TAG_WEIGHT);

    const { content, box } = buildTag(link.id, TAG_COLOR);
    this.pin = makeClothespin();
    this.pin.scale.setScalar(PIN_SCALE);
    this.pivot = new THREE.Group();
    this.body = new THREE.Group();
    this.body.add(content);
    this.pivot.add(this.body);
    this.root = new THREE.Group();
    this.root.add(this.pin, this.pivot);

    const size = box.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.1, size.y + 0.1, Math.max(size.z, 0.4)), new THREE.MeshBasicMaterial({ visible: false }));
    box.getCenter(proxy.position);
    this.body.add(proxy);
    this.root.traverse((o) => {
      if (o !== proxy) o.raycast = noop;
    });

    this.hang = new Hang({ length: TAG_LENGTH, swingDamping: 1.2, flipDamping: 1.0, windGain: 1.3 });
    this.sy = new Spring(260, 12, 1);
    this.sxz = new Spring(260, 12, 1);
    this.probe = new AccelProbe();
    this.peg = new THREE.Vector3();
    this.grip = new THREE.Vector3();
    this.clock = 0;
    this.lastHover = -1;
    this.hovered = false;
  }

  get interactive() {
    return this.root;
  }

  squash(sy, sxz) {
    this.sy.value = sy;
    this.sy.velocity = 0;
    this.sxz.value = sxz;
    this.sxz.velocity = 0;
  }

  setHover(on) {
    if (on === this.hovered) return;
    this.hovered = on;
    if (!on || this.clock - this.lastHover < HOVER_COOLDOWN) return;
    this.lastHover = this.clock;
    const s = Math.random() < 0.5 ? -1 : 1;
    this.hang.kick(s * 0.6 * this.motion, s * WIGGLE * Math.sqrt(G / TAG_LENGTH) * this.motion);
    this.squash(1.07, 0.97);
    playPlink({ pitch: PITCH });
  }

  // opens the link: call inside the click handler so popup blockers allow it
  open() {
    this.strand.addImpulse(this.i, 0, TUG.vy, 0, TUG.sigma);
    this.hang.kick(0, (Math.random() < 0.5 ? -1 : 1) * CLICK_SPIN * this.motion);
    this.squash(1.12, 0.95);
    playBubble();
    const { href } = this.link;
    if (href.startsWith("mailto:")) window.location.href = href;
    else window.open(href, "_blank", "noopener");
  }

  // windX / windZ: wind push in world units/s^2 at this tag
  update(dt, windX, windZ) {
    this.clock += dt;
    const pos = this.strand.rope.pos;
    const k = this.i * 3;
    const a = (this.i - 2) * 3;
    const b = (this.i + 2) * 3;
    const peg = this.peg.set(pos[k], pos[k + 1], pos[k + 2]);
    const angle = Math.atan2(pos[b + 1] - pos[a + 1], pos[b] - pos[a]);

    this.hang.update(dt, this.probe.update(dt, peg.x, peg.y, peg.z), windX, windZ);
    this.pin.position.copy(peg);
    this.pin.rotation.z = angle;
    const d = PIN_GRIP_Y * PIN_SCALE + HOLD;
    this.grip.set(peg.x - Math.sin(angle) * d, peg.y + Math.cos(angle) * d, peg.z);
    this.hang.apply(this.pivot, this.grip, angle);

    this.sy.update(dt);
    this.sxz.update(dt);
    this.body.scale.set(this.sxz.value, this.sy.value, this.sxz.value);
  }
}
