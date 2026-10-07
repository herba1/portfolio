const SAMPLE_STEP = 0.2;
const CUBIC_STEPS = 48;

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function unitDirection(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length, length];
}

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function createPen(startX, startY) {
  const points = [startX, startY];
  const commands = [`M${round3(startX)} ${round3(startY)}`];
  let penX = startX;
  let penY = startY;

  const push = (x, y) => {
    points.push(x, y);
    penX = x;
    penY = y;
  };

  const line = (x, y) => {
    const [, , length] = unitDirection(penX, penY, x, y);
    if (length < 1e-6) return;
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    const fromX = penX;
    const fromY = penY;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      push(fromX + (x - fromX) * t, fromY + (y - fromY) * t);
    }
    commands.push(`L${round3(x)} ${round3(y)}`);
  };

  const arc = (centerX, centerY, radius, fromAngle, toAngle) => {
    const startX = centerX + Math.cos(fromAngle) * radius;
    const startY = centerY + Math.sin(fromAngle) * radius;
    if (Math.hypot(startX - penX, startY - penY) > 1e-3) line(startX, startY);
    const sweep = toAngle - fromAngle;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) * radius) / SAMPLE_STEP));
    for (let step = 1; step <= steps; step += 1) {
      const angle = fromAngle + (sweep * step) / steps;
      push(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
    }
    const pieces = Math.abs(sweep) > Math.PI * 0.99 ? 2 : 1;
    for (let piece = 1; piece <= pieces; piece += 1) {
      const angle = fromAngle + (sweep * piece) / pieces;
      const large = Math.abs(sweep / pieces) > Math.PI ? 1 : 0;
      const direction = sweep > 0 ? 1 : 0;
      commands.push(
        `A${round3(radius)} ${round3(radius)} 0 ${large} ${direction} ${round3(centerX + Math.cos(angle) * radius)} ${round3(centerY + Math.sin(angle) * radius)}`,
      );
    }
  };

  const cubic = (c1x, c1y, c2x, c2y, x, y) => {
    const fromX = penX;
    const fromY = penY;
    for (let step = 1; step <= CUBIC_STEPS; step += 1) {
      const t = step / CUBIC_STEPS;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      push(a * fromX + b * c1x + c * c2x + d * x, a * fromY + b * c1y + c * c2y + d * y);
    }
    commands.push(`C${round3(c1x)} ${round3(c1y)} ${round3(c2x)} ${round3(c2y)} ${round3(x)} ${round3(y)}`);
  };

  const fillet = (startX, startY, heading, turn, radius) => {
    const side = Math.sign(turn);
    const centerX = startX + Math.cos(heading + (side * Math.PI) / 2) * radius;
    const centerY = startY + Math.sin(heading + (side * Math.PI) / 2) * radius;
    const fromAngle = heading - (side * Math.PI) / 2;
    arc(centerX, centerY, radius, fromAngle, fromAngle + turn);
  };

  return {
    line,
    arc,
    cubic,
    fillet,
    get x() {
      return penX;
    },
    get y() {
      return penY;
    },
    points,
    commands,
  };
}

function compileIcon(definition) {
  const [startX, startY] = definition.start;
  const pen = createPen(startX, startY);
  const segments = definition.segments;
  let vertexX = startX;
  let vertexY = startY;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const kind = segment[0];
    if (kind === "L") {
      const [, x, y, roundness = 0] = segment;
      const next = segments[index + 1];
      if (roundness > 0 && next && next[0] === "L") {
        const [inX, inY, inLength] = unitDirection(vertexX, vertexY, x, y);
        const [outX, outY, outLength] = unitDirection(x, y, next[1], next[2]);
        const headingIn = Math.atan2(inY, inX);
        const turn = wrapAngle(Math.atan2(outY, outX) - headingIn);
        if (Math.abs(turn) > 1e-3) {
          const halfTan = Math.tan(Math.abs(turn) / 2);
          const tangent = Math.min(roundness * halfTan, inLength * 0.5, outLength * 0.5);
          const radius = tangent / halfTan;
          pen.line(x - inX * tangent, y - inY * tangent);
          pen.fillet(pen.x, pen.y, headingIn, turn, radius);
          vertexX = x;
          vertexY = y;
          continue;
        }
      }
      pen.line(x, y);
      vertexX = x;
      vertexY = y;
    } else if (kind === "A") {
      const [, centerX, centerY, radius, fromAngle, toAngle] = segment;
      pen.arc(centerX, centerY, radius, fromAngle, toAngle);
      vertexX = pen.x;
      vertexY = pen.y;
    } else if (kind === "C") {
      const [, c1x, c1y, c2x, c2y, x, y] = segment;
      pen.cubic(c1x, c1y, c2x, c2y, x, y);
      vertexX = x;
      vertexY = y;
    }
  }

  const raw = pen.points;
  const xs = [];
  const ys = [];
  let length = 0;
  for (let index = 0; index < raw.length; index += 2) {
    const x = raw[index];
    const y = raw[index + 1];
    if (xs.length) {
      const step = Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
      if (step < 1e-5) continue;
      length += step;
    }
    xs.push(x);
    ys.push(y);
  }

  const count = xs.length;
  const points = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    points[index * 2] = xs[index];
    points[index * 2 + 1] = ys[index];
  }

  const headingAt = (fromIndex, toIndex) => Math.atan2(ys[toIndex] - ys[fromIndex], xs[toIndex] - xs[fromIndex]);
  const lookahead = Math.min(3, count - 1);

  return {
    ...definition,
    points,
    count,
    length,
    path: pen.commands.join(""),
    entryHeading: headingAt(0, lookahead),
    exitHeading: headingAt(count - 1 - lookahead, count - 1),
  };
}

