const HAND_SMOOTHING = 30;
const CATCH_RATE = 9;
const RELEASE_WINDOW = 0.09;
const SAMPLE_SLOTS = 24;
const FLING_LIMIT = 8;
const SEEK_LIMIT = 12;
const SEEK_STIFFNESS = 22;
const WHEEL_IDLE = 0.12;
const SPIN_UP = { rate: 9, torque: 4 };
const SPIN_DOWN = { rate: 5, torque: 1.3 };
const WOW = { depth: 0.006, hz: 0.7 };
const FLUTTER = { depth: 0.0025, hz: 6.1 };

const FREE = 0;
const HELD = 1;
const SEEK = 2;

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

export class TapeTransport {
  constructor() {
    this.position = 0;
    this.velocity = 0;
    this.mode = FREE;
    this.playing = false;
    this.shuttle = 1;
    this.away = false;
    this.worn = false;
    this.clock = 0;
    this.wobble = 1;
    this.pixelsPerSecond = 160;
    this.grabX = 0;
    this.handX = 0;
    this.grabPosition = 0;
    this.skidOffset = 0;
    this.skidVelocity = 0;
    this.wheelHeld = false;
    this.lastWheelAt = 0;
    this.seekTarget = 0;
    this.sampleTimes = new Float64Array(SAMPLE_SLOTS);
    this.samplePositions = new Float64Array(SAMPLE_SLOTS);
    this.sampleCount = 0;
    this.sampleHead = 0;
  }

  get held() {
    return this.mode === HELD;
  }

  get seeking() {
    return this.mode === SEEK;
  }

  get motor() {
    return this.playing ? this.shuttle : 0;
  }

  get target() {
    return this.away ? 0 : this.motor;
  }

  get audibleVelocity() {
    return this.mode === FREE ? this.velocity * this.wobble : this.velocity;
  }

  get settled() {
    return this.mode === FREE && this.target === 0 && Math.abs(this.velocity) < 1e-4;
  }

  handTarget() {
    return this.grabPosition + (this.grabX - this.handX) / this.pixelsPerSecond;
  }

  record(time, position) {
    this.sampleTimes[this.sampleHead] = time;
    this.samplePositions[this.sampleHead] = position;
    this.sampleHead = (this.sampleHead + 1) % SAMPLE_SLOTS;
    this.sampleCount = Math.min(SAMPLE_SLOTS, this.sampleCount + 1);
  }

  grab(x, time) {
    this.mode = HELD;
    this.grabX = x;
    this.handX = x;
    this.grabPosition = this.position;
    this.skidOffset = 0;
    this.skidVelocity = this.velocity;
    this.wheelHeld = false;
    this.sampleCount = 0;
    this.sampleHead = 0;
    this.record(time, this.handTarget());
  }

  drag(x, time) {
    if (this.mode !== HELD) return;
    this.handX = x;
    this.record(time, this.handTarget());
  }

  release(time) {
    if (this.mode !== HELD) return;
    let fling = 0;
    if (this.sampleCount > 1) {
      const newest = (this.sampleHead - 1 + SAMPLE_SLOTS) % SAMPLE_SLOTS;
      const lastAt = this.sampleTimes[newest];
      if (time - lastAt < RELEASE_WINDOW) {
        let oldest = newest;
        for (let i = 1; i < this.sampleCount; i++) {
          const slot = (newest - i + SAMPLE_SLOTS) % SAMPLE_SLOTS;
          if (lastAt - this.sampleTimes[slot] > RELEASE_WINDOW) break;
          oldest = slot;
        }
        const span = Math.max(0.016, lastAt - this.sampleTimes[oldest]);
        fling = (this.samplePositions[newest] - this.samplePositions[oldest]) / span;
      }
    }
    this.mode = FREE;
    this.wheelHeld = false;
    this.velocity = clamp(fling + this.skidVelocity, FLING_LIMIT);
    this.skidVelocity = 0;
  }

  wheel(deltaPixels, time) {
    if (this.mode !== HELD) {
      this.grab(0, time);
      this.wheelHeld = true;
    }
    if (!this.wheelHeld) return;
    this.lastWheelAt = time;
    this.drag(this.handX - deltaPixels, time);
  }

  impulse(deltaVelocity) {
    if (this.mode === HELD) return;
    this.mode = FREE;
    this.velocity = clamp(this.velocity + deltaVelocity, FLING_LIMIT);
  }

  seek(target) {
    if (this.mode === HELD) return;
    this.mode = SEEK;
    this.seekTarget = target;
  }

  step(dt, now) {
    this.clock += dt;
    this.wobble = this.worn
      ? 1 + WOW.depth * Math.sin(2 * Math.PI * WOW.hz * this.clock) + FLUTTER.depth * Math.sin(2 * Math.PI * FLUTTER.hz * this.clock)
      : 1;
    if (this.mode === HELD && this.wheelHeld && now - this.lastWheelAt > WHEEL_IDLE) this.release(this.lastWheelAt);
    if (dt <= 0) return;

    if (this.mode === HELD) {
      this.skidVelocity *= Math.exp(-CATCH_RATE * dt);
      this.skidOffset += this.skidVelocity * dt;
      const next = this.handTarget() + this.skidOffset;
      const instant = (next - this.position) / dt;
      this.velocity += (instant - this.velocity) * (1 - Math.exp(-HAND_SMOOTHING * dt));
      this.position = next;
      return;
    }

    if (this.mode === SEEK) {
      const offset = this.seekTarget - this.position;
      const accel = SEEK_STIFFNESS * SEEK_STIFFNESS * offset - 2 * SEEK_STIFFNESS * this.velocity;
      this.velocity = clamp(this.velocity + accel * dt, SEEK_LIMIT);
      this.position += this.velocity * dt;
      if (Math.abs(this.seekTarget - this.position) < 0.012 && Math.abs(this.velocity) < 0.8) this.mode = FREE;
      return;
    }

    const target = this.target;
    const gap = target - this.velocity;
    const speeding = Math.abs(target) > Math.abs(this.velocity) && target * this.velocity >= 0;
    const profile = speeding ? SPIN_UP : SPIN_DOWN;
    const limit = profile.torque + 1.2 * Math.abs(gap);
    const next = this.velocity + clamp(gap * profile.rate, limit) * dt;
    this.velocity = (target - next) * gap <= 0 ? target : next;
    this.position += this.velocity * this.wobble * dt;
  }
}
