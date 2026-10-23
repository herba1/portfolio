import { buildChannels, createWaves, firstEventAt, voice } from "@/lib/chiptune/synth";

export const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const LOOKAHEAD = 0.2;
const HIDDEN_LOOKAHEAD = 1.8;
const WINDOW = 1024;
const LEVEL = 1.7;

export function createSkinAudio() {
  let ctx = null;
  let waves = null;
  let master = null;
  let pre = null;
  let filters = [];
  let vol = null;
  let pan = null;
  let analyser = null;
  let scratch = null;
  let ui = null;
  let noise = null;
  let enabled = true;
  let state = { pre: 0, bands: BANDS.map(() => 0), on: true, volume: 0.72, balance: 0 };
  let voiceN = 0;
  let lastUi = 0;
  let song = null;
  let want = null;
  let session = null;
  let timer = 0;
  let listener = null;
  let unlocked = false;
  let lastReport = "";

  const report = () => {
    const next = !enabled ? "off" : ctx && ctx.state === "running" ? "on" : "pending";
    if (next === lastReport) return;
    lastReport = next;
    listener?.(next);
  };

  const unlock = () => {
    if (unlocked || !ctx) return;
    unlocked = true;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  };

  const dbToGain = (db) => Math.pow(10, db / 20);

  const applyEq = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    pre.gain.setTargetAtTime(state.on ? dbToGain(state.pre) * 0.8 : 0.8, t, 0.015);
    filters.forEach((f, i) => f.gain.setTargetAtTime(state.on ? state.bands[i] : 0, t, 0.015));
  };

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {}
    ctx = new Ctx({ latencyHint: "playback" });
    ctx.onstatechange = report;
    waves = createWaves(ctx);
    master = ctx.createGain();
    master.gain.value = enabled ? LEVEL : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.08;
    master.connect(comp);
    comp.connect(limit);
    limit.connect(ctx.destination);
    pre = ctx.createGain();
    const dc = ctx.createBiquadFilter();
    dc.type = "highpass";
    dc.frequency.value = 30;
    dc.Q.value = 0.7;
    pre.connect(dc);
    filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    let node = dc;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    scratch = new Float32Array(analyser.fftSize);
    node.connect(analyser);
    vol = ctx.createGain();
    vol.gain.value = state.volume * state.volume;
    node.connect(vol);
    pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = state.balance;
    vol.connect(pan);
    pan.connect(master);
    ui = ctx.createGain();
    ui.gain.value = 0.8;
    ui.connect(master);
    const length = Math.floor(ctx.sampleRate * 0.2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 4242;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    applyEq();
    return ctx;
  };

  const tick = () => {
    const s = session;
    if (!s || !ctx) return;
    const now = ctx.currentTime;
    const horizon = now + (document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD);
    const ev = s.song.events;
    while (s.idx < ev.length && s.t0 + ev[s.idx].s < horizon) {
      const e = ev[s.idx];
      s.idx += 1;
      let when = s.t0 + e.s;
      if (when < now - 0.04) continue;
      if (when < now + 0.005) when = now + 0.005;
      voice(ctx, waves, s.chans, when, e, { live: true });
    }
    if (s.idx >= ev.length && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  };

  const stopSession = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
    if (!session) return;
    const s = session;
    session = null;
    const now = ctx.currentTime;
    s.bus.gain.cancelScheduledValues(now);
    s.bus.gain.setValueAtTime(s.bus.gain.value, now);
    s.bus.gain.linearRampToValueAtTime(0, now + 0.04);
    window.setTimeout(() => s.bus.disconnect(), 120);
  };

  const startSession = (offset) => {
    if (!ctx || !song || !enabled || ctx.state !== "running") return;
    stopSession();
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + 0.03);
    bus.connect(pre);
    const start = now + 0.06;
    session = { song, bus, chans: buildChannels(ctx, bus), t0: start - offset, idx: firstEventAt(song.events, Math.max(0, offset - 0.002)) };
    tick();
    timer = window.setInterval(tick, 25);
  };

  const onVisibility = () => tick();
  document.addEventListener("visibilitychange", onVisibility);

  const burst = (t, freq, q, gain, dur, offset) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.0007);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(ui);
    src.start(t, offset, dur + 0.01);
    src.onended = () => env.disconnect();
  };

  const running = () => enabled && ctx && ctx.state === "running";

  return {
    setSong(next) {
      song = next;
    },
  live() {
      return Boolean(running() && session);
    },
    // Sound is on but the browser hasn't let the context start yet.
    blocked() {
      return Boolean(enabled && !(ctx && ctx.state === "running"));
    },
    read(out) {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(scratch);
      out.set(scratch.subarray(scratch.length - WINDOW));
      return ctx.sampleRate;
    },
    arm(getOffset) {
      if (!enabled) return;
      const c = ensure();
      if (!c) return;
      unlock();
      const begin = () => {
        if (want && !session) startSession(getOffset ? getOffset() : want.offset);
        report();
      };
      if (c.state === "running") begin();
      else c.resume().then(begin).catch(() => {});
    },
    onState(fn) {
      listener = fn;
      report();
    },
    play(offset) {
      want = { offset, at: performance.now() };
      startSession(offset);
    },
    stop() {
      want = null;
      if (ctx) stopSession();
    },
    setEq(next) {
      state = { ...state, ...next };
      applyEq();
    },
    setVolume(v) {
      state.volume = v;
      if (vol) vol.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02);
    },
    setBalance(b) {
      state.balance = b;
      if (pan?.pan) pan.pan.setTargetAtTime(b, ctx.currentTime, 0.02);
    },
    click(kind = "button") {
      if (!running()) return;
      const now = ctx.currentTime;
      if (kind === "notch" && now - lastUi < 0.03) return;
      lastUi = now;
      voiceN = (voiceN + 1) % 41;
      const v = (voiceN % 5) * 60;
      if (kind === "button") {
        burst(now, 2400 + v, 1.6, 0.18, 0.014, (voiceN * 0.0031) % 0.15);
        burst(now + 0.002, 420, 2.4, 0.1, 0.03, 0.08);
      } else if (kind === "release") {
        burst(now, 3200 + v, 1.8, 0.06, 0.01, 0.12);
      } else if (kind === "toggle") {
        burst(now, 1800 + v, 1.4, 0.16, 0.016, 0.02);
        burst(now + 0.018, 3400, 2, 0.06, 0.01, 0.06);
      } else if (kind === "notch") {
        burst(now, 4200 + v * 2, 3, 0.04, 0.006, (voiceN * 0.0057) % 0.15);
      } else if (kind === "snap") {
        burst(now, 1200, 2.2, 0.14, 0.02, 0.1);
        burst(now + 0.004, 3000, 2, 0.05, 0.01, 0.13);
      }
    },
    async setEnabled(on, getOffset) {
      enabled = on;
      if (on) {
        const c = ensure();
        if (!c) return false;
        unlock();
        await c.resume().catch(() => {});
        master.gain.cancelScheduledValues(c.currentTime);
        master.gain.setTargetAtTime(LEVEL, c.currentTime, 0.02);
        if (want && !session) startSession(getOffset ? getOffset() : want.offset);
        report();
        return c.state === "running";
      }
      report();
      if (master) {
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        window.setTimeout(() => {
          if (!enabled) stopSession();
        }, 120);
      }
      return false;
    },
    destroy() {
      want = null;
      document.removeEventListener("visibilitychange", onVisibility);
      if (ctx) {
        stopSession();
        ctx.close().catch(() => {});
      }
      ctx = null;
    },
  };
}
