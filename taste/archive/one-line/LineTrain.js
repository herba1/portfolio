import { ICONS } from "./oneLineIcons";
import { colorChannels, readToken } from "./oneLineThread";

export const ICON_PX = 24;
export const ICON_TOP = 12;
export const BAR_HEIGHT = 76;
export const BAR_PADDING = 8;

const UNIT = ICON_PX / 24;
const RAIL_Y = 44;
const RAIL_RADIUS = 6;
const LEAD_RADIUS = 1.75;
const STEP_PX = 0.5;
const TRACK_CAPACITY = 24000;
const SPAN_CAPACITY = 32;
const DEFAULT_WEIGHT = 2;
const MIN_SHARE = 0.375;
const REST_SHARE = 0.75;
const HOVER_SHARE = 0.125;
const WIDTH_QUANTUM = 0.05;
const ICON_FEATHER = 8;
const ICON_SWELL = 0.5;
const SUBSTEP = 1 / 240;
const MAX_DPR = 3;

const HEAD_SPRING = { stiffness: 260, damping: 24 };
const TAIL_SPRING = { stiffness: 170, damping: 22 };
const INTRO_HEAD_SPRING = { stiffness: 120, damping: 22 };
const INTRO_TAIL_SPRING = { stiffness: 92, damping: 19.5 };
const TAIL_DELAY = 0.05;
const INTRO_TAIL_DELAY = 0.14;
const SCALE_SPRING = { stiffness: 320, damping: 11 };
const REST_LENGTH_OMEGA = 12;
const TUG_OMEGA = 26;
const TUG_DAMPING_RATIO = 0.9;
const TUG_PX = 4;
const UNPICK_SHARE = 0.18;
const SNAG_DRIFT = 3;
const SNAG_DROP = 6;
const DRIFT_RATE = 12;
const NEAR_INK_SHARE = 0.6;
const HOVER_INK_SHARE = 0.4;
const HOVER_SECONDS = 0.05;
const EMPHASIS_STEPS = 40;
const STRAIGHT_TURN = 0.002;
const CURVE_STEP = 0.15;
const TUG_REACH = 16;
const STUB_RUN = 96;
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
const LANE_Y = RAIL_Y - FOLD_RADIUS * 2;
const LANE_CORNER = 3;
const LEAD_FLOOR = LANE_Y - LANE_CORNER;
const HOP_RADIUS = 2.5;
const EASE_RADIUS = 3;
const FOLD_CARRY = 0.92;
const FINISH_SHARE = 0.3;
const CATCH_OMEGA = 40;
const CATCH_SPEED = 1200;
const FINGER_SLOPE = 1.65;
const EDGE_INSET = 4;
const EDGE_REACH = 10;
const SELECT_EDGE = 0.1;
const JOLT_OMEGA = 24;
const JOLT_DAMPING = 0.62;
const JOLT_PX = 2.5;
const JOLT_SIDE = 0.5;
const JOLT_LIMIT = 4;
const RELEASE_SHARE = 0.4;
const CINCH_OMEGA = 28;
const CINCH_DAMPING = 0.62;
const CINCH_SCALE = 0.06;
const CINCH_LIMIT = 0.09;
const JOLT_FULL_SPEED = 900;
const JOLT_MIN_SHARE = 0.25;
const LABEL_TICK = 0.1;
const RELEASE_FLOOR = 0.45;
const TAU = Math.PI * 2;

const DOWN = Math.PI / 2;
const UP = -Math.PI / 2;
const TAB_COUNT = ICONS.length;

const COVER_STEPS = Array.from({ length: 101 }, (_, step) => (step / 100).toFixed(2));
const WEIGHT_STEP_COUNT = Math.round((1 + LABEL_TICK) * 100) + 1;

function peakGain(damping) {
  const ring = Math.sqrt(1 - damping * damping);
  return Math.exp((-damping / ring) * Math.atan(ring / damping));
}

const JOLT_KICK = (JOLT_PX * JOLT_OMEGA) / peakGain(JOLT_DAMPING);
const CINCH_KICK = (CINCH_SCALE * CINCH_OMEGA) / peakGain(CINCH_DAMPING);

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function positiveAngle(angle) {
  let wrapped = angle % TAU;
  if (wrapped < 0) wrapped += TAU;
  return wrapped > TAU - 1e-3 ? 0 : wrapped;
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
    this.version = 0;
    this.reset();
  }

  reset() {
    this.version += 1;
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
    this.exitLead = false;
    this.leadFrom = 0;
    this.leadEnd = 0;
    this.routeFrom = 0;
    this.junction = 0;
    this.runFrom = 0;
    this.descended = false;
    this.runLane = RAIL_Y;
    this.inboundDir = 0;
    this.inboundLane = RAIL_Y;
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
    exitX: new Float32Array(TAB_COUNT),
    exitLeadLength: new Float32Array(TAB_COUNT),
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
  if (track.lastY < LEAD_FLOOR) track.lineTo(track.lastX, LEAD_FLOOR);
  track.heading = DOWN;
  track.exitLead = true;
  track.leadEnd = track.length;
}

function appendDive(track) {
  track.leadFrom = track.length;
  appendExitLead(track);
}

function laneFor(y) {
  return y < (RAIL_Y + LANE_Y) / 2 ? LANE_Y : RAIL_Y;
}

function rotateToward(track, heading, sign, radius) {
  const turn = sign > 0 ? positiveAngle(heading - track.heading) : -positiveAngle(track.heading - heading);
  track.arcTurn(turn, radius);
  track.heading = heading;
}

function descendOnto(track, want, room, laneY) {
  const lane = laneY < RAIL_Y && track.lastY < laneY - 1 ? laneY : RAIL_Y;
  const corner = lane === RAIL_Y ? RAIL_RADIUS : LANE_CORNER;
  const radius = Math.max(0, Math.min(corner, room, lane - track.lastY));
  track.lineTo(track.lastX, lane - radius);
  track.heading = DOWN;
  track.c1s = track.length;
  track.junction = track.c1s;
  track.descended = true;
  track.turnTo(want, radius);
  track.heading = want;
  track.c1e = track.length;
}

