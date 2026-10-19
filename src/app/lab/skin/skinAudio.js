export const BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const BEAT_URL = "/blog/audio/friday-beat.wav";

export function loadBeat() {
  return fetch(BEAT_URL)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new Off(2, 44100, 44100);
      return off.decodeAudioData(buf);
    });
}

export function createSkinAudio() {
  let ctx = null;
  let master = null;
  let pre = null;
  let filters = [];
  let vol = null;
  let pan = null;
  let ui = null;
  let noise = null;
  let beat = null;
  let source = null;
  let enabled = true;
  let state = { pre: 0, bands: BANDS.map(() => 0), on: true, volume: 0.72, balance: 0 };
  let voice = 0;
  let lastUi = 0;
  let want = null;

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
    ctx = new Ctx({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    pre = ctx.createGain();
    filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    let node = pre;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
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

  const stopSource = () => {
    if (!source) return;
    const s = source;
    source = null;
    const now = ctx.currentTime;
    s.fade.gain.cancelScheduledValues(now);
    s.fade.gain.setValueAtTime(s.fade.gain.value, now);
    s.fade.gain.linearRampToValueAtTime(0, now + 0.03);
    s.stop(now + 0.04);
    s.onended = () => s.fade.disconnect();
  };

  const startSource = (offset) => {
    if (!ctx || !beat || ctx.state !== "running") return;
    stopSource();
    const s = ctx.createBufferSource();
    s.buffer = beat;
    s.loop = true;
    const fade = ctx.createGain();
    const now = ctx.currentTime;
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(1, now + 0.03);
    s.connect(fade);
    fade.connect(pre);
    s.fade = fade;
    s.start(now, ((offset % beat.duration) + beat.duration) % beat.duration);
    source = s;
  };

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

  const live = () => enabled && ctx && ctx.state === "running";

  return {
    setBeat(b) {
      beat = b;
      if (want) startSource(want.offset + (performance.now() - want.at) / 1000);
    },
    arm(getOffset) {
      if (!enabled) return;
      const c = ensure();
      if (!c) return;
      if (c.state !== "running") {
        c.resume()
          .then(() => {
            if (want && !source) startSource(getOffset ? getOffset() : want.offset);
          })
          .catch(() => {});
      }
    },
    play(offset) {
      want = { offset, at: performance.now() };
      startSource(offset);
    },
    stop() {
      want = null;
      if (ctx) stopSource();
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
      if (!live()) return;
      const now = ctx.currentTime;
      if (kind === "notch" && now - lastUi < 0.03) return;
      lastUi = now;
      voice = (voice + 1) % 41;
      const v = (voice % 5) * 60;
      if (kind === "button") {
        burst(now, 2400 + v, 1.6, 0.22, 0.014, (voice * 0.0031) % 0.15);
        burst(now + 0.002, 420, 2.4, 0.12, 0.03, 0.08);
      } else if (kind === "release") {
        burst(now, 3200 + v, 1.8, 0.08, 0.01, 0.12);
      } else if (kind === "toggle") {
        burst(now, 1800 + v, 1.4, 0.2, 0.016, 0.02);
        burst(now + 0.018, 3400, 2, 0.08, 0.01, 0.06);
      } else if (kind === "notch") {
        burst(now, 4200 + v * 2, 3, 0.05, 0.006, (voice * 0.0057) % 0.15);
      } else if (kind === "snap") {
        burst(now, 1200, 2.2, 0.16, 0.02, 0.1);
        burst(now + 0.004, 3000, 2, 0.06, 0.01, 0.13);
      }
    },
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const c = ensure();
        if (!c) return false;
        await c.resume().catch(() => {});
        master.gain.setTargetAtTime(1, c.currentTime, 0.02);
        if (want && !source) startSource(want.offset + (performance.now() - want.at) / 1000);
        return c.state === "running";
      }
      if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      return false;
    },
    destroy() {
      want = null;
      if (ctx) {
        stopSource();
        ctx.close().catch(() => {});
      }
      ctx = null;
    },
  };
}
