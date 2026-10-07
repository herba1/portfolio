export const FREE = 0;
export const FOLLOW = 1;
export const RAIL = 2;
export const BRIDGES = 11;

const HAND_DAMPING = 120;
const BRIDGE_COMPLIANCE = 5e-4;
const BRIDGE_DAMPING = 260;
const YIELD_STRETCH = 1.6;
const DRAWN_GAP_CAP = 2.6;
const SHEAR_WEIGHT = 0.7;
const RAIL_INV_MASS = 1 / 1.5;
const RAIL_BRAKE = 11000;
const RAIL_VISCOUS = 17;
const SLEEP_SPEED = 2;
const SLEEP_SPIN = 0.02;
const SLEEP_AFTER = 0.25;
const WALL_PULL = 0.2;
const ZIP_INTERVAL = 0.055;
const SNAP_STRAIN = 1.6;
const HANDOFF = 0.15;
const HANDOFF_CAP = 0.35;
const HANDOFF_TAU = 0.09;
const STRENGTH_SPREAD = 0.6;
const HINGE_BRIDGES = 2;
const HINGE_LIMIT = 0.14;

function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(bodyCapacity = 16, seamCapacity = 16) {
  const bridgeCapacity = seamCapacity * BRIDGES;
  return {
    bodyCapacity,
    seamCapacity,
    alive: new Uint8Array(bodyCapacity),
    mode: new Uint8Array(bodyCapacity),
    awake: new Uint8Array(bodyCapacity),
    rest: new Float64Array(bodyCapacity),
    x: new Float64Array(bodyCapacity),
    y: new Float64Array(bodyCapacity),
    a: new Float64Array(bodyCapacity),
    px: new Float64Array(bodyCapacity),
    py: new Float64Array(bodyCapacity),
    pa: new Float64Array(bodyCapacity),
    vx: new Float64Array(bodyCapacity),
    vy: new Float64Array(bodyCapacity),
    va: new Float64Array(bodyCapacity),
    railX: new Float64Array(bodyCapacity),
    railY: new Float64Array(bodyCapacity),
    halfW: new Float64Array(bodyCapacity),
    halfH: new Float64Array(bodyCapacity),
    invMass: new Float64Array(bodyCapacity),
    invInertia: new Float64Array(bodyCapacity),
    linearTau: new Float64Array(bodyCapacity),
    angularTau: new Float64Array(bodyCapacity),
    seamAlive: new Uint8Array(seamCapacity),
    seamA: new Int16Array(seamCapacity),
    seamB: new Int16Array(seamCapacity),
    seamIntact: new Uint8Array(seamCapacity),
    seamDirty: new Uint8Array(seamCapacity),
    seamCooldown: new Float64Array(seamCapacity),
    seamPreload: new Float64Array(seamCapacity),
    bridgeY: new Float64Array(bridgeCapacity),
    bridgeOffX: new Float64Array(bridgeCapacity),
    bridgeOffY: new Float64Array(bridgeCapacity),
    bridgeLimitE: new Float64Array(bridgeCapacity),
    bridgeLimitG: new Float64Array(bridgeCapacity),
    bridgeBroken: new Uint8Array(bridgeCapacity),
    bridgeGap: new Float64Array(bridgeCapacity),
    bridgeLoad: new Float64Array(bridgeCapacity),
    bridgeKick: new Float64Array(bridgeCapacity),
    bridgeShare: new Float64Array(bridgeCapacity),
    bridgeSeed: new Uint32Array(bridgeCapacity),
    rail: { s: 0, ps: 0, v: 0, ux: 1, uy: 0, ox: 0, oy: 0, driven: false, max: Infinity, min: -Infinity, ratchet: true },
    hand: { body: -1, lx: 0, ly: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, x: 0, y: 0, compliance: 1e-6, damped: false, dt: 1 / 60 },
    bounds: { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity },
    events: [],
    substepIndex: 0,
  };
}

