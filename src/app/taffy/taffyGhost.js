export const GHOST_POINTER = "ghost";

const RESUME_MS = 4000;
const START_MS = 1600;
const SETTLE_MS = 900;
const BLOCKED_POLL_MS = 250;
const HOVER_MS = 220;
const BOND_HOVER_MS = 380;
const TAP_MS = 90;
const LINGER_MS = 280;
const FREE_HOLD_MS = 120;
const LOOSE_WAIT_MS = 500;
const TITLE_WAIT_MS = 4000;
const TITLE_POLL_MS = 100;
const GAP_MIN_MS = 550;
const GAP_SPAN_MS = 450;
const TITLE_GAP_MS = 900;
const FRAME_CAP_MS = 100;
const LATE_MS = 24;
const SNAP_HAND_LAG = 0.72;
const NECK_HAND_LAG = 0.14;
const SNAP_EXTENSIONS = 3;
const SNAP_EXTEND = 0.14;
const SNAP_EXTEND_MS = 260;
const BREATH = 0.035;
const RECENT = 3;
const SCRIPT = ["neck", "snap", "bond", "neck", "cut", "snap", "neck", "next"];
const WARMUP = [
  { strength: 0.4, slow: 1.4 },
  { strength: 0.58, slow: 1.18 },
];
const STILL = { x: 0, y: 0 };

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

function* pause(ms) {
  let t = 0;
  while (t < ms) t += yield ms - t;
}

function* until(test, ms, every = 0) {
  let t = 0;
  while (t < ms && !test()) t += yield every;
}

function* glide(hand, from, to, bend, ms, ease) {
  let t = 0;
  while (t < ms) {
    t += yield 0;
    if (hand.lost()) return false;
    const e = ease(Math.min(1, t / ms));
    const arc = Math.sin(Math.PI * e);
    hand.move(from.x + (to.x - from.x) * e + bend.x * arc, from.y + (to.y - from.y) * e + bend.y * arc);
  }
  return true;
}

function* breathe(hand, at, ux, uy, depth, ms) {
  let t = 0;
  while (t < ms) {
    t += yield 0;
    if (hand.lost()) return false;
    const swell = depth * Math.sin(Math.PI * Math.min(1, t / ms));
    hand.move(at.x + ux * swell, at.y + uy * swell);
  }
  return true;
}

function createHand(engine) {
  const event = { pointerId: GHOST_POINTER, pointerType: "mouse", button: 0, isPrimary: false, clientX: 0, clientY: 0, timeStamp: 0 };
  const hand = { x: 0, y: 0, now: 0, pressed: false, present: false };
  const aim = (x, y) => {
    hand.x = x;
    hand.y = y;
    engine.toClient(x, y, event);
    event.timeStamp = hand.now;
  };
  hand.move = (x, y) => {
    aim(x, y);
    hand.present = true;
    engine.pointerMove(event);
  };
  hand.down = (x, y) => {
    aim(x, y);
    hand.present = true;
    hand.pressed = true;
    return engine.pointerDown(event);
  };
  hand.up = (cancelled) => {
    if (!hand.pressed) return;
    aim(hand.x, hand.y);
    hand.pressed = false;
    engine.pointerUp(event, cancelled);
  };
  hand.leave = () => {
    if (!hand.present) return;
    hand.present = false;
    engine.pointerLeave();
  };
  hand.status = () => engine.ghostStatus(GHOST_POINTER);
  hand.lost = () => {
    if (!hand.pressed) return false;
    const status = hand.status();
    return status !== "held" && status !== "loose" && status !== "free" && status !== "press";
  };
  return hand;
}

const centreOf = (glyph) => ({ x: (glyph.left + glyph.right) / 2, y: (glyph.top + glyph.bottom) / 2 });

const inside = (scene, x, y, margin) => x >= margin && x <= scene.width - margin && y >= margin && y <= scene.height - margin;

