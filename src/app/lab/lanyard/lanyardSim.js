import * as THREE from "three";

// Units are roughly decimetres: the pass is 10 by 15 cm.
export const CARD = { W: 1, H: 1.5, T: 0.032, R: 0.075, PIVOT: 0.75 + 0.17, STRAP: 0.24 };

const GRAVITY = 34;
const ANCHOR_Y = 4.25;
const ROPE_LEN = 2.95;
const SEGMENTS = 22;
const ROPE_MASS = 0.14;
const CARD_MASS = 1;
const FRAME = 1 / 60;
const SUBSTEPS = 24;

// Damping in 1/s: air on the ribbon, the card, and how fast a spin dies.
const ROPE_DRAG = 1.8;
const CARD_DRAG = 0.5;
const SPIN_DRAG = 0.9;
// Torsion of the strap, in N·m per radian of twist, and its internal friction.
const TORSION = 0.42;
const TORSION_DAMP = 0.05;
// Bending: the ribbon resists a kink a little. Compliance per substep pair.
const BEND_COMPLIANCE = 4e-5;
// The hand: a stiff spring, so a corner grab swings the card round your finger.
const GRAB_COMPLIANCE = 6e-4;

// Flat-plate air drag per quarter of the card.
const AIR = 0.09;

const MAX_V = 22;
const MAX_W = 34;

