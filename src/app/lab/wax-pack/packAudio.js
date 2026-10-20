export function createPackAudio() {
  let ctx = null;
  let noise = null;
  let master = null;
  let last = 0;

  function start() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = Math.round(ctx.sampleRate * 0.6);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  const ready = () => ctx && ctx.state === "running" && noise;

  function burst({ at = 0, dur = 0.05, freq = 3000, q = 0.8, level = 0.1, type = "bandpass", sweep = 0 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(80, freq * sweep), t + dur);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  function crinkle(amount = 1) {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (now - last < 0.03) return;
    last = now;
    const count = 1 + Math.floor(Math.random() * 2 + amount);
    for (let i = 0; i < count; i += 1) {
      burst({ at: i * 0.012, dur: 0.02 + Math.random() * 0.03, freq: 3500 + Math.random() * 3500, q: 1.4, level: 0.05 * Math.min(1, amount) });
    }
  }

  function rip() {
    if (!ready()) return;
    burst({ dur: 0.28, freq: 5200, q: 0.6, level: 0.11, sweep: 0.35 });
    for (let i = 0; i < 6; i += 1) burst({ at: 0.02 + i * 0.03, dur: 0.03, freq: 4000 + Math.random() * 3000, q: 1.6, level: 0.05 });
  }

  function swish() {
    if (!ready()) return;
    burst({ dur: 0.2, freq: 1400, q: 0.7, level: 0.07, sweep: 2.6 });
  }

  function sparkle() {
    if (!ready()) return;
    const notes = [1568, 2093, 2637, 3136];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.035, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }

  function destroy() {
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    noise = null;
  }

  return { start, crinkle, rip, swish, sparkle, destroy };
}
