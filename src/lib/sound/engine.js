// One audio context for every piece on a page, and one bus they all play
// through: a touch of shared room so the pieces sit in the same space, a low
// cut and a gentle top shelf so nothing is boomy or fizzy on laptop
// speakers, and a fast limiter so twenty clicks at once never clip. Each
// piece takes a client: its own on/off, its own level, its own banks of
// pre-rendered takes.
//
// Takes are rendered from synth.js in a worker (render.worker.js), as soon
// as a piece makes its banks — before any gesture, and never on the main
// thread, so turning sound on or starting a drag never costs a frame. They
// play as buffers: one source and one gain per hit, no filters to build and
// tear down. A take that has not arrived yet is skipped rather than rendered
// on the spot.

import { soundAllowed } from "./desktopOnly.js";
import { gateToTile, markShared, ownerTile } from "./tileGate.js";
import { rng, roomImpulseData } from "./synth.js";

export { seamless } from "./synth.js";

const RATE = 48000;
const SUSPEND_AFTER_MS = 1500;
// A context left running with nothing playing still keeps the device's audio
// hardware awake. After this long without a hit or a loop it sleeps, and the
// next sound wakes it.
const IDLE_SLEEP_MS = 20000;
// A sound asked for while the context is still waking (the first tap, or
// the first after a sleep) plays once it is up, if it is not stale by then.
const WAKE_GRACE_MS = 300;

let shared = null;
let worker = null;
let workerFailed = false;
let nextJob = 1;
const waiting = new Map();

function renderer() {
  if (worker || workerFailed || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./render.worker.js", import.meta.url), { type: "module" });
  } catch {
    workerFailed = true;
    return null;
  }
  worker.onmessage = ({ data }) => {
    const job = waiting.get(data.id);
    if (!job) return;
    waiting.delete(data.id);
    if (data.out) job.resolve(data.out);
    else job.reject(new Error(data.error || "render failed"));
  };
  worker.onerror = () => {
    // The worker could not load: fall back to idle rendering for everything
    // still waiting.
    workerFailed = true;
    worker = null;
    for (const job of waiting.values()) job.reject(new Error("worker failed"));
    waiting.clear();
  };
  return worker;
}

function remote(message) {
  const w = renderer();
  if (!w) return Promise.reject(new Error("no worker"));
  const id = nextJob;
  nextJob += 1;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, ...message });
  });
}

const idle = (fn) =>
  typeof window !== "undefined" && window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(() => fn(null), 50);

function bus() {
  if (shared) return shared;
  if (!soundAllowed()) return null;
  const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;
  let ctx;
  try {
    ctx = new Ctx({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  markShared(ctx);
  const input = ctx.createGain();
  input.gain.value = 1;
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = "highpass";
  lowCut.frequency.value = 60;
  lowCut.Q.value = 0.6;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 8000;
  shelf.gain.value = -3;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 2;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  input.connect(lowCut);
  lowCut.connect(shelf);
  shelf.connect(limiter);
  limiter.connect(ctx.destination);
  const room = ctx.createConvolver();
  const roomOut = ctx.createGain();
  room.connect(roomOut);
  roomOut.connect(lowCut);
  shared = { ctx, input, room, clients: new Set(), idle: 0, sleep: 0, lastActive: performance.now(), loops: 0, waking: null, pending: [] };
  // The room is filled off the main thread too; until it lands the dry
  // sound plays alone.
  const fill = (channels) => {
    const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate);
    channels.forEach((data, c) => buffer.getChannelData(c).set(data));
    room.buffer = buffer;
  };
  remote({ room: true, sr: ctx.sampleRate })
    .then(fill)
    .catch(() => idle(() => fill(roomImpulseData(ctx.sampleRate))));
  ctx.onstatechange = () => {
    if (ctx.state === "running") flushPending();
  };
  return shared;
}

function touch() {
  if (shared) shared.lastActive = performance.now();
}

function scheduleSleep() {
  if (!shared || shared.sleep) return;
  shared.sleep = setInterval(() => {
    const { ctx } = shared;
    if (ctx.state !== "running") return;
    if (shared.loops > 0 || performance.now() - shared.lastActive < IDLE_SLEEP_MS) return;
    ctx.suspend().catch(() => {});
  }, 5000);
}

function wake() {
  if (!shared) return null;
  const { ctx } = shared;
  if (ctx.state === "running") return null;
  if (ctx.state === "closed") return null;
  // "suspended", or Safari's "interrupted" after a call or a lock.
  if (!shared.waking) {
    shared.waking = ctx
      .resume()
      .catch(() => {})
      .finally(() => {
        shared.waking = null;
        flushPending();
      });
  }
  return shared.waking;
}

function flushPending() {
  if (!shared || shared.ctx.state !== "running") return;
  const now = performance.now();
  const list = shared.pending.splice(0);
  for (const job of list) if (now - job.at < WAKE_GRACE_MS) job.run();
}

function wantRunning() {
  if (!shared) return;
  clearTimeout(shared.idle);
  const anyOn = [...shared.clients].some((client) => client.on);
  if (anyOn) {
    touch();
    wake();
    scheduleSleep();
    return;
  }
  // Nothing wants sound: let the device sleep, a moment later so a toggle
  // straight back on does not stutter.
  shared.idle = setTimeout(() => {
    if (![...shared.clients].some((client) => client.on) && shared.ctx.state === "running") shared.ctx.suspend().catch(() => {});
  }, SUSPEND_AFTER_MS);
}

export const db = (value) => Math.pow(10, value / 20);

// Building an AudioContext takes tens of milliseconds. Once the page has had
// any gesture (so the browser lets a context start), build it in an idle
// slot, so the gesture that turns a piece's sound on does not pay for it.
let warming = false;
function warm() {
  if (warming || shared || typeof window === "undefined") return;
  warming = true;
  const build = () => idle(() => bus());
  if (navigator.userActivation?.hasBeenActive) build();
  else {
    const first = () => {
      window.removeEventListener("pointerdown", first, true);
      window.removeEventListener("keydown", first, true);
      build();
    };
    window.addEventListener("pointerdown", first, true);
    window.addEventListener("keydown", first, true);
  }
}

const toBuffer = (ctx, data) => {
  const buffer = ctx.createBuffer(1, data.length, RATE);
  buffer.getChannelData(0).set(data);
  return buffer;
};

// Hold a ramping param where it is now and head for `value`, without the
// jump back that cancelScheduledValues makes in the middle of a ramp.
function glide(param, value, t, tau) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    const now = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(now, t);
  }
  param.setTargetAtTime(value, t, tau);
}

