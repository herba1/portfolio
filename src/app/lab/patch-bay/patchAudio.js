const CRUSH = `
class PatchCrush extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bits = 8;
    this.hold = 4;
    this.target = { bits: 8, hold: 4 };
    this.count = [0, 0];
    this.last = [0, 0];
    this.port.onmessage = (e) => {
      this.target = e.data;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    this.bits += (this.target.bits - this.bits) * 0.02;
    this.hold += (this.target.hold - this.hold) * 0.02;
    const steps = Math.pow(2, Math.max(1, Math.min(16, this.bits)));
    const hold = Math.max(1, Math.round(this.hold));
    for (let c = 0; c < output.length; c += 1) {
      const src = input[c] || input[0];
      const dst = output[c];
      if (!src) {
        dst.fill(0);
        continue;
      }
      let count = this.count[c] || 0;
      let last = this.last[c] || 0;
      for (let i = 0; i < dst.length; i += 1) {
        if (count <= 0) {
          last = Math.round(src[i] * steps * 0.5) / (steps * 0.5);
          count = hold;
        }
        count -= 1;
        dst[i] = last;
      }
      this.count[c] = count;
      this.last[c] = last;
    }
    return true;
  }
}
registerProcessor("patch-crush", PatchCrush);
`;

function noiseRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roomImpulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c += 1) {
    const random = noiseRng(17 + c * 101);
    const data = buffer.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / rate;
      const env = Math.pow(1 - i / length, 2.2) * Math.exp(-t * 2.4);
      const early = t < 0.08 ? 0.6 : 1;
      const n = random() * 2 - 1;
      const damp = 0.18 + 0.8 * Math.exp(-t * 3);
      lp += (n - lp) * damp;
      data[i] = lp * env * early;
    }
  }
  return buffer;
}

function saturator(ctx, drive) {
  const node = ctx.createWaveShaper();
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  node.curve = curve;
  return node;
}

function makeLowpass(ctx) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 3.2;
  return {
    input: filter,
    output: filter,
    set(v, now) {
      const f = 160 * Math.pow(2, v * 6.9);
      filter.frequency.setTargetAtTime(f, now, 0.03);
    },
  };
}

function makeEcho(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(1.5);
  const feedback = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  const low = ctx.createBiquadFilter();
  const wet = ctx.createGain();
  const sat = saturator(ctx, 1.6);
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  low.type = "highpass";
  low.frequency.value = 160;
  feedback.gain.value = 0.46;
  wet.gain.value = 0.62;
  input.connect(output);
  input.connect(delay);
  delay.connect(tone);
  tone.connect(low);
  low.connect(sat);
  sat.connect(feedback);
  feedback.connect(delay);
  sat.connect(wet);
  wet.connect(output);
  return {
    input,
    output,
    set(v, now) {
      delay.delayTime.setTargetAtTime(0.09 + v * 0.48, now, 0.12);
    },
  };
}

function makeWobble(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.014;
  const slow = ctx.createOscillator();
  const fast = ctx.createOscillator();
  const slowDepth = ctx.createGain();
  const fastDepth = ctx.createGain();
  slow.frequency.value = 0.9;
  fast.frequency.value = 6.3;
  slow.connect(slowDepth);
  fast.connect(fastDepth);
  slowDepth.connect(delay.delayTime);
  fastDepth.connect(delay.delayTime);
  slow.start();
  fast.start();
  input.connect(delay);
  delay.connect(output);
  return {
    input,
    output,
    set(v, now) {
      slowDepth.gain.setTargetAtTime(0.0002 + v * 0.0062, now, 0.06);
      fastDepth.gain.setTargetAtTime(0.00004 + v * 0.0004, now, 0.06);
      slow.frequency.setTargetAtTime(0.5 + v * 1.1, now, 0.1);
    },
    stop() {
      slow.stop();
      fast.stop();
    },
  };
}

function makeCrush(ctx, node) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const makeup = ctx.createGain();
  makeup.gain.value = 0.9;
  if (node) {
    input.connect(node);
    node.connect(makeup);
  } else {
    const sat = saturator(ctx, 4);
    input.connect(sat);
    sat.connect(makeup);
  }
  makeup.connect(output);
  return {
    input,
    output,
    set(v) {
      if (!node) return;
      node.port.postMessage({ bits: 12 - v * 9, hold: 1 + Math.round(v * v * 9) });
    },
  };
}

function makeRoom(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const conv = ctx.createConvolver();
  const pre = ctx.createDelay(0.1);
  pre.delayTime.value = 0.018;
  conv.buffer = roomImpulse(ctx, 2.8);
  input.connect(dry);
  input.connect(pre);
  pre.connect(conv);
  conv.connect(wet);
  dry.connect(output);
  wet.connect(output);
  return {
    input,
    output,
    set(v, now) {
      wet.gain.setTargetAtTime(v * 1.1, now, 0.05);
      dry.gain.setTargetAtTime(1 - v * 0.5, now, 0.05);
    },
  };
}

