export const INTRO_STYLES = ["circle", "sphere", "spiral", "fly", "marquee", "warp", "cascade", "domino", "bloom"];

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const wrapAngle = (a) => a - TAU * Math.round(a / TAU);
const SETTLE_FACTOR = 1.8;

export function springAt(time, duration, bounce = 0) {
  if (time <= 0) return 0;
  if (time >= duration * SETTLE_FACTOR) return 1;
  const omega = TAU / duration;
  const zeta = 1 - bounce;
  if (zeta >= 0.999) return 1 - (1 + omega * time) * Math.exp(-omega * time);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * time) * (Math.cos(damped * time) + ((zeta * omega) / damped) * Math.sin(damped * time));
}

const landedOf = (time, duration, value) => (time >= duration * SETTLE_FACTOR ? 1 : clamp01(Math.min(value, 0.9994)));

const travelSeconds = (base, distance, speed) => (base * Math.max(0.8, Math.min(1.45, Math.sqrt(distance / 700)))) / speed;

const quatAxis = (x, y, z, angle) => {
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};
const quatMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const quatNormalize = (q) => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
const quatFacing = (nx, ny, nz) => {
  if (nz < -0.9999) return quatAxis(0, 1, 0, Math.PI);
  return quatNormalize([-ny, nx, 0, 1 + nz]);
};
const quatToward = (q, t) => {
  const sign = q[3] < 0 ? -1 : 1;
  return quatNormalize([sign * q[0] * (1 - t), sign * q[1] * (1 - t), sign * q[2] * (1 - t), lerp(1, sign * q[3], 1 - t)]);
};
const quatBlend = (a, b, t) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  return quatNormalize([lerp(a[0], sign * b[0], t), lerp(a[1], sign * b[1], t), lerp(a[2], sign * b[2], t), lerp(a[3], sign * b[3], t)]);
};

const FOCAL = 760;
const project = (x, y, z) => {
  const p = FOCAL / Math.max(80, FOCAL - z);
  return { x: x * p, y: y * p, p };
};

function exitDistance(x, y, ux, uy, view, margin) {
  const halfW = view.w / 2 + margin;
  const halfH = view.h / 2 + margin;
  const sx = Math.abs(ux) > 1e-4 ? (Math.sign(ux) * halfW - x) / ux : Infinity;
  const sy = Math.abs(uy) > 1e-4 ? (Math.sign(uy) * halfH - y) / uy : Infinity;
  return Math.max(margin, Math.min(sx, sy) + margin);
}

const ORBIT = { dealStep: 0.018, deal: 0.5, fanAt: 0.45, fanStep: 0.018, fan: 0.75, hold: 0.35, spreadSpan: 0.5, spread: 0.85, spin: 0.5, fill: 0.85 };
const FLY = { rowSpan: 0.42, trail: 0.06, duration: 0.85, lean: 5 * DEG };
const MARQUEE = { speed: 2600, pitch: 1.08, rowStep: 0.1, trail: 0.03, duration: 0.85, lean: 5 * DEG };
const WARP = { span: 0.3, duration: 0.95, spin: 0.35 };
const CASCADE = { span: 0.45, duration: 0.8, bounce: 0.12, lean: 3 * DEG };
const DOMINO = { span: 0.35, duration: 0.7, bounce: 0.18 };
const BLOOM = { span: 0.45, duration: 0.7, bounce: 0.12 };

export function introEndSeconds(style) {
  switch (style) {
    case "circle":
    case "sphere":
    case "spiral":
      return ORBIT.fanAt + 30 * ORBIT.fanStep + ORBIT.fan + ORBIT.hold + ORBIT.spreadSpan + ORBIT.spread * 1.45 * SETTLE_FACTOR;
    case "fly":
      return FLY.rowSpan + FLY.trail + FLY.duration * SETTLE_FACTOR;
    case "marquee":
      return 2.9 + MARQUEE.rowStep * 4 + MARQUEE.duration * SETTLE_FACTOR;
    case "warp":
      return WARP.span + WARP.duration * 1.45 * SETTLE_FACTOR;
    case "cascade":
      return CASCADE.span + CASCADE.duration * SETTLE_FACTOR;
    case "domino":
      return DOMINO.span * 2 + DOMINO.duration * SETTLE_FACTOR;
    default:
      return BLOOM.span + BLOOM.duration * SETTLE_FACTOR;
  }
}

