import { BLEED, DEBRIS } from "./scorchParams";

export const DEBRIS_SLOTS = 2;
export const DEBRIS_FLOATS = 24;

const TAU = Math.PI * 2;
const RAMP_SECONDS = 0.5;
const EXIT_MARGIN = 0.25;
const MIN_BULK = 0.3;
const MAX_BULK = 4;
const PERSPECTIVE_SLACK = 1.12;

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function byDepth(a, b) {
  return a.scale - b.scale || a.born - b.born;
}

function orient(piece) {
  const spinHalf = piece.angle / 2;
  const tiltHalf = piece.tilt / 2;
  const wobbleHalf = piece.wobble / 2;
  const axisX = Math.cos(piece.axis);
  const axisY = Math.sin(piece.axis);
  const spinZ = Math.sin(spinHalf);
  const spinW = Math.cos(spinHalf);
  const tiltS = Math.sin(tiltHalf);
  const tiltW = Math.cos(tiltHalf);
  const wobbleS = Math.sin(wobbleHalf);
  const wobbleW = Math.cos(wobbleHalf);
  const ax = axisX * tiltS;
  const ay = axisY * tiltS;
  const bx = -axisY * wobbleS;
  const by = axisX * wobbleS;
  const tx = tiltW * bx + ax * wobbleW;
  const ty = tiltW * by + ay * wobbleW;
  const tz = ax * by - ay * bx;
  const tw = tiltW * wobbleW - (ax * bx + ay * by);
  piece.qx = spinW * tx - spinZ * ty;
  piece.qy = spinW * ty + spinZ * tx;
  piece.qz = spinW * tz + spinZ * tw;
  piece.qw = spinW * tw - spinZ * tz;
}

