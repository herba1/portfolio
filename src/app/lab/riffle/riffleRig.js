export const FRAME_COUNT = 24;

const DEG = Math.PI / 180;

const KEYS = [
  [0, { px: 0, py: 0.93, pz: 0, hy: -8, cy: -14, lean: 14, tilt: 4, gaze: 78, gazeDown: 4, hx: -0.13, hh: 1.4, hz: 0.2, baz: -118, bel: 48, fx: 0.37, fy: 0, fz: 0.04, fyaw: 28, fheel: 0, bx: -0.37, bz: 0, byaw: 8, bheel: 0, lpu: 1, lpr: 0.1, lpf: 0.35, tpu: 0.25, tpr: 1, tpf: -0.4, ball: 0 }],
  [3, { px: -0.01, hy: -10, cy: -17, hx: -0.15, hh: 1.42, hz: 0.18, baz: -124, bel: 52 }],
  [6, { px: -0.06, py: 0.92, hy: -20, cy: -30, lean: 15, tilt: 6, hx: -0.25, hh: 1.45, hz: 0.1, baz: -136, bel: 58, fx: 0.24, fy: 0.12, fz: 0.02, fyaw: 22, fheel: 0.35 }],
  [8, { px: -0.03, py: 0.9, hy: -18, cy: -32, hx: -0.26, hh: 1.45, hz: 0.07, baz: -142, bel: 63, fx: 0.46, fy: 0.05, fz: 0.03, fyaw: 30, fheel: 0.2 }],
  [9, { px: 0.02, py: 0.89, hy: -12, cy: -32, tilt: 8, hx: -0.25, hh: 1.43, hz: 0.06, baz: -143, bel: 64, fx: 0.52, fy: 0, fz: 0.03, fyaw: 34, fheel: 0 }],
  [10, { px: 0.05, py: 0.88, hy: 8, cy: -24, tilt: 12, hx: -0.18, hh: 1.36, hz: 0.12, baz: -135, bel: 46, tpu: 0.9, tpr: 0.4, tpf: 0.1 }],
  [11, { px: 0.08, py: 0.87, hy: 34, cy: -4, lean: 18, tilt: 16, hx: -0.05, hh: 1.22, hz: 0.26, baz: -100, bel: 14, byaw: 26, bheel: 0.15 }],
  [12, { px: 0.1, hy: 58, cy: 32, tilt: 18, gaze: 60, gazeDown: 14, hx: 0.04, hh: 1.08, hz: 0.34, baz: -82, bel: 0, byaw: 52, bheel: 0.3, lpu: 0.9, lpr: -0.2, lpf: 0.3, tpu: 1, tpr: 0.1, tpf: 0.3 }],
  [13, { px: 0.11, hy: 74, cy: 64, tilt: 16, gaze: 66, gazeDown: 18, hx: 0.12, hh: 1.04, hz: 0.3, baz: 42, bel: -4, byaw: 70, bheel: 0.42 }],
  [14, { px: 0.11, hy: 84, cy: 92, tilt: 12, gaze: 74, gazeDown: 14, hx: 0.24, hh: 1.1, hz: 0.3, baz: 88, bel: 6, byaw: 82, bheel: 0.55, lpu: 0.6, lpr: -0.6, lpf: 0, tpu: 0.6, tpr: 0.2, tpf: 0.7 }],
  [15, { hy: 90, cy: 116, tilt: 8, gaze: 80, gazeDown: 8, hx: 0.22, hh: 1.24, hz: 0.18, baz: 132, bel: 18 }],
  [16, { hy: 93, cy: 132, tilt: 4, hx: 0.16, hh: 1.38, hz: 0.06, baz: 168, bel: 26, byaw: 88, bheel: 0.62, lpu: -0.2, lpr: -1, lpf: 0.2, tpu: 0.2, tpr: -0.3, tpf: 1 }],
  [18, { hy: 95, cy: 142, lean: 12, tilt: 0, gaze: 84, gazeDown: 0, hx: 0.06, hh: 1.5, hz: -0.06, baz: 214, bel: 18 }],
  [20, { hy: 96, cy: 146, lean: 10, tilt: -2, hx: 0.02, hh: 1.55, hz: -0.1, baz: 236, bel: 4, bheel: 0.66 }],
  [23, { px: 0.12, py: 0.9, hy: 96, cy: 148, lean: 9, tilt: -3, gaze: 86, hx: 0.01, hh: 1.56, hz: -0.11, baz: 244, bel: -4, byaw: 90, bheel: 0.68 }],
];

