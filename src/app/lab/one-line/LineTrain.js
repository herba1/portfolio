import { ICONS } from "./oneLineIcons";

export const ICON_PX = 28;
export const ICON_TOP = 8;
export const BAR_HEIGHT = 76;
export const BAR_PADDING = 8;

const UNIT = ICON_PX / 24;
const RAIL_Y = 44;
const RAIL_RADIUS = 6;
const LEAD_RADIUS = 1.75;
const STEP_PX = 0.5;
const TRACK_CAPACITY = 24000;
const SPAN_CAPACITY = 32;
const TRAIN_POINTS = 180;
const INK_WIDTH = 2.5;
const MIN_WIDTH = 0.7;
const WIDTH_QUANTUM = 0.05;
const SUBSTEP = 1 / 240;

const HEAD_SPRING = { stiffness: 260, damping: 24 };
const TAIL_SPRING = { stiffness: 170, damping: 22 };
const INTRO_HEAD_SPRING = { stiffness: 120, damping: 22 };
const INTRO_TAIL_SPRING = { stiffness: 92, damping: 19.5 };
const TAIL_DELAY = 0.05;
const INTRO_TAIL_DELAY = 0.14;
const SCALE_SPRING = { stiffness: 320, damping: 11 };
const REST_LENGTH_OMEGA = 12;
const TUG_OMEGA = 26;
const TUG_DAMPING_RATIO = 0.42;
const TUG_PX = 4;
const UNPICK_SHARE = 0.18;
const SNAG_DRIFT = 3;
const SNAG_CLEARANCE = 0.5;
const STRAND_WIDTH = 1.5;
const NEAR_INK_SHARE = 0.6;
const TUG_REACH = 16;
const PROJECTION_SECONDS = 0.12;
const STUB_GAIN = 0.35;
const PEEK_MAX = 12;
const FADE_SECONDS = 0.12;
const SEW_SECONDS = 0.2;
const INTRO_SEW_SECONDS = 0.34;
const SEW_BRAKE_SHARE = 0.22;
const SEW_APPROACH_PX = 30;
const SEW_APPROACH_GAIN = 46;
const SEW_GRIP = 58;
const SEW_REEL = 2.2;
const LAND_PULSE = 4.5;
const FOLD_RADIUS = 2.5;
const FOLD_EASE_RADIUS = 6;
const FOLD_EASE_ANGLE = 0.5;
const FOLD_ROOM = 22;
const HAIRPIN_BRAKE = 0.25;
const FOLD_CARRY = 0.8;

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;
const TAB_COUNT = ICONS.length;

const WEIGHT_STEPS = Array.from({ length: 101 }, (_, step) => `"wght" ${490 + step}`);
const COVER_STEPS = Array.from({ length: 101 }, (_, step) => (step / 100).toFixed(2));
const TUG_STEPS = Array.from({ length: 49 }, (_, step) => `translate3d(0, ${(((step - 8) / 40) * TUG_PX).toFixed(3)}px, 0)`);
const NEAR_STEPS = Array.from({ length: 49 }, (_, step) => (Math.max(0, step - 8) / 40).toFixed(3));
const UNPICK_STEPS = Array.from({ length: 49 }, (_, step) => (step > 8 ? (-((step - 8) / 40) * UNPICK_SHARE).toFixed(4) : "0"));
const ICON_CUM = ICONS.map((icon) => {
  const cum = new Float32Array(icon.count);
  for (let index = 1; index < icon.count; index += 1) {
    const dx = icon.points[index * 2] - icon.points[index * 2 - 2];
    const dy = icon.points[index * 2 + 1] - icon.points[index * 2 - 1];
    cum[index] = cum[index - 1] + Math.hypot(dx, dy);
  }
  return cum;
});
const BELL = Float32Array.from({ length: TRAIN_POINTS }, (_, index) => Math.pow(Math.sin((Math.PI * index) / (TRAIN_POINTS - 1)), 0.5));

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

class Track {
  constructor() {
    this.xs = new Float32Array(TRACK_CAPACITY);
    this.ys = new Float32Array(TRACK_CAPACITY);
    this.cum = new Float64Array(TRACK_CAPACITY);
    this.spanIcon = new Int8Array(SPAN_CAPACITY);
    this.spanStart = new Float64Array(SPAN_CAPACITY);
    this.spanEnd = new Float64Array(SPAN_CAPACITY);
    this.reset();
  }

  reset() {
    this.count = 0;
    this.length = 0;
    this.heading = 0;
    this.spanCount = 0;
    this.c1s = 0;
    this.c1e = 0;
    this.c2s = 0;
    this.c2e = 0;
    this.iconStart = 0;
    this.target = -1;
    this.source = -1;
    this.restStart = -1;
    this.restEnd = -1;
    this.railDir = 1;
    this.stub = false;
    this.reversed = false;
    this.folded = false;
  }

  get lastX() {
    return this.xs[this.count - 1];
  }

  get lastY() {
    return this.ys[this.count - 1];
  }

  push(x, y) {
    if (this.count >= TRACK_CAPACITY) return;
    if (this.count > 0) {
      const step = Math.hypot(x - this.xs[this.count - 1], y - this.ys[this.count - 1]);
      if (step < 1e-4) return;
      this.length += step;
    }
    this.xs[this.count] = x;
    this.ys[this.count] = y;
    this.cum[this.count] = this.length;
    this.count += 1;
  }

  addSpan(icon, start, end) {
    if (this.spanCount >= SPAN_CAPACITY || end - start < 1e-3) return;
    this.spanIcon[this.spanCount] = icon;
    this.spanStart[this.spanCount] = start;
    this.spanEnd[this.spanCount] = end;
    this.spanCount += 1;
  }

