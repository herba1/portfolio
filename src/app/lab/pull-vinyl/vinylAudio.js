export function createVinylAudio() {
  let ctx = null;
  let crackle = null;

  const wake = () => {
    if (typeof window === "undefined") return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
  };

  const noiseBuffer = (seconds, fill) => {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = fill(i, length);
    return buffer;
  };

  const slide = (level = 0.03) => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.3, (i, n) => (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / n));
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(1800, now);
    band.frequency.linearRampToValueAtTime(3200, now + 0.3);
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(now);
  };

  const startCrackle = () => {
    if (!ctx || ctx.state !== "running" || crackle) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2, () => (Math.random() < 0.0016 ? (Math.random() * 2 - 1) * 0.9 : (Math.random() * 2 - 1) * 0.03));
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.2);
    src.connect(hp).connect(gain).connect(ctx.destination);
    src.start(now);
    crackle = { src, gain };
  };

  const stopCrackle = () => {
    if (!ctx || !crackle) return;
    const now = ctx.currentTime;
    const { src, gain } = crackle;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    src.stop(now + 0.32);
    crackle = null;
  };

  return {
    wake,
    slide,
    startCrackle,
    stopCrackle,
    destroy() {
      ctx?.close();
      ctx = null;
      crackle = null;
    },
  };
}
