const PROCESSOR = `
const hash = (n) => {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

class NeedleDeck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pcm = null;
    this.src = 44100;
    this.loop = 5;
    this.segments = [];
    this.lock = 0;
    this.lockEnd = 0;
    this.ph = 0;
    this.rate = 0;
    this.target = { pos: 0, vel: 0, at: 0 };
    this.down = 0;
    this.gain = 0;
    this.old = null;
    this.fade = 0;
    this.dcx = 0;
    this.dcy = 0;
    this.lp = 0;
    this.thump = -1;
    this.tick = -1;
    this.seg = 0;
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    if (m.type === "init") {
      this.pcm = m.pcm;
      this.src = m.rate;
      this.loop = m.loop;
      this.segments = m.segments;
      this.lock = m.lock;
      this.lockEnd = m.lockEnd;
      this.ph = m.pos;
      this.target = { pos: m.pos, vel: 0, at: currentTime };
    } else if (m.type === "t") {
      this.target = { pos: m.pos, vel: m.vel, at: m.at };
      this.down = m.down ? 1 : 0;
    } else if (m.type === "drop") {
      this.thump = 0;
      this.ph = m.pos;
      this.old = null;
      this.target = { pos: m.pos, vel: m.vel, at: currentTime };
      this.rate = m.vel;
    } else if (m.type === "lift") {
      this.tick = 0;
    }
  }

  music(t) {
    const segs = this.segments;
    let i = this.seg;
    if (i >= segs.length || t < segs[i].t0 || t >= segs[i].t1) {
      i = 0;
      while (i < segs.length - 1 && t >= segs[i].t1) i++;
      this.seg = i;
    }
    const s = segs[i];
    if (!s || !s.music || t < s.t0 || t >= s.t1) return 0;
    const edge = Math.min(1, (t - s.t0) / 0.004, (s.t1 - t) / 0.004);
    const pcm = this.pcm;
    const n = pcm.length;
    let x = ((t - s.t0) % this.loop) * this.src;
    const i1 = Math.floor(x);
    const f = x - i1;
    const a = pcm[(i1 - 1 + n) % n];
    const b = pcm[i1 % n];
    const c = pcm[(i1 + 1) % n];
    const d = pcm[(i1 + 2) % n];
    const c1 = 0.5 * (c - a);
    const c2 = a - 2.5 * b + 2 * c - 0.5 * d;
    const c3 = 0.5 * (d - a) + 1.5 * (b - c);
    return (((c3 * f + c2) * f + c1) * f + b) * edge;
  }

  surface(t) {
    const x = t * 7000;
    const k = Math.floor(x);
    const f = x - k;
    const hiss = (hash(k) * (1 - f) + hash(k + 1) * f - 0.5) * 0.009;
    const slot = Math.floor(t * 9);
    let pop = 0;
    const h = hash(slot * 7919 + 13);
    if (h > 0.972) {
      const at = (slot + 0.2 + 0.6 * hash(slot * 31 + 7)) / 9;
      const d = (t - at) * 44100;
      const amp = (h - 0.972) * 4.2 * (hash(slot + 99) > 0.5 ? 1 : -1);
      pop = amp * Math.exp(-Math.abs(d) / 5) * (d < 0 ? 0.6 : 1);
    }
    if (t >= this.lock) {
      const d = (t - (this.lock + 0.9)) * 44100;
      pop += 0.07 * Math.exp(-Math.abs(d) / 6);
    }
    return hiss + pop;
  }

  side(t) {
    if (!this.pcm || t < 0) return 0;
    return this.music(t) * 0.8 + this.surface(t);
  }

  process(_, outputs) {
    const out = outputs[0];
    const ch = out[0];
    if (!ch) return true;
    const sr = sampleRate;
    const kRate = 1 - Math.exp(-1 / (sr * 0.007));
    const kGain = 1 - Math.exp(-1 / (sr * 0.005));
    const tg = this.target;
    for (let i = 0; i < ch.length; i++) {
      const now = currentTime + i / sr;
      const age = Math.min(0.05, Math.max(0, now - tg.at));
      const tp = tg.pos + tg.vel * age;
      const err = tp - this.ph;
      if (Math.abs(err) > 0.3) {
        this.old = { ph: this.ph, rate: this.rate };
        this.fade = 1;
        this.ph = tp;
        this.rate = tg.vel;
      } else {
        const want = tg.vel + Math.max(-3, Math.min(3, err * 14));
        this.rate += (want - this.rate) * kRate;
      }
      this.ph += this.rate / sr;
      if (this.ph >= this.lockEnd) this.ph -= this.lockEnd - this.lock;
      this.gain += (this.down - this.gain) * kGain;
      const speed = Math.abs(this.rate);
      const sg = speed >= 0.14 ? 1 : (speed / 0.14) * (speed / 0.14) * (3 - 2 * (speed / 0.14));
      let x = this.side(this.ph) * sg;
      if (this.old && this.fade > 0) {
        this.old.ph += this.old.rate / sr;
        const os = Math.min(1, Math.abs(this.old.rate) / 0.14);
        x = x * (1 - this.fade) + this.side(this.old.ph) * os * this.fade;
        this.fade -= 1 / (sr * 0.018);
        if (this.fade <= 0) this.old = null;
      }
      const c = speed > 1.6 ? Math.max(0.3, 1.6 / speed) : 1;
      this.lp += (x - this.lp) * c;
      x = this.lp * this.gain;
      if (this.thump >= 0) {
        const t = this.thump / sr;
        x += Math.sin(2 * Math.PI * 52 * t) * Math.exp(-t / 0.045) * 0.32 + (hash(this.thump + 4711) - 0.5) * Math.exp(-t / 0.003) * 0.3;
        this.thump++;
        if (t > 0.3) this.thump = -1;
      }
      if (this.tick >= 0) {
        const t = this.tick / sr;
        x += (hash(this.tick + 977) - 0.5) * Math.exp(-t / 0.002) * 0.12;
        this.tick++;
        if (t > 0.03) this.tick = -1;
      }
      const y = x - this.dcx + 0.9965 * this.dcy;
      this.dcx = x;
      this.dcy = y;
      const v = Math.tanh(y * 1.1);
      for (let c2 = 0; c2 < out.length; c2++) out[c2][i] = v;
    }
    return true;
  }
}

registerProcessor("needle-deck", NeedleDeck);
`;