const stripTravel = (viewSpan, cfg) => viewSpan + cfg.tileSize + cfg.gap;

const flat = (x, y, scale, rx, ry, rz, landed, started, z = 0) => ({ x, y, z, scale, rx, ry, rz, landed, started, order: scale * 200 });

function ringShape(a, slot, cfg, view) {
  const radius = view.min * cfg.introRadius;
  const tilt = cfg.introTilt * DEG;
  const zRaw = Math.sin(a) * radius;
  const q = quatMul(quatAxis(1, 0, 0, tilt * 0.35), quatAxis(0, 1, 0, wrapAngle(Math.PI / 2 - a) * 0.2));
  return {
    x: Math.cos(a) * radius,
    y: -zRaw * Math.sin(tilt),
    z: zRaw * Math.cos(tilt),
    q,
    tileScale: (((TAU * radius) / slot.starCount) * cfg.introTile) / cfg.tileSize,
    clockwise: true,
  };
}

function spiralShape(a0, slot, cfg, view, t) {
  const turns = 2.2;
  const a = a0 + t * TAU * turns;
  const outer = view.min * cfg.introRadius * 1.1;
  const radius = outer * (0.14 + 0.86 * t);
  const lean = 22 * DEG;
  const lift = -Math.sin(a) * radius;
  const arc = (TAU * radius * turns) / slot.starCount;
  return {
    x: Math.cos(a) * radius,
    y: lift * Math.cos(lean),
    z: -lift * Math.sin(lean),
    q: quatMul(quatAxis(1, 0, 0, -lean * 0.6), quatAxis(0, 0, 1, wrapAngle(-a - Math.PI / 2) * 0.1)),
    tileScale: Math.max(0.16, Math.min(0.55, (arc * cfg.introTile) / cfg.tileSize)),
    clockwise: true,
  };
}

function sphereShape(a, slot, cfg, view, t) {
  const radius = view.min * cfg.introRadius * 1.05;
  const height = 1 - 2 * ((t * slot.starCount + 0.5) / slot.starCount);
  const ring = Math.sqrt(Math.max(0, 1 - height * height));
  const theta = t * slot.starCount * GOLDEN + a;
  const nx = ring * Math.cos(theta);
  const nz = ring * Math.sin(theta);
  const ny = height;
  const facing = Math.max(nz, 0.35);
  const norm = Math.hypot(nx * 0.7, ny * 0.7, facing) || 1;
  const tile = Math.sqrt((4 * Math.PI * radius * radius) / slot.starCount) * 0.52 * cfg.introTile;
  return {
    x: nx * radius,
    y: ny * radius,
    z: nz * radius,
    q: quatFacing((nx * 0.7) / norm, (ny * 0.7) / norm, facing / norm),
    tileScale: tile / cfg.tileSize,
    clockwise: false,
  };
}

const SHAPES = { circle: ringShape, sphere: sphereShape, spiral: spiralShape };

function orbitTimes(slot, speed) {
  const index = slot.ringT * slot.starCount;
  const spreadBase = (ORBIT.fanAt + slot.starCount * ORBIT.fanStep + ORBIT.fan + ORBIT.hold) / speed;
  return {
    dealAt: (index * ORBIT.dealStep) / speed,
    fanAt: (ORBIT.fanAt + index * ORBIT.fanStep) / speed,
    spinFrom: ORBIT.fanAt / speed,
    spreadBase,
    spreadAt: spreadBase + (slot.bornRadN * ORBIT.spreadSpan) / speed,
  };
}

function arriveFromOutside({ since, speed, cfg, wx, wy, view, start, base }) {
  const length = Math.hypot(wx, wy) || 1;
  const ux = wx / length;
  const uy = wy / length;
  const distance = exitDistance(wx, wy, ux, uy, view, cfg.tileSize);
  const duration = travelSeconds(base, distance, speed);
  const p = springAt(since - start, duration);
  return flat(wx + ux * distance * (1 - p), wy + uy * distance * (1 - p), 1, 0, 0, 0, landedOf(since - start, duration, p), since >= start);
}

