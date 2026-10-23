import { soundAllowed } from "@/lib/sound/desktopOnly";

const BUCKETS = 5;
const MIN_GAP = 0.016;

export function createClicks() {
  if (!soundAllowed()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.4);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);
  const pans = [];
  for (let b = 0; b < BUCKETS; b += 1) {
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = (b / (BUCKETS - 1)) * 1.4 - 0.7;
    pan.connect(master);
    pans.push(pan);
  }
  const last = new Float64Array(BUCKETS);
  let enabled = false;
  let voice = 0;

  const click = (bucket, count) => {
    const now = ctx.currentTime;
    if (now - last[bucket] < MIN_GAP) return;
    last[bucket] = now;
    voice = (voice + 1) % 97;
    const level = Math.min(1, 0.32 + 0.22 * Math.log2(1 + count));
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600 + ((voice * 37) % 97) * 14;
    band.Q.value = 1.6;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 900;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.22 * level, now + 0.0008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    src.connect(band);
    band.connect(high);
    high.connect(env);
    env.connect(pans[bucket]);
    const offset = ((voice * 0.0137) % 0.35) + 0.01;
    src.start(now, offset, 0.03);
    src.onended = () => env.disconnect();

    const body = ctx.createBufferSource();
    body.buffer = noise;
    const low = ctx.createBiquadFilter();
    low.type = "bandpass";
    low.frequency.value = 520 + ((voice * 13) % 11) * 18;
    low.Q.value = 3.2;
    const benv = ctx.createGain();
    benv.gain.setValueAtTime(0.0001, now);
    benv.gain.exponentialRampToValueAtTime(0.12 * level, now + 0.0015);
    benv.gain.exponentialRampToValueAtTime(0.0001, now + 0.034);
    body.connect(low);
    low.connect(benv);
    benv.connect(pans[bucket]);
    body.start(now, offset + 0.02, 0.04);
    body.onended = () => benv.disconnect();
  };

  return {
    buckets: BUCKETS,
    get enabled() {
      return enabled;
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on && ctx.state === "running") await ctx.suspend().catch(() => {});
    },
    play(counts) {
      if (!enabled || ctx.state !== "running") return;
      for (let b = 0; b < BUCKETS; b += 1) if (counts[b] > 0) click(b, counts[b]);
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