  lineTo(x, y) {
    const fromX = this.lastX;
    const fromY = this.lastY;
    const distance = Math.hypot(x - fromX, y - fromY);
    if (distance < 1e-4) return;
    const steps = Math.max(1, Math.ceil(distance / STEP_PX));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      this.push(fromX + (x - fromX) * t, fromY + (y - fromY) * t);
    }
    this.heading = Math.atan2(y - fromY, x - fromX);
  }

  arcTurn(turn, radius) {
    if (radius < 1e-3 || Math.abs(turn) < 1e-4) {
      this.heading = wrapAngle(this.heading + turn);
      return;
    }
    const side = Math.sign(turn);
    const heading = this.heading;
    const centerX = this.lastX + Math.cos(heading + (side * Math.PI) / 2) * radius;
    const centerY = this.lastY + Math.sin(heading + (side * Math.PI) / 2) * radius;
    const fromAngle = heading - (side * Math.PI) / 2;
    const steps = Math.max(2, Math.ceil((Math.abs(turn) * radius) / STEP_PX));
    for (let step = 1; step <= steps; step += 1) {
      const angle = fromAngle + (turn * step) / steps;
      this.push(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
    }
    this.heading = wrapAngle(heading + turn);
  }

  turnTo(heading, radius) {
    this.arcTurn(wrapAngle(heading - this.heading), radius);
  }

  indexAfter(distance) {
    let low = 0;
    let high = this.count - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.cum[middle] < distance) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  }

  sample(distance, out) {
    if (this.count < 2) {
      out.x = this.count ? this.xs[0] : 0;
      out.y = this.count ? this.ys[0] : 0;
      out.heading = this.heading;
      return out;
    }
    const at = clamp(distance, 0, this.length);
    const index = this.indexAfter(at);
    const span = this.cum[index] - this.cum[index - 1] || 1;
    const t = (at - this.cum[index - 1]) / span;
    out.x = this.xs[index - 1] + (this.xs[index] - this.xs[index - 1]) * t;
    out.y = this.ys[index - 1] + (this.ys[index] - this.ys[index - 1]) * t;
    out.heading = Math.atan2(this.ys[index] - this.ys[index - 1], this.xs[index] - this.xs[index - 1]);
    return out;
  }

  appendFrom(source, from, to, scratch) {
    const base = this.length;
    source.sample(from, scratch);
    this.push(scratch.x, scratch.y);
    const startLength = this.length;
    if (to >= from) {
      for (let index = source.indexAfter(from); index < source.count && source.cum[index] < to; index += 1) {
        if (source.cum[index] > from) this.push(source.xs[index], source.ys[index]);
      }
      source.sample(to, scratch);
      this.push(scratch.x, scratch.y);
      this.heading = scratch.heading;
      for (let span = 0; span < source.spanCount; span += 1) {
        const start = Math.max(source.spanStart[span], from);
        const end = Math.min(source.spanEnd[span], to);
        if (end > start) this.addSpan(source.spanIcon[span], startLength + start - from, startLength + end - from);
      }
    } else {
      for (let index = source.indexAfter(from) - 1; index >= 0 && source.cum[index] > to; index -= 1) {
        if (source.cum[index] < from) this.push(source.xs[index], source.ys[index]);
      }
      source.sample(to, scratch);
      this.push(scratch.x, scratch.y);
      this.heading = wrapAngle(scratch.heading + Math.PI);
      for (let span = 0; span < source.spanCount; span += 1) {
        const start = Math.max(source.spanStart[span], to);
        const end = Math.min(source.spanEnd[span], from);
        if (end > start) this.addSpan(source.spanIcon[span], startLength + from - end, startLength + from - start);
      }
    }
    return base;
  }
}

function createLayout() {
  return {
    width: 0,
    centers: new Float32Array(TAB_COUNT),
    originX: new Float32Array(TAB_COUNT),
    entryX: new Float32Array(TAB_COUNT),
    entryLeads: ICONS.map(() => ({ xs: new Float32Array(64), ys: new Float32Array(64), count: 0 })),
    iconLength: new Float32Array(TAB_COUNT),
    exitLeadLength: new Float32Array(TAB_COUNT),
    paths: [],
  };
}

function iconPointX(layout, icon, index) {
  return layout.originX[icon] + ICONS[icon].points[index * 2] * UNIT;
}

function iconPointY(icon, index) {
  return ICON_TOP + ICONS[icon].points[index * 2 + 1] * UNIT;
}

function appendIcon(track, layout, icon) {
  const definition = ICONS[icon];
  track.push(iconPointX(layout, icon, 0), iconPointY(icon, 0));
  const start = track.length;
  for (let index = 1; index < definition.count; index += 1) track.push(iconPointX(layout, icon, index), iconPointY(icon, index));
  track.heading = definition.exitHeading;
  track.addSpan(icon, start, track.length);
  return start;
}

function appendExitLead(track) {
  track.turnTo(DOWN, LEAD_RADIUS);
  track.lineTo(track.lastX, RAIL_Y - RAIL_RADIUS);
  track.heading = DOWN;
}

function foldBack(track, dir) {
  track.heading = dir > 0 ? Math.PI : 0;
  track.arcTurn(dir * Math.PI, FOLD_RADIUS);
  track.arcTurn(dir * FOLD_EASE_ANGLE, FOLD_EASE_RADIUS);
  const drop = 2 * FOLD_RADIUS - 2 * FOLD_EASE_RADIUS * (1 - Math.cos(FOLD_EASE_ANGLE));
  const run = drop / Math.sin(FOLD_EASE_ANGLE);
  const heading = track.heading;
  track.lineTo(track.lastX + Math.cos(heading) * run, track.lastY + Math.sin(heading) * run);
  track.arcTurn(-dir * FOLD_EASE_ANGLE, FOLD_EASE_RADIUS);
}

