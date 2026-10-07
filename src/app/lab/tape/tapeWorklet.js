export const TAPE_HEAD_SOURCE = `
class TapeHeadDsp {
  constructor(outputRate) {
    this.outputRate = outputRate;
    this.levels = null;
    this.sourceRate = outputRate;
    this.length = 0;
    this.head = 0;
    this.rate = 0;
    this.gain = 0;
    this.lowA = 0;
    this.lowB = 0;
    this.targetPosition = 0;
    this.targetVelocity = 0;
    this.targetAt = 0;
    this.steered = false;
    this.fresh = true;
    this.fadeLeft = 0;
    this.fadeFrames = Math.max(1, Math.round(0.005 * outputRate));
    this.rateFollow = 1 - Math.exp(-1 / (0.006 * outputRate));
    this.gainFollow = 1 - Math.exp(-1 / (0.01 * outputRate));
  }

  load(levels, sourceRate) {
    this.levels = levels;
    this.sourceRate = sourceRate;
    this.length = levels[0].length;
    this.fresh = true;
  }

  steer(position, velocity, at) {
    this.targetPosition = position;
    this.targetVelocity = velocity;
    this.targetAt = at;
    this.steered = true;
  }

  read(level, x) {
    const data = this.levels[level];
    const n = data.length;
    let i = Math.floor(x);
    const f = x - i;
    i = ((i % n) + n) % n;
    const before = i === 0 ? n - 1 : i - 1;
    const next = i + 1 === n ? 0 : i + 1;
    const after = next + 1 === n ? 0 : next + 1;
    const xm1 = data[before];
    const x0 = data[i];
    const x1 = data[next];
    const x2 = data[after];
    const c = (x1 - xm1) * 0.5;
    const v = x0 - x1;
    const w = c + v;
    const a = w + v + (x2 - x0) * 0.5;
    const b = w + a;
    return ((a * f - b) * f + c) * f + x0;
  }

  render(out, frames, now) {
    if (!this.levels || !this.steered) {
      out.fill(0);
      return;
    }
    const n = this.length;
    const sourceRate = this.sourceRate;
    const ratio = sourceRate / this.outputRate;
    const elapsed = Math.min(0.25, Math.max(0, now - this.targetAt));
    let target = (this.targetPosition + this.targetVelocity * elapsed) * sourceRate;
    target = ((target % n) + n) % n;
    let error = target - this.head;
    if (error > n * 0.5) error -= n;
    else if (error < -n * 0.5) error += n;
    const jumping = this.fresh || Math.abs(error) > sourceRate * 0.35;
    if (jumping && this.fadeLeft === 0) {
      if (this.gain > 0.0005) {
        this.fadeLeft = this.fadeFrames;
      } else {
        this.head = target;
        this.rate = this.targetVelocity * ratio;
        this.gain = 0;
        this.fresh = false;
        error = 0;
      }
    }
    if (this.fadeLeft > 0) error = 0;
    const limit = 12 * ratio;
    let command = Math.max(-limit, Math.min(limit, this.targetVelocity * ratio + (error * 30) / this.outputRate));
    const speed = Math.abs(command) / ratio;
    const cutoff = Math.min(0.45 * this.outputRate, 900 + 17000 * Math.pow(Math.min(speed, 1), 0.7));
    const pole = 1 - Math.exp((-2 * Math.PI * cutoff) / this.outputRate);
    const loudness = speed < 0.02 ? 0 : Math.min(1, (speed - 0.02) / 0.1);
    const top = this.levels.length - 1.001;
    for (let s = 0; s < frames; s++) {
      const fading = this.fadeLeft > 0;
      if (!fading) this.rate += (command - this.rate) * this.rateFollow;
      this.head += this.rate;
      if (this.head >= n) this.head -= n;
      else if (this.head < 0) this.head += n;
      const step = Math.abs(this.rate);
      let level = step > 1 ? Math.log2(step) : 0;
      if (level > top) level = top;
      const base = Math.floor(level);
      const blend = level - base;
      const scale = 1 / (1 << base);
      let value = this.read(base, this.head * scale);
      if (blend > 0.001) value += (this.read(base + 1, this.head * scale * 0.5) - value) * blend;
      this.lowA += (value - this.lowA) * pole;
      this.lowB += (this.lowA - this.lowB) * pole;
      if (fading) {
        this.gain -= this.gain / this.fadeLeft;
        this.fadeLeft -= 1;
      } else {
        this.gain += (loudness - this.gain) * this.gainFollow;
      }
      out[s] = this.lowB * this.gain * 0.9;
      if (fading && this.fadeLeft === 0) {
        this.head = target;
        this.rate = this.targetVelocity * ratio;
        this.gain = 0;
        this.fresh = false;
        command = Math.max(-limit, Math.min(limit, this.targetVelocity * ratio));
      }
    }
  }
}
`;

export const TAPE_WORKLET_SOURCE = `${TAPE_HEAD_SOURCE}
class TapeHeadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new TapeHeadDsp(sampleRate);
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "load") this.dsp.load(message.levels, message.sourceRate);
      else if (message.type === "steer") this.dsp.steer(message.position, message.velocity, message.at);
    };
  }

  process(inputs, outputs) {
    const channel = outputs[0] && outputs[0][0];
    if (channel) this.dsp.render(channel, channel.length, currentTime);
    return true;
  }
}

registerProcessor("tape-head", TapeHeadProcessor);
`;