function clearOf(scene, skip, x, y) {
  const pad = scene.F * 0.12;
  return scene.glyphs.every((glyph, i) => i === skip || x < glyph.left - pad || x > glyph.right + pad || y < glyph.top - pad || y > glyph.bottom + pad);
}

function pickGlyph(scene, rng, recent, avoid = -1) {
  const pool = [];
  scene.glyphs.forEach((glyph, i) => {
    if (glyph.resting && i !== avoid) pool.push(i);
  });
  if (!pool.length) return -1;
  const fresh = pool.filter((i) => !recent.includes(i));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rng() * from.length)];
}

function planPull(engine, scene, rng, g, snap, strength) {
  const glyph = scene.glyphs[g];
  const home = centreOf(glyph);
  const halfW = (glyph.right - glyph.left) / 2 + 6;
  const halfH = (glyph.bottom - glyph.top) / 2 + 6;
  const upward = scene.lines > 1 ? glyph.line < scene.lines - 1 : rng() < 0.3;
  const side = rng() < 0.5 ? -1 : 1;
  const tilt = 0.15 + rng() * 0.6;
  const tries = [
    [upward, tilt],
    [upward, -tilt],
    [upward, tilt * 0.3],
    [upward, tilt + 0.35],
    [upward, -tilt - 0.35],
    [!upward, tilt],
    [!upward, -tilt],
  ];
  for (const [up, lean] of tries) {
    const angle = (up ? -Math.PI / 2 : Math.PI / 2) + lean * side;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const need = engine.ghostReach(g, ux, uy, snap ? 1 : strength);
    if (!(need > 0)) continue;
    const reach = snap ? (need * (1.06 + rng() * 0.08)) / SNAP_HAND_LAG : need / (1 - NECK_HAND_LAG * strength * strength);
    const travel = snap ? reach * 0.92 : need;
    const glyphX = home.x + ux * travel;
    const glyphY = home.y + uy * travel;
    if (glyphX - halfW < 0 || glyphX + halfW > scene.width || glyphY - halfH < 0 || glyphY + halfH > scene.height) continue;
    const press = { x: glyph.inkX, y: glyph.inkY };
    const end = { x: press.x + ux * reach, y: press.y + uy * reach };
    if (!inside(scene, end.x, end.y, 4)) continue;
    const swing = reach * (0.05 + rng() * 0.08) * (rng() < 0.5 ? -1 : 1);
    const bend = { x: -uy * swing, y: ux * swing };
    let clear = true;
    for (let k = 3; k <= 8 && clear; k += 1) {
      const e = k / 8;
      const arc = Math.sin(Math.PI * e);
      clear = clearOf(scene, g, press.x + ux * reach * e + bend.x * arc, press.y + uy * reach * e + bend.y * arc);
    }
    if (!clear) continue;
    return { g, press, end, bend, ux, uy, reach, strength: snap ? 1 : strength, width: scene.width, height: scene.height };
  }
  return null;
}

function planBond(scene, rng, recent) {
  const { capH } = scene;
  const linked = (i, j) => scene.bonds.some((bond) => (bond.a === i && bond.b === j) || (bond.a === j && bond.b === i));
  const pairs = [];
  scene.glyphs.forEach((a, i) => {
    if (!a.resting) return;
    scene.glyphs.forEach((b, j) => {
      if (i === j || !b.resting || linked(i, j)) return;
      const distance = Math.hypot(b.inkX - a.inkX, b.inkY - a.inkY);
      if (distance < capH * 0.8 || distance > capH * 1.8) return;
      pairs.push({ i, j, wide: Math.abs(i - j) >= 2, fresh: !recent.includes(i) });
    });
  });
  if (!pairs.length) return null;
  const tiers = [pairs.filter((pair) => pair.wide && pair.fresh), pairs.filter((pair) => pair.fresh), pairs];
  const pool = tiers.find((tier) => tier.length);
  const { i, j } = pool[Math.floor(rng() * pool.length)];
  const a = scene.glyphs[i];
  const b = scene.glyphs[j];
  const dx = b.inkX - a.inkX;
  const dy = b.inkY - a.inkY;
  const length = Math.hypot(dx, dy) || 1;
  let px = dy / length;
  let py = -dx / length;
  if (py > 0) {
    px = -px;
    py = -py;
  }
  const lift = capH * (0.45 + rng() * 0.25);
  const bend = { x: px * lift, y: py * lift };
  if (!inside(scene, (a.inkX + b.inkX) / 2 + bend.x, (a.inkY + b.inkY) / 2 + bend.y, 4)) return null;
  return { g: i, target: j, press: { x: a.inkX, y: a.inkY }, end: { x: b.inkX, y: b.inkY }, bend };
}

