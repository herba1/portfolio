const PROCESSOR = `
const hash = (n) => {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

const DELAY = 0.03;
const REACH = 0.08;

class SpliceHead extends AudioWorkletProcessor {
  constructor() {
    super();
    this.srcA = null;
    this.srcB = null;
    this.rate = 44100;
    this.loop = 5;
    this.offA = 0;
    this.offB = 0;
    this.half = 0.03;
    this.queue = [];
    this.clock = null;
    this.tracks = [this.track(), this.track()];
    this.lift = 1;
    this.lp = 0;
    this.dcx = 0;
    this.dcy = 0;
    this.shots = [];
    this.primed = false;
    this.port.onmessage = (e) => this.message(e.data);
  }

  track() {
    return { ph: 0, r: 0, old: null, fade: 0 };
  }

  message(m) {
    if (m.type === "init") {
      this.srcA = m.a;
      this.srcB = m.b;
      this.rate = m.rate;
      this.loop = m.a.length / m.rate;
      this.offA = m.offA;
      this.offB = m.offB;
      this.half = m.half;
    } else if (m.type === "t") {
      const est = currentTime - m.t;
      if (this.clock === null || Math.abs(est - this.clock) > 0.12) {
        this.clock = est;
        this.queue.length = 0;
      } else {
        this.clock += (est - this.clock) * 0.03;
      }
      if (!this.primed) {
        this.tracks[0].ph = m.a;
        this.tracks[1].ph = m.b;
        this.primed = true;
      }
      const q = this.queue;
      if (q.length && m.t <= q[q.length - 1].t) q[q.length - 1] = m;
      else q.push(m);
      if (q.length > 48) q.shift();
    } else if (m.type === "shot") {
      this.shots.push({ kind: m.kind, n: 0 });
    }
  }

  sample(src, t) {
    const n = src.length;
    const x = (((t % this.loop) + this.loop) % this.loop) * this.rate;
    const i1 = Math.floor(x);
    const f = x - i1;
    const a = src[(i1 - 1 + n) % n];
    const b = src[i1 % n];
    const c = src[(i1 + 1) % n];
    const d = src[(i1 + 2) % n];
    const c1 = 0.5 * (c - a);
    const c2 = a - 2.5 * b + 2 * c - 0.5 * d;
    const c3 = 0.5 * (d - a) + 1.5 * (b - c);
    return ((c3 * f + c2) * f + c1) * f + b;
  }

  at(tp) {
    const q = this.queue;
    if (!q.length) return null;
    if (tp <= q[0].t) return q[0];
    const last = q[q.length - 1];
    if (tp >= last.t) {
      if (q.length < 2) return last;
      const prev = q[q.length - 2];
      const span = Math.max(1e-4, last.t - prev.t);
      const ahead = Math.min(tp - last.t, REACH);
      return { ...last, a: last.a + ((last.a - prev.a) / span) * ahead, b: last.b + ((last.b - prev.b) / span) * ahead };
    }
    let i = q.length - 2;
    while (i > 0 && q[i].t > tp) i--;
    const p0 = q[i];
    const p1 = q[i + 1];
    const k = (tp - p0.t) / Math.max(1e-4, p1.t - p0.t);
    return { ...p0, a: p0.a + (p1.a - p0.a) * k, b: p0.b + (p1.b - p0.b) * k };
  }

  level(r) {
    const s = Math.abs(r);
    const g = Math.min(1, Math.max(0, (s - 0.012) / 0.1));
    return g * g * (3 - 2 * g) * Math.min(1, Math.pow(s, 0.45));
  }

  voice(tr, src, off) {
    if (!src) return 0;
    let x = this.sample(src, tr.ph + off) * this.level(tr.r);
    if (tr.old) {
      x = x * (1 - tr.fade) + this.sample(src, tr.old.ph + off) * this.level(tr.old.r) * tr.fade;
    }
    return x;
  }

  shot(s, sr) {
    const t = s.n / sr;
    s.n++;
    if (s.kind === "snick") {
      const noise = hash(s.n * 7 + 13) - hash(s.n * 7 + 12);
      return noise * Math.exp(-t / 0.0022) * 0.5 + Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-t / 0.01) * 0.05 + (t > 0.018 ? (hash(s.n + 99) - 0.5) * Math.exp(-(t - 0.018) / 0.0015) * 0.12 : 0);
    }
    if (s.kind === "tick") return (hash(s.n + 311) - 0.5) * Math.exp(-t / 0.0012) * 0.22;
    if (s.kind === "press") return Math.sin(2 * Math.PI * 85 * t) * Math.exp(-t / 0.025) * 0.16 + (hash(s.n + 51) - 0.5) * Math.exp(-t / 0.004) * 0.05;
    return 0;
  }

  process(_, outputs) {
    const out = outputs[0];
    const ch = out[0];
    if (!ch) return true;
    const sr = sampleRate;
    const n = ch.length;
    const kRate = 1 - Math.exp(-1 / (sr * 0.006));
    const kLift = 1 - Math.exp(-1 / (sr * 0.03));
    const t0 = currentTime - (this.clock || 0) - DELAY;
    const dur = n / sr;
    const s0 = this.clock === null ? null : this.at(t0);
    const s1 = this.clock === null ? null : this.at(t0 + dur);
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (s0 && s1 && this.srcA) {
        const k = i / n;
        const goals = [s0.a + (s1.a - s0.a) * k, s0.b + (s1.b - s0.b) * k];
        const slopes = [(s1.a - s0.a) / dur, (s1.b - s0.b) / dur];
        for (let j = 0; j < 2; j++) {
          const tr = this.tracks[j];
          const err = goals[j] - tr.ph;
          if (Math.abs(err) > 0.25) {
            tr.old = { ph: tr.ph, r: tr.r };
            tr.fade = 1;
            tr.ph = goals[j];
            tr.r = slopes[j];
          } else {
            const want = slopes[j] + Math.max(-3, Math.min(3, err * 30));
            tr.r += (want - tr.r) * kRate;
          }
          tr.ph += tr.r / sr;
          if (tr.old) {
            tr.old.ph += tr.old.r / sr;
            tr.fade -= 1 / (sr * 0.02);
            if (tr.fade <= 0) tr.old = null;
          }
        }
        const [ta, tb] = this.tracks;
        const span = 2 * this.half;
        const fa = s1.cutOn ? Math.min(1, Math.max(0, (s1.cut - ta.ph) / span + 0.5)) : 1;
        const fb = s1.bOn ? Math.min(1, Math.max(0, tb.ph / span + 0.5)) : 0;
        const cover = Math.min(1, fa + fb);
        const va = fa > 0 ? this.voice(ta, this.srcA, this.offA) * fa : 0;
        const vb = fb > 0 ? this.voice(tb, this.srcB, this.offB) * fb : 0;
        x = (va + vb) * (cover > 0 ? 1 : 0);
        const speed = Math.max(Math.abs(ta.r), Math.abs(tb.r));
        const c = speed > 1.4 ? Math.max(0.22, 1.4 / speed) : 1;
        this.lp += (x - this.lp) * c;
        x = this.lp;
        this.lift += (s1.lift - this.lift) * kLift;
        x *= this.lift;
      }
      for (let k = this.shots.length - 1; k >= 0; k--) {
        const s = this.shots[k];
        x += this.shot(s, sr);
        if (s.n > sr * 0.2) this.shots.splice(k, 1);
      }
      const y = x - this.dcx + 0.9965 * this.dcy;
      this.dcx = x;
      this.dcy = y;
      const v = Math.tanh(y * 1.05);
      for (let c2 = 0; c2 < out.length; c2++) out[c2][i] = v;
    }
    return true;
  }
}

registerProcessor("splice-head", SpliceHead);
`;

