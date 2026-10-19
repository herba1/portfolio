function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildLoop(ctx) {
  const rate = ctx.sampleRate;
  const seconds = 2;
  const length = rate * seconds;
  const buffer = ctx.createBuffer(2, length, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const rand = rng(1969);
  let lp = 0;
  let bp1 = 0;
  let bp2 = 0;
  for (let i = 0; i < length; i += 1) {
    const n = rand() * 2 - 1;
    lp += (n - lp) * 0.02;
    left[i] = lp * 0.18 + n * 0.012;
    right[i] = lp * 0.16 + n * 0.012;
  }
  const clicks = 24 * seconds;
  for (let c = 0; c < clicks; c += 1) {
    const start = Math.floor((c / clicks) * length + (rand() - 0.5) * rate * 0.0012);
    const strong = c % 2 === 0;
    const amp = (strong ? 0.5 : 0.32) * (0.85 + rand() * 0.3);
    const dur = Math.floor(rate * (strong ? 0.012 : 0.008));
    bp1 = 0;
    bp2 = 0;
    for (let k = 0; k < dur; k += 1) {
      const i = (start + k + length) % length;
      const env = Math.exp(-k / (rate * 0.0022));
      const n = rand() * 2 - 1;
      bp1 += (n - bp1) * 0.45;
      bp2 += (bp1 - bp2) * 0.45;
      const v = (bp1 - bp2) * amp * env;
      left[i] += v;
      right[i] += v * 0.9;
    }
    const thump = Math.floor(rate * 0.02);
    for (let k = 0; k < thump; k += 1) {
      const i = (start + k + length) % length;
      const v = Math.sin((k / rate) * Math.PI * 2 * 92) * Math.exp(-k / (rate * 0.006)) * amp * 0.25;
      left[i] += v;
      right[i] += v;
    }
  }
  for (let i = 0; i < length; i += 1) {
    const hum = Math.sin((i / rate) * Math.PI * 2 * 48) * 0.02 + Math.sin((i / rate) * Math.PI * 2 * 96) * 0.008;
    left[i] += hum;
    right[i] += hum;
  }
  const fade = Math.floor(rate * 0.004);
  for (let k = 0; k < fade; k += 1) {
    const w = k / fade;
    left[k] *= w;
    right[k] *= w;
    left[length - 1 - k] *= w;
    right[length - 1 - k] *= w;
  }
  return buffer;
}

export function createProjector() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3800;
  tone.Q.value = 0.5;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  tone.connect(gain);
  gain.connect(comp);
  comp.connect(ctx.destination);
  let src = null;
  let enabled = false;

  const ensure = () => {
    if (src) return;
    src = ctx.createBufferSource();
    src.buffer = buildLoop(ctx);
    src.loop = true;
    src.connect(tone);
    src.start();
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        ensure();
      } else {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        await new Promise((r) => setTimeout(r, 120));
        if (!enabled && ctx.state === "running") await ctx.suspend().catch(() => {});
      }
      return enabled && ctx.state === "running";
    },
    update(ratio) {
      if (!enabled || !src || ctx.state !== "running") return;
      const speed = Math.min(2.4, Math.abs(ratio));
      const now = ctx.currentTime;
      src.playbackRate.setTargetAtTime(Math.max(0.3, speed), now, 0.06);
      gain.gain.setTargetAtTime(speed < 0.05 ? 0 : 0.5 * Math.min(1, 0.35 + speed * 0.65), now, 0.08);
      tone.frequency.setTargetAtTime(2400 + speed * 1600, now, 0.1);
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