function orbit(style, ctx) {
  const { since, speed, cfg, slot, wx, wy, view } = ctx;
  const times = orbitTimes(slot, speed);
  if (!slot.star) {
    return arriveFromOutside({ ...ctx, start: times.spreadBase + 0.15 / speed + (slot.bornRadN * ORBIT.spreadSpan) / speed, base: ORBIT.fill });
  }

  const spinTime = since - times.spinFrom;
  const spinStop = times.spreadAt - times.spinFrom;
  const settle = 0.6 / speed;
  const spinRate = ORBIT.spin * speed;
  const spin = spinRate * (spinTime <= 0 ? 0 : spinTime < spinStop ? spinTime : spinStop + settle * (1 - Math.exp(-(spinTime - spinStop) / settle)));
  const baseAngle = slot.ringT * TAU - Math.PI / 2;
  const shape = SHAPES[style](baseAngle + spin, slot, cfg, view, slot.ringT);
  const restShape = SHAPES[style](baseAngle + spinRate * (Math.max(0, spinStop) + settle), slot, cfg, view, slot.ringT);
  const rest = project(restShape.x, restShape.y, restShape.z);

  const dealDuration = ORBIT.deal / speed;
  const dealt = springAt(since - times.dealAt, dealDuration, 0.12);
  const pile = { x: slot.jx * 12, y: slot.jy * 12 };
  const pileQ = quatAxis(0, 0, 1, slot.jr * 0.15);

  const fan = springAt(since - times.fanAt, ORBIT.fan / speed);
  const placed = project(lerp(pile.x, shape.x, fan), lerp(pile.y, shape.y, fan), lerp(0, shape.z, fan));
  const scaleInShape = lerp(0.9 * Math.max(0, dealt), shape.tileScale * placed.p, fan);
  const orient = quatBlend(pileQ, shape.q, fan);

  const r0 = Math.hypot(placed.x, placed.y);
  const r1 = Math.hypot(wx, wy);
  const th0 = Math.atan2(placed.y, placed.x);
  const th1 = Math.atan2(wy, wx);
  const thRest = Math.atan2(rest.y, rest.x);
  const clockwiseRest = -((((thRest - th1) % TAU) + TAU) % TAU);
  const deltaRest = shape.clockwise && Math.abs(clockwiseRest) <= Math.PI * 1.2 ? clockwiseRest : wrapAngle(th1 - thRest);
  const delta = deltaRest + wrapAngle(thRest - th0);
  const spreadDuration = travelSeconds(ORBIT.spread, Math.hypot(wx - placed.x, wy - placed.y), speed);
  const spread = springAt(since - times.spreadAt, spreadDuration);
  const theta = th0 + delta * spread;
  const r = lerp(r0, r1, spread);
  const moving = spread > 0;

  return {
    x: moving ? Math.cos(theta) * r : placed.x,
    y: moving ? Math.sin(theta) * r : placed.y,
    z: lerp(shape.z * 0.6 * fan + (1 - fan) * slot.ringT * 30, 0, spread),
    scale: lerp(scaleInShape, 1, spread),
    q: quatToward(orient, clamp01(spread)),
    order: lerp(shape.z, lerp(scaleInShape, 1, spread) * 200, clamp01(spread)),
    landed: landedOf(since - times.spreadAt, spreadDuration, spread),
    started: since >= times.dealAt,
  };
}

function fly({ since, speed, cfg, slot, wx, wy, view }) {
  const dir = slot.rowDir;
  const lead = dir > 0 ? slot.bornColN : 1 - slot.bornColN;
  const start = (slot.rowN * FLY.rowSpan + (1 - lead) * FLY.trail) / speed;
  const distance = stripTravel(view.w, cfg);
  const duration = FLY.duration / speed;
  const p = springAt(since - start, duration);
  const lean = -dir * FLY.lean * Math.sin(Math.PI * clamp01(p));
  return flat(wx - dir * distance * (1 - p), wy, 1, 0, 0, lean, landedOf(since - start, duration, p), since >= start);
}