function routeToGoal(track, layout, goal, stubDir) {
  const isStub = goal < 0;
  const goalX = isStub ? (stubDir > 0 ? layout.width + 24 : -24) : layout.entryX[goal];
  const x = track.lastX;
  let dir;
  if (Math.abs(wrapAngle(track.heading - DOWN)) < 0.3) {
    dir = isStub ? stubDir : goalX >= x ? 1 : -1;
    const room = isStub ? Infinity : Math.abs(goalX - x) / 2;
    const radius = Math.max(0, Math.min(RAIL_RADIUS, room, RAIL_Y - track.lastY));
    track.lineTo(x, RAIL_Y - radius);
    track.heading = DOWN;
    track.c1s = track.length;
    track.turnTo(dir > 0 ? 0 : Math.PI, radius);
    track.c1e = track.length;
  } else {
    track.c1s = track.length;
    track.c1e = track.length;
    const current = Math.cos(track.heading) >= 0 ? 1 : -1;
    dir = isStub ? stubDir : Math.abs(goalX - x) < 0.01 ? current : goalX > x ? 1 : -1;
    track.reversed = dir !== current;
    if (track.reversed && Math.abs(goalX - x) > FOLD_ROOM) {
      foldBack(track, dir);
      track.folded = true;
    }
    track.heading = dir > 0 ? 0 : Math.PI;
  }
  track.railDir = dir;
  if (isStub) {
    track.lineTo(goalX, RAIL_Y);
    track.c2s = track.length;
    track.c2e = track.length;
    track.iconStart = track.length;
    track.target = -1;
    track.stub = true;
    return;
  }
  const radius = Math.min(RAIL_RADIUS, Math.abs(goalX - track.lastX));
  track.lineTo(goalX - dir * radius, RAIL_Y);
  track.heading = dir > 0 ? 0 : Math.PI;
  track.c2s = track.length;
  track.turnTo(UP, radius);
  track.c2e = track.length;
  const lead = layout.entryLeads[goal];
  track.lineTo(goalX, lead.ys[0]);
  for (let index = 1; index < lead.count; index += 1) track.push(lead.xs[index], lead.ys[index]);
  track.iconStart = appendIcon(track, layout, goal);
  track.target = goal;
  track.stub = false;
}

function measureLayout(layout, width, scratchTrack) {
  layout.width = width;
  const inner = Math.max(0, width - BAR_PADDING * 2);
  for (let icon = 0; icon < TAB_COUNT; icon += 1) {
    const center = BAR_PADDING + ((icon + 0.5) * inner) / TAB_COUNT;
    layout.centers[icon] = center;
    layout.originX[icon] = center - ICON_PX / 2;
    layout.iconLength[icon] = ICONS[icon].length * UNIT;

    scratchTrack.reset();
    scratchTrack.push(iconPointX(layout, icon, 0), iconPointY(icon, 0));
    scratchTrack.heading = wrapAngle(ICONS[icon].entryHeading + Math.PI);
    scratchTrack.turnTo(DOWN, LEAD_RADIUS);
    const lead = layout.entryLeads[icon];
    lead.count = Math.min(scratchTrack.count, lead.xs.length);
    for (let index = 0; index < lead.count; index += 1) {
      lead.xs[index] = scratchTrack.xs[scratchTrack.count - 1 - index];
      lead.ys[index] = scratchTrack.ys[scratchTrack.count - 1 - index];
    }
    layout.entryX[icon] = lead.xs[0];

    scratchTrack.reset();
    const last = ICONS[icon].count - 1;
    scratchTrack.push(iconPointX(layout, icon, last), iconPointY(icon, last));
    scratchTrack.heading = ICONS[icon].exitHeading;
    appendExitLead(scratchTrack);
    layout.exitLeadLength[icon] = scratchTrack.length + RAIL_RADIUS;
  }
}

function readColor(element, property, fallback) {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  return value || fallback;
}

function colorChannels(color) {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2]];
}

