import { amorphFragment, amorphVertex } from "./amorphShader";
import { loadImage, samplePortrait } from "./amorphSample";

const MORPH_SECONDS = 3.2;

function springStep(state, target, dt, omega) {
  const delta = state.value - target;
  const exp = Math.exp(-omega * dt);
  const next = (delta + (state.velocity + omega * delta) * dt) * exp;
  state.velocity = (state.velocity - omega * (state.velocity + omega * delta) * dt) * exp;
  state.value = target + next;
  return Math.abs(next) > 1e-4 || Math.abs(state.velocity) > 1e-4;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
  return shader;
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export default class AmorphEngine {
  constructor({ canvas, box, portraits, embedded, onPortrait, onReady, onError }) {
    this.canvas = canvas;
    this.box = box;
    this.portraits = portraits;
    this.embedded = embedded;
    this.onPortrait = onPortrait;
    this.onReady = onReady;
    this.onError = onError;
    this.frame = 0;
    this.last = 0;
    this.visible = false;
    this.started = false;
    this.destroyed = false;
    this.ready = false;
    this.motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1;

    this.current = 0;
    this.morph = 1;
    this.morphing = false;
    this.queued = false;
    this.curve = 0.32;
    this.origin = [0, 0];
    this.time = 0;
    this.holding = false;
    this.holdAge = 0;
    this.holdAt = [0, 0];
    this.holdTarget = [0, 0];
    this.wave = { value: 0, velocity: 0 };
    this.gain = { value: 0, velocity: 0 };
    this.push = { value: 0, velocity: 0 };
    this.pushTarget = 0;
    this.hoverAt = 0;
    this.pointer = [9, 9];
    this.inkMix = { value: 0, velocity: 0 };
    this.inkMixTarget = 0;
    this.ink = hexToRgb("#1d1b18");
    this.inkTarget = this.ink.slice();
    this.layout = { cx: 0, cy: 0, size: 1, width: 1, height: 1, dpr: 1 };

    this.tick = this.tick.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(box);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
      if (this.visible && !this.started) this.start();
      if (this.visible) this.kick();
    });
    this.intersection.observe(box);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  handleVisibility() {
    if (document.hidden) this.stopLoop();
    else this.kick();
  }

  measure() {
    const rect = this.box.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const narrow = width < 640;
    const top = this.embedded ? 12 : narrow ? 136 : 96;
    const bottom = this.embedded ? 12 : narrow ? 148 : 120;
    const room = Math.max(120, height - top - bottom);
    const size = Math.min(width * (this.embedded ? 0.9 : narrow ? 0.9 : 0.8), room, 760);
    return { width, height, size, cx: width / 2, cy: top + room / 2, rect };
  }

  async start() {
    this.started = true;
    const gl = this.canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) {
      this.onError?.();
      return;
    }
    this.gl = gl;
    try {
      const { size } = this.measure();
      const grid = Math.max(112, Math.min(240, Math.round(size / 2.9 / 4) * 4));
      this.grid = grid;
      const images = await Promise.all(this.portraits.map((portrait) => loadImage(portrait.src)));
      if (this.destroyed) return;
      this.sets = [];
      for (let index = 0; index < images.length; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.destroyed) return;
        this.sets.push(samplePortrait(images[index], grid, 1013 + index * 7919));
      }
      this.setupGl();
      this.ready = true;
      this.resize();
      this.render();
      this.onPortrait?.(this.current);
      this.onReady?.();
    } catch (error) {
      if (!this.destroyed) this.onError?.(error);
    }
  }

  setupGl() {
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, amorphVertex));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, amorphFragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    this.program = program;
    this.uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < count; index += 1) {
      const info = gl.getActiveUniform(program, index);
      this.uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }

    const set = this.sets[this.current];
    const n = set.count;
    this.count = n;
    this.slot = new Int32Array(n);
    for (let index = 0; index < n; index += 1) this.slot[index] = index;
    this.fromPos = new Float32Array(set.positions);
    this.toPos = new Float32Array(set.positions);
    this.fromColor = new Uint8Array(set.colors);
    this.toColor = new Uint8Array(set.colors);
    const seeds = new Float32Array(n * 2);
    let state = 2463534242;
    for (let index = 0; index < n * 2; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      seeds[index] = (state >>> 0) / 4294967296;
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attribute = (location, data, size, type, normalized) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
      return buffer;
    };
    this.buffers = {
      from: attribute(0, this.fromPos, 2, gl.FLOAT, false),
      to: attribute(1, this.toPos, 2, gl.FLOAT, false),
      fromColor: attribute(2, this.fromColor, 4, gl.UNSIGNED_BYTE, true),
      toColor: attribute(3, this.toColor, 4, gl.UNSIGNED_BYTE, true),
      seed: attribute(4, seeds, 2, gl.FLOAT, false),
    };
    gl.bindVertexArray(null);
  }

  upload(buffer, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }

  resize() {
    const { width, height, size, cx, cy } = this.measure();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.layout = { width, height, size, cx, cy, dpr };
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    if (this.ready) this.render();
  }

  toPortrait(clientX, clientY) {
    const rect = this.box.getBoundingClientRect();
    const { cx, cy, size } = this.layout;
    return [((clientX - rect.left - cx) / size) * 2, -((clientY - rect.top - cy) / size) * 2];
  }

  press(clientX, clientY) {
    if (!this.ready) return;
    const at = clientX == null ? [0, 0.1] : this.toPortrait(clientX, clientY);
    this.holding = true;
    this.holdTarget = at;
    if (this.gain.value < 0.03) {
      this.holdAt = at.slice();
      this.wave.value = 0;
      this.wave.velocity = 0;
      this.holdAge = 0;
    }
    this.kick();
  }

  moveHold(clientX, clientY) {
    if (!this.holding) return;
    this.holdTarget = this.toPortrait(clientX, clientY);
    this.kick();
  }

  release() {
    if (!this.holding) return;
    this.holding = false;
    if (this.morphing) this.queued = true;
    else this.begin(this.holdAt);
    this.kick();
  }

  cancel() {
    if (!this.holding) return;
    this.holding = false;
    this.kick();
  }

  advance() {
    if (!this.ready) return;
    if (this.morphing) {
      this.queued = true;
      return;
    }
    this.holdAt = [0, 0.1];
    this.holdTarget = [0, 0.1];
    this.holdAge = Math.max(this.holdAge, 0.4);
    this.wave.velocity += 1.6;
    this.gain.velocity += 4.5;
    this.begin([0, 0.1]);
    this.kick();
  }

  hover(clientX, clientY) {
    if (!this.ready) return;
    const now = performance.now();
    const at = this.toPortrait(clientX, clientY);
    const elapsed = Math.max(8, now - (this.hoverAt || 0)) / 1000;
    if (this.hoverAt && elapsed < 0.2) {
      const vx = (at[0] - this.pointer[0]) / elapsed;
      const vy = (at[1] - this.pointer[1]) / elapsed;
      const speed = Math.hypot(vx, vy);
      const turn = Math.sign(at[0] * vy - at[1] * vx) || 1;
      const target = turn * Math.min(0.9, speed * 0.32) * this.motion;
      this.pushTarget += (target - this.pushTarget) * 0.35;
    }
    this.hoverAt = now;
    this.pointer = at;
    this.kick();
  }

  leave() {
    this.pushTarget = 0;
    this.kick();
  }

  setInk(mix, hex) {
    this.inkMixTarget = mix;
    if (hex) this.inkTarget = hexToRgb(hex);
    this.kick();
  }

  begin(origin) {
    const next = (this.current + 1) % this.sets.length;
    const source = this.sets[this.current];
    const target = this.sets[next];
    const n = this.count;
    this.fromPos.set(this.toPos);
    this.fromColor.set(this.toColor);
    for (let index = 0; index < n; index += 1) {
      const slot = target.order[source.rank[this.slot[index]]];
      this.slot[index] = slot;
      this.toPos[index * 2] = target.positions[slot * 2];
      this.toPos[index * 2 + 1] = target.positions[slot * 2 + 1];
      this.toColor[index * 4] = target.colors[slot * 4];
      this.toColor[index * 4 + 1] = target.colors[slot * 4 + 1];
      this.toColor[index * 4 + 2] = target.colors[slot * 4 + 2];
      this.toColor[index * 4 + 3] = target.colors[slot * 4 + 3];
    }
    this.upload(this.buffers.from, this.fromPos);
    this.upload(this.buffers.to, this.toPos);
    this.upload(this.buffers.fromColor, this.fromColor);
    this.upload(this.buffers.toColor, this.toColor);
    this.current = next;
    this.origin = origin.slice();
    this.curve = -this.curve;
    this.morph = 0;
    this.morphing = true;
    this.onPortrait?.(next);
  }

  kick() {
    if (!this.ready || this.frame || !this.visible || document.hidden || this.destroyed) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stopLoop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  tick(now) {
    this.frame = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    let busy = false;

    if (this.holding) {
      this.holdAge += dt;
      this.holdAt[0] += (this.holdTarget[0] - this.holdAt[0]) * (1 - Math.exp(-dt * 7));
      this.holdAt[1] += (this.holdTarget[1] - this.holdAt[1]) * (1 - Math.exp(-dt * 7));
      busy = true;
    }
    busy = springStep(this.wave, this.holding ? 1 : this.wave.value, dt, 2.4) || busy;
    busy = springStep(this.gain, this.holding ? 1 : 0, dt, this.holding ? 7 : 1.9) || busy;
    if (!this.holding && this.gain.value < 0.002 && Math.abs(this.gain.velocity) < 0.002) {
      this.gain.value = 0;
      this.gain.velocity = 0;
      this.wave.value = 0;
      this.wave.velocity = 0;
      this.holdAge = 0;
    }

    if (this.morphing) {
      this.morph = Math.min(1, this.morph + dt / MORPH_SECONDS);
      busy = true;
      if (this.morph >= 1) {
        this.morphing = false;
        if (this.queued && !this.holding) {
          this.queued = false;
          this.begin(this.holdAt);
        }
      }
    }

    this.pushTarget *= Math.exp(-dt * 3.2);
    if (Math.abs(this.pushTarget) < 1e-3) this.pushTarget = 0;
    busy = springStep(this.push, this.pushTarget, dt, 6) || busy;
    busy = springStep(this.inkMix, this.inkMixTarget, dt, 8) || busy;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = this.inkTarget[channel] - this.ink[channel];
      this.ink[channel] += delta * (1 - Math.exp(-dt * 8));
      if (Math.abs(delta) > 0.002) busy = true;
    }

    if (this.gain.value > 0.001 || this.morphing) this.time += dt;

    this.render();
    if (busy) this.kick();
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.ready) return;
    const { width, height, size, cx, cy, dpr } = this.layout;
    const u = this.uniforms;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform4f(u.uView, (cx / width) * 2 - 1, 1 - (cy / height) * 2, size / width, size / height);
    gl.uniform1f(u.uDot, (size / this.grid) * dpr);
    gl.uniform1f(u.uMorph, this.morph);
    gl.uniform2f(u.uOrigin, this.origin[0], this.origin[1]);
    gl.uniform1f(u.uCurve, this.curve);
    gl.uniform1f(u.uWave, Math.max(0, this.wave.value));
    gl.uniform1f(u.uGain, Math.min(1.2, Math.max(0, this.gain.value)));
    gl.uniform2f(u.uHoldAt, this.holdAt[0], this.holdAt[1]);
    gl.uniform1f(u.uSpread, 0.11 + 0.1 * (1 - Math.exp(-this.holdAge * 0.5)));
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uMotion, this.motion);
    gl.uniform2f(u.uPointer, this.pointer[0], this.pointer[1]);
    gl.uniform1f(u.uPush, this.push.value);
    gl.uniform3f(u.uInk, this.ink[0], this.ink[1], this.ink[2]);
    gl.uniform1f(u.uInkMix, Math.min(1, Math.max(0, this.inkMix.value)));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }

  destroy() {
    this.destroyed = true;
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    const gl = this.gl;
    if (gl) {
      if (this.buffers) Object.values(this.buffers).forEach((buffer) => gl.deleteBuffer(buffer));
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
  }
}
