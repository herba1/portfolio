const STEP_UNITS = 2;
const STROKE_GAP_MS = 150;
const DEFAULT_PRESSURE = 0.7;
const FRAME_PAD = 18;
const NIB_SCALE_MIN = 0.5;
const NIB_SCALE_MAX = 2.6;

export const LOOP_TEMPO = 1.8;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function leaf(points) {
  return { pace: 2, press: 60, flick: true, points };
}

function ensoPoints() {
  const points = [];
  const start = 2.6;
  const sweep = 5.7;
  const count = 28;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = start + sweep * t;
    const radius = 150 * (1 + 0.028 * Math.sin(angle * 3 + 0.6)) - 10 * t;
    const pressure = 0.95 - 0.22 * t - 0.6 * smoothstep(0.68, 1, t);
    points.push([radius * Math.cos(angle), radius * Math.sin(angle), pressure]);
  }
  return points;
}

const SIGNATURE = [
  [92, 104],
  [110, 74],
  [127, 66],
  [128, 112],
  [119, 204],
  [107, 298],
];

const SIGNATURE_TAIL = [
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
];

export const PIECES = [
  {
    id: "enso",
    fill: 0.74,
    speed: 0.4,
    brush: 1.9,
    strokes: [{ press: 380, flick: true, points: ensoPoints() }],
  },
  {
    id: "ink",
    fill: 0.6,
    speed: 0.55,
    brush: 1.25,
    slant: 0.12,
    strokes: [
      {
        press: 180,
        hold: 120,
        points: [
          [22, -148, 0.55],
          [20, -110, 0.85],
          [18, -50, 0.85],
          [16, -4, 0.6],
        ],
      },
      { hold: 420, points: [[28, -228, 0.9]] },
      {
        press: 160,
        hold: 60,
        points: [
          [92, -150, 0.55],
          [90, -100, 0.85],
          [88, -40, 0.85],
          [86, -2, 0.6],
        ],
      },
      {
        gap: 90,
        hold: 220,
        points: [
          [92, -100, 0.3],
          [110, -136, 0.6],
          [140, -156, 0.8],
          [172, -140, 0.85],
          [184, -96, 0.85],
          [184, -40, 0.85],
          [182, -2, 0.7],
        ],
      },
      {
        press: 220,
        hold: 60,
        points: [
          [250, -262, 0.55],
          [248, -200, 0.9],
          [246, -110, 0.9],
          [244, -30, 0.85],
          [243, -2, 0.6],
        ],
      },
      {
        flick: true,
        pace: 1.2,
        points: [
          [326, -154, 0.25],
          [294, -118, 0.6],
          [262, -84, 0.8],
          [258, -74, 0.8],
          [290, -44, 0.85],
          [322, -12, 0.75],
          [346, 4, 0.25],
        ],
      },
    ],
  },
  {
    id: "bamboo",
    fill: 0.8,
    speed: 0.38,
    brush: 1.5,
    strokes: [
      {
        press: 160,
        hold: 180,
        points: [
          [0, 420, 0.95],
          [1, 380, 0.82],
          [3, 330, 0.8],
          [4, 292, 0.92],
        ],
      },
      {
        gap: 110,
        press: 160,
        hold: 180,
        points: [
          [5, 282, 0.95],
          [6, 240, 0.8],
          [8, 190, 0.78],
          [9, 152, 0.92],
        ],
      },
      {
        gap: 110,
        press: 140,
        hold: 160,
        points: [
          [10, 142, 0.9],
          [11, 100, 0.76],
          [12, 56, 0.72],
          [13, 22, 0.8],
        ],
      },
      {
        pace: 1.6,
        flick: true,
        points: [
          [-12, 288, 0.2],
          [4, 285, 0.6],
          [22, 287, 0.2],
        ],
      },
      {
        pace: 1.6,
        flick: true,
        points: [
          [-6, 148, 0.2],
          [10, 145, 0.6],
          [28, 147, 0.2],
        ],
      },
      {
        pace: 1.5,
        flick: true,
        points: [
          [12, 150, 0.35],
          [50, 120, 0.3],
          [90, 100, 0.25],
          [116, 94, 0.15],
        ],
      },
      leaf([
        [118, 96, 0.25],
        [140, 106, 0.8],
        [166, 122, 0.95],
        [192, 142, 0.55],
        [214, 160, 0.06],
      ]),
      leaf([
        [116, 98, 0.25],
        [120, 120, 0.8],
        [124, 148, 0.95],
        [126, 174, 0.55],
        [126, 200, 0.06],
      ]),
      leaf([
        [114, 98, 0.25],
        [102, 116, 0.8],
        [88, 138, 0.95],
        [76, 158, 0.55],
        [64, 178, 0.06],
      ]),
      {
        pace: 1.5,
        flick: true,
        points: [
          [12, 30, 0.35],
          [-8, 12, 0.3],
          [-32, -2, 0.22],
          [-52, -8, 0.12],
        ],
      },
      leaf([
        [-52, -4, 0.25],
        [-72, 8, 0.8],
        [-98, 24, 0.95],
        [-124, 44, 0.55],
        [-148, 62, 0.06],
      ]),
      leaf([
        [-50, -2, 0.25],
        [-54, 20, 0.8],
        [-58, 48, 0.95],
        [-58, 74, 0.55],
        [-56, 100, 0.06],
      ]),
      leaf([
        [-48, -2, 0.25],
        [-38, 16, 0.75],
        [-28, 38, 0.85],
        [-22, 56, 0.5],
        [-18, 72, 0.06],
      ]),
    ],
  },
  {
    id: "mountains",
    fill: 0.78,
    speed: 0.6,
    brush: 1.3,
    strokes: [
      {
        flick: true,
        pace: 1.1,
        points: [
          [-330, 40, 0.25],
          [-250, -10, 0.4],
          [-170, -80, 0.5],
          [-120, -40, 0.45],
          [-60, -120, 0.55],
          [0, -70, 0.5],
          [60, -30, 0.45],
          [140, -90, 0.45],
          [220, -20, 0.4],
          [330, 30, 0.2],
        ],
      },
      {
        press: 240,
        flick: true,
        points: [
          [-340, 120, 0.55],
          [-240, 80, 0.8],
          [-150, 110, 0.9],
          [-60, 40, 0.95],
          [30, 90, 0.9],
          [120, 60, 0.8],
          [220, 100, 0.65],
          [340, 130, 0.2],
        ],
      },
      {
        pace: 1.6,
        flick: true,
        points: [
          [-250, 190, 0.2],
          [-140, 186, 0.45],
          [-30, 190, 0.2],
        ],
      },
      {
        pace: 1.6,
        flick: true,
        points: [
          [60, 214, 0.15],
          [150, 210, 0.4],
          [230, 214, 0.15],
        ],
      },
      { gap: 260, hold: 1300, points: [[190, -190, 1]] },
    ],
  },
  {
    id: "wave",
    fill: 0.76,
    speed: 0.5,
    brush: 1.4,
    strokes: [
      {
        press: 220,
        flick: true,
        points: [
          [178, -72, 0.55],
          [152, -30, 0.95],
          [138, 20, 1],
          [148, 72, 1],
          [182, 116, 0.85],
          [238, 146, 0.55],
          [314, 164, 0.12],
        ],
      },
      {
        gap: 180,
        press: 140,
        hold: 360,
        points: [
          [-340, 196, 0.3],
          [-250, 176, 0.55],
          [-160, 138, 0.75],
          [-80, 70, 0.9],
          [-20, -30, 0.95],
          [30, -120, 0.9],
          [86, -178, 0.8],
          [156, -194, 0.7],
          [212, -158, 0.6],
          [232, -100, 0.5],
          [214, -56, 0.45],
          [182, -46, 0.4],
          [162, -66, 0.3],
          [170, -90, 0.2],
          [192, -94, 0.1],
        ],
      },
      {
        pace: 1.5,
        flick: true,
        points: [
          [-320, 236, 0.15],
          [-120, 228, 0.4],
          [80, 234, 0.3],
          [330, 224, 0.06],
        ],
      },
      { gap: 200, hold: 300, points: [[266, -142, 0.7]] },
      { hold: 180, points: [[292, -106, 0.5]] },
      { hold: 140, points: [[254, -200, 0.45]] },
    ],
  },
  {
    id: "plum",
    fill: 0.76,
    speed: 0.4,
    brush: 1.45,
    strokes: [
      {
        press: 320,
        flick: true,
        points: [
          [-260, 220, 0.95],
          [-200, 170, 0.9],
          [-150, 150, 0.85],
          [-110, 96, 0.8],
          [-50, 60, 0.7],
          [0, 46, 0.6],
          [60, 0, 0.5],
          [110, -30, 0.4],
          [170, -42, 0.2],
        ],
      },
      {
        pace: 1.4,
        flick: true,
        points: [
          [-110, 96, 0.5],
          [-120, 40, 0.4],
          [-100, -20, 0.3],
          [-80, -64, 0.12],
        ],
      },
      {
        pace: 1.4,
        flick: true,
        points: [
          [0, 46, 0.45],
          [40, 80, 0.35],
          [92, 98, 0.12],
        ],
      },
      { gap: 220, hold: 520, points: [[-78, -78, 1]] },
      { hold: 380, points: [[-142, 6, 1]] },
      { hold: 620, points: [[100, 106, 1]] },
      { hold: 300, points: [[178, -58, 1]] },
      { hold: 460, points: [[40, -24, 1]] },
      { hold: 140, points: [[-30, 34, 0.7]] },
    ],
  },
  {
    id: "herb",
    fill: 0.66,
    speed: 1.5,
    brush: 1.1,
    slant: 0.1,
    strokes: [
      { hold: 80, points: SIGNATURE },
      { hold: 700, points: SIGNATURE_TAIL },
    ],
  },
];

