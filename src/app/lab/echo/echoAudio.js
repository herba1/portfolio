const SCALE = [0, 2, 4, 7, 9];
const BASE = 196;

export const WOW_HZ = 0.55;
export const FLUTTER_HZ = 6.3;

export function noteFor(ch) {
  const code = ch.toLowerCase().charCodeAt(0);
  if (code >= 97 && code <= 122) {
    const deg = ((code - 97) * 3) % 11;
    return BASE * Math.pow(2, (SCALE[deg % 5] + 12 * Math.floor(deg / 5)) / 12);
  }
  if (code >= 48 && code <= 57) return BASE * 2 * Math.pow(2, SCALE[(code - 48) % 5] / 12);
  return BASE * 4;
}

export function createEchoSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });

  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master.connect(comp);
  comp.connect(ctx.destination);

  const bus = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 0.85;
  bus.connect(dry);
  dry.connect(master);

  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.3;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2400;
  tone.Q.value = 0.4;
  const thin = ctx.createBiquadFilter();
  thin.type = "highpass";
  thin.frequency.value = 160;
  const sat = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.6) / 1.6;
  }
  sat.curve = curve;
  const fb = ctx.createGain();
  fb.gain.value = 0.6;
  const wet = ctx.createGain();
  wet.gain.value = 1;
  bus.connect(delay);
  delay.connect(tone);
  tone.connect(thin);
  thin.connect(sat);
  sat.connect(fb);
  fb.connect(delay);
  fb.connect(wet);
  wet.connect(master);

  const wow = ctx.createOscillator();
  wow.frequency.value = WOW_HZ;
  const wowDepth = ctx.createGain();
  wowDepth.gain.value = 0.0024;
  wow.connect(wowDepth);
  wowDepth.connect(delay.delayTime);
  const flutter = ctx.createOscillator();
  flutter.frequency.value = FLUTTER_HZ;
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.value = 0.00032;
  flutter.connect(flutterDepth);
  flutterDepth.connect(delay.delayTime);
  wow.start();
  flutter.start();

  const hissLen = ctx.sampleRate * 2;
  const hissBuf = ctx.createBuffer(1, hissLen, ctx.sampleRate);
  const hd = hissBuf.getChannelData(0);
  let seed = 31337;
  for (let i = 0; i < hissLen; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    hd[i] = (seed / 4294967296) * 2 - 1;
  }
  const hiss = ctx.createBufferSource();
  hiss.buffer = hissBuf;
  hiss.loop = true;
  const hissTone = ctx.createBiquadFilter();
  hissTone.type = "bandpass";
  hissTone.frequency.value = 5200;
  hissTone.Q.value = 0.5;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.0035;
  hiss.connect(hissTone);
  hissTone.connect(hissGain);
  hissGain.connect(master);
  hiss.start();

  let enabled = false;

  const note = (freq, pan, velocity = 1) => {
    if (!enabled || ctx.state !== "running") return;
    const at = ctx.currentTime + 0.005;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.13 * velocity, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.04 * velocity, at + 0.16);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, at);
    lp.frequency.exponentialRampToValueAtTime(900, at + 0.6);
    lp.Q.value = 0.3;
    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = freq;
    const b = ctx.createOscillator();
    b.type = "triangle";
    b.frequency.value = freq * 2;
    b.detune.value = 4;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.22;
    a.connect(lp);
    b.connect(bGain);
    bGain.connect(lp);
    lp.connect(env);
    let tail = env;
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.6, Math.min(0.6, pan));
      env.connect(panner);
      tail = panner;
    }
    tail.connect(bus);
    a.start(at);
    b.start(at);
    a.stop(at + 1.6);
    b.stop(at + 1.6);
    a.onended = () => {
      env.disconnect();
      lp.disconnect();
      bGain.disconnect();
      panner?.disconnect();
    };
  };

  return {
    get running() {
      return enabled && ctx.state === "running";
    },
    get time() {
      return ctx.currentTime;
    },
    async enable() {
      enabled = true;
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      if (ctx.state !== "running") return false;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0, now);
      master.gain.linearRampToValueAtTime(0.9, now + 0.3);
      return true;
    },
    resume() {
      if (enabled && ctx.state !== "running") ctx.resume().catch(() => {});
    },
    suspend() {
      if (ctx.state === "running") ctx.suspend().catch(() => {});
    },
    setTape(time, feedback) {
      const now = ctx.currentTime;
      delay.delayTime.setTargetAtTime(time, now, 0.09);
      fb.gain.setTargetAtTime(feedback, now, 0.05);
    },
    note,
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
