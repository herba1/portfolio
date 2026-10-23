// One audio context for every piece on a page, and one bus they all play
// through: a touch of shared room so the pieces sit in the same space, a low
// cut and a gentle top shelf so nothing is boomy or fizzy on laptop
// speakers, and a fast limiter so twenty clicks at once never clip. Each
// piece takes a client: its own on/off, its own level, its own banks of
// pre-rendered takes.
//
// Takes are rendered from synth.js in idle slots, never on the frame a sound
// is asked for, and played as buffers: one source and one gain per hit, no
// filters to build and tear down, so a busy piece costs the main thread
// almost nothing.

import { rng } from "./synth.js";

const RATE = 48000;
const SUSPEND_AFTER_MS = 1500;

let shared = null;

function roomImpulse(ctx) {
  const seconds = 0.45;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    const rand = rng(4049 + c * 131);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / ctx.sampleRate;
      // Darker as it decays, as air and walls take the highs first.
      low += (rand() * 2 - 1 - low) * (0.55 - 0.45 * Math.min(1, t / seconds));
      const early = t > 0.003 && t < 0.03 && rand() > 0.988 ? (rand() - 0.5) * 2.2 : 0;
      data[i] = (low * Math.exp(-t / 0.08) * 0.5 + early * Math.exp(-t / 0.015)) * 0.6;
    }
  }
  return buffer;
}

function bus() {
  if (shared) return shared;
  const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;
  let ctx;
  try {
    ctx = new Ctx({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  const input = ctx.createGain();
  input.gain.value = 0.8;
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = "highpass";
  lowCut.frequency.value = 60;
  lowCut.Q.value = 0.6;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 8000;
  shelf.gain.value = -3;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.09;
  input.connect(lowCut);
  lowCut.connect(shelf);
  shelf.connect(limiter);
  limiter.connect(ctx.destination);
  const room = ctx.createConvolver();
  room.buffer = roomImpulse(ctx);
  const roomOut = ctx.createGain();
  roomOut.gain.value = 1;
  room.connect(roomOut);
  roomOut.connect(lowCut);
  shared = { ctx, input, room, clients: new Set(), idle: 0 };
  return shared;
}

function wantRunning() {
  if (!shared) return;
  clearTimeout(shared.idle);
  const anyOn = [...shared.clients].some((client) => client.on);
  const { ctx } = shared;
  if (anyOn) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return;
  }
  // Nothing wants sound: let the device sleep, a moment later so a toggle
  // straight back on does not stutter.
  shared.idle = setTimeout(() => {
    if (![...shared.clients].some((client) => client.on) && ctx.state === "running") ctx.suspend().catch(() => {});
  }, SUSPEND_AFTER_MS);
}

const idle = (fn) =>
  typeof window !== "undefined" && window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 250 }) : setTimeout(() => fn(null), 16);

export const db = (value) => Math.pow(10, value / 20);