const FIELDS = Object.keys(KEYS[0][1]);

const TRACKS = (() => {
  const tracks = {};
  for (const name of FIELDS) {
    const pts = [];
    let current = KEYS[0][1][name];
    for (const [frame, values] of KEYS) {
      if (values[name] !== undefined) current = values[name];
      pts.push([frame, current]);
    }
    tracks[name] = pts;
  }
  return tracks;
})();

function sampleTrack(pts, f) {
  if (f <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (f >= last[0]) return last[1];
  let i = 0;
  while (i < pts.length - 2 && f > pts[i + 1][0]) i += 1;
  const [x1, y1] = pts[i];
  const [x2, y2] = pts[i + 1];
  const [x0, y0] = i > 0 ? pts[i - 1] : [x1 - (x2 - x1), y1];
  const [x3, y3] = i + 2 < pts.length ? pts[i + 2] : [x2 + (x2 - x1), y2];
  const h = x2 - x1;
  const m1 = ((y2 - y0) / (x2 - x0)) * h;
  const m2 = ((y3 - y1) / (x3 - x1)) * h;
  const s = (f - x1) / h;
  let lo = Math.min(y1, y2);
  let hi = Math.max(y1, y2);
  const s2 = s * s;
  const s3 = s2 * s;
  const v = (2 * s3 - 3 * s2 + 1) * y1 + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * y2 + (s3 - s2) * m2;
  if ((y0 - y1) * (y2 - y1) > 0 || (y3 - y2) * (y1 - y2) > 0) {
    lo -= Math.abs(y2 - y1) * 0.15;
    hi += Math.abs(y2 - y1) * 0.15;
  }
  return Math.min(hi, Math.max(lo, v));
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / Math.max(1e-6, len(a)));
const Y = [0, 1, 0];

function yawDir(deg) {
  const a = deg * DEG;
  return [Math.sin(a), 0, Math.cos(a)];
}

function batDir(az, el) {
  const a = az * DEG;
  const e = el * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

function ik(root, end, a, b, pole) {
  const d = sub(end, root);
  const dist = Math.min(len(d), a + b - 1e-3);
  const dir = norm(d);
  const x = (a * a - b * b + dist * dist) / (2 * dist);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  const p = norm(sub(pole, mul(dir, dot(pole, dir))));
  const joint = add(add(root, mul(dir, x)), mul(p, y));
  const tip = add(root, mul(dir, dist));
  return [joint, tip];
}

function footPoints(pos, yaw, heel) {
  const toe = yawDir(yaw);
  const tip = add(pos, add(mul(toe, 0.14), [0, 0.03, 0]));
  const back = add(tip, add(mul(toe, -0.27 * Math.cos(heel)), [0, 0.27 * Math.sin(heel), 0]));
  const ankle = add(add(tip, mul(toe, -0.21 * Math.cos(heel))), [0, 0.21 * Math.sin(heel) + 0.075, 0]);
  return { toe: tip, heel: back, ankle, dir: toe };
}

const BALL_PATH = [
  [8, [3.2, 1.42, 0.64]],
  [9, [2.64, 1.32, 0.64]],
  [10, [2.1, 1.22, 0.65]],
  [11, [1.57, 1.13, 0.65]],
  [12, [1.04, 1.06, 0.66]],
  [13, [0.53, 1.01, 0.66]],
  [14, [1.34, 1.34, 1.0]],
  [15, [2.24, 1.72, 1.36]],
  [16, [3.2, 2.14, 1.72]],
];

export function pose(f) {
  const v = {};
  for (const name of FIELDS) v[name] = sampleTrack(TRACKS[name], f);
  const pelvis = [v.px, v.py, v.pz];
  const fh = yawDir(v.hy);
  const rh = cross(fh, Y);
  const fc = yawDir(v.cy);
  const rc = cross(fc, Y);
  const lean = v.lean * DEG;
  const up1 = add(mul(Y, Math.cos(lean)), mul(fc, Math.sin(lean)));
  const f1 = sub(mul(fc, Math.cos(lean)), mul(Y, Math.sin(lean)));
  const tilt = v.tilt * DEG;
  const up = add(mul(up1, Math.cos(tilt)), mul(rc, Math.sin(tilt)));
  const r = sub(mul(rc, Math.cos(tilt)), mul(up1, Math.sin(tilt)));
  const chestTop = add(pelvis, mul(up, 0.47));
  const shoulderL = add(add(chestTop, mul(r, -0.18)), mul(up, -0.035));
  const shoulderR = add(add(chestTop, mul(r, 0.18)), mul(up, -0.035));
  const neck = add(chestTop, mul(up, 0.05));
  const headUp = norm(add(mul(Y, 0.75), mul(up, 0.25)));
  const head = add(neck, mul(headUp, 0.15));
  const gd = v.gazeDown * DEG;
  const gaze = norm(add(mul(yawDir(v.gaze), Math.cos(gd)), [0, -Math.sin(gd), 0]));
  const hipL = add(add(pelvis, mul(rh, -0.1)), [0, -0.04, 0]);
  const hipR = add(add(pelvis, mul(rh, 0.1)), [0, -0.04, 0]);
  const footF = footPoints([v.fx, v.fy, v.fz], v.fyaw, v.fheel);
  const footB = footPoints([v.bx, 0, v.bz], v.byaw, v.bheel);
  const [kneeL, ankleL] = ik(hipL, footF.ankle, 0.45, 0.44, norm(add(fh, mul(footF.dir, 0.8))));
  const [kneeR, ankleR] = ik(hipR, footB.ankle, 0.45, 0.44, norm(add(fh, mul(footB.dir, 0.8))));
  const bd = batDir(v.baz, v.bel);
  const handL = [v.hx, v.hh, v.hz];
  const handR = add(handL, mul(bd, 0.085));
  const lp = norm(add(add(mul(up, -v.lpu), mul(r, -v.lpr)), mul(f1, v.lpf)));
  const tp = norm(add(add(mul(up, -v.tpu), mul(r, v.tpr)), mul(f1, v.tpf)));
  const [elbowL, wristL] = ik(shoulderL, handL, 0.29, 0.27, lp);
  const [elbowR, wristR] = ik(shoulderR, handR, 0.29, 0.27, tp);
  const knob = add(handL, mul(bd, -0.07));
  const tip = add(handL, mul(bd, 0.8));
  let ball = null;
  const first = BALL_PATH[0][0];
  const lastBall = BALL_PATH[BALL_PATH.length - 1][0];
  if (f >= first && f <= lastBall) {
    const i = Math.min(BALL_PATH.length - 2, Math.floor(f - first));
    const t = f - first - i;
    ball = { pos: add(mul(BALL_PATH[i][1], 1 - t), mul(BALL_PATH[i + 1][1], t)), contact: Math.abs(f - 13) < 0.5 };
  }
  return {
    pelvis,
    hips: { center: pelvis, f: fh, r: rh },
    chest: { top: chestTop, up, f: f1, r },
    shoulderL,
    shoulderR,
    neck,
    head,
    gaze,
    headUp,
    hipL,
    hipR,
    kneeL,
    kneeR,
    ankleL,
    ankleR,
    footF,
    footB,
    elbowL,
    elbowR,
    wristL,
    wristR,
    bat: { knob, tip, dir: bd, hand: handL },
    ball,
  };
}
