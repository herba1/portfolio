export function createIrisSound() {
  let ctx = null;
  let master = null;
  let noise = null;
  let swishGain = null;
  let swishFilter = null;
  let lastClick = 0;

  function noiseBuffer(seconds) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.04 * white) / 1.04;
      data[i] = white * 0.6 + brown * 2.4;
    }
    return buffer;
  }

  function start() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    noise = noiseBuffer(2);
    const loop = ctx.createBufferSource();
    loop.buffer = noise;
    loop.loop = true;
    swishFilter = ctx.createBiquadFilter();
    swishFilter.type = "bandpass";
    swishFilter.frequency.value = 2400;
    swishFilter.Q.value = 0.9;
    const air = ctx.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = 700;
    swishGain = ctx.createGain();
    swishGain.gain.value = 0;
    loop.connect(air);
    air.connect(swishFilter);
    swishFilter.connect(swishGain);
    swishGain.connect(master);
    loop.start();
  }

  function click(strength, closedness) {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - lastClick < 0.018) return;
    lastClick = now;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200 + closedness * 1400;
    band.Q.value = 2.2;
    const g = ctx.createGain();
    const peak = 0.5 * strength;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.028 + strength * 0.02);
    src.connect(band);
    band.connect(g);
    g.connect(master);
    src.start(now, Math.random() * 1.5, 0.08);

    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(1500 + closedness * 500, now);
    body.frequency.exponentialRampToValueAtTime(700, now + 0.03);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, now);
    bg.gain.linearRampToValueAtTime(0.12 * strength, now + 0.001);
    bg.gain.exponentialRampToValueAtTime(0.0005, now + 0.035);
    body.connect(bg);
    bg.connect(master);
    body.start(now);
    body.stop(now + 0.05);
  }

  function swish(speed, closedness) {
    if (!ctx || ctx.state !== "running" || !swishGain) return;
    const now = ctx.currentTime;
    const level = Math.min(0.11, Math.pow(Math.min(1, Math.abs(speed) / 9), 1.4) * 0.11);
    swishGain.gain.setTargetAtTime(level, now, level > swishGain.gain.value ? 0.02 : 0.07);
    swishFilter.frequency.setTargetAtTime(1800 + closedness * 2600 + Math.abs(speed) * 120, now, 0.05);
  }

  function destroy() {
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }

  return { start, click, swish, destroy };
}
