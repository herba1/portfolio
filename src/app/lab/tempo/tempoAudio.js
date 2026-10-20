const OPEN = 16000;
const SHUT = 560;

export function createTempoSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 771913;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(comp);
  comp.connect(ctx.destination);

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = OPEN;
  tone.Q.value = 0.9;
  const beatGain = ctx.createGain();
  beatGain.gain.value = 0.62;
  tone.connect(beatGain);
  beatGain.connect(master);

  let buffer = null;
  let source = null;
  let anchorTime = 0;
  let anchorBeat = 0;
  let enabled = false;
  let voice = 0;
  let pending = null;

  const live = () => enabled && ctx.state === "running";

  const heardTime = () => {
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0 && performance.now() - ts.performanceTime < 250) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  };

  const pan = (node, p) => {
    if (!ctx.createStereoPanner) {
      node.connect(master);
      return node;
    }
    const s = ctx.createStereoPanner();
    s.pan.value = Math.max(-0.8, Math.min(0.8, p));
    node.connect(s);
    s.connect(master);
    return s;
  };

  return {
    ctx,
    get running() {
      return Boolean(source) && ctx.state === "running";
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          return false;
        }
      }
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(on ? 0.9 : 0.0001, now, 0.03);
      return ctx.state === "running";
    },
    feed(bytes) {
      if (pending || !bytes) return pending;
      pending = ctx
        .decodeAudioData(bytes.slice(0))
        .then((b) => {
          buffer = b;
          return b;
        })
        .catch(() => null);
      return pending;
    },
    async startAt(beatNow, beatPeriod) {
      if (source) return true;
      await pending;
      if (!buffer || ctx.state !== "running") return false;
      const b = beatNow();
      let next = Math.floor(b) + 1;
      if (next - b < 0.3) next += 1;
      const at = ctx.currentTime + (next - b) * beatPeriod;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.connect(tone);
      source.start(at);
      anchorTime = at;
      anchorBeat = next;
      return true;
    },
    beat(beatPeriod) {
      if (!source) return null;
      const t = heardTime();
      if (t < anchorTime) return null;
      return anchorBeat + (t - anchorTime) / beatPeriod;
    },
    timeOf(beat, beatPeriod) {
      return anchorTime + (beat - anchorBeat) * beatPeriod;
    },
    suspend() {
      if (ctx.state === "running") ctx.suspend().catch(() => {});
    },
    resume() {
      if (enabled && ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    wipe(at, dur, toward) {
      if (!live()) return;
      const t = Math.max(at, ctx.currentTime + 0.005);
      tone.frequency.cancelScheduledValues(t);
      tone.frequency.setValueAtTime(OPEN, t);
      tone.frequency.exponentialRampToValueAtTime(SHUT, t + dur * 0.9);
      voice = (voice + 1) % 97;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.6;
      band.frequency.setValueAtTime(700, t);
      band.frequency.exponentialRampToValueAtTime(5200, t + dur);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 380;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.075, t + dur * 0.55);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
      src.connect(band);
      band.connect(hp);
      hp.connect(env);
      let panner = null;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(-0.5 * toward, t);
        panner.pan.linearRampToValueAtTime(0.6 * toward, t + dur);
        env.connect(panner);
        panner.connect(master);
      } else {
        env.connect(master);
      }
      src.start(t, (voice * 0.031) % 0.5, dur * 1.1 + 0.05);
      src.onended = () => {
        env.disconnect();
        panner?.disconnect();
      };
    },
    open(at) {
      if (!live()) return;
      const t = Math.max(at, ctx.currentTime + 0.005);
      tone.frequency.cancelScheduledValues(t);
      tone.frequency.setValueAtTime(Math.max(SHUT, tone.frequency.value), t);
      tone.frequency.exponentialRampToValueAtTime(OPEN, t + 0.09);
    },
    tick(p) {
      if (!live()) return;
      voice = (voice + 1) % 97;
      const t = ctx.currentTime + 0.002;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2900 + (voice % 5) * 160;
      band.Q.value = 3;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.06, t + 0.001);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);
      src.connect(band);
      band.connect(env);
      const end = pan(env, p);
      src.start(t, (voice * 0.017) % 0.9, 0.05);
      src.onended = () => {
        env.disconnect();
        if (end !== env) end.disconnect();
      };
    },
    destroy() {
      enabled = false;
      pending = null;
      try {
        source?.stop();
      } catch {}
      ctx.close().catch(() => {});
    },
  };
}