export function addBody(world, { x, y, a, halfW, halfH, mode = FREE }) {
  let index = -1;
  for (let i = 0; i < world.bodyCapacity; i += 1) {
    if (!world.alive[i]) {
      index = i;
      break;
    }
  }
  if (index < 0) return -1;
  world.alive[index] = 1;
  world.mode[index] = mode;
  world.awake[index] = mode === RAIL ? 0 : 1;
  world.rest[index] = 0;
  world.halfW[index] = halfW;
  world.halfH[index] = halfH;
  world.invMass[index] = 1;
  world.invInertia[index] = 3 / (halfW * halfW + halfH * halfH);
  world.linearTau[index] = 0.25;
  world.angularTau[index] = 0.18;
  world.vx[index] = 0;
  world.vy[index] = 0;
  world.va[index] = 0;
  world.a[index] = a;
  if (mode === RAIL) {
    world.railX[index] = x - world.rail.ux * world.rail.s;
    world.railY[index] = y - world.rail.uy * world.rail.s;
  }
  world.x[index] = x;
  world.y[index] = y;
  world.px[index] = x;
  world.py[index] = y;
  world.pa[index] = a;
  return index;
}

export function removeBody(world, index) {
  world.alive[index] = 0;
  world.awake[index] = 0;
  if (world.hand.body === index) world.hand.body = -1;
  for (let seam = 0; seam < world.seamCapacity; seam += 1) {
    if (world.seamAlive[seam] && (world.seamA[seam] === index || world.seamB[seam] === index)) world.seamAlive[seam] = 0;
  }
}

export function bodyPose(world, index, out) {
  if (world.mode[index] === RAIL) {
    out.x = world.railX[index] + world.rail.ux * world.rail.s;
    out.y = world.railY[index] + world.rail.uy * world.rail.s;
  } else {
    out.x = world.x[index];
    out.y = world.y[index];
  }
  out.a = world.a[index];
  return out;
}

export function setMode(world, index, mode) {
  const current = world.mode[index];
  if (current === mode) return;
  const rail = world.rail;
  if (current === RAIL) {
    world.x[index] = world.railX[index] + rail.ux * rail.s;
    world.y[index] = world.railY[index] + rail.uy * rail.s;
    world.vx[index] = rail.driven ? 0 : rail.ux * rail.v;
    world.vy[index] = rail.driven ? 0 : rail.uy * rail.v;
    world.va[index] = 0;
  }
  if (mode === RAIL) {
    world.railX[index] = world.x[index] - rail.ux * rail.s;
    world.railY[index] = world.y[index] - rail.uy * rail.s;
    world.vx[index] = 0;
    world.vy[index] = 0;
    world.va[index] = 0;
  }
  world.mode[index] = mode;
  world.awake[index] = mode === RAIL ? 0 : 1;
  world.rest[index] = 0;
}

export function addSeam(world, left, right, seed, brokenFrom = BRIDGES, brokenTo = BRIDGES) {
  let seam = -1;
  for (let i = 0; i < world.seamCapacity; i += 1) {
    if (!world.seamAlive[i]) {
      seam = i;
      break;
    }
  }
  if (seam < 0) return -1;
  const random = mulberry(seed);
  const height = world.halfH[left] * 2;
  const spacing = height / BRIDGES;
  world.seamAlive[seam] = 1;
  world.seamA[seam] = left;
  world.seamB[seam] = right;
  world.seamDirty[seam] = 1;
  world.seamCooldown[seam] = 0;
  world.seamPreload[seam] = 0;
  let intact = 0;
  for (let k = 0; k < BRIDGES; k += 1) {
    const q = seam * BRIDGES + k;
    world.bridgeY[q] = -height / 2 + (k + 0.5) * spacing;
    world.bridgeOffX[q] = 0;
    world.bridgeOffY[q] = 0;
    world.bridgeLimitE[q] = 1.8 * (1 - STRENGTH_SPREAD / 2 + random() * STRENGTH_SPREAD);
    world.bridgeLimitG[q] = Math.min(DRAWN_GAP_CAP, 2.25 * (1 - STRENGTH_SPREAD / 2 + random() * STRENGTH_SPREAD));
    world.bridgeShare[q] = 0.3 + random() * 0.4;
    world.bridgeSeed[q] = (random() * 4294967295) >>> 0;
    world.bridgeGap[q] = 0;
    world.bridgeLoad[q] = 0;
    world.bridgeKick[q] = 0;
    const broken = k >= brokenFrom && k < brokenTo;
    world.bridgeBroken[q] = broken ? 1 : 0;
    if (!broken) intact += 1;
  }
  world.seamIntact[seam] = intact;
  return seam;
}

