const RESUME_MS = 4000;
const START_MS = 1400;
const GAP_MIN_MS = 700;
const GAP_SPAN_MS = 700;
const SHEET_PAUSE_MS = 1400;
const POLL_MS = 250;
const FRAME_CAP_MS = 100;
const LATE_MS = 24;
const MIN_GESTURE_MS = 1600;
const MAX_GESTURE_MS = 3400;
const LENGTH_SAMPLES = 48;
const EDGE = 0.035;
const HOLD_DRIFT = 0.004;
const SCRIPT = ["hold", "corner", "sweep", "tongue", "hold", "sweep", "corner", "tongue"];
const SPEED = { corner: 0.16, sweep: 0.26, tongue: 0.2 };

function sequence(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOutSine = (t) => (1 - Math.cos(Math.PI * t)) / 2;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function cornerPath(rng, cut) {
  const left = rng() < 0.5;
  const radius = 0.24 + ((cut * 0.09) % 0.36) + rng() * 0.06;
  const bulge = (rng() - 0.5) * 0.12;
  const corner = left ? 0 : 1;
  const side = left ? 1 : -1;
  const overshoot = EDGE / radius;
  return (t) => {
    const angle = Math.PI / 2 + overshoot - (Math.PI / 2 + overshoot * 2) * t;
    const reach = radius * (1 + bulge * Math.sin(Math.PI * t));
    return { u: corner + side * Math.cos(angle) * reach, v: Math.sin(angle) * reach };
  };
}

function sweepPath(rng, cut) {
  const height = clamp(0.16 + ((cut * 0.17) % 0.62) + (rng() - 0.5) * 0.06, 0.12, 0.84);
  const tilt = (rng() - 0.5) * 0.16;
  const wave = 0.025 + rng() * 0.035;
  const phase = rng();
  const forward = rng() < 0.5;
  return (t) => {
    const s = forward ? t : 1 - t;
    return {
      u: -EDGE + (1 + EDGE * 2) * s,
      v: height + tilt * (s - 0.5) + wave * Math.sin(Math.PI * 2 * (s * 1.2 + phase)),
    };
  };
}

function tonguePath(rng, cut) {
  const width = 0.18 + rng() * 0.14;
  const start = 0.08 + rng() * (0.84 - width);
  const height = 0.24 + ((cut * 0.11) % 0.44) + rng() * 0.08;
  const lean = (rng() - 0.5) * 0.1;
  const forward = rng() < 0.5;
  return (t) => {
    const s = forward ? t : 1 - t;
    const arch = Math.sin(Math.PI * s);
    return { u: start + width * s + lean * arch, v: -EDGE + (height + EDGE) * arch };
  };
}

function holdPath(rng, spot) {
  const turns = 0.6 + rng() * 0.8;
  const phase = rng() * Math.PI * 2;
  return (t) => ({
    u: spot.u + HOLD_DRIFT * Math.cos(phase + Math.PI * 2 * turns * t),
    v: spot.v + HOLD_DRIFT * Math.sin(phase + Math.PI * 2 * turns * t),
  });
}

function lengthOf(path) {
  let length = 0;
  let previous = path(0);
  for (let index = 1; index <= LENGTH_SAMPLES; index += 1) {
    const point = path(index / LENGTH_SAMPLES);
    length += Math.hypot(point.u - previous.u, point.v - previous.v);
    previous = point;
  }
  return length;
}

export function createScorchGhost({ engine, host, keyTarget, reducedMotion = false, seed = 7 }) {
  const rng = sequence(seed);
  let disposed = false;
  let enabled = !reducedMotion;
  let active = false;
  let frame = 0;
  let timer = 0;
  let clock = 0;
  let lastNow = null;
  let readyAt = null;
  let nextAt = 0;
  let resumeAt = 0;
  let beat = 0;
  let cut = 0;
  let count = 0;
  let gesture = null;

  const live = () => !disposed && enabled && active;

  const sync = (now) => {
    const dt = lastNow === null ? 0 : Math.min(FRAME_CAP_MS, Math.max(0, now - lastNow));
    lastNow = now;
    clock += dt;
    return dt;
  };

  const compose = () => {
    const kind = SCRIPT[beat % SCRIPT.length];
    beat += 1;
    count += 1;
    const id = `ghost-${count}`;
    if (kind === "hold") {
      const spot = engine.darkestSpot();
      return { id, path: holdPath(rng, spot), duration: 1500 + rng() * 800, elapsed: 0, still: true, last: null };
    }
    let path;
    if (kind === "corner") path = cornerPath(rng, cut);
    else if (kind === "sweep") path = sweepPath(rng, cut);
    else path = tonguePath(rng, cut);
    cut += 1;
    const duration = clamp((lengthOf(path) / SPEED[kind]) * 1000, MIN_GESTURE_MS, MAX_GESTURE_MS);
    return { id, path, duration, elapsed: 0, still: false, last: null };
  };

  const end = (gap) => {
    if (gesture) {
      engine.flameOut(gesture.id);
      if (!gesture.still) engine.calm();
    }
    gesture = null;
    nextAt = clock + gap;
  };

  const advance = (dt) => {
    gesture.elapsed += dt;
    const progress = Math.min(1, gesture.elapsed / gesture.duration);
    const point = gesture.path(easeInOutSine(progress));
    engine.flame(gesture.id, point.u, point.v);
    if (!gesture.still && gesture.last && dt > 0) {
      const seconds = dt / 1000;
      engine.blow(point.u, point.v, (point.u - gesture.last.u) / seconds, (point.v - gesture.last.v) / seconds);
    }
    gesture.last = point;
    if (progress >= 1) end(GAP_MIN_MS + rng() * GAP_SPAN_MS);
  };

  const tick = (now) => {
    const dt = sync(now);
    if (gesture) {
      advance(dt);
      return gesture ? 0 : Math.max(0, nextAt - clock);
    }
    if (clock < resumeAt) return resumeAt - clock;
    if (!engine.isReady()) {
      readyAt = null;
      return POLL_MS;
    }
    if (readyAt === null) {
      readyAt = clock;
      nextAt = Math.max(nextAt, clock + START_MS);
    }
    if (clock < nextAt) return nextAt - clock;
    gesture = compose();
    advance(0);
    return 0;
  };

  const cancel = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  function run(now) {
    frame = 0;
    if (!live()) return;
    schedule(tick(now));
  }

  function schedule(wait) {
    cancel();
    if (!live()) {
      lastNow = null;
      return;
    }
    if (wait <= LATE_MS) {
      frame = requestAnimationFrame(run);
      return;
    }
    timer = window.setTimeout(() => {
      timer = 0;
      frame = requestAnimationFrame(run);
    }, wait - LATE_MS);
  }

  const interrupt = () => {
    if (live()) sync(performance.now());
    if (gesture) end(0);
    resumeAt = clock + RESUME_MS;
    schedule(resumeAt - clock);
  };

  const seen = { x: NaN, y: NaN };

  const handleInput = (event) => {
    if (disposed) return;
    if (event.type === "pointermove") {
      const still = event.clientX === seen.x && event.clientY === seen.y;
      seen.x = event.clientX;
      seen.y = event.clientY;
      if (still) return;
    }
    interrupt();
  };

  const hostEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "focusin", "keydown"];
  for (const name of hostEvents) host.addEventListener(name, handleInput, true);
  const separateKeys = keyTarget && keyTarget !== host;
  if (separateKeys) keyTarget.addEventListener("keydown", handleInput, true);

  return {
    setActive(next) {
      if (active === next) return;
      active = next;
      schedule(0);
    },
    setReducedMotion(value) {
      enabled = !value;
      if (!enabled && gesture) end(0);
      schedule(0);
    },
    sheet() {
      cut = 0;
      if (gesture) end(SHEET_PAUSE_MS);
      else nextAt = Math.max(nextAt, clock + SHEET_PAUSE_MS);
    },
    dispose() {
      if (gesture) end(0);
      disposed = true;
      cancel();
      for (const name of hostEvents) host.removeEventListener(name, handleInput, true);
      if (separateKeys) keyTarget.removeEventListener("keydown", handleInput, true);
    },
  };
}
