import { MAX_STAGES, amorphFragment, amorphVertex } from "./amorphShader";
import { loadImage, samplePortrait } from "./amorphSample";

const CORNERS = [[-0.9, 0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, -0.9]];
const DWELL_MS = 4000;
const SPEED = 3.2;
const SWAP_OMEGA = 9;
const SWAP_DELAY = 0.16;
const KICK_OMEGA = 4.5;
const KICK_ZETA = 0.32;
const KICK_RISE = 9;
const PUSH = 0.3;
const SETTLE = 3.4;
const BLANK = 0;

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
    this.base = BLANK;
    this.stages = [];
    this.queued = null;
    this.clock = 0;
    this.auto = 0;
    this.inkMix = { value: 0, velocity: 0 };
    this.inkMixTarget = 0;
    this.ink = hexToRgb("#1d1b18").map((value) => ({ value, velocity: 0 }));
    this.inkTarget = hexToRgb("#1d1b18");
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

  toUnit(clientX, clientY) {
    const { size, cx, cy } = this.layout;
    const rect = this.box.getBoundingClientRect();
    const x = ((clientX - rect.left - cx) / size) * 2;
    const y = -((clientY - rect.top - cy) / size) * 2;
    return [Math.max(-1.2, Math.min(1.2, x)), Math.max(-1.2, Math.min(1.2, y))];
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
        this.sets.push(samplePortrait(images[index], grid, 1013));
      }
      this.setupGl();
      this.ready = true;
      this.resize();
      this.onPortrait?.(this.current);
      this.onReady?.();
      this.push(1, [0, 0]);
      this.kick();
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

    const grid = this.grid;
    const n = grid * grid;
    this.count = n;
    const rows = new Uint8Array(n * 4 * (this.sets.length + 1));
    this.sets.forEach((set, index) => rows.set(set.colors, n * 4 * (index + 1)));
    for (let index = 0; index < n; index += 1) {
      rows[index * 4] = this.sets[0].colors[index * 4];
      rows[index * 4 + 1] = this.sets[0].colors[index * 4 + 1];
      rows[index * 4 + 2] = this.sets[0].colors[index * 4 + 2];
      rows[index * 4 + 3] = 0;
    }
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid, grid * (this.sets.length + 1), 0, gl.RGBA, gl.UNSIGNED_BYTE, rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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
    const attribute = (location, data, size, divisor) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(location, divisor);
      return buffer;
    };
    this.buffers = {
      position: attribute(0, this.sets[0].positions, 2, 1),
      seed: attribute(1, seeds, 2, 1),
      corner: attribute(2, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2, 0),
    };
    gl.bindVertexArray(null);
    this.stageSet = new Int32Array(MAX_STAGES);
    this.stageOrigin = new Float32Array(MAX_STAGES * 2);
    this.stageTime = new Float32Array(MAX_STAGES);
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

  schedule() {
    clearTimeout(this.auto);
    if (this.destroyed || !this.motion) return;
    this.auto = setTimeout(() => {
      if (this.destroyed) return;
      if (!this.visible || document.hidden) {
        this.schedule();
        return;
      }
      this.advance();
    }, DWELL_MS);
  }

  advance(origin) {
    if (!this.ready) return;
    const from = origin ?? this.nextCorner();
    if (this.stages.length >= MAX_STAGES) {
      this.queued = from;
      return;
    }
    this.push(this.latest() + 1 > this.sets.length ? 1 : this.latest() + 1, from);
    this.kick();
  }

  latest() {
    return this.stages.length ? this.stages[this.stages.length - 1].set : this.base;
  }

  nextCorner() {
    this.cornerIndex = ((this.cornerIndex ?? -1) + 1) % CORNERS.length;
    return CORNERS[this.cornerIndex];
  }

  push(set, origin) {
    clearTimeout(this.auto);
    const [ox, oy] = origin;
    const reach = Math.max(Math.hypot(1 + Math.abs(ox), 1 + Math.abs(oy)), 0.5);
    this.stages.push({ set, origin, start: this.clock, reach, announced: false });
    this.current = (set - 1) % this.sets.length;
    if (!this.motion) this.settle(true);
  }

  settle(all) {
    while (this.stages.length) {
      const stage = this.stages[0];
      const done = this.clock - stage.start > stage.reach / SPEED + 0.03 + SETTLE;
      if (!all && !done) break;
      if (!stage.announced) this.onPortrait?.((stage.set - 1) % this.sets.length);
      this.base = stage.set;
      this.stages.shift();
    }
  }

  setInk(mix, hex) {
    this.inkMixTarget = mix;
    if (hex) this.inkTarget = hexToRgb(hex);
    this.kick();
  }

  kick() {
    if (!this.ready || this.frame || !this.visible || document.hidden || this.destroyed) return;
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  stopLoop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  tick(now) {
    this.frame = 0;
    const dt = this.last ? Math.min(0.05, Math.max(0.001, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    let busy = false;

    if (this.stages.length) {
      this.clock += dt;
      busy = true;
      for (const stage of this.stages) {
        if (!stage.announced && this.clock - stage.start > (stage.reach / SPEED) * 0.4) {
          stage.announced = true;
          this.onPortrait?.((stage.set - 1) % this.sets.length);
        }
      }
      this.settle(false);
      if (this.queued && this.stages.length < MAX_STAGES) {
        const origin = this.queued;
        this.queued = null;
        this.push(this.latest() + 1 > this.sets.length ? 1 : this.latest() + 1, origin);
      }
      if (!this.stages.length) this.schedule();
    }

    busy = springStep(this.inkMix, this.inkMixTarget, dt, 8) || busy;
    for (let channel = 0; channel < 3; channel += 1) {
      busy = springStep(this.ink[channel], this.inkTarget[channel], dt, 8) || busy;
    }

    this.render();
    if (busy && this.visible && !document.hidden && !this.destroyed) this.frame = requestAnimationFrame(this.tick);
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
    gl.uniform1f(u.uUnit, (size / 2) * dpr);
    gl.uniform2f(u.uCanvas, this.canvas.width, this.canvas.height);
    const stages = this.stages;
    for (let index = 0; index < MAX_STAGES; index += 1) {
      const stage = stages[index];
      this.stageSet[index] = stage ? stage.set : 0;
      this.stageOrigin[index * 2] = stage ? stage.origin[0] : 0;
      this.stageOrigin[index * 2 + 1] = stage ? stage.origin[1] : 0;
      this.stageTime[index] = stage ? this.clock - stage.start : 0;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(u.uSets, 0);
    gl.uniform1i(u.uGrid, this.grid);
    gl.uniform1i(u.uBase, this.base);
    gl.uniform1i(u.uStages, stages.length);
    gl.uniform1iv(u["uStageSet[0]"], this.stageSet);
    gl.uniform2fv(u["uStageOrigin[0]"], this.stageOrigin);
    gl.uniform1fv(u["uStageTime[0]"], this.stageTime);
    gl.uniform1f(u.uSpeed, SPEED);
    gl.uniform1f(u.uSwapOmega, SWAP_OMEGA);
    gl.uniform1f(u.uKickOmega, KICK_OMEGA);
    gl.uniform1f(u.uKickZeta, KICK_ZETA);
    gl.uniform1f(u.uKickRise, KICK_RISE);
    gl.uniform1f(u.uSwapDelay, SWAP_DELAY);
    gl.uniform1f(u.uPush, PUSH);
    gl.uniform3f(u.uInk, this.ink[0].value, this.ink[1].value, this.ink[2].value);
    gl.uniform1f(u.uInkMix, Math.min(1, Math.max(0, this.inkMix.value)));
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.auto);
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    const gl = this.gl;
    if (gl) {
      if (this.buffers) Object.values(this.buffers).forEach((buffer) => gl.deleteBuffer(buffer));
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
  }
}
