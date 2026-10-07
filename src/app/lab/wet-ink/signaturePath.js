const SIGNATURE_STROKES = [
  {
    hold: 80,
    pace: 1,
    points: [
      [92, 104],
      [110, 74],
      [127, 66],
      [128, 112],
      [119, 204],
      [107, 298],
    ],
  },
  {
    hold: 700,
    pace: 1,
    points: [
      [64, 208],
      [140, 192],
      [214, 176],
      [256, 150],
      [270, 100],
      [262, 58],
      [250, 66],
      [244, 140],
      [238, 230],
      [236, 298],
      [262, 290],
      [300, 262],
      [330, 232],
      [338, 208],
      [322, 198],
      [304, 214],
      [298, 248],
      [308, 288],
      [336, 300],
      [368, 284],
      [384, 244],
      [394, 208],
      [397, 224],
      [405, 216],
      [420, 211],
      [423, 236],
      [424, 272],
      [432, 296],
      [470, 298],
      [500, 226],
      [524, 116],
      [536, 56],
      [522, 40],
      [506, 58],
      [500, 140],
      [496, 240],
      [498, 296],
      [522, 300],
      [552, 284],
      [562, 252],
      [550, 222],
      [530, 220],
      [538, 236],
      [566, 232],
      [604, 220],
    ],
  },
];

const BOX = { left: 50, right: 620, top: 36, baseline: 300, bottom: 330 };
const SLANT = 0.1;
const STEP_UNITS = 2;
const LIFT_MS = 110;
export const SIGNATURE_MS = 2300;

function catmullRom(points, samplesPerSpan) {
  const out = [];
  const count = points.length;
  for (let i = 0; i < count - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, count - 1)];
    for (let s = 0; s < samplesPerSpan; s += 1) {
      const t = s / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(points[count - 1]);
  return out;
}

function resample(dense) {
  const out = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i += 1) {
    const [ax, ay] = dense[i - 1];
    const [bx, by] = dense[i];
    const span = Math.hypot(bx - ax, by - ay);
    let at = STEP_UNITS - carry;
    while (at <= span) {
      const t = at / span;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      at += STEP_UNITS;
    }
    carry = span - (at - STEP_UNITS);
  }
  out.push(dense[dense.length - 1]);
  return out;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function paceStroke(stroke) {
  const slanted = stroke.points.map(([x, y]) => [x + (BOX.baseline - y) * SLANT, y]);
  const path = resample(catmullRom(slanted, 20));
  const count = path.length;
  const turn = new Float32Array(count);
  for (let i = 1; i < count - 1; i += 1) {
    const ax = path[i][0] - path[i - 1][0];
    const ay = path[i][1] - path[i - 1][1];
    const bx = path[i + 1][0] - path[i][0];
    const by = path[i + 1][1] - path[i][1];
    const angle = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    turn[i] = angle / STEP_UNITS;
  }
  const length = (count - 1) * STEP_UNITS;
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let curvature = 0;
    let weight = 0;
    for (let k = -3; k <= 3; k += 1) {
      const j = Math.min(count - 1, Math.max(0, i + k));
      const w = 4 - Math.abs(k);
      curvature += turn[j] * w;
      weight += w;
    }
    curvature /= weight;
    const travelled = i * STEP_UNITS;
    const launch = 0.22 + 0.78 * smoothstep(0, 46, travelled);
    const landing = 0.18 + 0.82 * smoothstep(0, 38, length - travelled);
    speed[i] = (stroke.pace / (1 + 16 * curvature)) * launch * landing;
  }
  let cost = 0;
  const cumulative = new Float32Array(count);
  for (let i = 1; i < count; i += 1) {
    cost += STEP_UNITS / (0.5 * (speed[i] + speed[i - 1]));
    cumulative[i] = cost;
  }
  return { path, cumulative, cost, hold: stroke.hold };
}

const PACED = SIGNATURE_STROKES.map(paceStroke);

export function buildSignature(width, height) {
  const ascent = BOX.baseline - BOX.top;
  const descent = BOX.bottom - BOX.baseline;
  const scale = Math.min((width * 0.74) / (BOX.right - BOX.left), (height * 0.6) / ascent, (height * 0.3) / descent);
  const originX = width * 0.13 - BOX.left * scale;
  const originY = height * 0.66 - BOX.baseline * scale;
  const fixedMs = PACED.reduce((sum, stroke) => sum + stroke.hold, 0) + LIFT_MS * (PACED.length - 1);
  const movingCost = PACED.reduce((sum, stroke) => sum + stroke.cost, 0);
  const msPerCost = (SIGNATURE_MS - fixedMs) / movingCost;
  const events = [];
  let clock = 0;
  PACED.forEach((stroke, index) => {
    const { path, cumulative } = stroke;
    for (let i = 0; i < path.length; i += 1) {
      events.push({
        kind: i === 0 ? "down" : "move",
        t: clock + cumulative[i] * msPerCost,
        x: originX + path[i][0] * scale,
        y: originY + path[i][1] * scale,
      });
    }
    clock += stroke.cost * msPerCost + stroke.hold;
    const last = path[path.length - 1];
    events.push({ kind: "up", t: clock, x: originX + last[0] * scale, y: originY + last[1] * scale });
    if (index < PACED.length - 1) clock += LIFT_MS;
  });
  return { events, duration: clock, scale };
}