function marquee({ since, speed, cfg, slot, wx, wy, view }) {
  const pitch = cfg.tileSize * MARQUEE.pitch;
  const rate = MARQUEE.speed * speed;
  const tailStart = -(view.w / 2 + cfg.tileSize) - (slot.starCount - 1) * pitch;
  const tailInside = (-view.w / 2 + cfg.tileSize - tailStart) / rate;
  const lead = slot.bornColN;
  let start = tailInside + (Math.abs(slot.row) * MARQUEE.rowStep + (1 - lead) * MARQUEE.trail) / speed;
  if (slot.star) {
    const trainX = -(view.w / 2 + cfg.tileSize) - slot.ringT * slot.starCount * pitch + rate * since;
    const exitAt = (view.w / 2 + cfg.tileSize - (trainX - rate * since)) / rate;
    start = Math.max(start, exitAt + 0.02);
    if (since < exitAt) return flat(trainX, 0, 1, 0, 0, 0, 0, true);
  }
  const distance = stripTravel(view.w, cfg);
  const duration = MARQUEE.duration / speed;
  const p = springAt(since - start, duration);
  const lean = -MARQUEE.lean * Math.sin(Math.PI * clamp01(p));
  return flat(wx - distance * (1 - p), wy, 1, 0, 0, lean, landedOf(since - start, duration, p), since >= start);
}

function warp({ since, speed, slot, wx, wy }) {
  const start = (slot.bornRadN * WARP.span) / speed;
  const duration = travelSeconds(WARP.duration, Math.hypot(wx, wy), speed);
  const p = springAt(since - start, duration);
  return flat(wx * p, wy * p, p, 0, 0, (1 - p) * slot.spinDir * WARP.spin, landedOf(since - start, duration, p), since >= start);
}

function cascade({ since, speed, cfg, slot, wx, wy, view }) {
  const start = (slot.bornColN * CASCADE.span) / speed;
  const duration = CASCADE.duration / speed;
  const p = springAt(since - start, duration, CASCADE.bounce);
  const drop = stripTravel(view.h, cfg);
  const lean = slot.spinDir * CASCADE.lean * Math.sin(Math.PI * clamp01(p));
  return flat(wx, wy + drop * (1 - p), 1, 0, 0, lean, landedOf(since - start, duration, p), since >= start);
}

function domino({ since, speed, slot, wx, wy }) {
  const start = ((slot.bornRowN + slot.bornColN) * DOMINO.span) / speed;
  const duration = DOMINO.duration / speed;
  const p = springAt(since - start, duration, DOMINO.bounce);
  return flat(wx, wy, 1, -(1 - p) * (Math.PI / 2), 0, 0, landedOf(since - start, duration, p), since >= start);
}

function bloom({ since, speed, slot, wx, wy }) {
  const start = (slot.bornRadN * BLOOM.span) / speed;
  const duration = BLOOM.duration / speed;
  const p = springAt(since - start, duration, BLOOM.bounce);
  return flat(wx, wy, Math.max(0, p), 0, 0, 0, landedOf(since - start, duration, p), since >= start);
}

const FLAT = { fly, marquee, warp, cascade, domino, bloom };

const INTERRUPT_SECONDS = 0.45;

export function settleToGrid(snap, { since, at, wx, wy, opacity }) {
  const time = since - at;
  const p = springAt(time, INTERRUPT_SECONDS);
  return {
    x: lerp(snap.x, wx, p),
    y: lerp(snap.y, wy, p),
    z: lerp(snap.z || 0, 0, p),
    scale: lerp(snap.scale, 1, p),
    q: snap.q ? quatToward(snap.q, p) : null,
    rx: (snap.rx || 0) * (1 - p),
    ry: (snap.ry || 0) * (1 - p),
    rz: (snap.rz || 0) * (1 - p),
    landed: landedOf(time, INTERRUPT_SECONDS, p),
    started: true,
    order: lerp(snap.scale, 1, p) * 200,
    opacity,
  };
}

export function introFrame(style, { since, armed, speed, cfg, slot, wx, wy, viewW, viewH }) {
  const view = { w: viewW, h: viewH, min: Math.min(viewW, viewH) };
  const ctx = { since, speed, cfg, slot, wx, wy, view };
  const offstage =
    Math.abs(wx) - cfg.tileSize / 2 > view.w / 2 + cfg.gap / 2 || Math.abs(wy) - cfg.tileSize / 2 > view.h / 2 + cfg.gap / 2;
  const animates = SHAPES[style] ? slot.star || !offstage : !offstage;
  const pose = !animates
    ? { ...flat(wx, wy, 1, 0, 0, 0, 1, true), order: 200 }
    : SHAPES[style]
      ? orbit(style, ctx)
      : (FLAT[style] || bloom)(ctx);
  return { ...pose, opacity: armed && slot.loadedAt != null ? 1 : 0 };
}
