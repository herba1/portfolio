import {
  CALM_TAU,
  LANE_CELLS,
  LANE_GRIP,
  LANE_GRIP_CEILING,
  LANE_MAX_CELLS,
  LOOM_COUPLING,
  LOOM_DRAG,
  LOOM_STEP_SECONDS,
  LOOM_VISCOSITY,
  WEAVE_FIRST_SECONDS,
  WEAVE_GRIP,
  WEAVE_HOLD_SECONDS,
  WEAVE_LEAD_STEP,
  WEAVE_LEAD_SWAY,
  WEAVE_PEAK_CELLS,
  WEAVE_PULL_SECONDS,
  WEAVE_RELEASE_SECONDS,
  WEAVE_REST_SECONDS,
  WEAVE_TAKE_SHARE,
} from "./stirParams";

const WEAVE_PERIOD = WEAVE_PULL_SECONDS + WEAVE_HOLD_SECONDS + WEAVE_RELEASE_SECONDS + WEAVE_REST_SECONDS;
const LET_GO_AT = WEAVE_PULL_SECONDS + WEAVE_HOLD_SECONDS;

function wrap(value, span) {
  const turned = value % span;
  return turned < 0 ? turned + span : turned;
}

function smooth(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export function createLanes(lengths, cellW, startX) {
  const rows = lengths.length;
  const velocity = new Float32Array(rows);
  const offset = new Float64Array(rows);
  const span = new Float64Array(rows);
  const shear = new Float64Array(rows);
  const slip = new Float64Array(rows);
  const push = new Float64Array(rows);
  const drawn = new Float64Array(rows);
  const pack = new Float32Array(rows * 2);
  const cap = LANE_MAX_CELLS * cellW;
  const cruise = -LANE_CELLS * cellW;
  const pullPeak = -WEAVE_PEAK_CELLS * cellW;
  const centre = (rows - 1) / 2;
  const hand = { lead: -1, target: 0, grip: 0 };
  const weave = { clock: -WEAVE_FIRST_SECONDS };

  for (let row = 0; row < rows; row += 1) {
    span[row] = lengths[row] * cellW;
    offset[row] = wrap(-startX, span[row]);
  }

  function leadOf(stroke) {
    const row = Math.round(centre + centre * WEAVE_LEAD_SWAY * Math.sin(stroke * WEAVE_LEAD_STEP));
    return row < 0 ? 0 : row > rows - 1 ? rows - 1 : row;
  }

  function placeHand(strength) {
    hand.lead = -1;
    if (weave.clock < 0 || strength <= 0) return;
    const stroke = Math.floor(weave.clock / WEAVE_PERIOD);
    const phase = weave.clock - stroke * WEAVE_PERIOD;
    const taking = smooth(phase / (WEAVE_PULL_SECONDS * WEAVE_TAKE_SHARE));
    const letting = 1 - smooth((phase - LET_GO_AT) / WEAVE_RELEASE_SECONDS);
    const grip = WEAVE_GRIP * strength * taking * letting;
    if (grip <= 0) return;
    const along = phase < WEAVE_PULL_SECONDS ? Math.sin((Math.PI * phase) / WEAVE_PULL_SECONDS) : 0;
    hand.lead = leadOf(stroke);
    hand.target = pullPeak * along * along;
    hand.grip = grip;
  }

  function settleShear() {
    let sum = 0;
    for (let row = 0; row < rows; row += 1) sum += shear[row];
    const mean = sum / rows;
    for (let row = 0; row < rows; row += 1) shear[row] -= mean;
  }

  function steer(dt, wake, flow, calming) {
    const steps = Math.max(1, Math.ceil(dt / LOOM_STEP_SECONDS));
    const h = dt / steps;
    const base = cruise * wake;
    const drag = calming ? Math.max(LOOM_DRAG, 1 / CALM_TAU) : LOOM_DRAG;
    const forget = calming ? Math.exp(-h / CALM_TAU) : 1;
    const gripping = flow && !calming;
    drawn.fill(0);
    for (let step = 0; step < steps; step += 1) {
      weave.clock += h;
      placeHand(wake);
      for (let row = 0; row < rows; row += 1) {
        const above = row > 0 ? row - 1 : row;
        const below = row < rows - 1 ? row + 1 : row;
        let force =
          LOOM_COUPLING * (shear[above] + shear[below] - 2 * shear[row]) +
          LOOM_VISCOSITY * (slip[above] + slip[below] - 2 * slip[row]) -
          drag * slip[row];
        if (row === hand.lead) force += hand.grip * (hand.target - slip[row]);
        if (gripping) {
          const grip = Math.min(LANE_GRIP_CEILING, flow.rowWeight[row] * LANE_GRIP);
          if (grip > 1e-5) force += grip * (cap * Math.tanh(flow.rowFlow[row] / cap) - base - slip[row]);
        }
        push[row] = force;
      }
      for (let row = 0; row < rows; row += 1) {
        slip[row] += push[row] * h;
        shear[row] = (shear[row] + slip[row] * h) * forget;
        drawn[row] += (base + slip[row]) * h;
      }
    }
    settleShear();
    const inverse = 1 / dt;
    for (let row = 0; row < rows; row += 1) velocity[row] = drawn[row] * inverse;
  }

  function adopt(previous) {
    if (!previous || previous.cellW !== cellW) return;
    weave.clock = previous.weave.clock;
    const shared = Math.min(rows, previous.rows);
    for (let row = 0; row < shared; row += 1) {
      if (previous.lengths[row] !== lengths[row]) continue;
      offset[row] = previous.offset[row];
      velocity[row] = previous.velocity[row];
      shear[row] = previous.shear[row];
      slip[row] = previous.slip[row];
    }
    settleShear();
  }

  function halt() {
    velocity.fill(0);
    slip.fill(0);
    drawn.fill(0);
  }

  function advance() {
    let moving = false;
    for (let row = 0; row < rows; row += 1) {
      const step = drawn[row];
      if (step === 0) continue;
      offset[row] = wrap(offset[row] - step, span[row]);
      drawn[row] = 0;
      moving = true;
    }
    return moving;
  }

  function columnAt(row, x) {
    const cell = Math.floor((x + offset[row]) / cellW);
    const length = lengths[row];
    const column = cell % length;
    return column < 0 ? column + length : column;
  }

  function packFor(dpr) {
    for (let row = 0, at = 0; row < rows; row += 1, at += 2) {
      pack[at] = offset[row] * dpr;
      pack[at + 1] = lengths[row];
    }
    return pack;
  }

  return { rows, cellW, lengths, offset, velocity, shear, slip, weave, adopt, steer, halt, advance, columnAt, packFor };
}
