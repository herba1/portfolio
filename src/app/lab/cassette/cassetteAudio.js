const PROCESSOR = `
const hash = (n) => {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296 - 0.5;
};

class CassetteChatter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pcm = null;
    this.src = 44100;
    this.ph = 0;
    this.rate = 0;
    this.wantRate = 0;
    this.gain = 0;
    this.wantGain = 0;
    this.lp = 0;
    this.lp2 = 0;
    this.hp = 0;
    this.hpx = 0;
    this.n = 0;
    this.tick = -1;
    this.tickAmp = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "init") {
        this.pcm = m.pcm;
        this.src = m.rate;
      } else if (m.type === "t") {
        this.wantRate = m.rate;
        this.wantGain = m.gain;
      } else if (m.type === "tick") {
        this.tick = 0;
        this.tickAmp = m.amp;
      }
    };
  }

  sample(t) {
    const pcm = this.pcm;
    const n = pcm.length;
    const x = (((t * this.src) % n) + n) % n;
    const i1 = Math.floor(x);
    const f = x - i1;
    const a = pcm[(i1 - 1 + n) % n];
    const b = pcm[i1];
    const c = pcm[(i1 + 1) % n];
    const d = pcm[(i1 + 2) % n];
    const c1 = 0.5 * (c - a);
    const c2 = a - 2.5 * b + 2 * c - 0.5 * d;
    const c3 = 0.5 * (d - a) + 1.5 * (b - c);
    return ((c3 * f + c2) * f + c1) * f + b;
  }

  process(_, outputs) {
    const out = outputs[0];
    const ch = out[0];
    if (!ch) return true;
    const sr = sampleRate;
    const kRate = 1 - Math.exp(-1 / (sr * 0.03));
    const kGain = 1 - Math.exp(-1 / (sr * 0.02));
    for (let i = 0; i < ch.length; i++) {
      this.rate += (this.wantRate - this.rate) * kRate;
      this.gain += (this.wantGain - this.gain) * kGain;
      let x = 0;
      if (this.pcm) {
        this.ph += this.rate / sr;
        x = this.sample(this.ph);
      }
      const speed = Math.min(6, Math.abs(this.rate));
      const cut = Math.min(0.6, 0.06 + speed * 0.05);
      this.lp += (x - this.lp) * cut;
      this.lp2 += (this.lp - this.lp2) * cut;
      this.n++;
      const hiss = hash(this.n) * 0.05 * Math.min(1, speed / 3);
      let y = (this.lp2 * 0.8 + hiss) * this.gain;
      if (this.tick >= 0) {
        const t = this.tick / sr;
        y += (hash(this.tick + 977) * 0.9 + Math.sin(t * 2 * Math.PI * 1900) * 0.4) * Math.exp(-t / 0.004) * this.tickAmp;
        this.tick++;
        if (t > 0.04) this.tick = -1;
      }
      const hp = y - this.hpx + 0.995 * this.hp;
      this.hpx = y;
      this.hp = hp;
      const v = Math.tanh(hp * 1.2);
      for (let c = 0; c < out.length; c++) out[c][i] = v;
    }
    return true;
  }
}

registerProcessor("cassette-chatter", CassetteChatter);
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

async function songUrl(song) {
  if (!song?.title) return null;
  if (song.previewUrl) return song.previewUrl;
  const query = new URLSearchParams({ artist: song.artist || "", title: song.title });
  const response = await fetch(`/api/spotify/preview?${query}`);
  if (!response.ok) return null;
  const data = await response.json();
  return data?.url || null;
}

async function loadFirst(song, fallback) {
  const url = await songUrl(song).catch(() => null);
  if (!url) return loadBeat(fallback);
  return loadBeat(url).catch(() => loadBeat(fallback));
}

async function loadBeat(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`audio ${response.status}`);
  const bytes = await response.arrayBuffer();
  const parsed = parseWav(bytes);
  let beat = parsed;
  if (!beat) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Offline(1, 44100, 44100);
    const decoded = await ctx.decodeAudioData(bytes);
    const pcm = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < pcm.length; i++) pcm[i] += data[i] / decoded.numberOfChannels;
    }
    beat = { pcm, rate: decoded.sampleRate };
  }
  let peak = 1e-4;
  for (let i = 0; i < beat.pcm.length; i++) peak = Math.max(peak, Math.abs(beat.pcm[i]));
  const gain = Math.min(8, 0.8 / peak);
  for (let i = 0; i < beat.pcm.length; i++) beat.pcm[i] *= gain;
  return beat;
}

export function createChatter(url, getSong) {
  let ctx = null;
  let node = null;
  let master = null;
  let moduleUrl = null;
  let muted = false;
  let destroyed = false;

  function start() {
    if (ctx || destroyed) {
      if (ctx && !muted) ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx({ latencyHint: "interactive" });
    ctx.resume().catch(() => {});
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    moduleUrl = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
    Promise.all([ctx.audioWorklet.addModule(moduleUrl), loadFirst(getSong?.(), url)])
      .then(([, beat]) => {
        if (!ctx || destroyed) return;
        node = new AudioWorkletNode(ctx, "cassette-chatter", { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.postMessage({ type: "init", pcm: beat.pcm, rate: beat.rate });
        node.connect(master);
        master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
      })
      .catch(() => {});
  }

  function update(rate, gain) {
    if (node) node.port.postMessage({ type: "t", rate, gain });
  }

  function tick(amp) {
    if (node && !muted) node.port.postMessage({ type: "tick", amp });
  }

  function setMuted(next) {
    muted = next;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.03);
    if (!muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function sleep() {
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function wake() {
    if (ctx && !muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  function destroy() {
    destroyed = true;
    if (node) node.disconnect();
    if (ctx) ctx.close().catch(() => {});
    if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    ctx = null;
    node = null;
  }

  return {
    start,
    update,
    tick,
    setMuted,
    sleep,
    wake,
    destroy,
    get started() {
      return Boolean(ctx);
    },
  };
}