function planCut(scene, rng) {
  const tappable = scene.bonds.filter((bond) => bond.tap);
  if (!tappable.length) return null;
  return tappable[Math.floor(rng() * tappable.length)].tap;
}

function planPaper(engine, scene, rng) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const glyph of scene.glyphs) {
    top = Math.min(top, glyph.top);
    bottom = Math.max(bottom, glyph.bottom);
  }
  const below = scene.height - bottom;
  const sides = below >= top ? [true, false] : [false, true];
  for (const under of sides) {
    for (let k = 0; k < 4; k += 1) {
      const x = scene.width * (0.2 + rng() * 0.6);
      const y = under ? bottom + below * (0.45 + rng() * 0.3) : top * (0.3 + rng() * 0.4);
      if (engine.ghostProbe(x, y) === "paper") return { x, y };
    }
  }
  return null;
}

function* neck(hand, plan, slow, rng) {
  hand.move(plan.press.x, plan.press.y);
  yield* pause(HOVER_MS * slow);
  if (hand.down(plan.press.x, plan.press.y) !== "grab") return;
  const ms = (700 + plan.strength * 500 + rng() * 220) * slow;
  if (!(yield* glide(hand, plan.press, plan.end, plan.bend, ms, easeInOutSine))) return;
  if (!(yield* breathe(hand, plan.end, plan.ux, plan.uy, plan.reach * BREATH, (200 + rng() * 260) * slow))) return;
  hand.up(true);
  yield* pause(LINGER_MS);
  hand.leave();
}

function* snap(hand, plan, rng) {
  hand.move(plan.press.x, plan.press.y);
  yield* pause(HOVER_MS);
  if (hand.down(plan.press.x, plan.press.y) !== "grab") return;
  if (!(yield* glide(hand, plan.press, plan.end, plan.bend, 950 + rng() * 300, easeInOutSine))) return;
  let from = plan.end;
  for (let k = 0; k < SNAP_EXTENSIONS && hand.status() === "held"; k += 1) {
    const to = { x: from.x + plan.ux * plan.reach * SNAP_EXTEND, y: from.y + plan.uy * plan.reach * SNAP_EXTEND };
    if (!inside(plan, to.x, to.y, 2)) break;
    if (!(yield* glide(hand, from, to, STILL, SNAP_EXTEND_MS, easeInOutSine))) return;
    from = to;
  }
  yield* until(() => hand.status() !== "loose", LOOSE_WAIT_MS);
  if (hand.status() === "free") yield* pause(FREE_HOLD_MS);
  hand.up(true);
  yield* pause(LINGER_MS);
  hand.leave();
}

function* bond(hand, plan, rng) {
  hand.move(plan.press.x, plan.press.y);
  yield* pause(HOVER_MS);
  if (hand.down(plan.press.x, plan.press.y) !== "grab") return;
  if (!(yield* glide(hand, plan.press, plan.end, plan.bend, 1000 + rng() * 300, easeInOutSine))) return;
  yield* pause(320);
  hand.up(false);
  yield* pause(LINGER_MS + 80);
  hand.leave();
}

function* cut(hand, tap) {
  hand.move(tap.x, tap.y);
  yield* pause(BOND_HOVER_MS);
  const outcome = hand.down(tap.x, tap.y);
  yield* pause(TAP_MS);
  hand.up(outcome !== "press");
  yield* pause(LINGER_MS);
  hand.leave();
}

