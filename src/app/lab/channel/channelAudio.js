export function createChannelSound(src) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 424242;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.16;
  master.connect(comp);
  comp.connect(ctx.destination);

  const staticGain = ctx.createGain();
  staticGain.gain.value = 0;
  const staticHp = ctx.createBiquadFilter();
  staticHp.type = "highpass";
  staticHp.frequency.value = 600;
  const staticLp = ctx.createBiquadFilter();
  staticLp.type = "lowpass";
  staticLp.frequency.value = 7200;
  staticHp.connect(staticLp);
  staticLp.connect(staticGain);
  staticGain.connect(master);

  const speaker = ctx.createGain();
  speaker.gain.value = 0;
  const spHp = ctx.createBiquadFilter();
  spHp.type = "highpass";
  spHp.frequency.value = 170;
  const spLp = ctx.createBiquadFilter();
  spLp.type = "lowpass";
  spLp.frequency.value = 4200;
  const spPeak = ctx.createBiquadFilter();
  spPeak.type = "peaking";
  spPeak.frequency.value = 1300;
  spPeak.gain.value = 5;
  spPeak.Q.value = 0.9;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
  }
  shaper.curve = curve;
  spHp.connect(spLp);
  spLp.connect(spPeak);
  spPeak.connect(shaper);
  shaper.connect(speaker);
  speaker.connect(master);

  let enabled = false;
  let staticSrc = null;
  let beat = null;
  let beatSrc = null;
  let beatLoading = null;
  let hum = null;
  let channel = 0;
  let lastStatic = -1;
  let lastSpeaker = -1;
  let voice = 0;

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay }) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    s.connect(f);
    f.connect(env);
    env.connect(master);
    voice = (voice + 1) % 89;
    s.start(at, (voice * 0.0211) % 1.6, attack + decay + 0.02);
    s.onended = () => env.disconnect();
  };

  const startBeat = (at) => {
    if (!beat) return;
    if (beatSrc) {
      try {
        beatSrc.stop(at);
      } catch {
        beatSrc = null;
      }
    }
    const s = ctx.createBufferSource();
    s.buffer = beat;
    s.loop = true;
    s.connect(spHp);
    s.start(at, (channel * 1.37) % beat.duration);
    beatSrc = s;
  };

  const loadBeat = () => {
    if (beatLoading) return beatLoading;
    beatLoading = fetch(src)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        beat = decoded;
        if (enabled) startBeat(ctx.currentTime + 0.05);
      })
      .catch(() => {});
    return beatLoading;
  };

  const startBed = () => {
    if (!staticSrc) {
      staticSrc = ctx.createBufferSource();
      staticSrc.buffer = noise;
      staticSrc.loop = true;
      staticSrc.connect(staticHp);
      staticSrc.start();
    }
    if (!hum) {
      const whine = ctx.createOscillator();
      whine.frequency.value = 15734;
      const wg = ctx.createGain();
      wg.gain.value = 0.0016;
      const buzz = ctx.createOscillator();
      buzz.type = "sawtooth";
      buzz.frequency.value = 60;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      const bg = ctx.createGain();
      bg.gain.value = 0.006;
      whine.connect(wg);
      wg.connect(master);
      buzz.connect(lp);
      lp.connect(bg);
      bg.connect(master);
      whine.start();
      buzz.start();
      hum = { whine, buzz };
    }
    loadBeat();
    if (beat && !beatSrc) startBeat(ctx.currentTime + 0.02);
  };

  const stopBed = () => {
    const t = ctx.currentTime;
    if (staticSrc) {
      staticSrc.stop(t + 0.05);
      staticSrc = null;
    }
    if (hum) {
      hum.whine.stop(t + 0.05);
      hum.buzz.stop(t + 0.05);
      hum = null;
    }
    if (beatSrc) {
      beatSrc.stop(t + 0.05);
      beatSrc = null;
    }
    lastStatic = -1;
    lastSpeaker = -1;
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on, index) {
      enabled = on;
      channel = index ?? channel;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startBed();
        return true;
      }
      stopBed();
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    levels(stat, sound) {
      if (!live()) return;
      const t = ctx.currentTime;
      const s = Math.round(stat * 100) / 100;
      const p = Math.round(sound * 100) / 100;
      if (s !== lastStatic) {
        staticGain.gain.setTargetAtTime(s * 0.34, t, 0.012);
        lastStatic = s;
      }
      if (p !== lastSpeaker) {
        speaker.gain.setTargetAtTime(p * 0.62, t, 0.03);
        lastSpeaker = p;
      }
    },
    retune(index) {
      channel = index;
      if (!live()) return;
      startBeat(ctx.currentTime + 0.12);
    },
    detent() {
      if (!live()) return;
      const t = ctx.currentTime;
      burst({ at: t, freq: 2600, q: 1.8, gain: 0.28, attack: 0.0008, decay: 0.012 });
      burst({ at: t, type: "lowpass", freq: 320, q: 1.4, gain: 0.34, attack: 0.002, decay: 0.05 });
      burst({ at: t + 0.022, freq: 1500, q: 2.2, gain: 0.08, attack: 0.001, decay: 0.014 });
    },
    press() {
      if (!live()) return;
      const t = ctx.currentTime;
      burst({ at: t, freq: 3200, q: 1.5, gain: 0.14, attack: 0.0006, decay: 0.01 });
      burst({ at: t, type: "lowpass", freq: 500, q: 1, gain: 0.16, attack: 0.002, decay: 0.03 });
    },
    degauss() {
      if (!live()) return;
      const t = ctx.currentTime;
      burst({ at: t, freq: 2800, q: 1.4, gain: 0.2, attack: 0.0008, decay: 0.016 });
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.55, t + 0.025);
      env.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 1.2);
      const oscs = [
        ["sawtooth", 60, 0.5],
        ["sine", 120, 0.6],
        ["sine", 181, 0.25],
      ].map(([type, f, g]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f * 1.12, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.97, t + 1.3);
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(t + 1.6);
        return o;
      });
      lp.connect(env);
      env.connect(master);
      oscs[0].onended = () => env.disconnect();
      burst({ at: t + 0.01, freq: 170, q: 3, gain: 0.3, attack: 0.02, decay: 1.0 });
      burst({ at: t + 0.04, freq: 5200, q: 0.8, gain: 0.04, attack: 0.05, decay: 0.6 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
