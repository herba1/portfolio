export function createClicker() {
  let ctx = null;
  let noise = null;
  let lastAt = 0;

  const wake = () => {
    if (typeof window === "undefined") return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const length = Math.floor(ctx.sampleRate * 0.05);
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    if (ctx.state === "suspended") ctx.resume();
  };

  const tick = (strength = 0.5, pitch = 1) => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - lastAt < 0.012) return;
    lastAt = now;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400 * pitch + strength * 1200;
    band.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.02 + strength * 0.06, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03 + strength * 0.03);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.08);
    if (strength > 0.7) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220 * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(110 * pitch, now + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.05, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  };

  const destroy = () => {
    ctx?.close();
    ctx = null;
  };

  return { wake, tick, destroy };
}