export function setPreload(world, seam, amount) {
  if (seam < 0 || !world.seamAlive[seam]) return;
  const change = amount - world.seamPreload[seam];
  world.seamPreload[seam] = amount;
  for (let k = 0; k < BRIDGES; k += 1) {
    const q = seam * BRIDGES + k;
    if (world.bridgeBroken[q]) continue;
    world.bridgeLoad[q] = Math.min(1, Math.max(0, world.bridgeLoad[q] + change));
  }
  world.seamDirty[seam] = 1;
}

export function holdSeam(world, seam, seconds) {
  if (seam < 0 || !world.seamAlive[seam]) return;
  world.seamCooldown[seam] = Math.max(world.seamCooldown[seam], seconds);
  for (let k = 0; k < BRIDGES; k += 1) world.bridgeKick[seam * BRIDGES + k] = 0;
}

function handOff(world, seam, k) {
  for (let direction = -1; direction <= 1; direction += 2) {
    let j = k + direction;
    while (j >= 0 && j < BRIDGES && world.bridgeBroken[seam * BRIDGES + j]) j += direction;
    if (j < 0 || j >= BRIDGES) continue;
    const q = seam * BRIDGES + j;
    world.bridgeKick[q] = Math.min(HANDOFF_CAP, world.bridgeKick[q] + HANDOFF);
  }
}

export function breakAll(world, seam) {
  for (let k = 0; k < BRIDGES; k += 1) {
    const q = seam * BRIDGES + k;
    if (world.bridgeBroken[q]) continue;
    world.bridgeBroken[q] = 1;
    world.events.push({ type: "break", seam, k, speed: 0 });
  }
  world.seamIntact[seam] = 0;
  world.seamDirty[seam] = 1;
  world.events.push({ type: "free", seam });
}

function isDynamic(world, index) {
  const mode = world.mode[index];
  return mode !== RAIL && world.awake[index] === 1;
}

function railCarries(world, index) {
  return world.mode[index] === RAIL && !world.rail.driven;
}

function weight(world, index, rx, ry, nx, ny) {
  if (index < 0) return 0;
  if (isDynamic(world, index)) {
    const cross = rx * ny - ry * nx;
    return world.invMass[index] + world.invInertia[index] * cross * cross;
  }
  if (railCarries(world, index)) {
    const along = nx * world.rail.ux + ny * world.rail.uy;
    return RAIL_INV_MASS * along * along;
  }
  return 0;
}

function push(world, index, impulseX, impulseY, rx, ry) {
  if (index < 0) return;
  if (isDynamic(world, index)) {
    const invMass = world.invMass[index];
    world.x[index] += impulseX * invMass;
    world.y[index] += impulseY * invMass;
    world.a[index] += world.invInertia[index] * (rx * impulseY - ry * impulseX);
    return;
  }
  if (railCarries(world, index)) {
    const rail = world.rail;
    rail.s += (impulseX * rail.ux + impulseY * rail.uy) * RAIL_INV_MASS;
  }
}

const scratch = { ax: 0, ay: 0, arx: 0, ary: 0, bx: 0, by: 0, brx: 0, bry: 0 };

function anchor(world, index, localX, localY, side) {
  let cx;
  let cy;
  if (world.mode[index] === RAIL) {
    cx = world.railX[index] + world.rail.ux * world.rail.s;
    cy = world.railY[index] + world.rail.uy * world.rail.s;
  } else {
    cx = world.x[index];
    cy = world.y[index];
  }
  const angle = world.a[index];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = localX * cos - localY * sin;
  const ry = localX * sin + localY * cos;
  if (side === 0) {
    scratch.arx = rx;
    scratch.ary = ry;
    scratch.ax = cx + rx;
    scratch.ay = cy + ry;
  } else {
    scratch.brx = rx;
    scratch.bry = ry;
    scratch.bx = cx + rx;
    scratch.by = cy + ry;
  }
}