function parseWav(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x52494646) return null;
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 0x666d7420) {
      fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 0x64617461 && fmt && fmt.format === 1 && fmt.bits === 16) {
      const frames = Math.floor(size / (2 * fmt.channels));
      const pcm = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) sum += view.getInt16(body + (i * fmt.channels + c) * 2, true);
        pcm[i] = sum / (fmt.channels * 32768);
      }
      return { pcm, rate: fmt.rate };
    }
    offset = body + size + (size & 1);
  }
  return null;
}

function normalize(beat) {
  let peak = 1e-4;
  for (let i = 0; i < beat.pcm.length; i++) peak = Math.max(peak, Math.abs(beat.pcm[i]));
  const gain = Math.min(8, 0.85 / peak);
  for (let i = 0; i < beat.pcm.length; i++) beat.pcm[i] *= gain;
  return beat;
}

export async function loadBeat(url) {
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  const parsed = parseWav(bytes);
  if (parsed) return normalize(parsed);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(1, 44100, 44100);
  const decoded = await ctx.decodeAudioData(bytes);
  const pcm = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / decoded.numberOfChannels;
  }
  return normalize({ pcm, rate: decoded.sampleRate });
}

export function grooveTexture(beat) {
  const { pcm, rate } = beat;
  const width = 2048;
  const data = new Uint8Array(width * 4);
  const per = pcm.length / width;
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 140) / rate);
  let low = 0;
  for (let k = 0; k < Math.min(pcm.length, rate); k++) low += (pcm[k] - low) * lowAlpha;
  const env = new Float32Array(width);
  const slope = new Float32Array(width);
  let prevLow = low;
  let maxEnv = 1e-6;
  let maxSlope = 1e-6;
  for (let i = 0; i < width; i++) {
    const a = Math.floor(i * per);
    const b = Math.floor((i + 1) * per);
    let sum = 0;
    for (let k = a; k < b; k++) {
      sum += pcm[k] * pcm[k];
      low += (pcm[k] - low) * lowAlpha;
    }
    env[i] = Math.sqrt(sum / Math.max(1, b - a));
    slope[i] = low - prevLow;
    prevLow = low;
    maxEnv = Math.max(maxEnv, env[i]);
    maxSlope = Math.max(maxSlope, Math.abs(slope[i]));
  }
  for (let i = 0; i < width; i++) {
    const e = Math.pow(env[i] / maxEnv, 0.7);
    const s = slope[i] / maxSlope;
    data[i * 4] = Math.round(Math.min(1, e) * 255);
    data[i * 4 + 1] = Math.round((Math.max(-1, Math.min(1, s)) * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return { width, data };
}

export function createDeckAudio() {
  let ctx = null;
  let node = null;
  let master = null;
  let analyser = null;
  let scope = null;
  let beat = null;
  let side = null;
  let pending = null;
  let muted = false;
  let wanted = false;
  let url = null;
  let lastSent = null;

  function prepare(nextBeat, nextSide) {
    beat = nextBeat;
    side = nextSide;
    if (ctx && node && !node.inited) init(0);
  }

  function init(pos) {
    if (!node || !beat || !side) return;
    const segments = side.segments.map((s) => ({ t0: s.t0, t1: s.pitch === 0 ? Infinity : s.t1, music: s.music }));
    node.port.postMessage({ type: "init", pcm: beat.pcm.slice(), rate: beat.rate, loop: beat.pcm.length / beat.rate, segments, lock: side.tLock, lockEnd: side.lockEnd, pos });
    node.inited = true;
  }

  function start(pos) {
    wanted = true;
    if (ctx) {
      if (!muted) ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx({ latencyHint: "interactive" });
    ctx.resume().catch(() => {});
    master = ctx.createGain();
    master.gain.value = 0;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    scope = new Float32Array(analyser.fftSize);
    master.connect(analyser);
    analyser.connect(ctx.destination);
    url = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
    pending = ctx.audioWorklet
      .addModule(url)
      .then(() => {
        if (!ctx) return;
        node = new AudioWorkletNode(ctx, "needle-deck", { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(master);
        init(pos);
        if (lastSent) node.port.postMessage({ ...lastSent, at: ctx.currentTime });
        master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.04);
      })
      .catch(() => {});
  }

  function update(pos, vel, down) {
    lastSent = { type: "t", pos, vel, down };
    if (!node || !ctx) return;
    node.port.postMessage({ type: "t", pos, vel, down, at: ctx.currentTime });
  }

  function drop(pos, vel) {
    if (node) node.port.postMessage({ type: "drop", pos, vel });
  }

  function lift() {
    if (node) node.port.postMessage({ type: "lift" });
  }

  function setMuted(next) {
    muted = next;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.03);
    if (!muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function sleep() {
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function wake() {
    if (ctx && wanted && !muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function level() {
    if (!analyser || !ctx || ctx.state !== "running" || muted) return 0;
    analyser.getFloatTimeDomainData(scope);
    let sum = 0;
    for (let i = 0; i < scope.length; i++) sum += scope[i] * scope[i];
    return Math.sqrt(sum / scope.length);
  }

  function destroy() {
    if (node) node.disconnect();
    if (ctx) ctx.close().catch(() => {});
    if (url) URL.revokeObjectURL(url);
    ctx = null;
    node = null;
    pending = null;
  }

  return {
    prepare,
    start,
    update,
    drop,
    lift,
    setMuted,
    sleep,
    wake,
    level,
    destroy,
    get started() {
      return Boolean(ctx);
    },
    get ready() {
      return Boolean(node);
    },
    get pending() {
      return pending;
    },
  };
}