// createSound({ level, room, on }) — a piece's handle on the shared bus.
//   level  its output in dB (pieces sit around -4 to -10)
//   room   how much of it reaches the shared room, 0..1
//   on     whether it starts enabled (it still waits for a gesture to unlock)
export function createSound({ level = -6, room = 0.12, on = true } = {}) {
  const jobs = [];
  let preparing = 0;
  let destroyed = false;
  let out = null;
  let send = null;
  let gate = null;
  let claimed = false;
  const client = { on };
  warm();

  const ensure = () => {
    if (out || destroyed) return Boolean(out);
    const b = bus();
    if (!b) return false;
    out = b.ctx.createGain();
    out.gain.value = client.on ? db(level) : 0;
    // On the experiments index the gate follows this piece's tile on screen
    // (tileGate.js); everywhere else it stays open.
    gate = b.ctx.createGain();
    out.connect(gate);
    gate.connect(b.input);
    if (room > 0) {
      send = b.ctx.createGain();
      send.gain.value = room;
      gate.connect(send);
      send.connect(b.room);
    }
    b.clients.add(client);
    return true;
  };
  // The tile this piece lives in is the one in hand when it first sounds.
  const claim = () => {
    if (claimed || !gate) return;
    const tile = ownerTile();
    if (!tile) return;
    claimed = true;
    gateToTile(tile, gate, shared.ctx);
  };

  // Without a worker: render in idle slots, one take per slot.
  const prepare = () => {
    if (preparing || !jobs.length || destroyed) return;
    preparing = idle(() => {
      preparing = 0;
      jobs.shift()?.();
      prepare();
    });
  };

  const fetchTake = (bank, i) => {
    if (bank.takes[i] || bank.asked[i]) return;
    bank.asked[i] = true;
    const local = () => {
      jobs.push(() => {
        if (!bank.takes[i] && !destroyed) arrive(bank, i, bank.render(RATE, rng(bank.seed * 7919 + i * 104729), i));
      });
      prepare();
    };
    if (!bank.key) {
      local();
      return;
    }
    remote({ key: bank.key, name: bank.name, index: i, seed: bank.seed, sr: RATE })
      .then((data) => arrive(bank, i, data))
      .catch(local);
  };

  const arrive = (bank, i, data) => {
    if (destroyed || bank.takes[i]) return;
    bank.takes[i] = data;
    for (const fn of bank.onReady.splice(0)) fn();
  };

  const live = () => client.on && !destroyed && Boolean(out) && shared.ctx.state !== "closed";

  const api = {
    get ctx() {
      return ensure() ? shared.ctx : null;
    },
    // Where a piece connects its own live graph (a drone, a bed).
    get out() {
      return ensure() ? out : null;
    },
    // On, unlocked, and able to sound — a play() now is heard, at once or as
    // soon as a sleeping context wakes.
    get live() {
      return live();
    },
    get enabled() {
      return client.on;
    },
    // Call from a pointerdown or keydown: browsers only start audio inside a
    // gesture.
    unlock() {
      if (!client.on || !ensure()) return;
      claim();
      wantRunning();
    },
    async setEnabled(value) {
      client.on = Boolean(value);
      if (!ensure()) return false;
      // Off means silent now, loops and tails included, even while another
      // piece keeps the shared context running.
      glide(out.gain, client.on ? db(level) : 0, shared.ctx.currentTime, 0.03);
      wantRunning();
      if (client.on && shared.ctx.state !== "running") await wake();
      return client.on && shared.ctx.state === "running";
    },
    // A bank of `count` takes of one sound. `spec` is a *Takes.js entry:
    // its render(sampleRate, rand, index) returns a Float32Array, and the
    // key and name label() gave it let the worker find it.
    bank(render, spec = {}) {
      const { count = 6, seed = 1, key = null, name = null } = spec;
      const bank = {
        takes: new Array(count).fill(null),
        buffers: new Array(count).fill(null),
        asked: new Array(count).fill(false),
        onReady: [],
        last: -1,
        render,
        seed,
        key,
        name,
        // Whether the first take has arrived.
        get ready() {
          return Boolean(this.takes[0]);
        },
      };
      for (let i = 0; i < count; i += 1) fetchTake(bank, i);
      return bank;
    },
    // Play one take from a bank. gain in dB; pan -1..1; rate scales pitch and
    // length together; at is a delay in seconds; pick fixes the take.
    play(bank, { gain = 0, pan = 0, rate = 1, at = 0, pick = -1 } = {}) {
      if (!bank || !live()) return null;
      claim();
      const ctx = shared.ctx;
      if (ctx.state !== "running") {
        const asked = performance.now();
        shared.pending.push({ at: asked, run: () => api.play(bank, { gain, pan, rate, at, pick }) });
        wake();
        return null;
      }
      touch();
      const n = bank.takes.length;
      let i = pick >= 0 ? pick % n : Math.floor(Math.random() * n);
      if (!bank.takes[i]) {
        // Not arrived: take any that has, rather than render on this frame.
        const ready = bank.takes.findIndex(Boolean);
        if (ready < 0) return null;
        i = ready;
      } else if (pick < 0 && n > 1 && i === bank.last && bank.takes[(i + 1) % n]) i = (i + 1) % n;
      bank.last = i;
      if (!bank.buffers[i]) bank.buffers[i] = toBuffer(ctx, bank.takes[i]);
      const src = ctx.createBufferSource();
      src.buffer = bank.buffers[i];
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = db(gain);
      src.connect(g);
      let tail = g;
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        tail = p;
      }
      tail.connect(out);
      src.start(ctx.currentTime + 0.004 + Math.max(0, at));
      src.onended = () => tail.disconnect();
      return src;
    },
    // A looping texture to drive continuously (friction, a motor, hiss). It
    // starts silent and, if its take has not arrived yet, starts sounding
    // when it does. Ramp the returned { gain, rate, pan } AudioParams; stop()
    // fades it out. `offset` (0..1) fixes where in the take it starts, so two
    // loops of one take can start in phase.
    loop(bank, { pan = 0, offset = -1 } = {}) {
      if (!ensure() || !bank) return null;
      claim();
      const ctx = shared.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      let tail = g;
      let panner = null;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(panner);
        tail = panner;
      }
      tail.connect(out);
      // The rate lives on a constant source summed into the playback rate,
      // so a piece can ramp it before the take has arrived.
      const rate = ctx.createConstantSource();
      rate.offset.value = 1;
      rate.start();
      let src = null;
      let stopped = false;
      shared.loops += 1;
      const begin = () => {
        if (stopped || destroyed) return;
        if (!bank.buffers[0]) bank.buffers[0] = toBuffer(ctx, bank.takes[0]);
        src = ctx.createBufferSource();
        src.buffer = bank.buffers[0];
        src.loop = true;
        src.playbackRate.value = 0;
        rate.connect(src.playbackRate);
        src.connect(g);
        const start = offset >= 0 ? offset : Math.random();
        src.start(ctx.currentTime, (start % 1) * src.buffer.duration);
      };
      if (bank.takes[0]) begin();
      else {
        bank.onReady.push(begin);
        fetchTake(bank, 0);
      }
      return {
        gain: g.gain,
        rate: rate.offset,
        pan: panner?.pan ?? null,
        stop() {
          if (stopped) return;
          stopped = true;
          shared.loops -= 1;
          touch();
          const t = ctx.currentTime;
          glide(g.gain, 0, t, 0.02);
          const end = () => {
            g.disconnect();
            panner?.disconnect();
            rate.disconnect();
          };
          rate.stop(t + 0.2);
          if (src) {
            src.stop(t + 0.2);
            src.onended = end;
          } else setTimeout(end, 250);
        },
      };
    },
    destroy() {
      destroyed = true;
      client.on = false;
      jobs.length = 0;
      if (shared) {
        shared.clients.delete(client);
        wantRunning();
      }
      const node = out;
      const sendNode = send;
      const gateNode = gate;
      out = null;
      send = null;
      gate = null;
      if (node && shared) {
        // Let anything still ringing finish under a short fade.
        glide(node.gain, 0, shared.ctx.currentTime, 0.03);
        setTimeout(() => {
          node.disconnect();
          gateNode?.disconnect();
          sendNode?.disconnect();
        }, 300);
      }
    },
  };
  return api;
}