function solvePoint(world, bodyA, bodyB, alphaTilde) {
  const dx = scratch.bx - scratch.ax;
  const dy = scratch.by - scratch.ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const nx = dx / length;
  const ny = dy / length;
  const wA = weight(world, bodyA, scratch.arx, scratch.ary, nx, ny);
  const wB = weight(world, bodyB, scratch.brx, scratch.bry, nx, ny);
  const total = wA + wB + alphaTilde;
  if (total < 1e-12) return;
  const lambda = -length / total;
  const impulseX = nx * lambda;
  const impulseY = ny * lambda;
  push(world, bodyB, impulseX, impulseY, scratch.brx, scratch.bry);
  push(world, bodyA, -impulseX, -impulseY, scratch.arx, scratch.ary);
}

function seamSolvable(world, seam) {
  if (!world.seamAlive[seam] || world.seamIntact[seam] === 0) return false;
  const left = world.seamA[seam];
  const right = world.seamB[seam];
  return isDynamic(world, left) || isDynamic(world, right);
}

function solveContact(world, bodyA, bodyB, nx, ny) {
  const depth = (scratch.bx - scratch.ax) * nx + (scratch.by - scratch.ay) * ny;
  if (depth >= 0) return false;
  const wA = weight(world, bodyA, scratch.arx, scratch.ary, nx, ny);
  const wB = weight(world, bodyB, scratch.brx, scratch.bry, nx, ny);
  const total = wA + wB;
  if (total < 1e-12) return false;
  const lambda = -depth / total;
  push(world, bodyB, nx * lambda, ny * lambda, scratch.brx, scratch.bry);
  push(world, bodyA, -nx * lambda, -ny * lambda, scratch.arx, scratch.ary);
  return true;
}

function solveSeam(world, seam, alphaTilde, reverse) {
  const left = world.seamA[seam];
  const right = world.seamB[seam];
  const halfLeft = world.halfW[left];
  const halfRight = world.halfW[right];
  for (let step = 0; step < BRIDGES; step += 1) {
    const k = reverse ? BRIDGES - 1 - step : step;
    const q = seam * BRIDGES + k;
    const broken = world.bridgeBroken[q] === 1;
    const offX = broken ? 0 : world.bridgeOffX[q];
    const offY = broken ? 0 : world.bridgeOffY[q];
    anchor(world, left, halfLeft + offX, world.bridgeY[q] + offY, 0);
    anchor(world, right, -halfRight, world.bridgeY[q], 1);
    const angle = world.a[left];
    if (solveContact(world, left, right, Math.cos(angle), Math.sin(angle)) && !broken) {
      anchor(world, left, halfLeft + offX, world.bridgeY[q] + offY, 0);
      anchor(world, right, -halfRight, world.bridgeY[q], 1);
    }
    if (!broken) solvePoint(world, left, right, alphaTilde);
  }
}

function solveHand(world, t, alphaTilde) {
  const hand = world.hand;
  if (hand.body < 0 || !world.alive[hand.body]) return;
  hand.x = hand.fromX + (hand.toX - hand.fromX) * t;
  hand.y = hand.fromY + (hand.toY - hand.fromY) * t;
  anchor(world, hand.body, hand.lx, hand.ly, 1);
  scratch.ax = hand.x;
  scratch.ay = hand.y;
  scratch.arx = 0;
  scratch.ary = 0;
  solvePoint(world, -1, hand.body, alphaTilde);
}

function pointVelocity(world, index, rx, ry, out) {
  if (isDynamic(world, index)) {
    const spin = world.va[index];
    out.x = world.vx[index] - spin * ry;
    out.y = world.vy[index] + spin * rx;
    return;
  }
  if (railCarries(world, index)) {
    out.x = world.rail.ux * world.rail.v;
    out.y = world.rail.uy * world.rail.v;
    return;
  }
  out.x = 0;
  out.y = 0;
}

function pushVelocity(world, index, impulseX, impulseY, rx, ry) {
  if (isDynamic(world, index)) {
    const invMass = world.invMass[index];
    world.vx[index] += impulseX * invMass;
    world.vy[index] += impulseY * invMass;
    world.va[index] += world.invInertia[index] * (rx * impulseY - ry * impulseX);
    return;
  }
  if (railCarries(world, index)) {
    const rail = world.rail;
    rail.v += (impulseX * rail.ux + impulseY * rail.uy) * RAIL_INV_MASS;
  }
}

