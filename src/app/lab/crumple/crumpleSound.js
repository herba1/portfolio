export function createRustle() {
  let ctx = null;
  let noise = null;
  let out = null;
  let last = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const length = Math.round(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    out = ctx.createGain();
    out.gain.value = 0.5;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 6000;
    shelf.gain.value = -8;
    out.connect(shelf).connect(ctx.destination);
    return ctx;
  };

  const crackle = (t, strength) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800 + Math.random() * 4200;
    band.Q.value = 0.9 + Math.random() * 1.6;
    const amp = ctx.createGain();
    const dur = 0.006 + Math.random() * 0.03;
    const peak = (0.015 + Math.random() * 0.05) * strength;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(amp).connect(out);
    src.start(t, Math.random() * 0.4, dur + 0.01);
  };

  return {
    unlock() {
      const c = ensure();
      if (c && c.state === "suspended") c.resume().catch(() => {});
    },
    rustle(speed, p) {
      if (!ctx || ctx.state !== "running") return;
      const now = performance.now();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const density = 0.4 + 0.6 * Math.sin(Math.min(1, p) * Math.PI);
      const rate = Math.min(90, speed * 110 * density);
      let count = 0;
      let x = Math.random();
      const expected = rate * dt;
      while (x < expected && count < 6) {
        count += 1;
        x += Math.random() * 1.2;
      }
      const t = ctx.currentTime;
      for (let i = 0; i < count; i += 1) crackle(t + Math.random() * dt, Math.min(1, 0.4 + speed));
    },
    destroy() {
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