function parseWav(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint32(0, false) !== 0x52494646) return null;
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 0x666d7420) {
      fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 0x64617461 && fmt && fmt.format === 1 && fmt.bits === 16) {
      const frames = Math.floor(Math.min(size, view.byteLength - body) / (2 * fmt.channels));
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

function normalize(pcm, target) {
  let peak = 1e-4;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const gain = Math.min(8, target / peak);
  for (let i = 0; i < pcm.length; i++) pcm[i] *= gain;
  return pcm;
}

export async function loadBeat(url) {
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  const parsed = parseWav(bytes);
  if (parsed) {
    normalize(parsed.pcm, 0.8);
    return parsed;
  }
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(1, 44100, 44100);
  const decoded = await ctx.decodeAudioData(bytes);
  const pcm = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / decoded.numberOfChannels;
  }
  normalize(pcm, 0.8);
  return { pcm, rate: decoded.sampleRate };
}

export function secondReel(beat) {
  const { pcm, rate } = beat;
  const n = pcm.length;
  const shift = Math.round(rate * 0.125);
  const hpA = 1 - Math.exp((-2 * Math.PI * 2400) / rate);
  const lpA = 1 - Math.exp((-2 * Math.PI * 5200) / rate);
  const out = new Float32Array(n);
  let low = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = pcm[(i - shift + n) % n];
      low += (x - low) * hpA;
      if (pass === 1) out[i] = x - low;
    }
  }
  let tone = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = pcm[i] * 1.08 + out[i] * 0.62;
      tone += (x - tone) * lpA;
      if (pass === 1) out[i] = Math.tanh(tone * 1.35);
    }
  }
  normalize(out, 0.8);
  return { pcm: out, rate };
}