const velocityA = { x: 0, y: 0 };
const velocityB = { x: 0, y: 0 };

function dampSeam(world, seam, h) {
  const left = world.seamA[seam];
  const right = world.seamB[seam];
  const halfLeft = world.halfW[left];
  const halfRight = world.halfW[right];
  const amount = Math.min(1, h * BRIDGE_DAMPING);
  for (let k = 0; k < BRIDGES; k += 1) {
    const q = seam * BRIDGES + k;
    if (world.bridgeBroken[q]) continue;
    anchor(world, left, halfLeft + world.bridgeOffX[q], world.bridgeY[q] + world.bridgeOffY[q], 0);
    anchor(world, right, -halfRight, world.bridgeY[q], 1);
    pointVelocity(world, left, scratch.arx, scratch.ary, velocityA);
    pointVelocity(world, right, scratch.brx, scratch.bry, velocityB);
    const relX = velocityB.x - velocityA.x;
    const relY = velocityB.y - velocityA.y;
    const speed = Math.hypot(relX, relY);
    if (speed < 1e-6) continue;
    const nx = relX / speed;
    const ny = relY / speed;
    const total = weight(world, left, scratch.arx, scratch.ary, nx, ny) + weight(world, right, scratch.brx, scratch.bry, nx, ny);
    if (total < 1e-12) continue;
    const impulse = (-speed * amount) / total;
    pushVelocity(world, right, nx * impulse, ny * impulse, scratch.brx, scratch.bry);
    pushVelocity(world, left, -nx * impulse, -ny * impulse, scratch.arx, scratch.ary);
  }
}

function dampHand(world, h) {
  const hand = world.hand;
  const body = hand.body;
  if (body < 0 || !isDynamic(world, body)) return;
  anchor(world, body, hand.lx, hand.ly, 1);
  pointVelocity(world, body, scratch.brx, scratch.bry, velocityB);
  const targetX = (hand.toX - hand.fromX) / hand.dt;
  const targetY = (hand.toY - hand.fromY) / hand.dt;
  const relX = velocityB.x - targetX;
  const relY = velocityB.y - targetY;
  const speed = Math.hypot(relX, relY);
  if (speed < 1e-6) return;
  const nx = relX / speed;
  const ny = relY / speed;
  const total = weight(world, body, scratch.brx, scratch.bry, nx, ny);
  if (total < 1e-12) return;
  const impulse = (-speed * Math.min(1, h * HAND_DAMPING)) / total;
  pushVelocity(world, body, nx * impulse, ny * impulse, scratch.brx, scratch.bry);
}