export function createSim() {
  const n = SEGMENTS + 1;
  const seg = ROPE_LEN / SEGMENTS;
  const invM = SEGMENTS / ROPE_MASS;
  const rope = [];
  const prev = [];
  const vel = [];
  for (let i = 0; i < n; i += 1) {
    rope.push(new THREE.Vector3(0, ANCHOR_Y - i * seg, 0));
    prev.push(new THREE.Vector3());
    vel.push(new THREE.Vector3());
  }
  const anchor = rope[0].clone();

  const { W, H, T, PIVOT } = CARD;
  const invMass = 1 / CARD_MASS;
  const invI = new THREE.Vector3(12 / (CARD_MASS * (H * H + T * T)), 12 / (CARD_MASS * (W * W + T * T)), 12 / (CARD_MASS * (W * W + H * H)));
  const pivotLocal = new THREE.Vector3(0, PIVOT, 0);
  const x = new THREE.Vector3(0, rope[n - 1].y - PIVOT, 0);
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const xPrev = new THREE.Vector3();
  const qPrev = new THREE.Quaternion();
  const qInv = new THREE.Quaternion();
  const pivotWorld = new THREE.Vector3();

  const state = {
    rope,
    x,
    q,
    pivotWorld,
    twist: 0,
    dragging: false,
  };

  const grabLocal = new THREE.Vector3();
  const grabFrom = new THREE.Vector3();
  const grabTo = new THREE.Vector3();
  const grabNow = new THREE.Vector3();

  // scratch
  const r = new THREE.Vector3();
  const d = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const rn = new THREE.Vector3();
  const tq = new THREE.Quaternion();
  const a3 = new THREE.Vector3();

  // I⁻¹ in world space applied to a vector, in place.
  const applyInvI = (vec) => {
    qInv.copy(q).invert();
    vec.applyQuaternion(qInv);
    vec.multiply(invI);
    vec.applyQuaternion(q);
    return vec;
  };
  const generalisedInv = (rWorld, dir) => {
    rn.crossVectors(rWorld, dir);
    a3.copy(rn);
    applyInvI(a3);
    return invMass + rn.dot(a3);
  };
  // Positional impulse p at offset rWorld from the centre of mass.
  const applyImpulse = (rWorld, p) => {
    x.addScaledVector(p, invMass);
    a3.crossVectors(rWorld, p);
    applyInvI(a3);
    tq.set(a3.x, a3.y, a3.z, 0).multiply(q);
    q.x += 0.5 * tq.x;
    q.y += 0.5 * tq.y;
    q.z += 0.5 * tq.z;
    q.w += 0.5 * tq.w;
    q.normalize();
  };
  const bodyPoint = (local, out) => out.copy(local).applyQuaternion(q).add(x);

  // Distance constraint between rope particles i and j (j may be fixed).
  const solvePair = (i, j, rest, alpha) => {
    const wi = i === 0 ? 0 : invM;
    const wj = j === 0 ? 0 : invM;
    d.subVectors(rope[j], rope[i]);
    const len = d.length();
    if (len < 1e-9) return;
    const c = len - rest;
    const k = c / (wi + wj + alpha);
    d.multiplyScalar(k / len);
    rope[i].addScaledVector(d, wi);
    rope[j].addScaledVector(d, -wj);
  };

  // The ball joint: the last rope particle and the clip ring are one point.
  const solveJoint = () => {
    const end = rope[n - 1];
    r.copy(pivotLocal).applyQuaternion(q);
    pivotWorld.copy(r).add(x);
    d.subVectors(end, pivotWorld);
    const c = d.length();
    if (c < 1e-9) return;
    nrm.copy(d).divideScalar(c);
    const wb = generalisedInv(r, nrm);
    const lambda = c / (invM + wb);
    end.addScaledVector(nrm, -lambda * invM);
    d.copy(nrm).multiplyScalar(lambda);
    applyImpulse(r, d);
  };

  // Tethers: nothing can be further from the anchor than the strap allows.
  const solveTethers = () => {
    for (let i = 2; i < n; i += 1) {
      d.subVectors(rope[i], anchor);
      const len = d.length();
      const max = i * seg;
      if (len > max) rope[i].addScaledVector(d, (max - len) / len);
    }
    r.copy(pivotLocal).applyQuaternion(q);
    pivotWorld.copy(r).add(x);
    d.subVectors(pivotWorld, anchor);
    const len = d.length();
    if (len > ROPE_LEN) {
      nrm.copy(d).divideScalar(len);
      const wb = generalisedInv(r, nrm);
      d.copy(nrm).multiplyScalar(-(len - ROPE_LEN) / wb);
      applyImpulse(r, d);
    }
  };

  const solveGrab = (h) => {
    r.copy(grabLocal).applyQuaternion(q);
    pivotWorld.copy(r).add(x);
    d.subVectors(grabNow, pivotWorld);
    const c = d.length();
    if (c < 1e-9) return;
    nrm.copy(d).divideScalar(c);
    const wb = generalisedInv(r, nrm);
    const lambda = c / (wb + GRAB_COMPLIANCE / (h * h));
    d.copy(nrm).multiplyScalar(lambda);
    applyImpulse(r, d);
  };

  // Twist: carry the strap's face down the rope by parallel transport, then
  // measure how far the card's face has turned from it about the last link.
  const tn = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const cn = new THREE.Vector3();
  const cr = new THREE.Vector3();
  let lastPhi = 0;
  const measureTwist = () => {
    nn.set(0, 0, 1);
    for (let i = 0; i < n - 1; i += 1) {
      tn.subVectors(rope[i + 1], rope[i]).normalize();
      nn.addScaledVector(tn, -nn.dot(tn)).normalize();
    }
    cn.set(0, 0, 1).applyQuaternion(q);
    cn.addScaledVector(tn, -cn.dot(tn));
    if (cn.lengthSq() < 0.04) return tn;
    cn.normalize();
    cr.crossVectors(nn, cn);
    const phi = Math.atan2(cr.dot(tn), nn.dot(cn));
    let dphi = phi - lastPhi;
    if (dphi > Math.PI) dphi -= Math.PI * 2;
    if (dphi < -Math.PI) dphi += Math.PI * 2;
    state.twist += dphi;
    lastPhi = phi;
    return tn;
  };

  const torque = new THREE.Vector3();
  const an = new THREE.Vector3();
  const ar = new THREE.Vector3();
  const av = new THREE.Vector3();
  const af = new THREE.Vector3();
  const PLATE = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => new THREE.Vector3((sx * W) / 4, (sy * H) / 4, 0));
  const substep = (h, f) => {
    // integrate
    for (let i = 1; i < n; i += 1) {
      vel[i].y -= GRAVITY * h;
      prev[i].copy(rope[i]);
      rope[i].addScaledVector(vel[i], h);
    }
    v.y -= GRAVITY * h;
    // The strap's torsion acts about its last link, pulling the face back round.
    const axis = measureTwist();
    const spin = w.dot(axis);
    torque.copy(axis).multiplyScalar(-TORSION * state.twist - TORSION_DAMP * spin);
    applyInvI(torque);
    w.addScaledVector(torque, h);
    // Air on a flat plate: each quarter of the card is pushed back against
    // its own motion through its face. A sideways fling makes it flutter and turn.
    an.set(0, 0, 1).applyQuaternion(q);
    for (const pl of PLATE) {
      ar.copy(pl).applyQuaternion(q);
      av.crossVectors(w, ar).add(v);
      af.copy(an).multiplyScalar(-AIR * av.dot(an));
      v.addScaledVector(af, invMass * h);
      a3.crossVectors(ar, af);
      applyInvI(a3);
      w.addScaledVector(a3, h);
    }
    xPrev.copy(x);
    qPrev.copy(q);
    x.addScaledVector(v, h);
    tq.set(w.x, w.y, w.z, 0).multiply(q);
    q.x += 0.5 * h * tq.x;
    q.y += 0.5 * h * tq.y;
    q.z += 0.5 * h * tq.z;
    q.w += 0.5 * h * tq.w;
    q.normalize();

    if (state.dragging) grabNow.lerpVectors(grabFrom, grabTo, f);

    // solve
    for (let i = 0; i < n - 1; i += 1) solvePair(i, i + 1, seg, 0);
    const bend = BEND_COMPLIANCE / (h * h);
    for (let i = 0; i < n - 2; i += 1) solvePair(i, i + 2, seg * 2, bend);
    solveJoint();
    if (state.dragging) solveGrab(h);
    for (let i = n - 2; i >= 0; i -= 1) solvePair(i, i + 1, seg, 0);
    solveJoint();
    solveTethers();

    // velocities
    const ropeK = Math.exp(-ROPE_DRAG * h);
    for (let i = 1; i < n; i += 1) vel[i].subVectors(rope[i], prev[i]).divideScalar(h).multiplyScalar(ropeK);
    v.subVectors(x, xPrev).divideScalar(h).multiplyScalar(Math.exp(-CARD_DRAG * h));
    qInv.copy(qPrev).invert();
    tq.copy(q).multiply(qInv);
    w.set(tq.x, tq.y, tq.z).multiplyScalar((2 / h) * (tq.w < 0 ? -1 : 1));
    w.multiplyScalar(Math.exp(-SPIN_DRAG * h));
    if (!state.dragging) {
      if (v.length() > MAX_V) v.setLength(MAX_V);
      if (w.length() > MAX_W) w.setLength(MAX_W);
    }
  };

  const step = (dt) => {
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s += 1) substep(h, (s + 1) / SUBSTEPS);
    grabFrom.copy(grabTo);
    pivotWorld.copy(pivotLocal).applyQuaternion(q).add(x);
  };

  let acc = 0;
  state.step = step;
  state.advance = (dt) => {
    acc = Math.min(acc + dt, FRAME * 4);
    while (acc >= FRAME) {
      step(FRAME);
      acc -= FRAME;
    }
  };
  state.grab = (local, to) => {
    grabLocal.copy(local);
    bodyPoint(local, grabFrom);
    grabTo.copy(to);
    grabNow.copy(grabFrom);
    state.dragging = true;
  };
  state.energy = () => {
    let e = v.lengthSq() + w.lengthSq() * 0.1;
    for (let i = 1; i < n; i += 1) e += vel[i].lengthSq() * 0.01;
    return e;
  };
  state.drag = (to) => {
    grabTo.copy(to);
  };
  state.release = () => {
    state.dragging = false;
  };
  pivotWorld.copy(pivotLocal).applyQuaternion(q).add(x);
  return state;
}
