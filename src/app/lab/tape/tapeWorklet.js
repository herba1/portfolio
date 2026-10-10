export const TAPE_HEAD_SOURCE = `
class TapeHeadDsp {
  constructor(outputRate) {
    this.outputRate = outputRate;
    this.levels = null;
    this.sourceRate = outputRate;
    this.length = 0;
    this.head = 0;
    this.speed = 0;
    this.gain = 0;
    this.lowA = 0;
    this.lowB = 0;
    this.dcIn = 0;
    this.dcOut = 0;
    this.hissA = 0;
    this.hissB = 0;
    this.seed = 22222;
    this.targetPosition = 0;
    this.targetVelocity = 0;
    this.targetAt = 0;
    this.targetReach = NaN;
    this.mode = 0;
    this.worn = false;
    this.steered = false;
    this.fresh = true;
    this.clock = 0;
    this.delay = NaN;
    this.lag = 0;
    this.ghostHead = 0;
    this.ghostSpeed = 0;
    this.ghostLeft = 0;
    this.crossFrames = Math.max(1, Math.round(0.03 * outputRate));
    this.freeFollow = 1 - Math.exp(-1 / (0.008 * outputRate));
    this.heldFollow = 1 - Math.exp(-1 / (0.004 * outputRate));
    this.gainFollow = 1 - Math.exp(-1 / (0.012 * outputRate));
    this.dcPole = Math.exp((-2 * Math.PI * 22) / outputRate);
    this.delayFollow = 0.1;
    this.delayReset = 0.1;
    this.handLead = 0.032;
    this.seekLead = 0.05;
    this.leadLimit = 0.3;
    this.lagRelax = 0.01;
    this.lagGlide = 0.1;
    this.glideShift = 0.002;
    this.jumpSeconds = 0.3;
    this.heldStiffness = 8;
    this.heldTrim = 3;
    this.seekStiffness = 20;
    this.seekTrim = 4;
    this.freeStiffness = 10;
    this.freeTrim = 0.5;
    this.speedLimit = 16;
    this.outputLevel = 0.76;
  }

  load(levels, sourceRate) {
    this.levels = levels;
    this.sourceRate = sourceRate;
    this.length = levels[0].length;
    this.fresh = true;
  }

  steer(position, velocity, at, mode, worn, reach) {
    const delay = this.clock - at;
    if (mode !== this.mode) {
      const before = (this.mode === 0 ? 0 : this.delay) + this.lag;
      const after = mode === 0 ? 0 : delay;
      const carried = Number.isFinite(before) ? before - after : 0;
      this.lag = mode === 0 ? Math.max(0, carried) : 0;
      this.delay = delay;
    } else {
      if (!Number.isFinite(this.delay) || Math.abs(delay - this.delay) > this.delayReset) this.delay = delay;
      else this.delay += (delay - this.delay) * this.delayFollow;
      if (mode === 0 && this.lag > 0) {
        const speed = velocity < 0 ? -velocity : velocity;
        const glide = this.lagGlide * Math.abs(velocity - this.targetVelocity);
        this.lag = this.ease(this.lag, Math.min(glide, this.glideShift / Math.max(speed, 0.1)));
      }
    }
    this.targetPosition = position;
    this.targetVelocity = velocity;
    this.targetAt = at;
    this.targetReach = Number.isFinite(reach) ? reach : NaN;
    this.mode = mode;
    this.worn = Boolean(worn);
    this.steered = true;
  }

  ease(lag, amount) {
    if (lag > 0) return lag > amount ? lag - amount : 0;
    return lag < -amount ? lag + amount : 0;
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

  voice(head, step) {
    const top = this.levels.length - 1.001;
    let level = step > 1 ? Math.log2(step) : 0;
    if (level > top) level = top;
    const base = Math.floor(level);
    const blend = level - base;
    const scale = 1 / (1 << base);
    let value = this.read(base, head * scale);
    if (blend > 0.001) value += (this.read(base + 1, head * scale * 0.5) - value) * blend;
    return value;
  }

  loudness(speed) {
    if (speed < 0.012) return 0;
    const gate = Math.min(1, (speed - 0.012) / 0.05);
    const body = speed < 1 ? Math.sqrt(speed) : 1 + 0.06 * (Math.min(speed, 6) - 1);
    return gate * body;
  }

  saturate(x) {
    const ax = x < 0 ? -x : x;
    if (ax <= 0.72) return x;
    const bent = 0.72 + 0.26 * Math.tanh((ax - 0.72) / 0.26);
    return x < 0 ? -bent : bent;
  }

  noise() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  render(out, frames, now) {
    this.clock = now;
    if (!this.levels || !this.steered) {
      out.fill(0);
      return;
    }
    const n = this.length;
    const sourceRate = this.sourceRate;
    const period = n / sourceRate;
    const half = period * 0.5;
    const ratio = sourceRate / this.outputRate;
    const tick = 1 / this.outputRate;
    const free = this.mode === 0;
    const seeking = this.mode === 2;
    const follow = free ? this.freeFollow : this.heldFollow;
    const stiffness = free ? this.freeStiffness : seeking ? this.seekStiffness : this.heldStiffness;
    const trim = free ? this.freeTrim : seeking ? this.seekTrim : this.heldTrim;
    const limit = this.speedLimit;
    const velocity = this.targetVelocity;
    const settle = free ? 0 : this.delay;
    const leadCap = free ? this.leadLimit : seeking ? this.seekLead : this.handLead;
    const relax = this.lagRelax * tick;
    const reach = this.targetReach;
    const bounded = !free && Number.isFinite(reach);

    if (this.fresh) {
      const lead = Math.min(leadCap, Math.max(0, now - this.targetAt - settle - this.lag));
      let start = (this.targetPosition + velocity * lead) % period;
      if (start < 0) start += period;
      this.head = start * sourceRate;
      this.speed = velocity;
      this.gain = 0;
      this.ghostLeft = 0;
      this.fresh = false;
    }

    const speedNow = Math.abs(this.speed);
    const cutoff = Math.min(0.45 * this.outputRate, 1400 + 16600 * Math.pow(Math.min(speedNow, 1), 0.75));
    const pole = 1 - Math.exp((-2 * Math.PI * cutoff) / this.outputRate);
    const hissLevel = this.worn ? 0.004 : 0;

    for (let s = 0; s < frames; s++) {
      if (this.lag !== 0) this.lag = velocity > -0.02 && velocity < 0.02 ? 0 : this.ease(this.lag, relax);
      const age = now + s * tick - this.targetAt - settle - this.lag;
      const stale = free && age > this.leadLimit;
      const lead = Math.min(leadCap, Math.max(free ? 0 : -leadCap, age));
      let drive = velocity;
      let offset = velocity * lead;
      if (bounded && (reach >= 0 ? offset > reach : offset < reach)) {
        offset = reach;
        drive = lead > 0.001 ? reach / lead : 0;
      }
      const target = this.targetPosition + offset;
      let error = (target - this.head / sourceRate) % period;
      if (error > half) error -= period;
      else if (error < -half) error += period;
      if (stale) error = 0;

      if ((error > this.jumpSeconds || error < -this.jumpSeconds) && this.ghostLeft === 0) {
        this.ghostHead = this.head;
        this.ghostSpeed = this.speed;
        this.ghostLeft = this.crossFrames;
        let landing = target % period;
        if (landing < 0) landing += period;
        this.head = landing * sourceRate;
        this.speed = velocity;
        error = 0;
      }

      let correction = error * stiffness;
      if (correction > trim) correction = trim;
      else if (correction < -trim) correction = -trim;
      let command = drive + correction;
      if (command > limit) command = limit;
      else if (command < -limit) command = -limit;
      this.speed += (command - this.speed) * follow;

      const step = this.speed * ratio;
      this.head += step;
      if (this.head >= n) this.head -= n;
      else if (this.head < 0) this.head += n;
      const travel = step < 0 ? -step : step;
      let value = this.voice(this.head, travel);
      const moving = travel / ratio;

      if (this.ghostLeft > 0) {
        const ghostStep = this.ghostSpeed * ratio;
        this.ghostHead += ghostStep;
        if (this.ghostHead >= n) this.ghostHead -= n;
        else if (this.ghostHead < 0) this.ghostHead += n;
        const ghost = this.voice(this.ghostHead, ghostStep < 0 ? -ghostStep : ghostStep);
        const phase = (1 - this.ghostLeft / this.crossFrames) * Math.PI * 0.5;
        value = value * Math.sin(phase) + ghost * Math.cos(phase);
        this.ghostLeft -= 1;
      }

      if (hissLevel > 0) {
        const shimmer = this.noise() * hissLevel * Math.min(1, moving);
        this.hissA += (shimmer - this.hissA) * 0.5;
        this.hissB += (this.hissA - this.hissB) * 0.5;
        value += this.hissA - this.hissB * 0.6;
      }

      this.lowA += (value - this.lowA) * pole;
      this.lowB += (this.lowA - this.lowB) * pole;
      this.gain += (this.loudness(moving) - this.gain) * this.gainFollow;
      const shaped = this.lowB * this.gain;
      this.dcOut = shaped - this.dcIn + this.dcPole * this.dcOut;
      this.dcIn = shaped;
      out[s] = this.saturate(this.dcOut * this.outputLevel);
    }
    this.clock = now + frames * tick;
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
      else if (message.type === "steer") this.dsp.steer(message.position, message.velocity, message.at, message.mode, message.worn, message.reach);
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
