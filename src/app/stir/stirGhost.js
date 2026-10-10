import * as P from "./stirParams";

function smooth(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random, from, to) {
  return from + (to - from) * random();
}

function reachFor(layout, scale = 1) {
  const base = Math.min(P.GHOST_MAX_PX, Math.max(P.GHOST_MIN_PX, Math.min(layout.gridW, layout.gridH) * P.GHOST_SHARE));
  return base * scale;
}

export function introMove(layout, eyeOf) {
  const eye = eyeOf(layout.gridW * P.GHOST_X, layout.gridH * P.GHOST_Y);
  return {
    kind: "whorl",
    seconds: P.GHOST_SECONDS,
    cx: eye.x,
    cy: eye.y,
    reach: reachFor(layout),
    turn: P.GHOST_TURN,
    startAngle: P.GHOST_START_ANGLE,
    dyeTail: P.GHOST_DYE_TAIL,
    dyeRamp: P.GHOST_DYE_RAMP,
  };
}

export function createGhostScript(seed) {
  const random = seeded(seed);
  let count = 0;

  function whorl(layout, eyeOf) {
    const eye = eyeOf(layout.gridW * between(random, P.DRIFT_EDGE, 1 - P.DRIFT_EDGE), layout.gridH * between(random, P.DRIFT_EDGE, 1 - P.DRIFT_EDGE));
    const spin = random() < 0.5 ? -1 : 1;
    return {
      kind: "whorl",
      seconds: P.DRIFT_WHORL_SECONDS,
      cx: eye.x,
      cy: eye.y,
      reach: reachFor(layout, between(random, P.DRIFT_REACH_MIN, P.DRIFT_REACH_MAX)),
      turn: spin * P.DRIFT_WHORL_TURN,
      startAngle: random() * Math.PI * 2,
      dyeTail: P.DRIFT_DYE_TAIL,
      dyeRamp: P.DRIFT_DYE_RAMP,
    };
  }

  function swipe(layout) {
    const { gridW, rows, cellH } = layout;
    const row = Math.min(rows - 1, Math.max(0, Math.floor(rows * between(random, P.DRIFT_EDGE, 1 - P.DRIFT_EDGE))));
    const y = (row + 0.5) * cellH;
    const from = gridW * between(random, P.DRIFT_SWIPE_FROM_MIN, P.DRIFT_SWIPE_FROM_MAX);
    const to = gridW * between(random, 1 - P.DRIFT_SWIPE_FROM_MAX, 1 - P.DRIFT_SWIPE_FROM_MIN);
    const leftward = random() < P.DRIFT_SWIPE_WITH_WEAVE;
    const distance = Math.abs(to - from);
    return {
      kind: "swipe",
      seconds: Math.min(P.DRIFT_SWIPE_MAX_SECONDS, Math.max(P.DRIFT_SWIPE_MIN_SECONDS, distance / P.DRIFT_SWIPE_SPEED)),
      x0: leftward ? to : from,
      x1: leftward ? from : to,
      y0: y,
      y1: y,
      bow: cellH * between(random, -P.DRIFT_SWIPE_BOW, P.DRIFT_SWIPE_BOW),
      dyeTail: P.DRIFT_DYE_TAIL,
      dyeRamp: P.DRIFT_DYE_RAMP,
    };
  }

  return {
    next(layout, eyeOf) {
      const move = count % 2 === 0 ? whorl(layout, eyeOf) : swipe(layout);
      count += 1;
      return move;
    },
  };
}

export function placeMove(move, age, out) {
  const progress = Math.min(1, age / move.seconds);
  if (move.kind === "whorl") {
    const eased = P.GHOST_LINEAR_SHARE * progress + (1 - P.GHOST_LINEAR_SHARE) * smooth(progress);
    const angle = move.startAngle + eased * move.turn;
    const radius = move.reach * (P.GHOST_OUTER - P.GHOST_INWARD * eased);
    out.x = move.cx + Math.cos(angle) * radius;
    out.y = move.cy + Math.sin(angle) * radius;
  } else {
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress);
    const arc = Math.sin(Math.PI * eased) * move.bow;
    out.x = move.x0 + (move.x1 - move.x0) * eased;
    out.y = move.y0 + (move.y1 - move.y0) * eased + arc;
  }
  return P.DYE_PER_SPLAT * 2 * (move.dyeTail + (1 - move.dyeTail) * smooth(progress / move.dyeRamp));
}