export function createDebris({ reducedMotion }) {
  const pieces = [];
  const order = [];
  const instances = new Float32Array(DEBRIS.maxPieces * DEBRIS_SLOTS * DEBRIS_FLOATS);
  let born = 0;

  function makeRoom(wanted) {
    const over = pieces.length + wanted - DEBRIS.maxPieces;
    if (over <= 0) return;
    const doomed = [...pieces].sort((a, b) => Number(b.fleck) - Number(a.fleck) || a.share - b.share || a.born - b.born).slice(0, over);
    for (const piece of doomed) pieces.splice(pieces.indexOf(piece), 1);
  }

  function spawn(slot, found, maskSize, final) {
    makeRoom(found.islands.length);
    const { islands, centreU, centreV } = found;
    const pad = 1.5 / maskSize;
    for (const island of islands) {
      const bulk = clamp(Math.sqrt(island.share) / DEBRIS.reference, MIN_BULK, MAX_BULK);
      const settle = Math.sqrt(bulk);
      const { fleck } = island;
      const cx = (island.minU + island.maxU) / 2;
      const cy = (island.minV + island.maxV) / 2;
      const hx = (island.maxU - island.minU) / 2 + pad;
      const hy = (island.maxV - island.minV) / 2 + pad;
      const awayU = island.cx - centreU;
      const awayV = island.cy - centreV;
      const awayLength = Math.hypot(awayU, awayV) || 1;
      const heat = Math.min(1.2, island.heat);
      const near = Math.min(1, heat * 1.3);
      const outward = (0.03 + 0.05 * Math.random()) / settle;
      const lift = clamp(1.3 - 0.15 * bulk, 0.85, 1.25) * (fleck ? DEBRIS.fleckLift : 1);
      const tumbleOdds = fleck ? 0.7 : 0.45 * clamp(1.6 - 0.4 * bulk, 0.2, 1);
      const inertia = 0.12 * clamp((bulk - 1) / 3, 0, 1);
      const bigness = clamp((bulk - 0.5) / 3, 0, 1);
      const curlMax = fleck ? DEBRIS.fleckCurl : clamp(DEBRIS.curlReach * bulk ** -0.7, DEBRIS.curlFloor, DEBRIS.curlCeiling);
      const wide = hx > hy;
      const staggered = 0.05 + 0.4 * (1 - near) * (0.55 + 0.45 * Math.random());
      const prompt = DEBRIS.cutDelay * (0.4 + 0.6 * Math.random());
      born += 1;
      pieces.push({
        slot,
        label: island.label,
        share: island.share,
        cx,
        cy,
        hx,
        hy,
        recede: DEBRIS.shrink * clamp(1 + 0.6 * (bulk - 1), 1, 3),
        recedeSeconds: 2.6 / Math.sqrt(Math.max(1, bulk)),
        drag: 1 + 0.25 * clamp(bulk - 1, 0, 3),
        born,
        x: 0,
        y: 0,
        vx: (awayU / awayLength) * outward + (Math.random() - 0.5) * 0.04,
        vy: 0.04 + 0.08 * Math.random() + heat * 0.05,
        angle: 0,
        spin: ((Math.random() - 0.5) * 1.4) / bulk,
        axis: Math.random() * Math.PI,
        tilt: 0,
        rock: (0.35 + 0.6 * Math.random()) * clamp(1.15 - 0.12 * bulk, 0.55, 1.1),
        phase: Math.random() * TAU,
        rate: (2.6 + 2.2 * Math.random()) / settle,
        flutter: DEBRIS.flutter / settle,
        tumbles: Math.random() < tumbleOdds,
        tumble: 0,
        tumbleRate: ((Math.random() < 0.5 ? -1 : 1) * (2.4 + 3.5 * Math.random())) / settle,
        buoyancy: DEBRIS.gravity * (DEBRIS.buoyancy + DEBRIS.buoyancyHeat * Math.min(1, heat) + 0.5 * Math.random()) * lift,
        tau: DEBRIS.buoyancyTau * (0.8 + 0.5 * Math.random()) * (fleck ? 1.2 : 1),
        delay: reducedMotion ? 0.05 : (final ? staggered : prompt) + inertia,
        fleck,
        wobble: 0,
        wobbleOffset: Math.random() * TAU,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        bendAngle: (wide ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 1.1,
        curlSign: Math.random() < DEBRIS.curlUnder ? -1 : 1,
        curlMax: curlMax * (0.8 + 0.4 * Math.random()),
        curlTau: (DEBRIS.curlTau * bulk ** 0.3) / (0.75 + 0.5 * near),
        curlFlutter: DEBRIS.flutterSmall + (DEBRIS.flutterBig - DEBRIS.flutterSmall) * bigness,
        curlPhase: Math.random() * TAU,
        curlRate: (7 - 5 * bigness) * (0.85 + 0.3 * Math.random()),
        curl: 0,
        waveAmp: DEBRIS.waveSmall + (DEBRIS.waveBig - DEBRIS.waveSmall) * bigness,
        waveCycles: 0.7 + 0.6 * bigness,
        wavePhase: Math.random() * TAU,
        waveRate: (3.2 - 1.8 * bigness) * (Math.random() < 0.5 ? -1 : 1),
        wave: 0,
        age: 0,
        fall: 0,
        scale: 1,
        alpha: 1,
        ember: 1,
        snap: 0,
        ash: 0,
        hurry: false,
      });
    }
  }

  function fly(piece, dt, flames) {
    const flight = piece.age - piece.delay;
    const ramp = smoothstep(0, RAMP_SECONDS, flight);
    const falling = smoothstep(0, 0.18, -piece.vy);
    const sway = (0.35 + 0.65 * falling) * ramp;
    piece.phase += piece.rate * dt;
    let ax = piece.flutter * Math.sin(piece.phase) * sway;
    let ay = piece.buoyancy * Math.exp(-flight / piece.tau) - DEBRIS.gravity;
    const px = piece.cx + piece.x;
    const py = piece.cy + piece.y;
    for (const flame of flames.values()) {
      if (flame.strength < 0.05) continue;
      const distance = Math.hypot(px - flame.u, py - flame.v);
      if (distance >= DEBRIS.updraftReach) continue;
      const weight = (1 - distance / DEBRIS.updraftReach) ** 2 * flame.strength;
      ay += DEBRIS.updraft * weight + flame.vy * DEBRIS.push * weight * 0.5;
      ax += flame.vx * DEBRIS.push * weight;
      piece.spin += flame.vx * weight * dt * 4;
    }
    piece.vx += ax * dt;
    piece.vy += ay * dt;
    const flat = Math.abs(Math.cos(piece.tilt) * Math.cos(piece.wobble));
    piece.vx *= Math.exp(-DEBRIS.dragSide * dt);
    piece.vy *= Math.exp(-(DEBRIS.dragEdge + DEBRIS.dragFlat * flat * piece.drag) * dt);
    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
    piece.spin *= Math.exp(-0.35 * dt);
    piece.angle += (piece.spin + 0.5 * Math.cos(piece.phase) * sway * piece.rock) * dt;
    if (falling > 0.5) piece.fall += dt;
    if (piece.tumbles) piece.tumble += piece.tumbleRate * dt * smoothstep(0, 0.6, piece.fall);
    piece.tilt = piece.rock * Math.sin(piece.phase) * sway + piece.tumble;
    piece.wobble = piece.rock * DEBRIS.wobble * Math.sin(piece.phase * 0.63 + piece.wobbleOffset) * sway;
    const curlTime = Math.max(0, flight) / piece.curlTau;
    const curlGrowth = 1 - (1 + curlTime) * Math.exp(-curlTime);
    piece.curlPhase += piece.curlRate * dt;
    piece.curl = piece.curlSign * piece.curlMax * curlGrowth * (1 + piece.curlFlutter * Math.sin(piece.curlPhase) * sway);
    piece.wavePhase += piece.waveRate * dt;
    piece.wave = piece.waveAmp * ramp;
    orient(piece);
    piece.scale = 1 + DEBRIS.lift * smoothstep(0, 0.7, flight) - piece.recede * smoothstep(0, piece.recedeSeconds, piece.fall);
    if (piece.fleck) {
      piece.ash = smoothstep(0.15, 1.3, flight);
      piece.scale *= 1 - 0.75 * smoothstep(0.6, DEBRIS.fleckLife, flight);
      piece.alpha = Math.min(piece.alpha, 1 - smoothstep(DEBRIS.fleckLife * 0.55, DEBRIS.fleckLife, flight));
    }
    const bottom = piece.cy + piece.y + Math.min(piece.hx, piece.hy) * 0.4;
    if (bottom < 0) piece.alpha = Math.min(piece.alpha, 1 - smoothstep(0, BLEED.bottom * 0.85, -bottom));
    const { qx, qy, qz, qw } = piece;
    const downX = Math.abs(2 * (qx * qy + qw * qz));
    const downY = Math.abs(1 - 2 * (qx * qx + qz * qz));
    const reachDown = (downX * piece.hx + downY * piece.hy) * PERSPECTIVE_SLACK;
    const lowest = piece.cy + piece.y - piece.scale * reachDown;
    if (lowest < -DEBRIS.sinkStart) piece.alpha = Math.min(piece.alpha, 1 - smoothstep(DEBRIS.sinkStart, DEBRIS.sinkEnd, -lowest));
    if (flight > DEBRIS.maxAge) piece.alpha = Math.min(piece.alpha, 1 - smoothstep(DEBRIS.maxAge, DEBRIS.maxAge + 0.8, flight));
    const left = piece.cx + piece.x;
    if (left < -BLEED.left - EXIT_MARGIN || left > 1 + BLEED.right + EXIT_MARGIN) piece.alpha = 0;
  }

  function step(dt, flames) {
    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const piece = pieces[index];
      piece.age += dt;
      piece.snap = smoothstep(0, 0.1, piece.age) * (1 - smoothstep(0.3, 1.1, piece.age)) * DEBRIS.snapGlow;
      piece.ember = Math.exp(-Math.max(0, piece.age - piece.delay * 0.5) / DEBRIS.emberTau);
      if (piece.hurry) piece.alpha -= dt / DEBRIS.hurrySeconds;
      if (reducedMotion) piece.alpha = Math.min(piece.alpha, 1 - smoothstep(0.1, 0.55, piece.age));
      else if (piece.age > piece.delay) fly(piece, dt, flames);
      if (piece.alpha <= 0.001) pieces.splice(index, 1);
    }
  }

  function write() {
    order.length = 0;
    for (const piece of pieces) order.push(piece);
    order.sort(byDepth);
    for (let index = 0; index < order.length; index += 1) {
      const piece = order[index];
      const offset = index * DEBRIS_FLOATS;
      instances[offset] = piece.cx;
      instances[offset + 1] = piece.cy;
      instances[offset + 2] = piece.hx;
      instances[offset + 3] = piece.hy;
      instances[offset + 4] = piece.x;
      instances[offset + 5] = piece.y;
      instances[offset + 6] = piece.scale;
      instances[offset + 7] = Math.min(1, Math.max(0, piece.alpha));
      instances[offset + 8] = piece.qx;
      instances[offset + 9] = piece.qy;
      instances[offset + 10] = piece.qz;
      instances[offset + 11] = piece.qw;
      instances[offset + 12] = piece.bendAngle;
      instances[offset + 13] = piece.curl;
      instances[offset + 14] = piece.wave;
      instances[offset + 15] = piece.wavePhase;
      instances[offset + 16] = piece.label;
      instances[offset + 17] = piece.slot;
      instances[offset + 18] = piece.snap;
      instances[offset + 19] = piece.ash;
      instances[offset + 20] = piece.ember;
      instances[offset + 21] = piece.waveCycles;
      instances[offset + 22] = piece.curlSign;
      instances[offset + 23] = 0;
    }
    return order.length;
  }

  return {
    instances,
    spawn,
    step,
    write,
    liveIn(slot) {
      return pieces.some((piece) => piece.slot === slot);
    },
    hurry(slot) {
      for (const piece of pieces) if (piece.slot === slot) piece.hurry = true;
    },
    get count() {
      return pieces.length;
    },
  };
}