function steerOnto(track, dir, room) {
  const want = dir > 0 ? 0 : Math.PI;
  const error = wrapAngle(want - track.heading);
  const climb = Math.sin(track.heading);
  const landing = track.inboundDir === -dir && track.inboundLane === RAIL_Y ? LANE_Y : RAIL_Y;
  if (Math.abs(error) < 0.02) {
    track.heading = want;
    return;
  }
  if (climb > 0.5 && track.lastY < RAIL_Y - 0.5) {
    descendOnto(track, want, room, landing);
    return;
  }
  if (climb < -0.5) {
    const lift = LANE_Y - LANE_CORNER - 1;
    if (landing === LANE_Y && track.lastY > lift && track.lastY < RAIL_Y - 0.5) {
      track.turnTo(UP, Math.min(RAIL_RADIUS, track.lastY - lift));
      if (track.lastY > lift) track.lineTo(track.lastX, lift);
      track.heading = UP;
    }
    const hopBottom = track.lastY + HOP_RADIUS * Math.sin(track.heading + (dir * Math.PI) / 2);
    if (hopBottom < RAIL_Y - 1.5) {
      rotateToward(track, DOWN, dir, HOP_RADIUS);
      descendOnto(track, want, room, landing);
      return;
    }
  }
  if (Math.abs(error) <= Math.PI / 2) {
    track.turnTo(want, EASE_RADIUS);
    track.heading = want;
    return;
  }
  const rising = laneFor(track.lastY) === RAIL_Y;
  const forward = Math.cos(track.heading) >= 0 ? 1 : -1;
  rotateToward(track, want, rising ? -forward : forward, FOLD_RADIUS);
  track.reversed = true;
}

function routeToGoal(track, layout, goal, stubDir) {
  const isStub = goal < 0;
  const stubX = stubDir > 0 ? Math.max(layout.width + 24, track.lastX + STUB_RUN) : Math.min(-24, track.lastX - STUB_RUN);
  const goalX = isStub ? stubX : layout.entryX[goal];
  const current = Math.cos(track.heading) >= 0 ? 1 : -1;
  const leaving = Math.abs(wrapAngle(track.heading - DOWN)) < 0.3;
  let dir = isStub ? stubDir : Math.abs(goalX - track.lastX) < 0.01 ? (leaving ? 1 : current) : goalX > track.lastX ? 1 : -1;
  track.reversed = false;
  track.routeFrom = track.length;
  track.junction = track.length;
  track.descended = false;
  track.c1s = track.length;
  track.c1e = track.length;
  for (let pass = 0; pass < 3; pass += 1) {
    const room = isStub ? Infinity : Math.abs(goalX - track.lastX) / 2;
    steerOnto(track, dir, room);
    if (isStub || (goalX - track.lastX) * dir >= -0.01) break;
    dir = -dir;
  }
  track.railDir = dir;
  const laneY = laneFor(track.lastY);
  track.runLane = laneY;
  track.runFrom = track.length;
  if (isStub) {
    track.lineTo(goalX, laneY);
    track.c2s = track.length;
    track.c2e = track.length;
    track.iconStart = track.length;
    track.target = -1;
    track.stub = true;
    return;
  }
  const radius = Math.max(0, Math.min(laneY === RAIL_Y ? RAIL_RADIUS : LANE_CORNER, (goalX - track.lastX) * dir));
  track.lineTo(goalX - dir * radius, laneY);
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

function measureLayout(layout, width, dpr, scratchTrack, left) {
  layout.width = width;
  const inner = Math.max(0, width - BAR_PADDING * 2);
  const shift = left * dpr - Math.round(left * dpr);
  for (let icon = 0; icon < TAB_COUNT; icon += 1) {
    const center = BAR_PADDING + ((icon + 0.5) * inner) / TAB_COUNT;
    const origin = center - ICON_PX / 2;
    layout.centers[icon] = center;
    layout.originX[icon] = (Math.round(origin * dpr + shift) - shift) / dpr;
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
    layout.exitX[icon] = scratchTrack.lastX;
    layout.exitLeadLength[icon] = scratchTrack.length + (RAIL_Y - RAIL_RADIUS - scratchTrack.lastY) + (RAIL_RADIUS * Math.PI) / 2;
  }
}

function rgbStyle([red, green, blue]) {
  return `rgb(${red} ${green} ${blue})`;
}

function mixChannels(from, to, share) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * share));
}

function turnAt(xs, ys, count, index) {
  if (index <= 0 || index >= count - 1) return 0;
  const ax = xs[index] - xs[index - 1];
  const ay = ys[index] - ys[index - 1];
  const bx = xs[index + 1] - xs[index];
  const by = ys[index + 1] - ys[index];
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
}

function createGlyphs() {
  return ICONS.map((icon) => ({
    xs: new Float32Array(icon.count),
    ys: new Float32Array(icon.count),
    cum: new Float32Array(icon.count),
    keep: new Int32Array(icon.count),
    keepCount: 0,
    count: icon.count,
    length: 0,
  }));
}

function buildGlyphs(glyphs, layout) {
  for (let icon = 0; icon < TAB_COUNT; icon += 1) {
    const glyph = glyphs[icon];
    const { xs, ys, cum, count } = glyph;
    let length = 0;
    for (let index = 0; index < count; index += 1) {
      xs[index] = iconPointX(layout, icon, index);
      ys[index] = iconPointY(icon, index);
      if (index > 0) length += Math.hypot(xs[index] - xs[index - 1], ys[index] - ys[index - 1]);
      cum[index] = length;
    }
    glyph.length = length;
    glyph.keepCount = 0;
    let bend = 0;
    for (let index = 0; index < count; index += 1) {
      const turn = turnAt(xs, ys, count, index);
      bend += turn;
      const ends = index === 0 || index === count - 1;
      const curved = turn > STRAIGHT_TURN;
      const keep =
        ends ||
        (curved &&
          (bend >= CURVE_STEP || turnAt(xs, ys, count, index - 1) <= STRAIGHT_TURN || turnAt(xs, ys, count, index + 1) <= STRAIGHT_TURN));
      if (!keep) continue;
      glyph.keep[glyph.keepCount] = index;
      glyph.keepCount += 1;
      bend = 0;
    }
  }
}