const QUARTER = Math.PI / 2;
const NECK_ANGLE = 0.5;
const NECK_REACH = 2.2;
const NECK_LEAD = 1.8;
const NECK_DIR_X = Math.sin(QUARTER - NECK_ANGLE);
const NECK_DIR_Y = Math.cos(QUARTER - NECK_ANGLE);
const NECK_IN_X = 12 + 4 * Math.cos(QUARTER - NECK_ANGLE);
const NECK_OUT_X = 12 + 4 * Math.cos(QUARTER + NECK_ANGLE);
const NECK_Y = 7 + 4 * Math.sin(QUARTER - NECK_ANGLE);

const DEFINITIONS = [
  {
    key: "home",
    label: "Home",
    title: "Recently played",
    start: [9, 21],
    segments: [
      ["L", 9, 12, 1],
      ["L", 15, 12, 1],
      ["L", 15, 21, 0.9],
      ["L", 21, 21, 2],
      ["L", 21, 10, 2],
      ["L", 12, 2.6, 1.6],
      ["L", 3, 10, 2],
      ["L", 3, 21, 2],
      ["L", 9, 21, 0],
    ],
  },
  {
    key: "search",
    label: "Search",
    title: "Recent searches",
    start: [21, 21],
    segments: [
      ["L", 16.657, 16.657, 0],
      ["A", 11, 11, 8, QUARTER / 2, QUARTER / 2 + Math.PI * 2],
    ],
  },
  {
    key: "library",
    label: "Library",
    title: "Albums",
    start: [3, 21],
    segments: [
      ["L", 3, 4, 1.5],
      ["L", 7.5, 4, 1.5],
      ["L", 7.5, 21, 0.6],
      ["L", 10, 21, 0.6],
      ["L", 10, 8, 1.5],
      ["L", 14, 8, 1.5],
      ["L", 14, 21, 0.6],
      ["L", 16, 21, 0.6],
      ["L", 18.6, 6.6, 1.2],
      ["L", 21.85, 7.2, 1.2],
      ["L", 19.3, 21, 0],
    ],
  },
  {
    key: "liked",
    label: "Liked",
    title: "Liked songs",
    start: [12, 21],
    segments: [
      ["L", 19, 14, 0],
      ["C", 20.49, 12.54, 22, 10.79, 22, 8.5],
      ["A", 16.5, 8.5, 5.5, 0, -QUARTER],
      ["C", 14.74, 3, 13.5, 3.5, 12, 5],
      ["C", 10.5, 3.5, 9.26, 3, 7.5, 3],
      ["A", 7.5, 8.5, 5.5, -QUARTER, -Math.PI],
      ["C", 2, 10.8, 3.5, 12.55, 5, 14],
      ["L", 12, 21, 0],
    ],
  },
  {
    key: "profile",
    label: "Profile",
    title: "On repeat",
    start: [5, 21],
    segments: [
      ["L", 5, 19, 0],
      ["A", 9, 19, 4, Math.PI, Math.PI + QUARTER],
      ["C", 9 + NECK_REACH, 15, NECK_IN_X - NECK_DIR_X * NECK_LEAD, NECK_Y + NECK_DIR_Y * NECK_LEAD, NECK_IN_X, NECK_Y],
      ["A", 12, 7, 4, QUARTER - NECK_ANGLE, QUARTER + NECK_ANGLE - Math.PI * 2],
      ["C", NECK_OUT_X + NECK_DIR_X * NECK_LEAD, NECK_Y + NECK_DIR_Y * NECK_LEAD, 15 - NECK_REACH, 15, 15, 15],
      ["A", 15, 19, 4, -QUARTER, 0],
      ["L", 19, 21, 0],
    ],
  },
];

export const ICONS = DEFINITIONS.map(compileIcon);
