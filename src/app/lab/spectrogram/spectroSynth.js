export class SpectroSynth {
  constructor(freqs, gains, colRate) {
    this.n = freqs.length;
    this.colRate = colRate;
    const pf = [];
    const pg = [];
    const pr = [];
    const ratio = this.n > 1 ? Math.sqrt(freqs[0] / freqs[1]) : 1.02;
    for (let i = 0; i < this.n; i += 1) {
      const lo = freqs[i] / ratio;
      const hi = freqs[i] * ratio;
      const k = Math.max(1, Math.round((hi - lo) / 58));
      for (let j = 0; j < k; j += 1) {
        pf.push(k === 1 ? freqs[i] : lo * Math.pow(hi / lo, (j + 0.5) / k));
        pg.push(gains[i] / Math.pow(k, 0.15));
        pr.push(i);
      }
    }
    this.m = pf.length;
    this.freqs = Float64Array.from(pf);
    this.gains = Float64Array.from(pg);
    this.rowOf = Int32Array.from(pr);
    this.phase = new Float64Array(this.m);
    let seed = 90210;
    for (let i = 0; i < this.m; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      this.phase[i] = (seed / 4294967296) * Math.PI * 2;
    }
    this.amp = new Float64Array(this.m);
    this.step = new Float64Array(this.m);
    this.queue = [];
    this.pos = 0;
    this.seed = 1234567;
    this.pink = [0, 0, 0, 0, 0, 0, 0];
    this.hiss = 0.00045;
    this.rate = 0;
  }

  push(data, cols) {
    this.queue.push({ data, cols });
  }

  clear() {
    this.queue = [];
    this.pos = 0;
  }

  remaining() {
    let total = -this.pos;
    for (const chunk of this.queue) total += chunk.cols;
    return Math.max(0, total);
  }

  snapshot() {
    return { queue: this.queue.map((c) => ({ data: c.data, cols: c.cols })), pos: this.pos };
  }

  restore(state) {
    this.queue = state.queue.map((c) => ({ data: c.data, cols: c.cols }));
    this.pos = state.pos;
  }

  column(target) {
    const n = this.n;
    while (this.queue.length && this.pos >= this.queue[0].cols) {
      this.pos -= this.queue[0].cols;
      this.queue.shift();
    }
    if (!this.queue.length) {
      this.pos = 0;
      target.fill(0);
      return;
    }
    const chunk = this.queue[0];
    const c = Math.floor(this.pos);
    const f = this.pos - c;
    const a = c * n;
    const nextChunk = c + 1 < chunk.cols ? chunk : this.queue[1];
    const b = c + 1 < chunk.cols ? (c + 1) * n : 0;
    for (let i = 0; i < n; i += 1) {
      const va = chunk.data[a + i];
      const vb = nextChunk ? nextChunk.data[b + i] : 0;
      target[i] = va + (vb - va) * f;
    }
  }

  advance(count, sampleRate) {
    this.pos += (count * this.colRate) / sampleRate;
    while (this.queue.length && this.pos >= this.queue[0].cols) {
      this.pos -= this.queue[0].cols;
      this.queue.shift();
    }
    if (!this.queue.length) this.pos = 0;
  }

  render(out, count, sampleRate) {
    const m = this.m;
    const block = 32;
    const target = this.target || (this.target = new Float64Array(this.n));
    const tau = Math.PI * 2;
    const b = this.pink;
    for (let s0 = 0; s0 < count; s0 += block) {
      const len = Math.min(block, count - s0);
      this.pos += (len * this.colRate) / sampleRate;
      this.column(target);
      for (let i = 0; i < m; i += 1) this.step[i] = (target[this.rowOf[i]] * this.gains[i] - this.amp[i]) / len;
      for (let s = 0; s < len; s += 1) {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        const white = this.seed / 2147483648 - 1;
        b[0] = 0.99886 * b[0] + white * 0.0555179;
        b[1] = 0.99332 * b[1] + white * 0.0750759;
        b[2] = 0.969 * b[2] + white * 0.153852;
        b[3] = 0.8665 * b[3] + white * 0.3104856;
        b[4] = 0.55 * b[4] + white * 0.5329522;
        b[5] = -0.7616 * b[5] - white * 0.016898;
        const pink = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + white * 0.5362;
        b[6] = white * 0.115926;
        out[s0 + s] = pink * this.hiss;
      }
      if (this.rate !== sampleRate) {
        this.rate = sampleRate;
        this.rc = new Float64Array(m);
        this.rs = new Float64Array(m);
        this.pc = new Float64Array(m);
        this.ps = new Float64Array(m);
        for (let i = 0; i < m; i += 1) {
          const inc = (tau * this.freqs[i]) / sampleRate;
          this.rc[i] = Math.cos(inc);
          this.rs[i] = Math.sin(inc);
          this.pc[i] = Math.cos(this.phase[i]);
          this.ps[i] = Math.sin(this.phase[i]);
        }
      }
      const rc = this.rc;
      const rs = this.rs;
      const pc = this.pc;
      const ps = this.ps;
      for (let i = 0; i < m; i += 1) {
        let amp = this.amp[i];
        const st = this.step[i];
        let c = pc[i];
        let sn = ps[i];
        const kc = rc[i];
        const ks = rs[i];
        if (amp < 1e-7 && Math.abs(st) < 1e-9) {
          for (let s = 0; s < len; s += 1) {
            const nc = c * kc - sn * ks;
            sn = sn * kc + c * ks;
            c = nc;
          }
        } else {
          for (let s = 0; s < len; s += 1) {
            amp += st;
            out[s0 + s] += amp * sn;
            const nc = c * kc - sn * ks;
            sn = sn * kc + c * ks;
            c = nc;
          }
          this.amp[i] = amp;
        }
        const norm = 1.5 - 0.5 * (c * c + sn * sn);
        pc[i] = c * norm;
        ps[i] = sn * norm;
      }
    }
  }
}

export function workletSource() {
  return `${SpectroSynth.toString()}
class SpectroProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.synth = new SpectroSynth(o.freqs, o.gains, o.colRate);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "push") this.synth.push(m.data, m.cols);
      else if (m.type === "clear") this.synth.clear();
      else if (m.type === "state") this.synth.restore(m.state);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const l = out[0];
    this.synth.render(l, l.length, sampleRate);
    for (let c = 1; c < out.length; c += 1) out[c].set(l);
    return true;
  }
}
registerProcessor("spectro-bank", SpectroProcessor);
`;
}