export function createLineTrain({ canvas, labels, initial = 0, reduced = false, thread = null }) {
  const context = canvas.getContext("2d");
  const layout = createLayout();
  const scratch = { x: 0, y: 0, heading: 0 };
  const drawX = new Float32Array(TRACK_CAPACITY + 2);
  const drawY = new Float32Array(TRACK_CAPACITY + 2);
  const drawAt = new Float64Array(TRACK_CAPACITY + 2);
  const drawWidth = new Float32Array(TRACK_CAPACITY + 2);
  const drawFlat = new Uint8Array(TRACK_CAPACITY + 2);
  const normalX = new Float32Array(TRACK_CAPACITY + 2);
  const normalY = new Float32Array(TRACK_CAPACITY + 2);
  const coverage = new Float32Array(TAB_COUNT);
  const labelLevel = new Float32Array(TAB_COUNT);
  const selection = {
    active: false,
    goal: -1,
    from: 0,
    base: new Float32Array(TAB_COUNT),
    level: new Float32Array(TAB_COUNT),
    near: new Float32Array(TAB_COUNT),
    engage: 0,
  };
  const anchor = { junction: 0, junctionX: 0, runX: 0 };
  const tug = new Float32Array(TAB_COUNT);
  const tugVelocity = new Float32Array(TAB_COUNT);
  const strandDrift = new Float32Array(TAB_COUNT).fill(1);
  const writtenWeight = new Int16Array(TAB_COUNT).fill(-1);
  const hoverLevel = new Float32Array(TAB_COUNT);
  const jolt = {
    x: new Float32Array(TAB_COUNT),
    y: new Float32Array(TAB_COUNT),
    vx: new Float32Array(TAB_COUNT),
    vy: new Float32Array(TAB_COUNT),
    scale: new Float32Array(TAB_COUNT).fill(1),
    vs: new Float32Array(TAB_COUNT),
    strength: new Float32Array(TAB_COUNT),
  };
  const contact = { track: null, version: -1, head: 0, tail: 0 };
  const iconHit = { icon: -1, share: 0 };

  let track = new Track();
  let spare = new Track();
  const fadeTrack = new Track();
  const glyphs = createGlyphs();

  const inkChannels = colorChannels(readToken(canvas, "--color-ink", "#1a1a1a"));
  const quietChannels = colorChannels(readToken(canvas, "--color-ink-tertiary", "#94a3b8"));
  const emphasisStyles = Array.from({ length: EMPHASIS_STEPS + 1 }, (_, step) =>
    rgbStyle(mixChannels(quietChannels, inkChannels, step / EMPHASIS_STEPS)),
  );
  const pen = { style: rgbStyle(inkChannels), width: DEFAULT_WEIGHT, min: 0, rest: 0, hover: 0 };
  const weightToken = (property, fallback) => {
    const value = Number.parseFloat(readToken(document.documentElement, property, ""));
    return Number.isFinite(value) ? value : fallback;
  };
  const weightLight = weightToken("--font-weight-body-sm", 490);
  const weightStrong = weightToken("--font-weight-strong", 590);
  const weightSteps = Array.from({ length: WEIGHT_STEP_COUNT }, (_, step) => `"wght" ${Math.round((weightLight + ((weightStrong - weightLight) * step) / 100) * 10) / 10}`);

  const applyThread = (next) => {
    if (next?.rgb) pen.style = rgbStyle(next.rgb);
    const weight = Number.isFinite(next?.weight) ? next.weight : pen.width;
    pen.width = weight;
    pen.min = weight * MIN_SHARE;
    pen.rest = weight * REST_SHARE;
    pen.hover = weight * HOVER_SHARE;
  };
  applyThread(thread);

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
    dragX: 0,
    dragTarget: 0,
    dragFrom: 0,
    dragLag: 0,
    dragLagVelocity: 0,
    dragLength: 0,
    tailLag: 0,
    tailLagVelocity: 0,
    dragMark: 0,
    contactShare: 1,
    left: 0,
    alignPending: false,
    hoverIcon: -1,
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

  const buildRest = (target, icon, side, stub = false) => {
    target.reset();
    appendIcon(target, layout, icon);
    target.source = icon;
    target.restStart = 0;
    target.restEnd = target.length;
    target.leadFrom = 0;
    appendExitLead(target);
    const far = side > 0 ? TAB_COUNT - 1 : 0;
    routeToGoal(target, layout, stub || far === icon ? -1 : far, side);
  };

  const settleAt = (icon) => {
    buildRest(track, icon, icon >= TAB_COUNT - 1 ? -1 : 1);
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
    state.origin = -1;
    selection.active = false;
  };

  const rebuildToward = (goal, stubDir) => {
    const T = track;
    const out = spare;
    const S = state.tail;
    const H = state.head;
    let copyTo = H;
    let ending = 0;
    let throughIcon = -1;
    if (T.exitLead && H <= T.c1s && H >= T.leadFrom - 0.01) {
      copyTo = Math.max(H, Math.min(T.leadEnd, T.c1s));
      ending = 1;
    } else if (!T.stub && T.target >= 0 && H >= T.iconStart) {
      if (T.length - H <= layout.iconLength[T.target] * FINISH_SHARE) {
        copyTo = T.length;
        throughIcon = T.target;
        ending = 2;
      } else ending = 3;
    } else if (T.exitLead && H > T.c1s) copyTo = Math.max(H, T.c1e);
    out.reset();
    out.appendFrom(T, S, copyTo, scratch);
    if (ending === 1) {
      out.heading = DOWN;
      out.exitLead = true;
      out.leadFrom = Math.max(0, T.leadFrom - S);
      out.leadEnd = out.length;
    } else if (ending === 2) {
      out.heading = ICONS[T.target].exitHeading;
      out.leadFrom = T.iconStart - S;
      appendExitLead(out);
    } else if (ending === 3) appendDive(out);
    out.inboundDir = T.railDir;
    out.inboundLane = T.runLane;
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

  const branchFrom = (cut, side, keepAnchor) => {
    const T = track;
    const out = spare;
    out.reset();
    out.appendFrom(T, 0, cut, scratch);
    if (T.restEnd >= 0 && T.restEnd <= cut + 0.01) {
      out.source = T.source;
      out.restStart = T.restStart;
      out.restEnd = T.restEnd;
    }
    out.exitLead = T.exitLead;
    out.leadFrom = T.leadFrom;
    out.leadEnd = T.leadEnd;
    out.inboundDir = T.inboundDir;
    out.inboundLane = T.inboundLane;
    const kept = { junction: T.junction, c1s: T.c1s, c1e: T.c1e, descended: T.descended };
    routeToGoal(out, layout, -1, side);
    if (keepAnchor) {
      out.junction = kept.junction;
      out.c1s = kept.c1s;
      out.c1e = kept.c1e;
      out.descended = kept.descended;
    }
    swapIn();
  };

  const tabUnder = (x) => {
    const inner = Math.max(1, layout.width - BAR_PADDING * 2);
    return clamp(Math.floor(((x - BAR_PADDING) / inner) * TAB_COUNT), 0, TAB_COUNT - 1);
  };

  const measureProximity = (x) => {
    const inner = Math.max(1, layout.width - BAR_PADDING * 2);
    const at = clamp(((x - BAR_PADDING) / inner) * TAB_COUNT - 0.5, 0, TAB_COUNT - 1);
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      selection.near[icon] = 1 - smoothstep(0.5 - SELECT_EDGE, 0.5 + SELECT_EDGE, Math.abs(at - icon));
    }
  };

  const holdSelection = (goal) => {
    selection.base.set(selection.level);
    selection.goal = goal;
    selection.from = coverage[goal];
    selection.active = true;
  };

  const writeLabels = () => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const step = Math.round(clamp(labelLevel[icon], 0, 1 + LABEL_TICK) * 100);
      if (step === writtenWeight[icon]) continue;
      writtenWeight[icon] = step;
      const label = labels[icon];
      if (!label) continue;
      label.style.fontVariationSettings = weightSteps[step];
      label.style.setProperty("--ol-cov", COVER_STEPS[Math.min(step, 100)]);
    }
  };

  const relayout = (width, left) => {
    measureLayout(layout, width, Math.min(window.devicePixelRatio || 1, MAX_DPR), fadeTrack, left);
    buildGlyphs(glyphs, layout);
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

  const measureLabels = () => {
    labelLevel.set(coverage);
    if (state.reduced || state.introPending || state.intro) {
      selection.active = false;
      return;
    }
    if (state.dragging) {
      measureProximity(track.sample(state.head, scratch).x);
      if (state.dragLag === 0) selection.engage = 0;
      const share = selection.engage > 0 ? clamp(Math.abs(state.dragLag) / selection.engage, 0, 1) : 0;
      for (let icon = 0; icon < TAB_COUNT; icon += 1) {
        const near = selection.near[icon];
        selection.level[icon] = near + (selection.base[icon] - near) * share;
        labelLevel[icon] = selection.level[icon];
      }
      return;
    }
    if (!selection.active) return;
    const goal = selection.goal;
    const progress = selection.from < 0.999 ? clamp((coverage[goal] - selection.from) / (1 - selection.from), 0, 1) : 1;
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      selection.level[icon] = icon === goal ? selection.base[icon] : selection.base[icon] * (1 - progress);
      labelLevel[icon] = icon === goal ? Math.max(coverage[icon], selection.level[icon]) : selection.level[icon];
    }
    if (progress >= 1) selection.active = false;
  };

  const measure = () => {
    measureCoverage();
    measureLabels();
    if (state.reduced) return;
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const cinch = clamp((jolt.scale[icon] - 1) / CINCH_SCALE, 0, 1);
      if (cinch > 0 && labelLevel[icon] >= 0.999) labelLevel[icon] = 1 + LABEL_TICK * cinch;
    }
  };

  const gather = (source, from, to) => {
    source.sample(from, scratch);
    drawX[0] = scratch.x;
    drawY[0] = scratch.y;
    drawAt[0] = from;
    let count = 1;
    for (let index = source.indexAfter(from); index < source.count && source.cum[index] < to; index += 1) {
      if (source.cum[index] <= from) continue;
      drawX[count] = source.xs[index];
      drawY[count] = source.ys[index];
      drawAt[count] = source.cum[index];
      count += 1;
    }
    source.sample(to, scratch);
    drawX[count] = scratch.x;
    drawY[count] = scratch.y;
    drawAt[count] = to;
    return count + 1;
  };

  const iconShare = (source, at) => {
    let share = 0;
    for (let span = 0; span < source.spanCount; span += 1) {
      const start = source.spanStart[span];
      const end = source.spanEnd[span];
      if (at >= start && at <= end) return 1;
      const gap = at < start ? start - at : at - end;
      if (gap < ICON_FEATHER) share = Math.max(share, 1 - smoothstep(0, ICON_FEATHER, gap));
    }
    return share;
  };

  const iconNear = (source, at) => {
    iconHit.icon = -1;
    iconHit.share = 0;
    for (let span = 0; span < source.spanCount; span += 1) {
      const start = source.spanStart[span];
      const end = source.spanEnd[span];
      const gap = at < start ? start - at : at > end ? at - end : 0;
      if (gap >= ICON_FEATHER) continue;
      const share = gap === 0 ? 1 : 1 - smoothstep(0, ICON_FEATHER, gap);
      if (share > iconHit.share) {
        iconHit.share = share;
        iconHit.icon = source.spanIcon[span];
      }
    }
    return iconHit;
  };

  const joltStrength = (speed) => clamp(Math.abs(speed) / JOLT_FULL_SPEED, JOLT_MIN_SHARE, 1);

  const kickArrival = (icon, speed) => {
    const strength = joltStrength(speed) * state.contactShare;
    jolt.strength[icon] = strength;
    jolt.vy[icon] += JOLT_KICK * strength;
    jolt.vx[icon] -= track.railDir * JOLT_KICK * JOLT_SIDE * strength;
  };

  const kickCinch = (icon, strength) => {
    jolt.vs[icon] += CINCH_KICK * clamp(strength, JOLT_MIN_SHARE, 1);
  };

  const kickRelease = (icon, speed) => {
    const strength = joltStrength(speed) * RELEASE_SHARE;
    jolt.vy[icon] -= JOLT_KICK * strength;
    jolt.vx[icon] -= track.railDir * JOLT_KICK * JOLT_SIDE * strength;
  };

  const stepJolts = (h) => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const pull = JOLT_OMEGA * JOLT_OMEGA;
      const drag = 2 * JOLT_DAMPING * JOLT_OMEGA;
      jolt.vx[icon] += (-pull * jolt.x[icon] - drag * jolt.vx[icon]) * h;
      jolt.vy[icon] += (-pull * jolt.y[icon] - drag * jolt.vy[icon]) * h;
      jolt.x[icon] = clamp(jolt.x[icon] + jolt.vx[icon] * h, -JOLT_LIMIT, JOLT_LIMIT);
      jolt.y[icon] = clamp(jolt.y[icon] + jolt.vy[icon] * h, -JOLT_LIMIT, JOLT_LIMIT);
      const cinch = CINCH_OMEGA * CINCH_OMEGA * (1 - jolt.scale[icon]) - 2 * CINCH_DAMPING * CINCH_OMEGA * jolt.vs[icon];
      jolt.vs[icon] += cinch * h;
      jolt.scale[icon] = clamp(jolt.scale[icon] + jolt.vs[icon] * h, 1 - CINCH_LIMIT, 1 + CINCH_LIMIT);
    }
  };

  const joltsSettled = () => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      if (Math.abs(jolt.x[icon]) > 0.02 || Math.abs(jolt.y[icon]) > 0.02 || Math.abs(jolt.vx[icon]) > 0.5 || Math.abs(jolt.vy[icon]) > 0.5) return false;
      if (Math.abs(jolt.scale[icon] - 1) > 0.0005 || Math.abs(jolt.vs[icon]) > 0.01) return false;
    }
    return true;
  };

  const clearJolts = () => {
    jolt.x.fill(0);
    jolt.y.fill(0);
    jolt.vx.fill(0);
    jolt.vy.fill(0);
    jolt.scale.fill(1);
    jolt.vs.fill(0);
  };

  const iconCenterX = (icon) => layout.originX[icon] + ICON_PX / 2;
  const iconCenterY = ICON_TOP + ICON_PX / 2;

  const joltTrain = (source, count) => {
    for (let point = 0; point < count; point += 1) {
      const hit = iconNear(source, drawAt[point]);
      if (hit.icon < 0) continue;
      const icon = hit.icon;
      const scale = jolt.scale[icon];
      if (scale === 1 && jolt.x[icon] === 0 && jolt.y[icon] === 0) continue;
      const centerX = iconCenterX(icon);
      const movedX = centerX + (drawX[point] - centerX) * scale + jolt.x[icon];
      const movedY = iconCenterY + (drawY[point] - iconCenterY) * scale + jolt.y[icon];
      drawX[point] += (movedX - drawX[point]) * hit.share;
      drawY[point] += (movedY - drawY[point]) * hit.share;
    }
  };

  const weighTrain = (source, count, from, to) => {
    const span = Math.max(to - from, 1e-6);
    const deviation = state.scale - 1;
    const sewnWidth = pen.width * (1 + Math.max(0, deviation) * ICON_SWELL);
    for (let point = 0; point < count; point += 1) {
      const u = clamp((drawAt[point] - from) / span, 0, 1);
      const bell = Math.sqrt(Math.sin(Math.PI * u));
      const thread = Math.max(pen.min, pen.width * (1 + deviation * bell));
      const share = iconShare(source, drawAt[point]);
      drawWidth[point] = thread + (sewnWidth - thread) * share;
      drawFlat[point] = share >= 1 ? 1 : 0;
    }
  };

  const strokeRun = (from, to) => {
    context.lineWidth = drawWidth[to];
    context.beginPath();
    context.moveTo(drawX[from], drawY[from]);
    for (let point = from + 1; point <= to; point += 1) context.lineTo(drawX[point], drawY[point]);
    context.stroke();
  };

  const strokeQuantized = (from, to, step = WIDTH_QUANTUM) => {
    let current = -1;
    for (let point = from + 1; point <= to; point += 1) {
      const quantum = Math.round(((drawWidth[point - 1] + drawWidth[point]) * 0.5) / step);
      if (quantum !== current) {
        if (current >= 0) context.stroke();
        current = quantum;
        context.lineWidth = quantum * step;
        context.beginPath();
        context.moveTo(drawX[point - 1], drawY[point - 1]);
      }
      context.lineTo(drawX[point], drawY[point]);
    }
    if (current >= 0) context.stroke();
  };

  const ribbonHolds = (from, to) => {
    for (let point = from + 1; point < to; point += 1) {
      const ax = drawX[point] - drawX[point - 1];
      const ay = drawY[point] - drawY[point - 1];
      const bx = drawX[point + 1] - drawX[point];
      const by = drawY[point + 1] - drawY[point];
      const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
      if (turn < 1e-3) continue;
      const reach = (Math.hypot(ax, ay) + Math.hypot(bx, by)) * 0.5;
      if (reach / turn < drawWidth[point] * 0.5 + 0.05) return false;
    }
    return true;
  };

  const fillRibbon = (from, to) => {
    for (let point = from; point <= to; point += 1) {
      const before = point > from ? point - 1 : point;
      const after = point < to ? point + 1 : point;
      const tx = drawX[after] - drawX[before];
      const ty = drawY[after] - drawY[before];
      const length = Math.hypot(tx, ty) || 1;
      normalX[point] = -ty / length;
      normalY[point] = tx / length;
    }
    context.beginPath();
    for (let point = from; point <= to; point += 1) {
      const half = drawWidth[point] * 0.5;
      const x = drawX[point] + normalX[point] * half;
      const y = drawY[point] + normalY[point] * half;
      if (point === from) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    const endAngle = Math.atan2(normalY[to], normalX[to]);
    context.arc(drawX[to], drawY[to], drawWidth[to] * 0.5, endAngle, endAngle - Math.PI, true);
    for (let point = to; point >= from; point -= 1) {
      const half = drawWidth[point] * 0.5;
      context.lineTo(drawX[point] - normalX[point] * half, drawY[point] - normalY[point] * half);
    }
    const startAngle = Math.atan2(-normalY[from], -normalX[from]);
    context.arc(drawX[from], drawY[from], drawWidth[from] * 0.5, startAngle, startAngle - Math.PI, true);
    context.closePath();
    context.fill();
  };

  const paintRun = (from, to, flat) => {
    if (to <= from) return;
    if (flat) strokeRun(from, to);
    else if (ribbonHolds(from, to)) fillRibbon(from, to);
    else strokeQuantized(from, to);
  };

  const strokeGathered = (count, alpha) => {
    context.globalAlpha = alpha;
    let start = -1;
    let flat = false;
    for (let point = 1; point < count; point += 1) {
      const segmentFlat = drawFlat[point - 1] === 1 && drawFlat[point] === 1;
      if (start < 0) {
        start = point - 1;
        flat = segmentFlat;
      } else if (segmentFlat !== flat) {
        paintRun(start, point - 1, flat);
        start = point - 1;
        flat = segmentFlat;
      }
    }
    if (start >= 0) paintRun(start, count - 1, flat);
    context.globalAlpha = 1;
  };

  const drawRestIcon = (icon, alpha) => {
    if (icon < 0 || alpha <= 0.001) return;
    fadeTrack.reset();
    appendIcon(fadeTrack, layout, icon);
    const count = gather(fadeTrack, 0, fadeTrack.length);
    drawWidth.fill(pen.width, 0, count);
    drawFlat.fill(1, 0, count);
    strokeGathered(count, alpha);
  };

  const emphasisStyle = (icon) => {
    const near = clamp(tug[icon], 0, 1) * NEAR_INK_SHARE;
    return emphasisStyles[Math.round(clamp(near + hoverLevel[icon] * HOVER_INK_SHARE, 0, 1) * EMPHASIS_STEPS)];
  };



  const traceStrand = (glyph, icon, amount, lift) => {
    const unpicked = amount * UNPICK_SHARE * glyph.length;
    const { xs, ys, cum, count } = glyph;
    let end = 1;
    while (end < count - 1 && cum[end] < unpicked) end += 1;
    const t = clamp((unpicked - cum[end - 1]) / (cum[end] - cum[end - 1] || 1), 0, 1);
    const anchorX = xs[end - 1] + (xs[end] - xs[end - 1]) * t;
    const anchorY = ys[end - 1] + (ys[end] - ys[end - 1]) * t + lift;
    const freeX = xs[0] + strandDrift[icon] * SNAG_DRIFT * amount;
    const freeY = ys[0] + lift + SNAG_DROP * amount;
    const pull = Math.sqrt(amount);
    for (let index = 0; index < end; index += 1) {
      const share = cum[index] / Math.max(unpicked, 1e-6);
      const x = xs[index] + (freeX + (anchorX - freeX) * share - xs[index]) * pull;
      const y = ys[index] + lift + (freeY + (anchorY - freeY) * share - ys[index] - lift) * pull;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineTo(anchorX, anchorY);
    return end - 1;
  };

  const drawGlyphs = () => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const glyph = glyphs[icon];
      if (glyph.keepCount < 2) continue;
      const lift = clamp(tug[icon], -0.2, 1) * TUG_PX;
      const amount = clamp(tug[icon], 0, 1);
      const scale = jolt.scale[icon];
      const offsetX = iconCenterX(icon) * (1 - scale) + jolt.x[icon];
      const offsetY = iconCenterY * (1 - scale) + jolt.y[icon];
      context.setTransform(state.scaleX * scale, 0, 0, state.scaleY * scale, state.scaleX * offsetX, state.scaleY * offsetY);
      context.strokeStyle = emphasisStyle(icon);
      context.lineWidth = (pen.rest + pen.hover * hoverLevel[icon]) / scale;
      context.beginPath();
      let from = 0;
      if (amount * UNPICK_SHARE * glyph.length >= 0.05) from = traceStrand(glyph, icon, amount, lift);
      else context.moveTo(glyph.xs[0], glyph.ys[0] + lift);
      for (let point = 0; point < glyph.keepCount; point += 1) {
        const index = glyph.keep[point];
        if (index > from) context.lineTo(glyph.xs[index], glyph.ys[index] + lift);
      }
      context.stroke();
    }
    context.setTransform(state.scaleX, 0, 0, state.scaleY, 0, 0);
  };

  const draw = () => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!layout.width || !state.visible) return;
    context.setTransform(state.scaleX, 0, 0, state.scaleY, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    drawGlyphs();
    context.strokeStyle = pen.style;
    context.fillStyle = pen.style;
    if (state.reduced) {
      if (state.fadeTo >= 0) {
        drawRestIcon(state.fadeFrom, 1 - state.fade);
        drawRestIcon(state.fadeTo, state.fade);
      } else drawRestIcon(state.goal, 1);
      return;
    }
    const length = state.head - state.tail;
    state.railMin = Infinity;
    state.railMax = -Infinity;
    if (length < 0.3) return;
    const count = gather(track, state.tail, state.head);
    for (let point = 0; point < count; point += 1) {
      const y = drawY[point];
      if (Math.abs(y - RAIL_Y) > 0.75 && Math.abs(y - LANE_Y) > 0.75) continue;
      if (drawX[point] < state.railMin) state.railMin = drawX[point];
      if (drawX[point] > state.railMax) state.railMax = drawX[point];
    }
    joltTrain(track, count);
    weighTrain(track, count, state.tail, state.head);
    strokeGathered(count, 1);
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

  const softX = (x) => {
    const low = BAR_PADDING + EDGE_INSET;
    const high = layout.width - BAR_PADDING - EDGE_INSET;
    if (x > high) return high + EDGE_REACH * (1 - Math.exp(-(x - high) / EDGE_REACH));
    if (x < low) return low - EDGE_REACH * (1 - Math.exp(-(low - x) / EDGE_REACH));
    return x;
  };

  const measureAnchor = () => {
    anchor.junction = clamp(track.junction, 0, track.length);
    anchor.junctionX = track.sample(anchor.junction, scratch).x;
    anchor.runX = track.sample(track.runFrom, scratch).x;
  };

  const fingerTarget = (x) => {
    const side = track.railDir;
    const finger = softX(x);
    const ahead = side * (finger - anchor.runX);
    if (ahead >= 0) return Math.min(track.runFrom + ahead, track.length);
    const into = side * (finger - anchor.junctionX);
    const span = side * (anchor.runX - anchor.junctionX);
    if (into <= 0 || span <= 0.5) return anchor.junction;
    return anchor.junction + (track.runFrom - anchor.junction) * Math.min(1, into / span);
  };

  const mirrorReach = (reach) => {
    const span = track.railDir * (anchor.runX - anchor.junctionX);
    const bend = track.runFrom - anchor.junction;
    if (span <= 0.5) return reach;
    return reach <= span ? (reach * bend) / span : bend + reach - span;
  };

  const retarget = (next, x, from) => {
    const step = next - state.dragTarget;
    const allowed = FINGER_SLOPE * Math.abs(x - from) + 0.01;
    if (Math.abs(step) > allowed) state.dragLag += step - Math.sign(step) * allowed;
    state.dragTarget = next;
  };

  const placeDrag = () => {
    const head = clamp(state.dragTarget - state.dragLag, 0, track.length);
    state.head = head;
    state.tail = clamp(head - state.dragLength - state.tailLag, 0, Math.max(0, head - 0.5));
  };

  const followFinger = () => {
    const x = state.dragX;
    if (track.railDir * (x - anchor.junctionX) < 0 && state.head < anchor.junction - 0.001) {
      branchFrom(anchor.junction, -track.railDir, false);
      measureAnchor();
      state.dragTarget = fingerTarget(x);
      state.dragLag = state.dragTarget - state.head;
    }
    const reach = track.railDir * (x - anchor.junctionX);
    if (reach >= 0) retarget(fingerTarget(x), x, state.dragFrom);
    else {
      const junction = anchor.junction;
      retarget(junction - mirrorReach(-reach), x, state.dragFrom);
      const passed = junction - (state.dragTarget - state.dragLag);
      if (passed >= 0) {
        branchFrom(junction, -track.railDir, false);
        measureAnchor();
        state.dragTarget = fingerTarget(x);
        state.dragLag = state.dragTarget - Math.min(junction + passed, state.dragTarget);
        state.dragLagVelocity = -state.dragLagVelocity;
      }
    }
    state.dragFrom = x;
    placeDrag();
  };

  const settleLag = (lag, velocity, h) => {
    const acceleration = -CATCH_OMEGA * CATCH_OMEGA * lag - 2 * CATCH_OMEGA * velocity;
    stepped.velocity = clamp(velocity + acceleration * h, -CATCH_SPEED, CATCH_SPEED);
    stepped.position = lag + stepped.velocity * h;
    if (Math.abs(stepped.position) < 0.05 && Math.abs(stepped.velocity) < 2) {
      stepped.position = 0;
      stepped.velocity = 0;
    }
    return stepped;
  };

  const dragStep = (dt, steps) => {
    const h = dt / steps;
    for (let step = 0; step < steps; step += 1) {
      settleLag(state.dragLag, state.dragLagVelocity, h);
      state.dragLag = stepped.position;
      state.dragLagVelocity = stepped.velocity;
      settleLag(state.tailLag, state.tailLagVelocity, h);
      state.tailLag = stepped.position;
      state.tailLagVelocity = stepped.velocity;
    }
    followFinger();
    const instant = (state.head - state.dragMark) / dt;
    state.dragMark = state.head;
    state.dragVelocity += (instant - state.dragVelocity) * 0.35;
    state.headVelocity = state.dragVelocity;
    state.tailVelocity = state.dragVelocity;
  };

  const integrate = (dt) => {
    if (state.tailDelay > 0) {
      state.tailDelay -= dt;
      if (state.tailDelay <= 0) {
        state.tailDelay = 0;
        state.goalTail = state.pendingTail;
      }
    }
    const headSpring = state.intro ? INTRO_HEAD_SPRING : HEAD_SPRING;
    const tailSpring = state.intro ? INTRO_TAIL_SPRING : TAIL_SPRING;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    const grip = 1 - Math.exp(-SEW_GRIP * h);
    const sewing = sewTarget();
    if (state.dragging) dragStep(dt, steps);
    for (let step = 0; step < steps; step += 1) {
      stepJolts(h);
      if (!state.dragging) {
        const wasShort = state.head < track.length - 0.01;
        const sewn = sewing >= 0 && state.head >= track.iconStart - SEW_APPROACH_PX && sewStep(sewing, h, grip);
        if (!sewn) {
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
          if (sewing >= 0 && wasShort) {
            state.scaleVelocity += LAND_PULSE;
            kickCinch(sewing, jolt.strength[sewing]);
          }
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
    const driftEase = 1 - Math.exp(-DRIFT_RATE * dt);
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      strandDrift[icon] += (track.railDir - strandDrift[icon]) * driftEase;
      const covered = coverage[icon] > 0 || icon === state.goal || icon === track.target || icon === state.origin;
      const center = layout.centers[icon];
      const gap = center < state.railMin ? state.railMin - center : center > state.railMax ? center - state.railMax : 0;
      const near = Number.isFinite(state.railMin) ? Math.exp(-((gap / TUG_REACH) * (gap / TUG_REACH))) : 0;
      const goal = covered || state.resting ? 0 : near;
      const acceleration = omega * omega * (goal - tug[icon]) - 2 * TUG_DAMPING_RATIO * omega * tugVelocity[icon];
      tugVelocity[icon] += acceleration * dt;
      tug[icon] += tugVelocity[icon] * dt;
    }
    if (contact.track === track && contact.version === track.version) noticeContact(contact.head, contact.tail, dt);
    contact.track = track;
    contact.version = track.version;
    contact.head = state.head;
    contact.tail = state.tail;
    easeHover(dt);
  };

  const noticeContact = (startHead, startTail, dt) => {
    const headSpeed = (state.head - startHead) / dt;
    if (!state.dragging && !track.stub && track.target >= 0 && startHead < track.iconStart && state.head >= track.iconStart) {
      kickArrival(track.target, headSpeed);
    }
    if (!state.dragging && track.source >= 0 && track.restEnd >= 0 && startHead > track.restEnd + 0.01 && state.head <= track.restEnd + 0.01) {
      kickCinch(track.source, joltStrength(headSpeed));
    }
    for (let span = 0; span < track.spanCount; span += 1) {
      const end = track.spanEnd[span];
      if (startTail < end && state.tail >= end) kickRelease(track.spanIcon[span], (state.tail - startTail) / dt);
    }
  };

  const easeHover = (dt) => {
    const ease = 1 - Math.exp(-dt / HOVER_SECONDS);
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      const goal = icon === state.hoverIcon ? 1 : 0;
      hoverLevel[icon] += (goal - hoverLevel[icon]) * ease;
      if (Math.abs(goal - hoverLevel[icon]) < 0.004) hoverLevel[icon] = goal;
    }
  };

  const hoverSettled = () => {
    for (let icon = 0; icon < TAB_COUNT; icon += 1) {
      if (hoverLevel[icon] !== (icon === state.hoverIcon ? 1 : 0)) return false;
    }
    return true;
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
    if (!joltsSettled()) return false;
    return hoverSettled();
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
    clearJolts();
    if (state.alignPending) {
      state.alignPending = false;
      relayout(layout.width, state.left);
      state.resting = false;
    }
    if (!state.resting) settleAt(state.goal);
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
      integrate(dt);
      if (isSettled()) {
        finishSettle();
        keepGoing = false;
      }
    }
    measure();
    writeLabels();
    draw();
    if (keepGoing) state.frame = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (state.frame || state.paused || !layout.width) return;
    state.lastTime = 0;
    state.frame = requestAnimationFrame(tick);
  };

  const renderStill = () => {
    measure();
    writeLabels();
    draw();
  };

  const resize = (width, left = state.left) => {
    if (width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    state.left = left;
    state.alignPending = false;
    relayout(width, left);
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
      renderStill();
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

  const align = (left) => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const drift = left * dpr - Math.round(left * dpr) - (state.left * dpr - Math.round(state.left * dpr));
    state.left = left;
    if (Math.abs(drift) < 1e-3 || !layout.width) return;
    if (state.introPending || state.reduced || (state.resting && !state.dragging)) {
      relayout(layout.width, left);
      if (!state.introPending) settleAt(state.goal);
      renderStill();
      wake();
      return;
    }
    state.alignPending = true;
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
    if (state.dragging) return;
    if (goal === state.goal && !release && state.resting) {
      state.scaleVelocity += 7;
      wake();
      return;
    }
    if (selection.active && selection.goal !== goal) holdSelection(goal);
    if (!release) state.contactShare = 1;
    const fromRest = state.resting && !release;
    if (goal !== state.goal && !release && state.resting) state.origin = state.goal;
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
      if (track.reversed && carried > 0) state.headVelocity = carried * FOLD_CARRY;
      state.goalHead = track.length;
      goalTail = track.iconStart;
    }
    state.goal = goal;
    state.intro = false;
    state.resting = false;
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

  const tabAt = (x) => {
    if (x === null || !layout.width) return -1;
    const inner = layout.width - BAR_PADDING * 2;
    if (inner <= 0 || x < BAR_PADDING || x > layout.width - BAR_PADDING) return -1;
    return clamp(Math.floor(((x - BAR_PADDING) / inner) * TAB_COUNT), 0, TAB_COUNT - 1);
  };

  const hover = (x) => {
    state.hoverIcon = tabAt(x);
    if (state.reduced) {
      for (let icon = 0; icon < TAB_COUNT; icon += 1) hoverLevel[icon] = icon === state.hoverIcon ? 1 : 0;
      if (!state.frame) renderStill();
      return;
    }
    wake();
  };

  const engageFlight = (x) => {
    const T = track;
    const H = state.head;
    const runEnd = T.stub ? T.length : T.c2s;
    if (T.descended && H <= T.junction + 0.01) {
      const junctionX = T.sample(T.junction, scratch).x;
      branchFrom(T.junction, x > junctionX ? 1 : x < junctionX ? -1 : T.railDir, false);
      return;
    }
    if (T.descended && H < runEnd - 0.01) {
      branchFrom(Math.max(H, T.c1e), T.railDir, true);
      return;
    }
    const headX = T.sample(H, scratch).x;
    rebuildToward(-1, x > headX ? 1 : x < headX ? -1 : T.railDir);
  };

  const dragBegin = (x) => {
    if (state.reduced || !layout.width || state.introPending) return false;
    if (state.resting) {
      state.origin = state.goal;
      const headX = track.sample(state.head, scratch).x;
      buildRest(track, state.goal, x >= headX ? 1 : -1, true);
      state.restLength = layout.iconLength[state.goal];
    } else engageFlight(x);
    state.dragLength = Math.max(1, state.restLength);
    state.restLengthGoal = state.dragLength;
    state.restLengthVelocity = 0;
    measureAnchor();
    state.dragX = x;
    state.dragFrom = x;
    state.dragTarget = fingerTarget(x);
    state.dragLag = state.dragTarget - state.head;
    state.dragLagVelocity = -state.headVelocity;
    state.tailLag = state.head - state.dragLength - state.tail;
    state.tailLagVelocity = state.headVelocity - state.tailVelocity;
    state.dragMark = state.head;
    state.dragVelocity = state.headVelocity;
    state.dragging = true;
    state.resting = false;
    state.intro = false;
    state.tailDelay = 0;
    selection.active = false;
    selection.base.set(labelLevel);
    selection.engage = Math.abs(state.dragLag) > 0.5 ? Math.abs(state.dragLag) : 0;
    followFinger();
    wake();
    return true;
  };

  const dragMove = (x) => {
    if (!state.dragging) return;
    state.dragX = x;
    followFinger();
    wake();
  };

  const dragEnd = () => {
    if (!state.dragging) return state.goal;
    const chosen = tabUnder(track.sample(state.head, scratch).x);
    state.dragging = false;
    state.dragLag = 0;
    state.dragLagVelocity = 0;
    state.tailLag = 0;
    state.tailLagVelocity = 0;
    state.headVelocity = state.dragVelocity;
    state.tailVelocity = state.dragVelocity;
    state.contactShare = RELEASE_FLOOR + (1 - RELEASE_FLOOR) * clamp(Math.abs(state.dragVelocity) / JOLT_FULL_SPEED, 0, 1);
    holdSelection(chosen);
    return chosen;
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
    clearJolts();
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
    align,
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