export function createLineTrain({ canvas, icons, labels, initial = 0, reduced = false }) {
  const context = canvas.getContext("2d");
  const layout = createLayout();
  const scratch = { x: 0, y: 0, heading: 0 };
  const trainX = new Float32Array(TRAIN_POINTS);
  const trainY = new Float32Array(TRAIN_POINTS);
  const trainWidth = new Float32Array(TRAIN_POINTS);
  const coverage = new Float32Array(TAB_COUNT);
  const tug = new Float32Array(TAB_COUNT);
  const tugVelocity = new Float32Array(TAB_COUNT);
  const writtenWeight = new Int16Array(TAB_COUNT).fill(-1);
  const writtenTug = new Int16Array(TAB_COUNT).fill(-1);

  let track = new Track();
  let spare = new Track();
  const fadeTrack = new Track();

  const ink = readColor(canvas, "--color-ink", "#1a1a1a");
  const [inkR, inkG, inkB] = colorChannels(ink);
  const inkStyle = `rgb(${inkR} ${inkG} ${inkB})`;
  const [softR, softG, softB] = colorChannels(readColor(canvas, "--color-ink-secondary", "#6b6b6b"));
  const strandStyles = NEAR_STEPS.map((near) => {
    const share = Number(near) * NEAR_INK_SHARE;
    const mix = (soft, strong) => Math.round(soft + (strong - soft) * share);
    return `rgb(${mix(softR, inkR)} ${mix(softG, inkG)} ${mix(softB, inkB)})`;
  });
  const strokes = icons.map((node) => node?.querySelector("path") ?? null);

  const state = {
    goal: initial,
    head: 0,
    tail: 0,
    headVelocity: 0,
    tailVelocity: 0,
    goalHead: 0,
    goalTail: 0,
    pendingTail: 0,
    tailDelay: 0,
    restLength: 0,
    restLengthVelocity: 0,
    restLengthGoal: 0,
    scale: 1,
    scaleGoal: 1,
    scaleVelocity: 0,
    resting: true,
    intro: false,
    introPending: !reduced,
    introRequested: false,
    dragging: false,
    dragVelocity: 0,
    hoverX: null,
    pendingSide: 0,
    reduced,
    fadeFrom: -1,
    fadeTo: -1,
    fade: 1,
    paused: false,
    frame: 0,
    lastTime: 0,
    pixelWidth: 0,
    pixelHeight: 0,
    scaleX: 1,
    scaleY: 1,
    visible: true,
    railMin: Infinity,
    railMax: -Infinity,
    origin: -1,
  };

  const swapIn = () => {
    const previous = track;
    track = spare;
    spare = previous;
  };

  const restSideFor = (icon) => {
    if (state.hoverX !== null) {
      const side = state.hoverX >= layout.centers[icon] ? 1 : -1;
      if (Math.abs(state.hoverX - layout.centers[icon]) > 1) return side;
    }
    return icon >= TAB_COUNT - 1 ? -1 : 1;
  };

  const buildRest = (target, icon, side) => {
    target.reset();
    appendIcon(target, layout, icon);
    target.source = icon;
    target.restStart = 0;
    target.restEnd = target.length;
    appendExitLead(target);
    const far = side > 0 ? TAB_COUNT - 1 : 0;
    routeToGoal(target, layout, far === icon ? -1 : far, side);
  };

  const settleAt = (icon) => {
    buildRest(track, icon, restSideFor(icon));
    state.goal = icon;
    state.head = track.restEnd;
    state.tail = 0;
    state.headVelocity = 0;
    state.tailVelocity = 0;
    state.goalHead = track.restEnd;
    state.goalTail = 0;
    state.pendingTail = 0;
    state.tailDelay = 0;
    state.restLength = layout.iconLength[icon];
    state.restLengthGoal = state.restLength;
    state.restLengthVelocity = 0;
    state.resting = true;
    state.intro = false;
    state.pendingSide = 0;
    state.origin = -1;
  };

  const rebuildToward = (goal, stubDir) => {
    const T = track;
    const out = spare;
    const S = state.tail;
    const H = state.head;
    out.reset();
    let throughIcon = -1;
    if (H <= T.c1s) {
      out.appendFrom(T, S, T.c1s, scratch);
      out.heading = DOWN;
    } else if (T.stub || H <= T.c2s) {
      out.appendFrom(T, S, Math.max(H, T.c1e), scratch);
      out.heading = T.railDir > 0 ? 0 : Math.PI;
    } else if (H <= T.c2e) {
      out.appendFrom(T, S, H, scratch);
      out.appendFrom(T, H, T.c2s, scratch);
      out.heading = T.railDir > 0 ? Math.PI : 0;
    } else if (H < T.iconStart) {
      out.appendFrom(T, S, H, scratch);
      out.appendFrom(T, H, T.c2e, scratch);
      out.heading = DOWN;
    } else {
      const forward = T.length - H + layout.exitLeadLength[T.target];
      const backward = H - T.c2e;
      if (forward <= backward || state.dragging) {
        out.appendFrom(T, S, T.length, scratch);
        out.heading = ICONS[T.target].exitHeading;
        appendExitLead(out);
        throughIcon = T.target;
      } else {
        out.appendFrom(T, S, H, scratch);
        out.appendFrom(T, H, T.c2e, scratch);
        out.heading = DOWN;
      }
    }
    routeToGoal(out, layout, goal, stubDir);
    if (throughIcon >= 0 && S <= T.iconStart + 0.01) {
      out.source = throughIcon;
      out.restStart = Math.max(0, T.iconStart - S);
      out.restEnd = T.length - S;
    } else if (T.restEnd >= 0 && S <= T.restStart + 0.01) {
      out.source = T.source;
      out.restStart = T.restStart - S;
      out.restEnd = T.restEnd - S;
    }
    swapIn();
    state.head = H - S;
    state.tail = 0;
  };

  const writeLabels = () => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const step = Math.round(clamp(coverage[icon], 0, 1) * 100);
      if (step === writtenWeight[icon]) continue;
      writtenWeight[icon] = step;
      const label = labels[icon];
      if (!label) continue;
      label.style.fontVariationSettings = WEIGHT_STEPS[step];
      label.style.setProperty("--ol-cov", COVER_STEPS[step]);
    }
  };

  const writeTugs = () => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const step = Math.round(clamp(tug[icon], -0.2, 1) * 40) + 8;
      if (step === writtenTug[icon]) continue;
      writtenTug[icon] = step;
      const node = icons[icon];
      if (!node) continue;
      node.style.transform = TUG_STEPS[step];
      node.style.setProperty("--ol-near", NEAR_STEPS[step]);
      const stroke = strokes[icon];
      if (stroke) stroke.style.strokeDashoffset = UNPICK_STEPS[step];
    }
  };

  const measureCoverage = () => {
    coverage.fill(0);
    if (state.reduced) {
      if (state.fadeTo >= 0) {
        coverage[state.fadeTo] = 1;
      } else coverage[state.goal] = 1;
      return;
    }
    if (state.introPending || state.intro) {
      coverage[state.goal] = 1;
      return;
    }
    for (let span = 0; span < track.spanCount; span += 1) {
      const overlap = Math.min(track.spanEnd[span], state.head) - Math.max(track.spanStart[span], state.tail);
      if (overlap > 0) coverage[track.spanIcon[span]] += overlap / layout.iconLength[track.spanIcon[span]];
    }
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      if (coverage[icon] > 0.995) coverage[icon] = 1;
      else if (coverage[icon] < 0.005) coverage[icon] = 0;
    }
  };

  const sampleTrain = (source, from, to) => {
    const span = to - from;
    let index = source.indexAfter(from);
    for (let point = 0; point < TRAIN_POINTS; point += 1) {
      const at = from + (span * point) / (TRAIN_POINTS - 1);
      while (index < source.count - 1 && source.cum[index] < at) index += 1;
      const segment = source.cum[index] - source.cum[index - 1] || 1;
      const t = clamp((at - source.cum[index - 1]) / segment, 0, 1);
      trainX[point] = source.xs[index - 1] + (source.xs[index] - source.xs[index - 1]) * t;
      trainY[point] = source.ys[index - 1] + (source.ys[index] - source.ys[index - 1]) * t;
    }
  };

  const strokeTrain = (alpha) => {
    context.globalAlpha = alpha;
    let current = -1;
    let open = false;
    for (let point = 1; point < TRAIN_POINTS; point += 1) {
      const width = (trainWidth[point - 1] + trainWidth[point]) * 0.5;
      const quantum = Math.round(width / WIDTH_QUANTUM);
      if (quantum !== current) {
        if (open) context.stroke();
        current = quantum;
        context.lineWidth = quantum * WIDTH_QUANTUM;
        context.beginPath();
        context.moveTo(trainX[point - 1], trainY[point - 1]);
        open = true;
      }
      context.lineTo(trainX[point], trainY[point]);
    }
    if (open) context.stroke();
    context.globalAlpha = 1;
  };

  const drawRestIcon = (icon, alpha) => {
    if (icon < 0 || alpha <= 0.001) return;
    fadeTrack.reset();
    appendIcon(fadeTrack, layout, icon);
    sampleTrain(fadeTrack, 0, fadeTrack.length);
    trainWidth.fill(INK_WIDTH);
    strokeTrain(alpha);
  };

  const drawStrand = (icon, step) => {
    const amount = (step - 8) / 40;
    const definition = ICONS[icon];
    const cum = ICON_CUM[icon];
    const points = definition.points;
    const unpicked = amount * UNPICK_SHARE * definition.length;
    if (unpicked < 0.05) return;
    let end = 1;
    while (end < definition.count - 1 && cum[end] < unpicked) end += 1;
    const t = clamp((unpicked - cum[end - 1]) / (cum[end] - cum[end - 1] || 1), 0, 1);
    const originX = layout.originX[icon];
    const lift = ICON_TOP + amount * TUG_PX;
    const anchorX = originX + (points[end * 2 - 2] + (points[end * 2] - points[end * 2 - 2]) * t) * UNIT;
    const anchorY = lift + (points[end * 2 - 1] + (points[end * 2 + 1] - points[end * 2 - 1]) * t) * UNIT;
    const freeX = originX + points[0] * UNIT + track.railDir * SNAG_DRIFT * amount;
    const freeY = RAIL_Y - SNAG_CLEARANCE;
    const pull = Math.sqrt(amount);
    context.strokeStyle = strandStyles[step];
    context.beginPath();
    for (let index = 0; index <= end; index += 1) {
      const last = index === end;
      const share = last ? 1 : cum[index] / unpicked;
      const x = last ? anchorX : originX + points[index * 2] * UNIT;
      const y = last ? anchorY : lift + points[index * 2 + 1] * UNIT;
      const tautX = freeX + (anchorX - freeX) * share;
      const tautY = freeY + (anchorY - freeY) * share;
      const drawX = x + (tautX - x) * pull;
      const drawY = y + (tautY - y) * pull;
      if (index === 0) context.moveTo(drawX, drawY);
      else context.lineTo(drawX, drawY);
    }
    context.stroke();
  };

  const drawStrands = () => {
    let drawn = false;
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const step = writtenTug[icon];
      if (step <= 8) continue;
      if (!drawn) {
        context.lineWidth = STRAND_WIDTH;
        drawn = true;
      }
      drawStrand(icon, step);
    }
    if (drawn) context.strokeStyle = inkStyle;
  };

  const draw = () => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!layout.width || !state.visible) return;
    context.setTransform(state.scaleX, 0, 0, state.scaleY, 0, 0);
    context.strokeStyle = inkStyle;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (state.reduced) {
      if (state.fadeTo >= 0) {
        drawRestIcon(state.fadeFrom, 1 - state.fade);
        drawRestIcon(state.fadeTo, state.fade);
      } else drawRestIcon(state.goal, 1);
      return;
    }
    drawStrands();
    const length = state.head - state.tail;
    state.railMin = Infinity;
    state.railMax = -Infinity;
    if (length < 0.3) return;
    sampleTrain(track, state.tail, state.head);
    state.railMin = Infinity;
    state.railMax = -Infinity;
    for (let point = 0; point < TRAIN_POINTS; point += 1) {
      if (Math.abs(trainY[point] - RAIL_Y) > 0.75) continue;
      if (trainX[point] < state.railMin) state.railMin = trainX[point];
      if (trainX[point] > state.railMax) state.railMax = trainX[point];
    }
    const deviation = state.scale - 1;
    for (let point = 0; point < TRAIN_POINTS; point += 1) {
      trainWidth[point] = Math.max(MIN_WIDTH, INK_WIDTH * (1 + deviation * BELL[point]));
    }
    strokeTrain(1);
  };

  const peekAmount = () => {
    if (state.hoverX === null) return 0;
    const distance = Math.abs(state.hoverX - layout.centers[state.goal]);
    return PEEK_MAX * smoothstep(18, 56, distance) * Math.max(0.35, 1 - Math.max(0, distance - 56) / 260);
  };

  const applyPeek = () => {
    if (!state.resting || state.dragging || state.reduced || track.restEnd < 0) return;
    const amount = peekAmount();
    if (amount < 0.01) {
      state.goalHead = track.restEnd;
      state.goalTail = track.restStart;
      state.pendingSide = 0;
      return;
    }
    const side = state.hoverX >= layout.centers[state.goal] ? 1 : -1;
    if (side !== track.railDir) {
      if (state.head <= track.c1s + 0.01) {
        buildRest(track, state.goal, side);
        state.pendingSide = 0;
      } else {
        state.pendingSide = side;
        state.goalHead = track.restEnd;
        state.goalTail = track.restStart;
        return;
      }
    }
    state.goalHead = track.restEnd + amount;
    state.goalTail = track.restStart;
  };

  const stepped = { position: 0, velocity: 0 };
  const springStep = (position, velocity, goal, spring, dt) => {
    const acceleration = spring.stiffness * (goal - position) - spring.damping * velocity;
    stepped.velocity = velocity + acceleration * dt;
    stepped.position = position + stepped.velocity * dt;
    return stepped;
  };

  const sewTarget = () => {
    if (state.dragging || state.resting || track.stub || track.target < 0) return -1;
    if (track.target !== state.goal || state.goalHead < track.length - 0.01) return -1;
    return track.target;
  };

  const sewStep = (icon, h, grip) => {
    const iconLength = layout.iconLength[icon];
    const speed = iconLength / (state.intro ? INTRO_SEW_SECONDS : SEW_SECONDS);
    if (state.head < track.iconStart) {
      const cap = speed + (track.iconStart - state.head) * SEW_APPROACH_GAIN;
      if (state.headVelocity > cap) state.headVelocity += (cap - state.headVelocity) * grip;
      return false;
    }
    const brake = (speed * speed) / (2 * SEW_BRAKE_SHARE * iconLength);
    const remaining = Math.max(0, track.length - state.head);
    const cruise = Math.min(speed, Math.sqrt(2 * brake * remaining));
    state.headVelocity += (cruise - state.headVelocity) * grip;
    state.head += state.headVelocity * h;
    return true;
  };

  const integrate = (dt) => {
    if (state.tailDelay > 0) {
      state.tailDelay -= dt;
      if (state.tailDelay <= 0) {
        state.tailDelay = 0;
        state.goalTail = state.pendingTail;
      }
    }
    if (state.dragging) {
      state.goalTail = clamp(state.head - state.restLength, 0, Math.max(0, state.head - 0.5));
    }
    const headSpring = state.intro ? INTRO_HEAD_SPRING : HEAD_SPRING;
    const tailSpring = state.intro ? INTRO_TAIL_SPRING : TAIL_SPRING;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    const grip = 1 - Math.exp(-SEW_GRIP * h);
    const sewing = sewTarget();
    for (let step = 0; step < steps; step += 1) {
      const wasShort = state.head < track.length - 0.01;
      const sewn = sewing >= 0 && state.head >= track.iconStart - SEW_APPROACH_PX && sewStep(sewing, h, grip);
      if (!state.dragging && !sewn) {
        springStep(state.head, state.headVelocity, state.goalHead, headSpring, h);
        state.head = stepped.position;
        state.headVelocity = stepped.velocity;
      }
      springStep(state.tail, state.tailVelocity, state.goalTail, tailSpring, h);
      state.tail = stepped.position;
      state.tailVelocity = stepped.velocity;

      if (state.head > track.length) {
        state.head = track.length;
        state.headVelocity = Math.min(0, state.headVelocity);
        if (sewing >= 0 && wasShort) state.scaleVelocity += LAND_PULSE;
      }
      if (sewing >= 0) {
        const unsewn = Math.max(0, track.length - state.head);
        const taut = track.iconStart - unsewn;
        const reeled = track.iconStart - unsewn * SEW_REEL;
        if (state.tail > taut) {
          state.tail = Math.max(0, taut);
          state.tailVelocity = Math.min(state.tailVelocity, state.headVelocity);
        } else if (state.tail < reeled && state.head >= track.iconStart) {
          const pull = (reeled - state.tail) * grip;
          state.tail += pull;
          state.tailVelocity = Math.max(state.tailVelocity, pull / h);
        }
      }
      if (state.tail > state.head - 0.5) {
        state.tail = state.head - 0.5;
        state.tailVelocity = Math.min(state.tailVelocity, state.headVelocity);
      }
      if (state.tail < 0) {
        state.tail = 0;
        state.tailVelocity = Math.max(0, state.tailVelocity);
      }

      const restAcceleration =
        REST_LENGTH_OMEGA * REST_LENGTH_OMEGA * (state.restLengthGoal - state.restLength) - 2 * REST_LENGTH_OMEGA * state.restLengthVelocity;
      state.restLengthVelocity += restAcceleration * h;
      state.restLength += state.restLengthVelocity * h;

      const length = state.head - state.tail;
      const scaleGoal = length > 0.5 ? clamp(Math.pow(state.restLength / length, 0.6), 0.3, 1.3) : 1.3;
      state.scaleGoal = scaleGoal;
      springStep(state.scale, state.scaleVelocity, scaleGoal, SCALE_SPRING, h);
      state.scale = clamp(stepped.position, 0.25, 1.5);
      state.scaleVelocity = stepped.velocity;
    }

    const omega = TUG_OMEGA;
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const covered = coverage[icon] > 0 || icon === state.goal || icon === track.target || icon === state.origin;
      const center = layout.centers[icon];
      const gap = center < state.railMin ? state.railMin - center : center > state.railMax ? center - state.railMax : 0;
      const near = Number.isFinite(state.railMin) ? Math.exp(-((gap / TUG_REACH) * (gap / TUG_REACH))) : 0;
      const goal = covered || state.resting ? 0 : near;
      const acceleration = omega * omega * (goal - tug[icon]) - 2 * TUG_DAMPING_RATIO * omega * tugVelocity[icon];
      tugVelocity[icon] += acceleration * dt;
      tug[icon] += tugVelocity[icon] * dt;
    }
  };

  const isSettled = () => {
    if (state.dragging || state.tailDelay > 0) return false;
    if (Math.abs(state.goalHead - state.head) > 0.05 || Math.abs(state.headVelocity) > 0.05) return false;
    if (Math.abs(state.goalTail - state.tail) > 0.05 || Math.abs(state.tailVelocity) > 0.05) return false;
    if (Math.abs(state.scale - state.scaleGoal) > 0.003 || Math.abs(state.scaleVelocity) > 0.02) return false;
    if (Math.abs(state.restLength - state.restLengthGoal) > 0.05 || Math.abs(state.restLengthVelocity) > 0.05) return false;
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      if (Math.abs(tug[icon]) > 0.004 || Math.abs(tugVelocity[icon]) > 0.02) return false;
    }
    return true;
  };

  const finishSettle = () => {
    state.head = state.goalHead;
    state.tail = state.goalTail;
    state.headVelocity = 0;
    state.tailVelocity = 0;
    state.scale = state.scaleGoal;
    state.scaleVelocity = 0;
    state.restLength = state.restLengthGoal;
    state.restLengthVelocity = 0;
    tug.fill(0);
    tugVelocity.fill(0);
    if (!state.resting) {
      settleAt(state.goal);
      if (state.hoverX !== null) {
        applyPeek();
        return false;
      }
    }
    return true;
  };

  const tick = (time) => {
    state.frame = 0;
    if (state.paused) return;
    const dt = clamp((time - (state.lastTime || time - 16)) / 1000, 1 / 240, 1 / 30);
    state.lastTime = time;
    let keepGoing = true;
    if (state.reduced) {
      state.fade = Math.min(1, state.fade + dt / FADE_SECONDS);
      if (state.fade >= 1) {
        state.fadeFrom = -1;
        state.fadeTo = -1;
        keepGoing = false;
      }
    } else {
      if (state.resting && state.pendingSide && state.head <= track.c1s + 0.01) {
        buildRest(track, state.goal, state.pendingSide);
        state.pendingSide = 0;
        applyPeek();
      }
      integrate(dt);
      if (isSettled()) keepGoing = !finishSettle();
    }
    measureCoverage();
    writeLabels();
    writeTugs();
    draw();
    if (keepGoing) state.frame = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (state.frame || state.paused || !layout.width) return;
    state.lastTime = 0;
    state.frame = requestAnimationFrame(tick);
  };

  const renderStill = () => {
    measureCoverage();
    writeLabels();
    writeTugs();
    draw();
  };

  const resize = (width) => {
    if (width <= 0) return;
    measureLayout(layout, width, fadeTrack);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(BAR_HEIGHT * dpr));
    if (pixelWidth !== state.pixelWidth || pixelHeight !== state.pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      state.pixelWidth = pixelWidth;
      state.pixelHeight = pixelHeight;
    }
    state.scaleX = pixelWidth / width;
    state.scaleY = pixelHeight / BAR_HEIGHT;
    if (state.introPending) {
      if (state.introRequested) runIntro();
      else renderStill();
      return;
    }
    if (state.dragging) state.dragging = false;
    settleAt(state.goal);
    state.scale = 1;
    state.scaleVelocity = 0;
    state.fadeTo = -1;
    state.fadeFrom = -1;
    renderStill();
  };

  const runIntro = () => {
    state.introPending = false;
    if (state.reduced) {
      settleAt(state.goal);
      renderStill();
      return;
    }
    const target = state.goal;
    const fromRight = layout.centers[target] < layout.width / 2;
    track.reset();
    track.push(fromRight ? layout.width : 0, RAIL_Y);
    track.heading = fromRight ? Math.PI : 0;
    routeToGoal(track, layout, target, fromRight ? -1 : 1);
    state.head = 0;
    state.tail = 0;
    state.headVelocity = 0;
    state.tailVelocity = 0;
    state.goalHead = track.length;
    state.goalTail = 0;
    state.pendingTail = track.iconStart;
    state.tailDelay = INTRO_TAIL_DELAY;
    state.restLength = layout.iconLength[target];
    state.restLengthGoal = state.restLength;
    state.restLengthVelocity = 0;
    state.scale = 1;
    state.scaleVelocity = 0;
    state.resting = false;
    state.intro = true;
    wake();
  };

  const startIntro = () => {
    state.introRequested = true;
    if (state.introPending && layout.width) runIntro();
  };

  const go = (goal, { release = false } = {}) => {
    if (goal < 0 || goal >= TAB_COUNT) return;
    if (!layout.width || state.introPending) {
      state.goal = goal;
      return;
    }
    if (state.reduced) {
      if (goal === state.goal && state.fadeTo < 0) return;
      state.fadeFrom = state.fadeTo >= 0 ? state.fadeTo : state.goal;
      state.fadeTo = goal;
      state.fade = 0;
      settleAt(goal);
      wake();
      return;
    }
    if (goal === state.goal && !release && state.resting) {
      state.scaleVelocity += 7;
      wake();
      return;
    }
    const fromRest = state.resting && !release;
    if (goal !== state.goal && !release) state.origin = state.goal;
    let goalTail;
    if (track.target === goal && !track.stub) {
      state.goalHead = track.length;
      goalTail = track.iconStart;
    } else if (track.source === goal && track.restEnd >= 0 && (track.stub || state.head < track.iconStart)) {
      state.goalHead = track.restEnd;
      goalTail = track.restStart;
    } else {
      const carried = state.headVelocity;
      rebuildToward(goal, 1);
      if (track.reversed) state.headVelocity = track.folded ? Math.abs(carried) * FOLD_CARRY : -Math.abs(carried) * HAIRPIN_BRAKE;
      state.goalHead = track.length;
      goalTail = track.iconStart;
    }
    state.goal = goal;
    state.intro = false;
    state.resting = false;
    state.pendingSide = 0;
    state.restLengthGoal = layout.iconLength[goal];
    if (fromRest) {
      state.goalTail = state.tail;
      state.pendingTail = goalTail;
      state.tailDelay = TAIL_DELAY;
    } else {
      state.goalTail = goalTail;
      state.pendingTail = goalTail;
      state.tailDelay = 0;
    }
    wake();
  };

  const hover = (x) => {
    state.hoverX = x;
    if (state.resting && !state.dragging) {
      applyPeek();
      wake();
    }
  };

  const dragBegin = () => {
    if (state.reduced || !layout.width || state.introPending) return false;
    state.dragging = true;
    state.dragVelocity = 0;
    if (state.resting) state.origin = state.goal;
    state.headVelocity = 0;
    state.intro = false;
    state.pendingSide = 0;
    state.tailDelay = 0;
    if (state.resting) state.restLength = layout.iconLength[state.goal];
    else if (track.target >= 0 && state.head < track.iconStart) {
      const far = track.railDir > 0 ? TAB_COUNT - 1 : 0;
      if (far !== track.target) rebuildToward(far, track.railDir);
    }
    wake();
    return true;
  };

  const dragMove = (dx, dt) => {
    if (!state.dragging) return;
    const before = state.head;
    let remaining = dx * track.railDir;
    for (let guard = 0; guard < 6 && Math.abs(remaining) > 1e-4; guard += 1) {
      if (remaining > 0) {
        if (track.stub) {
          const over = Math.max(0, state.head - track.c1e);
          const gain = STUB_GAIN / (1 + over / 40);
          state.head = Math.min(track.length - 1, state.head + remaining * gain);
          remaining = 0;
          break;
        }
        const room = track.length - state.head;
        if (remaining <= room) {
          state.head += remaining;
          remaining = 0;
          break;
        }
        state.head = track.length;
        remaining -= room;
        const from = track.target;
        const next = from + track.railDir;
        state.resting = false;
        if (next >= 0 && next < TAB_COUNT) rebuildToward(next, track.railDir);
        else rebuildToward(-1, track.railDir);
        state.goal = from;
        continue;
      }
      const floor = track.restEnd >= 0 ? track.restEnd : 0.5;
      const can = state.head - floor;
      if (-remaining <= can) {
        state.head += remaining;
        remaining = 0;
        break;
      }
      state.head = floor;
      remaining += Math.max(0, can);
      if (track.restStart === 0 && track.source >= 0 && state.head <= track.c1s + 0.01) {
        const side = -track.railDir;
        const tail = state.tail;
        const head = state.head;
        buildRest(track, track.source, side);
        state.head = Math.min(head, track.restEnd);
        state.tail = Math.min(tail, state.head - 0.5);
        state.goal = track.source;
        remaining = -remaining;
        continue;
      }
      remaining = 0;
    }
    if (state.tail > state.head - 0.5) {
      state.tail = Math.max(0, state.head - 0.5);
      state.tailVelocity = Math.min(0, state.tailVelocity);
    }
    const instant = (state.head - before) / Math.max(dt, 1 / 240);
    state.dragVelocity += (instant - state.dragVelocity) * 0.35;
    state.headVelocity = state.dragVelocity;
    state.resting = false;
    wake();
  };

  const dragEnd = (fingerVelocity) => {
    if (!state.dragging) return state.goal;
    state.dragging = false;
    track.sample(state.head, scratch);
    const projected = scratch.x + fingerVelocity * PROJECTION_SECONDS;
    let best = 0;
    let bestDistance = Infinity;
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const distance = Math.abs(layout.centers[icon] - projected);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = icon;
      }
    }
    state.headVelocity = state.dragVelocity;
    return best;
  };

  const setPaused = (paused) => {
    state.paused = paused;
    if (paused) {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    } else wake();
  };

  const setVisible = (visible) => {
    state.visible = visible;
    renderStill();
  };

  const setReduced = (value) => {
    if (state.reduced === value) return;
    state.reduced = value;
    state.dragging = false;
    state.fadeFrom = -1;
    state.fadeTo = -1;
    if (layout.width && !state.introPending) settleAt(state.goal);
    renderStill();
  };

  const destroy = () => {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.paused = true;
  };

  coverage.fill(0);

  return {
    resize,
    startIntro,
    go,
    hover,
    dragBegin,
    dragMove,
    dragEnd,
    setPaused,
    setVisible,
    setReduced,
    destroy,
    get goal() {
      return state.goal;
    },
  };
}
