export function createFoley() {
  let ctx = null;
  let master = null;
  let noise = null;

  function unlock() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.6);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  }

  function burst({ at = 0, dur = 0.03, freq = 3000, q = 1.2, gain = 0.2, type = "bandpass" }) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t, Math.random() * 0.4, dur + 0.02);
  }

  function ping(freq, at, gain, dur) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock,
    tick(strength = 1) {
      burst({ dur: 0.028, freq: 2600, q: 1.6, gain: 0.22 * strength });
      burst({ at: 0.006, dur: 0.05, freq: 900, q: 0.8, gain: 0.08 * strength });
    },
    clink(strength = 1) {
      ping(3150, 0, 0.05 * strength, 0.22);
      ping(4720, 0.004, 0.035 * strength, 0.16);
      ping(3330, 0.07, 0.03 * strength, 0.18);
    },
    whoosh() {
      burst({ dur: 0.32, freq: 700, q: 0.7, gain: 0.07, type: "bandpass" });
    },
    close() {
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