function measureSeam(world, seam, relativeSpeed, h) {
  const left = world.seamA[seam];
  const right = world.seamB[seam];
  const halfLeft = world.halfW[left];
  const halfRight = world.halfW[right];
  const angle = world.a[left];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let changed = false;
  world.seamCooldown[seam] = Math.max(0, world.seamCooldown[seam] - h);
  const kickDecay = Math.exp(-h / HANDOFF_TAU);
  const preload = world.seamPreload[seam];
  const relative = world.a[right] - angle;
  const hinge = world.seamIntact[seam] <= HINGE_BRIDGES ? Math.abs(Math.atan2(Math.sin(relative), Math.cos(relative))) / HINGE_LIMIT : 0;
  for (let k = 0; k < BRIDGES; k += 1) {
    const q = seam * BRIDGES + k;
    if (world.bridgeBroken[q]) continue;
    anchor(world, right, -halfRight, world.bridgeY[q], 1);
    anchor(world, left, halfLeft + world.bridgeOffX[q], world.bridgeY[q] + world.bridgeOffY[q], 0);
    const elasticX = scratch.bx - scratch.ax;
    const elasticY = scratch.by - scratch.ay;
    const elasticNormal = elasticX * cos + elasticY * sin;
    const elasticTangent = -elasticX * sin + elasticY * cos;
    const elastic = Math.hypot(Math.max(0, elasticNormal), elasticTangent * SHEAR_WEIGHT);
    anchor(world, left, halfLeft, world.bridgeY[q], 0);
    const geometricX = scratch.bx - scratch.ax;
    const geometricY = scratch.by - scratch.ay;
    const normal = geometricX * cos + geometricY * sin;
    const tangent = -geometricX * sin + geometricY * cos;
    const geometric = Math.hypot(Math.max(0, normal), tangent * SHEAR_WEIGHT);
    if (elastic > YIELD_STRETCH) {
      const flow = 1 - YIELD_STRETCH / elastic;
      world.bridgeOffX[q] += Math.max(0, elasticNormal) * flow;
      world.bridgeOffY[q] += elasticTangent * flow;
    }
    const kick = world.bridgeKick[q] * kickDecay;
    world.bridgeKick[q] = kick;
    const stretch = Math.max(elastic / world.bridgeLimitE[q], geometric / world.bridgeLimitG[q]);
    const strain = stretch + kick + hinge;
    const previousGap = world.bridgeGap[q];
    const previousLoad = world.bridgeLoad[q];
    world.bridgeGap[q] = Math.min(DRAWN_GAP_CAP, geometric);
    world.bridgeLoad[q] = Math.min(1, strain + preload);
    if (Math.abs(previousGap - world.bridgeGap[q]) > 0.04 || Math.abs(previousLoad - world.bridgeLoad[q]) > 0.03) changed = true;
    if (strain >= 1 && (world.seamCooldown[seam] <= 0 || stretch >= SNAP_STRAIN)) {
      world.bridgeBroken[q] = 1;
      world.bridgeGap[q] = DRAWN_GAP_CAP;
      world.bridgeKick[q] = 0;
      world.seamIntact[seam] -= 1;
      world.seamCooldown[seam] = ZIP_INTERVAL;
      handOff(world, seam, k);
      changed = true;
      world.events.push({ type: "break", seam, k, speed: relativeSpeed });
      if (world.seamIntact[seam] === 0) world.events.push({ type: "free", seam });
    }
  }
  if (changed) world.seamDirty[seam] = 1;
}

function seamSpeed(world, seam) {
  const left = world.seamA[seam];
  const right = world.seamB[seam];
  pointVelocity(world, left, 0, 0, velocityA);
  pointVelocity(world, right, 0, 0, velocityB);
  return Math.hypot(velocityB.x - velocityA.x, velocityB.y - velocityA.y) + Math.abs(world.va[right] - world.va[left]) * world.halfH[right];
}

function substep(world, h, t) {
  const rail = world.rail;
  const count = world.bodyCapacity;
  for (let i = 0; i < count; i += 1) {
    if (!world.alive[i] || !isDynamic(world, i)) continue;
    world.px[i] = world.x[i];
    world.py[i] = world.y[i];
    world.pa[i] = world.a[i];
    world.x[i] += world.vx[i] * h;
    world.y[i] += world.vy[i] * h;
    world.a[i] += world.va[i] * h;
  }
  rail.ps = rail.s;
  if (!rail.driven) rail.s += rail.v * h;

  const bridgeAlpha = BRIDGE_COMPLIANCE / (h * h);
  const reverse = (world.substepIndex & 1) === 1;
  world.substepIndex += 1;
  for (let seam = 0; seam < world.seamCapacity; seam += 1) {
    if (seamSolvable(world, seam)) solveSeam(world, seam, bridgeAlpha, reverse);
  }
  solveHand(world, t, world.hand.compliance / (h * h));

  const bounds = world.bounds;
  for (let i = 0; i < count; i += 1) {
    if (!world.alive[i] || world.mode[i] !== FREE || !world.awake[i]) continue;
    if (world.x[i] < bounds.minX) world.x[i] += (bounds.minX - world.x[i]) * WALL_PULL;
    if (world.x[i] > bounds.maxX) world.x[i] += (bounds.maxX - world.x[i]) * WALL_PULL;
    if (world.y[i] < bounds.minY) world.y[i] += (bounds.minY - world.y[i]) * WALL_PULL;
    if (world.y[i] > bounds.maxY) world.y[i] += (bounds.maxY - world.y[i]) * WALL_PULL;
  }

  for (let i = 0; i < count; i += 1) {
    if (!world.alive[i] || !isDynamic(world, i)) continue;
    world.vx[i] = (world.x[i] - world.px[i]) / h;
    world.vy[i] = (world.y[i] - world.py[i]) / h;
    world.va[i] = (world.a[i] - world.pa[i]) / h;
  }

  if (!rail.driven) {
    let velocity = (rail.s - rail.ps) / h;
    if (velocity > 0) {
      velocity = Math.max(0, velocity - (RAIL_BRAKE + RAIL_VISCOUS * velocity) * h * RAIL_INV_MASS);
    } else if (rail.ratchet) {
      velocity = 0;
    }
    rail.s = Math.min(rail.max, Math.max(rail.min, rail.ps + velocity * h));
    rail.v = (rail.s - rail.ps) / h;
  }

  for (let seam = 0; seam < world.seamCapacity; seam += 1) {
    if (seamSolvable(world, seam)) dampSeam(world, seam, h);
  }
  if (world.hand.damped) dampHand(world, h);

  for (let i = 0; i < count; i += 1) {
    if (!world.alive[i] || !isDynamic(world, i)) continue;
    const linear = Math.exp(-h / world.linearTau[i]);
    const angular = Math.exp(-h / world.angularTau[i]);
    world.vx[i] *= linear;
    world.vy[i] *= linear;
    world.va[i] *= angular;
  }

  for (let seam = 0; seam < world.seamCapacity; seam += 1) {
    if (seamSolvable(world, seam)) measureSeam(world, seam, seamSpeed(world, seam), h);
  }
}

