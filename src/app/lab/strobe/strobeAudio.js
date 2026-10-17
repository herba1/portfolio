const PROCESSOR = `
const hash = (n) => {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

class StrobeDeck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pcm = null;
    this.src = 44100;
    this.len = 0;
    this.ph = 0;
    this.rate = 0;
    this.target = 0;
    this.click = -1;
    this.clickAmp = 0;
    this.lp = 0;
    this.dcx = 0;
    this.dcy = 0;
    this.n = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "init") {
        this.pcm = m.pcm;
        this.src = m.rate;
        this.len = m.pcm.length;
      } else if (m.type === "rate") {
        this.target = m.rate;
      } else if (m.type === "click") {
        this.click = 0;
        this.clickAmp = m.amp;
      }
    };
  }

  sample(x) {
    const pcm = this.pcm;
    const n = this.len;
    const i1 = Math.floor(x);
    const f = x - i1;
    const a = pcm[((i1 - 1) % n + n) % n];
    const b = pcm[(i1 % n + n) % n];
    const c = pcm[((i1 + 1) % n + n) % n];
    const d = pcm[((i1 + 2) % n + n) % n];
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
    const k = 1 - Math.exp(-1 / (sr * 0.012));
    for (let i = 0; i < ch.length; i++) {
      this.rate += (this.target - this.rate) * k;
      let x = 0;
      if (this.pcm) {
        this.ph += (this.rate * this.src) / sr;
        if (this.ph >= this.len) this.ph -= this.len;
        if (this.ph < 0) this.ph += this.len;
        const speed = Math.abs(this.rate);
        const g = speed >= 0.18 ? 1 : (speed / 0.18) * (speed / 0.18) * (3 - 2 * (speed / 0.18));
        const cut = Math.min(1, 0.08 + speed * 1.1);
        this.lp += (this.sample(this.ph) - this.lp) * cut;
        const hiss = (hash(this.n++) - 0.5) * 0.004 * Math.min(1, speed);
        x = (this.lp * 0.9 + hiss) * g;
      }
      if (this.click >= 0) {
        const t = this.click / sr;
        x += (Math.sin(2 * Math.PI * 2400 * t) * 0.4 + (hash(this.click + 313) - 0.5)) * Math.exp(-t / 0.0016) * this.clickAmp;
        this.click++;
        if (t > 0.02) this.click = -1;
      }
      const y = x - this.dcx + 0.997 * this.dcy;
      this.dcx = x;
      this.dcy = y;
      const v = Math.tanh(y * 1.05);
      for (let c2 = 0; c2 < out.length; c2++) out[c2][i] = v;
    }
    return true;
  }
}

registerProcessor("strobe-deck", StrobeDeck);
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

async function loadBeat(url) {
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  let beat = parseWav(bytes);
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

export function createDeckAudio(url) {
  let ctx = null;
  let node = null;
  let master = null;
  let analyser = null;
  let scope = null;
  let muted = false;
  let wanted = false;
  let blobUrl = null;
  let rate = 0;
  let beat = null;
  let loading = null;

  function start() {
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
    blobUrl = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
    loading = loading || loadBeat(url).then((b) => (beat = b));
    Promise.all([ctx.audioWorklet.addModule(blobUrl), loading])
      .then(() => {
        if (!ctx || !beat) return;
        node = new AudioWorkletNode(ctx, "strobe-deck", { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.postMessage({ type: "init", pcm: beat.pcm.slice(), rate: beat.rate });
        node.port.postMessage({ type: "rate", rate });
        node.connect(master);
        master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05);
      })
      .catch(() => {});
  }

  function setRate(next) {
    if (Math.abs(next - rate) < 1e-5) return;
    rate = next;
    if (node) node.port.postMessage({ type: "rate", rate });
  }

  function click(amp) {
    if (node && !muted) node.port.postMessage({ type: "click", amp });
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
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    ctx = null;
    node = null;
  }

  return {
    start,
    setRate,
    click,
    setMuted,
    sleep,
    wake,
    level,
    destroy,
    get started() {
      return Boolean(ctx);
    },
  };
}