function* turn(hand, spot, engine) {
  const before = engine.ghostWord();
  hand.move(spot.x, spot.y);
  yield* pause(HOVER_MS);
  hand.down(spot.x, spot.y);
  yield* pause(TAP_MS);
  hand.up(false);
  hand.leave();
  yield* until(() => engine.ghostWord() !== before, TITLE_WAIT_MS, TITLE_POLL_MS);
}

export function createGhostConductor({ engine, seed = 1 }) {
  const rng = sequence(seed);
  const hand = createHand(engine);
  let clock = 0;
  let lastNow = null;
  let nextAt = START_MS;
  let resumeAt = 0;
  let gesture = null;
  let gap = 0;
  let beat = 0;
  let warm = 0;
  let blocked = false;
  let word = null;
  let recent = [];
  let played = null;

  const sync = (now) => {
    let dt = 0;
    if (lastNow !== null) {
      dt = Math.max(0, now - lastNow);
      if (gesture) dt = Math.min(dt, FRAME_CAP_MS);
    }
    lastNow = now;
    hand.now = now;
    clock += dt;
    return dt;
  };

  const remember = (g) => {
    recent.push(g);
    if (recent.length > RECENT) recent.shift();
  };

  const release = () => {
    if (hand.pressed) hand.up(true);
    hand.leave();
  };

  const necking = (scene, strength, slow) => {
    let avoid = -1;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const g = pickGlyph(scene, rng, recent, avoid);
      if (g < 0) return null;
      const plan = planPull(engine, scene, rng, g, false, strength) || planPull(engine, scene, rng, g, false, strength * 0.7);
      if (plan) {
        remember(g);
        played = "neck";
        return neck(hand, plan, slow, rng);
      }
      avoid = g;
    }
    return null;
  };

  const strength = () => 0.45 + rng() * 0.3;

  const compose = (kind, scene) => {
    gap = GAP_MIN_MS + rng() * GAP_SPAN_MS;
    if (kind === "snap") {
      const g = pickGlyph(scene, rng, recent);
      const plan = g >= 0 ? planPull(engine, scene, rng, g, true, 1) : null;
      if (!plan) return necking(scene, 0.7, 1);
      remember(g);
      played = "snap";
      return snap(hand, plan, rng);
    }
    if (kind === "bond" && scene.bonds.length < 2) {
      const plan = planBond(scene, rng, recent);
      if (!plan) return necking(scene, strength(), 1);
      remember(plan.g);
      played = "bond";
      return bond(hand, plan, rng);
    }
    if (kind === "cut" || kind === "bond") {
      const tap = planCut(scene, rng);
      if (!tap) return necking(scene, strength(), 1);
      played = "cut";
      return cut(hand, tap);
    }
    if (kind === "next") {
      const spot = planPaper(engine, scene, rng);
      if (!spot) return necking(scene, strength(), 1);
      gap = TITLE_GAP_MS;
      played = "next";
      return turn(hand, spot, engine);
    }
    return necking(scene, strength(), 1);
  };

  const begin = () => {
    const scene = engine.ghostScene();
    if (!scene || !scene.glyphs.length || !(scene.width > 0) || !(scene.height > 0)) return null;
    if (scene.word !== word) {
      word = scene.word;
      recent = [];
    }
    if (warm < WARMUP.length) {
      gap = GAP_MIN_MS + rng() * GAP_SPAN_MS;
      const { strength: gentle, slow } = WARMUP[warm];
      const warming = necking(scene, gentle, slow);
      if (warming) warm += 1;
      return warming;
    }
    const kind = SCRIPT[beat % SCRIPT.length];
    beat += 1;
    return compose(kind, scene);
  };

  const finish = () => {
    gesture = null;
    release();
    nextAt = clock + gap;
  };

  return {
    tick(now) {
      const dt = sync(now);
      if (gesture) {
        const step = gesture.next(dt);
        if (!step.done) return step.value;
        finish();
      }
      if (clock < resumeAt) return resumeAt - clock;
      if (clock < nextAt) return nextAt - clock;
      const status = engine.ghostStatus(GHOST_POINTER);
      if (status !== "idle") {
        if (status !== "blocked") release();
        blocked = true;
        return BLOCKED_POLL_MS;
      }
      if (blocked) {
        blocked = false;
        nextAt = clock + SETTLE_MS;
        return SETTLE_MS;
      }
      played = null;
      gesture = begin();
      if (!gesture) {
        nextAt = clock + BLOCKED_POLL_MS * 2;
        return BLOCKED_POLL_MS * 2;
      }
      const first = gesture.next();
      if (!first.done) return first.value;
      finish();
      return Math.max(0, nextAt - clock);
    },
    interrupt(now) {
      sync(now);
      if (gesture) {
        gesture.return();
        gesture = null;
      }
      release();
      resumeAt = clock + RESUME_MS;
      blocked = false;
      warm = 0;
    },
    sleep() {
      lastNow = null;
    },
    get playing() {
      return gesture ? played : null;
    },
    get hand() {
      return hand;
    },
  };
}

