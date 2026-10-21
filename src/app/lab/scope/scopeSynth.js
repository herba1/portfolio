export class ScopeSynth {
  constructor(size) {
    this.size = size;
    this.cur = new Float32Array(size * 2);
    this.next = null;
    this.morph = 1;
    this.morphRate = 1;
    this.phase = 0;
    this.freq = 65.41;
    this.freqTarget = 65.41;
    this.glide = 0.2;
    this.spin = 0;
    this.spinTarget = 0;
    this.angle = 0;
    this.lx = 0;
    this.ly = 0;
  }

  ease(m) {
    return m * m * (3 - 2 * m);
  }

  bake() {
    if (!this.next) return;
    const e = this.ease(this.morph);
    const a = this.cur;
    const b = this.next;
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 1) out[i] = a[i] + (b[i] - a[i]) * e;
    this.cur = out;
    this.next = null;
    this.morph = 1;
  }

  setTarget(table, morphSeconds, freq, glideSeconds, spin) {
    this.bake();
    if (morphSeconds <= 0) {
      this.cur = table;
    } else {
      this.next = table;
      this.morph = 0;
      this.morphRate = 1 / morphSeconds;
    }
    this.freqTarget = freq;
    this.glide = Math.max(0.001, glideSeconds);
    this.spinTarget = spin;
  }

  render(outX, outY, count, sampleRate) {
    const n = this.size;
    const a = this.cur;
    const b = this.next;
    const smooth = 1 - Math.exp((-2 * Math.PI * 9000) / sampleRate);
    const glideK = 1 - Math.exp(-1 / (this.glide * sampleRate));
    const spinK = 1 - Math.exp(-1 / (0.6 * sampleRate));
    const morphStep = this.morphRate / sampleRate;
    for (let s = 0; s < count; s += 1) {
      this.freq += (this.freqTarget - this.freq) * glideK;
      this.spin += (this.spinTarget - this.spin) * spinK;
      this.phase += this.freq / sampleRate;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      this.angle += (this.spin > 0.001 ? 0.55 : 0) / sampleRate;
      if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;
      const p = this.phase * n;
      const i0 = Math.floor(p) % n;
      const i1 = (i0 + 1) % n;
      const f = p - Math.floor(p);
      let x = a[i0 * 2] + (a[i1 * 2] - a[i0 * 2]) * f;
      let y = a[i0 * 2 + 1] + (a[i1 * 2 + 1] - a[i0 * 2 + 1]) * f;
      if (b) {
        const bx = b[i0 * 2] + (b[i1 * 2] - b[i0 * 2]) * f;
        const by = b[i0 * 2 + 1] + (b[i1 * 2 + 1] - b[i0 * 2 + 1]) * f;
        const e = this.ease(this.morph);
        x += (bx - x) * e;
        y += (by - y) * e;
        this.morph += morphStep;
        if (this.morph >= 1) {
          this.cur = b;
          this.next = null;
          this.morph = 1;
        }
      }
      const c = Math.cos(this.angle);
      x *= 1 - this.spin + this.spin * c;
      this.lx += (x - this.lx) * smooth;
      this.ly += (y - this.ly) * smooth;
      outX[s] = this.lx;
      outY[s] = this.ly;
    }
  }
}

export function workletSource() {
  return `${ScopeSynth.toString()}
class ScopeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.synth = new ScopeSynth(options.processorOptions.size);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "target") this.synth.setTarget(m.table, m.morph, m.freq, m.glide, m.spin);
      else if (m.type === "state") Object.assign(this.synth, m.state);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const l = out[0];
    const r = out[1] || out[0];
    this.synth.render(l, r, l.length, sampleRate);
    return true;
  }
}
registerProcessor("scope-xy", ScopeProcessor);
`;
}
