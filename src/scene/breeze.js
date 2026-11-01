// Shared wind for the whole page, 1D along world x: a steady breeze plus gusts that sweep left -> right.
// Everything that sways (letters, cards, charms, petals) reads at(x), so a gust visibly travels across
// the screen and things swing one after another. Strength is dimensionless (steady ~0.25..0.55, gust peak
// ~1.6); the lean / push direction is `dir`. Units: x in world units, time in seconds.
import * as THREE from "three";

const BREEZE = 0.4;
const BREEZE_WAVE = 0.15;
const WAVE_SPEED = 0.9; // rad/s of the slow breathing
const WAVE_LENGTH = 0.35; // rad per world unit
const GUST_PEAK = 1.6; // gust(1) amplitude
const GUST_SPEED = 7; // units/s the gust band travels
const GUST_W = 2.4; // band half width
const GUST_FROM = -16; // band center starts / ends beyond the screen
const GUST_TO = 16;
const GUST_GAP = [6, 11]; // s between scheduled gusts
const FIRST_GUST = 2.5; // s after load
const PUSH_DECAY = 3; // 1/s, so a push fades in roughly a second
const PUSH_MAX = 1.2;

// gusts: false keeps only the steady breeze (screenshots, reduced motion)
export function createBreeze({ gusts = true } = {}) {
  const dir = new THREE.Vector3(0.95, 0, -0.31).normalize();
  const active = []; // { x, amp }
  let t = 0;
  let nextGust = FIRST_GUST;
  let pushed = 0;

  function gust(strength = 1) {
    active.push({ x: GUST_FROM, amp: GUST_PEAK * strength });
  }

  return {
    dir,
    gust,
    // short-lived extra strength everywhere
    push(amount) {
      pushed = Math.min(PUSH_MAX, pushed + amount);
    },
    at(x) {
      let w = BREEZE + BREEZE_WAVE * Math.sin(t * WAVE_SPEED - x * WAVE_LENGTH) + pushed;
      for (const g of active) {
        const d = (x - g.x) / GUST_W;
        w += g.amp * Math.exp(-d * d);
      }
      return w;
    },
    update(dt) {
      t += dt;
      pushed *= Math.exp(-PUSH_DECAY * dt);
      for (let i = active.length - 1; i >= 0; i--) {
        active[i].x += GUST_SPEED * dt;
        if (active[i].x > GUST_TO) active.splice(i, 1);
      }
      if (gusts && (nextGust -= dt) <= 0) {
        gust(0.5 + Math.random() * 0.5);
        nextGust = GUST_GAP[0] + Math.random() * (GUST_GAP[1] - GUST_GAP[0]);
      }
    },
  };
}