export function waveRows(beats, width = 2048) {
  const data = new Uint8Array(width * beats.length * 4);
  beats.forEach((beat, row) => {
    const { pcm } = beat;
    const per = pcm.length / width;
    const env = new Float32Array(width);
    let max = 1e-6;
    for (let i = 0; i < width; i++) {
      const a = Math.floor(i * per);
      const b = Math.max(a + 1, Math.floor((i + 1) * per));
      let sum = 0;
      for (let k = a; k < b; k++) sum += pcm[k] * pcm[k];
      env[i] = Math.sqrt(sum / (b - a));
      max = Math.max(max, env[i]);
    }
    const smooth = new Float32Array(width);
    for (let i = 0; i < width; i++) {
      const prev = env[(i - 1 + width) % width];
      const next = env[(i + 1) % width];
      smooth[i] = env[i] * 0.6 + prev * 0.2 + next * 0.2;
    }
    for (let i = 0; i < width; i++) {
      const e = Math.pow(Math.min(1, smooth[i] / max), 0.62);
      const o = (row * width + i) * 4;
      data[o] = Math.round(e * 255);
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  });
  return { width, height: beats.length, data };
}

export function createSpliceAudio() {
  let ctx = null;
  let node = null;
  let master = null;
  let url = null;
  let sources = null;
  let muted = false;
  let wanted = false;
  let inited = false;

  function init() {
    if (!node || !sources || inited) return;
    node.port.postMessage({ type: "init", a: sources.a.slice(), b: sources.b.slice(), rate: sources.rate, offA: sources.offA, offB: sources.offB, half: sources.half });
    inited = true;
  }

  function prepare(next) {
    sources = next;
    init();
  }

  function start() {
    wanted = true;
    if (ctx) {
      if (!muted && ctx.state !== "running") ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx({ latencyHint: "interactive" });
    ctx.resume().catch(() => {});
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    url = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
    ctx.audioWorklet
      .addModule(url)
      .then(() => {
        if (!ctx) return;
        node = new AudioWorkletNode(ctx, "splice-head", { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(master);
        init();
        master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.04);
      })
      .catch(() => {});
  }

  function update(frame) {
    if (!node) return;
    node.port.postMessage(frame);
  }

  function shot(kind) {
    if (node && !muted) node.port.postMessage({ type: "shot", kind });
  }

  function setMuted(next) {
    muted = next;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.03);
    if (!muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function sleep() {
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function wake() {
    if (ctx && wanted && !muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function destroy() {
    if (node) node.disconnect();
    if (ctx) ctx.close().catch(() => {});
    if (url) URL.revokeObjectURL(url);
    ctx = null;
    node = null;
  }

  return {
    prepare,
    start,
    update,
    shot,
    setMuted,
    sleep,
    wake,
    destroy,
    get started() {
      return Boolean(ctx);
    },
  };
}