export function step(world, dt, substeps = 10) {
  const h = dt / substeps;
  world.hand.dt = dt;
  for (let seam = 0; seam < world.seamCapacity; seam += 1) {
    if (!world.seamAlive[seam] || world.seamIntact[seam] === 0) continue;
    const left = world.seamA[seam];
    const right = world.seamB[seam];
    if (world.mode[left] === RAIL || world.mode[right] === RAIL) continue;
    if (world.awake[left] || world.awake[right]) {
      world.awake[left] = 1;
      world.awake[right] = 1;
    }
  }
  for (let i = 0; i < substeps; i += 1) substep(world, h, (i + 1) / substeps);
  const hand = world.hand;
  hand.fromX = hand.toX;
  hand.fromY = hand.toY;
  let anyAwake = false;
  for (let i = 0; i < world.bodyCapacity; i += 1) {
    if (!world.alive[i] || !world.awake[i] || world.mode[i] === RAIL) continue;
    const slow = Math.hypot(world.vx[i], world.vy[i]) < SLEEP_SPEED && Math.abs(world.va[i]) < SLEEP_SPIN;
    if (slow && hand.body !== i) {
      world.rest[i] += dt;
      if (world.rest[i] > SLEEP_AFTER) {
        world.awake[i] = 0;
        world.vx[i] = 0;
        world.vy[i] = 0;
        world.va[i] = 0;
        continue;
      }
    } else {
      world.rest[i] = 0;
    }
    anyAwake = true;
  }
  return anyAwake;
}

export function grab(world, index, worldX, worldY, compliance = 1e-6, damped = false) {
  const pose = bodyPose(world, index, { x: 0, y: 0, a: 0 });
  const cos = Math.cos(-pose.a);
  const sin = Math.sin(-pose.a);
  const dx = worldX - pose.x;
  const dy = worldY - pose.y;
  const hand = world.hand;
  hand.body = index;
  hand.compliance = compliance;
  hand.damped = damped;
  hand.lx = dx * cos - dy * sin;
  hand.ly = dx * sin + dy * cos;
  hand.fromX = worldX;
  hand.fromY = worldY;
  hand.toX = worldX;
  hand.toY = worldY;
  hand.x = worldX;
  hand.y = worldY;
  if (world.mode[index] !== RAIL) {
    world.awake[index] = 1;
    world.rest[index] = 0;
  }
}

export function moveHand(world, worldX, worldY) {
  world.hand.toX = worldX;
  world.hand.toY = worldY;
}

export function release(world) {
  world.hand.body = -1;
}