function spline(points, samplesPerSpan) {
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
      const sample = [];
      for (let axis = 0; axis < 3; axis += 1) {
        sample.push(
          0.5 *
            (2 * p1[axis] +
              (-p0[axis] + p2[axis]) * t +
              (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
              (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3),
        );
      }
      out.push(sample);
    }
  }
  out.push(points[count - 1]);
  return out;
}

function lerpPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function resample(dense) {
  const out = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i += 1) {
    const a = dense[i - 1];
    const b = dense[i];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = STEP_UNITS - carry;
    while (at <= span) {
      out.push(lerpPoint(a, b, at / span));
      at += STEP_UNITS;
    }
    carry = span - (at - STEP_UNITS);
  }
  out.push(dense[dense.length - 1]);
  return out;
}

function paceStroke(stroke, slant) {
  const shaped = stroke.points.map(([x, y, p]) => [x - y * slant, y, p ?? DEFAULT_PRESSURE]);
  const base = { hold: stroke.hold ?? 0, press: stroke.press ?? 0, gap: stroke.gap ?? STROKE_GAP_MS };
  if (shaped.length === 1) return { ...base, path: shaped, cumulative: new Float32Array(1), cost: 0 };
  const path = resample(spline(shaped, 20));
  const count = path.length;
  const turn = new Float32Array(count);
  for (let i = 1; i < count - 1; i += 1) {
    const ax = path[i][0] - path[i - 1][0];
    const ay = path[i][1] - path[i - 1][1];
    const bx = path[i + 1][0] - path[i][0];
    const by = path[i + 1][1] - path[i][1];
    turn[i] = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) / STEP_UNITS;
  }
  const length = (count - 1) * STEP_UNITS;
  const pace = stroke.pace ?? 1;
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
    const ending = stroke.flick ? 1 + 0.8 * smoothstep(length - 70, length, travelled) : 0.18 + 0.82 * smoothstep(0, 38, length - travelled);
    speed[i] = (pace / (1 + 16 * curvature)) * launch * ending;
  }
  let cost = 0;
  const cumulative = new Float32Array(count);
  for (let i = 1; i < count; i += 1) {
    cost += STEP_UNITS / (0.5 * (speed[i] + speed[i - 1]));
    cumulative[i] = cost;
  }
  return { ...base, path, cumulative, cost };
}