// createSound({ level, room, on }) — a piece's handle on the shared bus.
//   level  its output in dB (pieces sit around -6 to -12)
//   room   how much of it reaches the shared room, 0..1
//   on     whether it starts enabled (it still waits for a gesture to unlock)
export function createSound({ level = -6, room = 0.12, on = true } = {}) {
  const banks = [];
  const jobs = [];
  let preparing = 0;
  let destroyed = false;
  let out = null;
  let send = null;
  const client = { on };

  const ensure = () => {
    if (out || destroyed) return Boolean(out);
    const b = bus();
    if (!b) return false;
    out = b.ctx.createGain();
    out.gain.value = db(level);
    out.connect(b.input);
    if (room > 0) {
      send = b.ctx.createGain();
      send.gain.value = room;
      out.connect(send);
      send.connect(b.room);
    }
    b.clients.add(client);
    return true;
  };

  const prepare = () => {
    if (preparing || !jobs.length || destroyed) return;
    preparing = idle((deadline) => {
      preparing = 0;
      const until = performance.now() + 6;
      while (jobs.length && (deadline?.timeRemaining ? deadline.timeRemaining() > 2 : performance.now() < until)) jobs.shift()();
      prepare();
    });
  };

  const api = {
    get ctx() {
      return ensure() ? shared.ctx : null;
    },
    // Where a piece connects its own live graph (a drone, a bed).
    get out() {
      return ensure() ? out : null;
    },
    get live() {
      return client.on && !destroyed && Boolean(out) && shared.ctx.state === "running";
    },
    get enabled() {
      return client.on;
    },
    // Call from a pointerdown or keydown: browsers only start audio inside a
    // gesture.
    unlock() {
      if (!client.on || !ensure()) return;
      wantRunning();
      prepare();
    },
    async setEnabled(value) {
      client.on = Boolean(value);
      if (!ensure()) return false;
      wantRunning();
      if (client.on) {
        prepare();
        if (shared.ctx.state !== "running") await shared.ctx.resume().catch(() => {});
      }
      return client.on && shared.ctx.state === "running";
    },
    // A bank of `count` takes of one sound, rendered lazily:
    // render(sampleRate, rand, index) returns a Float32Array.
    bank(render, { count = 6, seed = 1 } = {}) {
      const bank = { takes: new Array(count).fill(null), buffers: new Array(count).fill(null), last: -1, render, seed };
      banks.push(bank);
      for (let i = 0; i < count; i += 1) {
        jobs.push(() => {
          if (!bank.takes[i]) bank.takes[i] = render(RATE, rng(seed * 7919 + i * 104729), i);
        });
      }
      return bank;
    },
    // Play one take from a bank. gain in dB; pan -1..1; rate scales pitch and
    // length together; at is a delay in seconds; pick fixes the take.
    play(bank, { gain = 0, pan = 0, rate = 1, at = 0, pick = -1 } = {}) {
      if (!api.live || !bank) return null;
      const ctx = shared.ctx;
      const n = bank.takes.length;
      let i = pick >= 0 ? pick % n : Math.floor(Math.random() * n);
      if (pick < 0 && n > 1 && i === bank.last) i = (i + 1) % n;
      bank.last = i;
      if (!bank.buffers[i]) {
        if (!bank.takes[i]) bank.takes[i] = bank.render(RATE, rng(bank.seed * 7919 + i * 104729), i);
        const data = bank.takes[i];
        const buffer = ctx.createBuffer(1, data.length, RATE);
        buffer.getChannelData(0).set(data);
        bank.buffers[i] = buffer;
      }
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
    // A looping noise or tone texture to drive continuously (friction, a
    // motor, hiss). It starts silent; ramp the returned { gain, rate }
    // AudioParams, and stop() fades it out.
    loop(bank) {
      if (!ensure() || !bank) return null;
      const ctx = shared.ctx;
      if (!bank.buffers[0]) {
        if (!bank.takes[0]) bank.takes[0] = bank.render(RATE, rng(bank.seed * 7919), 0);
        const buffer = ctx.createBuffer(1, bank.takes[0].length, RATE);
        buffer.getChannelData(0).set(bank.takes[0]);
        bank.buffers[0] = buffer;
      }
      const src = ctx.createBufferSource();
      src.buffer = bank.buffers[0];
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(out);
      src.start(ctx.currentTime, Math.random() * src.buffer.duration);
      return {
        gain: g.gain,
        rate: src.playbackRate,
        stop() {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(0, t, 0.02);
          src.stop(t + 0.15);
          src.onended = () => g.disconnect();
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
      out = null;
      send = null;
      if (node && shared) {
        // Let anything still ringing finish under a short fade.
        const t = shared.ctx.currentTime;
        node.gain.setTargetAtTime(0, t, 0.03);
        setTimeout(() => {
          node.disconnect();
          sendNode?.disconnect();
        }, 300);
      }
    },
  };
  return api;
}

// A seamless loop: the end crossfades into the start, so a looping texture
// has no seam to click on.
export function seamless(data, sr, fadeSeconds = 0.05) {
  const fade = Math.min(Math.floor(data.length / 2), Math.round(sr * fadeSeconds));
  const n = data.length - fade;
  const out = new Float32Array(n);
  out.set(data.subarray(0, n));
  for (let i = 0; i < fade; i += 1) {
    const t = i / fade;
    out[i] = data[n + i] * Math.cos((t * Math.PI) / 2) + data[i] * Math.sin((t * Math.PI) / 2);
  }
  return out;
}
