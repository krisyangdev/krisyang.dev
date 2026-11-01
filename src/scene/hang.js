// A thing hanging from a peg: a pendulum with two hinges.
//   swing  rotation about z (sways left / right in the picture plane)
//   flip   rotation about the line (tips toward / away from the camera; a hard kick spins it all the way round)
// The peg's own acceleration drives both (a bouncing line makes everything on it sway), and so does wind.
// Hang the object's mesh so that its local origin is the grip point and it extends down -y.
import * as THREE from "three";

const G = 9.8;
const MAX_STEP = 1 / 120;

const qLine = new THREE.Quaternion();
const qSwing = new THREE.Quaternion();
const qFlip = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

export class Hang {
  // length: grip -> center of mass (world units); shorter = quicker sway
  constructor({ length = 0.6, swingDamping = 1.4, flipDamping = 1.0, windGain = 1 } = {}) {
    this.length = length;
    this.swingDamping = swingDamping;
    this.flipDamping = flipDamping;
    this.windGain = windGain;
    this.swing = 0;
    this.flip = 0;
    this.swingVel = 0;
    this.flipVel = 0;
  }

  // add angular velocity (rad/s)
  kick(swingVel = 0, flipVel = 0) {
    this.swingVel += swingVel;
    this.flipVel += flipVel;
  }

  // pegAccel: world acceleration of the grip point; windX / windZ: push in world units/s^2
  update(dt, pegAccel, windX = 0, windZ = 0) {
    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / n;
    const L = this.length;
    const gy = G + (pegAccel?.y ?? 0);
    const ax = (pegAccel?.x ?? 0) - windX * this.windGain;
    const az = (pegAccel?.z ?? 0) - windZ * this.windGain;
    for (let i = 0; i < n; i++) {
      // the pivot accelerating by a feels like gravity of -a acting on the bob
      const sw = (-gy * Math.sin(this.swing) - ax * Math.cos(this.swing)) / L - this.swingDamping * this.swingVel;
      const fl = (-gy * Math.sin(this.flip) + az * Math.cos(this.flip)) / L - this.flipDamping * this.flipVel;
      this.swingVel += sw * h;
      this.flipVel += fl * h;
      this.swing += this.swingVel * h;
      this.flip += this.flipVel * h;
    }
    // keep flip in (-PI, PI] after full spins so it settles the short way round
    if (this.flip > Math.PI) this.flip -= Math.PI * 2;
    else if (this.flip < -Math.PI) this.flip += Math.PI * 2;
  }

  // place object at the peg; lineAngle = the line's slope at the peg (rad, about z)
  apply(object, pegPos, lineAngle = 0) {
    object.position.copy(pegPos);
    qLine.setFromAxisAngle(Z, lineAngle);
    qSwing.setFromAxisAngle(Z, this.swing);
    qFlip.setFromAxisAngle(X, this.flip);
    object.quaternion.copy(qLine).multiply(qSwing).multiply(qFlip);
  }
}