const PACED = PIECES.map((piece) => {
  const strokes = piece.strokes.map((stroke) => paceStroke(stroke, piece.slant ?? 0));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke.path) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { piece, strokes, bounds: { minX, minY, maxX, maxY } };
});

function clampPressure(p) {
  return Math.min(1, Math.max(0.05, p));
}

function fitScale({ piece, bounds }, width, height) {
  const spanX = bounds.maxX - bounds.minX + FRAME_PAD * 2;
  const spanY = bounds.maxY - bounds.minY + FRAME_PAD * 2;
  return Math.min((width * piece.fill) / spanX, (height * piece.fill) / spanY);
}

function brushScale(piece, scale) {
  return Math.min(NIB_SCALE_MAX, Math.max(NIB_SCALE_MIN, piece.brush * scale));
}

export function pieceNibScale(index, width, height) {
  const paced = PACED[((index % PACED.length) + PACED.length) % PACED.length];
  return brushScale(paced.piece, fitScale(paced, width, height));
}

export function buildPiece(index, width, height) {
  const paced = PACED[index];
  const { piece, strokes, bounds } = paced;
  const scale = fitScale(paced, width, height);
  const originX = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const originY = height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
  const msPerCost = 1 / (piece.speed * LOOP_TEMPO);
  const place = (point) => ({ x: originX + point[0] * scale, y: originY + point[1] * scale, p: clampPressure(point[2]) });
  const events = [];
  let clock = 0;
  strokes.forEach((stroke, strokeIndex) => {
    const { path, cumulative } = stroke;
    const press = stroke.press / LOOP_TEMPO;
    events.push({ kind: "down", t: clock, ...place(path[0]) });
    for (let i = 1; i < path.length; i += 1) {
      events.push({ kind: "move", t: clock + press + cumulative[i] * msPerCost, ...place(path[i]) });
    }
    clock += press + stroke.cost * msPerCost + stroke.hold / LOOP_TEMPO;
    events.push({ kind: "up", t: clock, ...place(path[path.length - 1]) });
    if (strokeIndex < strokes.length - 1) clock += strokes[strokeIndex + 1].gap / LOOP_TEMPO;
  });
  const nibScale = brushScale(piece, scale);
  return { id: piece.id, events, duration: clock, nibScale };
}

export const PIECE_COUNT = PIECES.length;