export function createTaffyGhost({ engine, host, keyTarget, reducedMotion = false, seed = 1 }) {
  let disposed = false;
  let enabled = !reducedMotion;
  let visible = !document.hidden;
  let onscreen = true;
  let frame = 0;
  let timer = 0;

  const restore = (name, value) => {
    if (host.dataset[name] === value) return;
    if (value === undefined) delete host.dataset[name];
    else host.dataset[name] = value;
  };

  const quietly = (call) => (...args) => {
    const hover = host.dataset.hover;
    const grabbing = host.dataset.grabbing;
    const result = call(...args);
    restore("hover", hover);
    restore("grabbing", grabbing);
    return result;
  };

  const surface = {
    toClient: engine.toClient,
    ghostWord: engine.ghostWord,
    ghostStatus: engine.ghostStatus,
    ghostProbe: engine.ghostProbe,
    ghostReach: engine.ghostReach,
    ghostScene: engine.ghostScene,
    pointerDown: quietly(engine.pointerDown),
    pointerMove: quietly(engine.pointerMove),
    pointerUp: quietly(engine.pointerUp),
    pointerLeave: quietly(engine.pointerLeave),
  };

  const conductor = createGhostConductor({ engine: surface, seed });

  const live = () => !disposed && enabled && visible && onscreen;

  const cancel = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  function run(now) {
    frame = 0;
    if (!live()) return;
    schedule(conductor.tick(now));
  }

  function schedule(wait) {
    cancel();
    if (!live()) {
      conductor.sleep();
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

  const seen = { x: NaN, y: NaN };

  const handleInput = (event) => {
    if (disposed) return;
    if (event.type === "pointermove") {
      const still = event.clientX === seen.x && event.clientY === seen.y;
      seen.x = event.clientX;
      seen.y = event.clientY;
      if (still) return;
    }
    conductor.interrupt(performance.now());
  };

  const handleVisibility = () => {
    visible = !document.hidden;
    schedule(0);
  };

  const observer = new IntersectionObserver((entries) => {
    onscreen = entries[entries.length - 1]?.isIntersecting ?? true;
    schedule(0);
  });
  observer.observe(host);

  const hostEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "focusin", "keydown"];
  for (const name of hostEvents) host.addEventListener(name, handleInput, true);
  const separateKeys = keyTarget && keyTarget !== host;
  if (separateKeys) keyTarget.addEventListener("keydown", handleInput, true);
  document.addEventListener("visibilitychange", handleVisibility);

  schedule(0);

  return {
    setReducedMotion(value) {
      enabled = !value;
      if (!enabled) conductor.interrupt(performance.now());
      schedule(0);
    },
    dispose() {
      disposed = true;
      cancel();
      observer.disconnect();
      for (const name of hostEvents) host.removeEventListener(name, handleInput, true);
      if (separateKeys) keyTarget.removeEventListener("keydown", handleInput, true);
      document.removeEventListener("visibilitychange", handleVisibility);
    },
  };
}