export function createPatchAudio() {
  let ctx = null;
  let source = null;
  let pre = null;
  let bus = null;
  let master = null;
  let analyser = null;
  let scope = null;
  let effects = null;
  let order = [];
  let knobs = {};
  let muted = false;
  let wanted = false;
  let loading = null;
  let url = null;
  let rewire = 0;
  let destroyed = false;
  let trim = 1;
  let limiter = null;

  function connectChain() {
    if (!ctx || !effects) return;
    pre.disconnect();
    for (const id of Object.keys(effects)) effects[id].output.disconnect();
    let node = pre;
    for (const id of order) {
      const fx = effects[id];
      if (!fx) continue;
      node.connect(fx.input);
      node = fx.output;
    }
    node.connect(bus);
  }

  function applyKnob(id, v) {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (id === "source") pre.gain.setTargetAtTime(v * 1.25 * trim, now, 0.03);
    else if (id === "output") master.gain.setTargetAtTime(muted ? 0 : v * v * 1.1, now, 0.03);
    else effects?.[id]?.set(v, now);
  }

  async function build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx({ latencyHint: "interactive" });
    ctx.resume().catch(() => {});
    pre = ctx.createGain();
    bus = ctx.createGain();
    master = ctx.createGain();
    master.gain.value = 0;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    scope = new Float32Array(analyser.fftSize);
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    bus.connect(limiter);
    limiter.connect(master);
    master.connect(analyser);
    analyser.connect(ctx.destination);
    let crushNode = null;
    try {
      url = URL.createObjectURL(new Blob([CRUSH], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      crushNode = new AudioWorkletNode(ctx, "patch-crush", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    } catch {
      crushNode = null;
    }
    if (destroyed) return;
    effects = {
      lowpass: makeLowpass(ctx),
      echo: makeEcho(ctx),
      wobble: makeWobble(ctx),
      crush: makeCrush(ctx, crushNode),
      room: makeRoom(ctx),
    };
    const response = await fetch("/blog/audio/friday-beat.wav");
    const bytes = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    if (destroyed) return;
    let peak = 1e-4;
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    }
    trim = Math.min(6, 0.8 / peak);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(pre);
    for (const [id, v] of Object.entries(knobs)) applyKnob(id, v);
    connectChain();
    source.start();
    applyKnob("output", knobs.output ?? 0.78);
  }

  function start() {
    wanted = true;
    if (ctx) {
      if (!muted) ctx.resume().catch(() => {});
      return loading;
    }
    loading = build().catch(() => {});
    return loading;
  }

  function setChain(next) {
    const same = next.length === order.length && next.every((id, i) => id === order[i]);
    order = next.slice();
    if (same || !ctx || !effects) return;
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(0, now, 0.006);
    clearTimeout(rewire);
    rewire = setTimeout(() => {
      if (!ctx) return;
      connectChain();
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(1, t, 0.012);
    }, 32);
  }

  function setKnob(id, v) {
    knobs[id] = v;
    applyKnob(id, v);
  }

  function setMuted(next) {
    muted = next;
    if (!ctx) return;
    applyKnob("output", knobs.output ?? 0.78);
    if (!muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function click(strength) {
    if (!ctx || muted || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const random = noiseRng(Math.floor(strength * 1000) + 5);
    for (let i = 0; i < len; i += 1) {
      const t = i / ctx.sampleRate;
      data[i] = (random() * 2 - 1) * Math.exp(-t / 0.0025) * 0.5 + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.008) * 0.4;
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.18 * strength;
    node.connect(gain);
    gain.connect(master);
    node.start(now);
  }

  function level() {
    if (!analyser || !ctx || ctx.state !== "running" || muted) return 0;
    analyser.getFloatTimeDomainData(scope);
    let sum = 0;
    for (let i = 0; i < scope.length; i += 1) sum += scope[i] * scope[i];
    return Math.sqrt(sum / scope.length);
  }

  function sleep() {
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function wake() {
    if (ctx && wanted && !muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function destroy() {
    destroyed = true;
    clearTimeout(rewire);
    try {
      source?.stop();
      effects?.wobble?.stop();
    } catch {
      source = null;
    }
    if (ctx) ctx.close().catch(() => {});
    if (url) URL.revokeObjectURL(url);
    ctx = null;
  }

  return {
    start,
    setChain,
    setKnob,
    setMuted,
    click,
    level,
    sleep,
    wake,
    destroy,
    get playing() {
      return Boolean(ctx && source && wanted && !muted);
    },
  };
}
