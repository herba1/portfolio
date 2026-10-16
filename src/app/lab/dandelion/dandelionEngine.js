import SeedSim from "./dandelionSim";
import { buildLattice, loadImage, sampleTones } from "./dandelionField";
import { seedFragment, seedVertex } from "./dandelionShader";

const INK = [0.165, 0.145, 0.12];
const HUSK = [0.37, 0.26, 0.16];
const SHADE = [0.3, 0.23, 0.15];
const FLUFF = [0.62, 0.57, 0.5];
const MAX_SPEED = 7;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader failed");
  }
  return shader;
}

function columnsFor(size) {
  const pitch = size >= 560 ? 8.6 : size >= 380 ? 7.6 : 6.8;
  return Math.max(40, Math.min(96, Math.round(size / pitch)));
}

export default class DandelionEngine {
  constructor({ canvas, box, portraits, embedded, onReady, onError }) {
    this.canvas = canvas;
    this.box = box;
    this.portraits = portraits;
    this.embedded = embedded;
    this.onReady = onReady;
    this.onError = onError;
    this.motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1;
    this.frame = 0;
    this.last = null;
    this.time = 0;
    this.visible = false;
    this.started = false;
    this.ready = false;
    this.destroyed = false;
    this.current = 0;
    this.layout = { width: 1, height: 1, size: 1, cx: 0, cy: 0, dpr: 1 };
    this.ptr = { x: 0, y: 0, inside: false, down: false, mouse: false, moved: false };
    this.prev = null;
    this.vel = [0, 0];
    this.auto = null;
    this.breath = null;

    this.tick = this.tick.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(box);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
      if (this.visible && !this.started) this.start();
      if (this.visible) this.kick();
      else this.stopLoop();
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
    const top = this.embedded ? 12 : narrow ? 132 : 100;
    const bottom = this.embedded ? 12 : narrow ? 92 : 104;
    const room = Math.max(160, height - top - bottom);
    const size = Math.min(width * (this.embedded ? 0.94 : narrow ? 0.94 : 0.86), room, 780);
    return { width, height, size, cx: width / 2, cy: top + room / 2 };
  }

  async start() {
    this.started = true;
    const gl = this.canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      this.onError?.();
      return;
    }
    this.gl = gl;
    try {
      const images = await Promise.all(this.portraits.map((portrait) => loadImage(portrait.src)));
      if (this.destroyed) return;
      this.images = images;
      this.setupProgram();
      this.resize();
      this.build(columnsFor(this.layout.size));
      this.ready = true;
      this.render();
      this.onReady?.();
      this.kick();
    } catch (error) {
      if (!this.destroyed) this.onError?.(error);
    }
  }

  setupProgram() {
    const gl = this.gl;
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, seedVertex);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, seedFragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
    this.program = program;
    this.uniforms = {};
    const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < total; i += 1) {
      const info = gl.getActiveUniform(program, i);
      this.uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    this.cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const layout = [
      [1, 3, 0],
      [2, 3, 12],
      [3, 2, 24],
      [4, 4, 32],
      [5, 2, 48],
    ];
    this.passes = [0, 1, 2].map((mode) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [location, size, offset] of layout) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 56, offset);
        gl.vertexAttribDivisor(location, 1);
      }
      return { mode, vao, buffer, data: null, count: 0, capacity: 0 };
    });
    gl.bindVertexArray(null);
  }

  build(cols) {
    const gl = this.gl;
    const lattice = buildLattice(cols);
    this.cols = cols;
    this.lattice = lattice;
    this.tones = this.images.map((image) => sampleTones(image, lattice));
    this.sim = new SeedSim(lattice, this.tones[this.current], this.motion);
    this.applyView();
    for (const pass of this.passes) {
      pass.data = new Float32Array(lattice.count * 14);
      pass.count = 0;
      pass.capacity = lattice.count;
      gl.bindBuffer(gl.ARRAY_BUFFER, pass.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, pass.data.byteLength, gl.DYNAMIC_DRAW);
    }
  }

  pack() {
    const sim = this.sim;
    const lattice = this.lattice;
    const dyn = sim.dyn;
    const [seeds, stubs, shadows] = this.passes;
    let a = 0;
    let b = 0;
    let c = 0;
    const put = (target, slot, i) => {
      const o = slot * 14;
      const d = i * 8;
      for (let k = 0; k < 8; k += 1) target[o + k] = dyn[d + k];
      target[o + 8] = lattice.home[i * 2];
      target[o + 9] = lattice.home[i * 2 + 1];
      target[o + 10] = lattice.rnd[i * 2];
      target[o + 11] = lattice.rnd[i * 2 + 1];
      target[o + 12] = lattice.rest[i * 2];
      target[o + 13] = lattice.rest[i * 2 + 1];
    };
    for (let i = 0; i < sim.n; i += 1) {
      const d = i * 8;
      if (dyn[d + 6] < 0.015) continue;
      const z = dyn[d + 2];
      if (z >= -0.5) put(seeds.data, a++, i);
      if (dyn[d + 7] < 0.98) put(stubs.data, b++, i);
      if (z > 0.01) put(shadows.data, c++, i);
    }
    seeds.count = a;
    stubs.count = b;
    shadows.count = c;
  }

  applyView() {
    if (!this.sim) return;
    const { width, height, size, cx, cy } = this.layout;
    const unit = size / 2;
    this.sim.setView(-cx / unit, -cy / unit, (width - cx) / unit, (height - cy) / unit);
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
    if (!this.ready) return;
    const cols = columnsFor(size);
    if (Math.abs(cols - this.cols) / this.cols > 0.18) this.build(cols);
    else this.applyView();
    this.render();
    this.kick();
  }

  toPortrait(clientX, clientY) {
    const rect = this.box.getBoundingClientRect();
    const { cx, cy, size } = this.layout;
    const unit = size / 2;
    return [(clientX - rect.left - cx) / unit, (clientY - rect.top - cy) / unit];
  }

  pointerDown(clientX, clientY, mouse) {
    this.ptr.x = clientX;
    this.ptr.y = clientY;
    this.ptr.down = true;
    this.ptr.inside = true;
    this.ptr.mouse = mouse;
    this.ptr.moved = true;
    this.prev = null;
    this.kick();
  }

  pointerMove(clientX, clientY, mouse) {
    this.ptr.x = clientX;
    this.ptr.y = clientY;
    this.ptr.inside = true;
    this.ptr.mouse = mouse;
    this.ptr.moved = true;
    this.kick();
  }

  pointerUp() {
    this.ptr.down = false;
    if (!this.ptr.mouse) {
      this.ptr.inside = false;
      this.prev = null;
    }
    this.kick();
  }

  pointerLeave() {
    if (this.ptr.down) return;
    this.ptr.inside = false;
    this.prev = null;
  }

  gust(dirX, dirY) {
    if (!this.ready) return;
    const m = Math.max(1e-4, Math.hypot(dirX, dirY));
    const dx = dirX / m;
    const dy = dirY / m;
    const bend = 0.12;
    this.auto = {
      from: [-dx * 1.35 - dy * bend, -dy * 1.35 + dx * bend],
      to: [dx * 1.35 + dy * bend, dy * 1.35 - dx * bend],
      t: 0,
      dur: 0.55,
      prev: null,
      vel: [0, 0],
    };
    this.kick();
  }

  setPortrait(index) {
    if (!this.ready || index === this.current) return;
    const forward = index > this.current;
    this.current = index;
    this.sim.sweep(this.tones[index], forward ? 1 : -1, 0);
    this.kick();
  }

  setBreath(source) {
    this.breath = source;
    this.kick();
  }

  deposit(from, to, dt, hard, vel) {
    const sim = this.sim;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    let vx = dx / dt;
    let vy = dy / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }
    const k = hard ? 0.9 : 0.5;
    vel[0] += (vx - vel[0]) * Math.min(1, dt * 30);
    vel[1] += (vy - vel[1]) * Math.min(1, dt * 30);
    if (Math.hypot(vel[0], vel[1]) < (hard ? 0.05 : 0.25)) return;
    const steps = Math.min(14, Math.max(1, Math.ceil(length / 0.05)));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      sim.addGust(from[0] + dx * t, from[1] + dy * t, vel[0] * k, vel[1] * k, hard);
    }
  }

  kick() {
    if (!this.ready || this.frame || !this.visible || document.hidden || this.destroyed) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  stopLoop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = null;
  }

  tick(now) {
    this.frame = 0;
    const dt = this.last == null ? 1 / 60 : Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    let busy = false;

    const ptr = this.ptr;
    if (ptr.inside && (ptr.down || ptr.mouse)) {
      const at = this.toPortrait(ptr.x, ptr.y);
      if (this.prev) this.deposit(this.prev, at, dt, ptr.down, this.vel);
      else {
        this.vel[0] = 0;
        this.vel[1] = 0;
      }
      this.prev = at;
      if (ptr.down || ptr.moved) busy = true;
      ptr.moved = false;
    }

    if (this.auto) {
      const auto = this.auto;
      auto.t = Math.min(1, auto.t + dt / auto.dur);
      const e = auto.t * auto.t * (3 - 2 * auto.t);
      const at = [auto.from[0] + (auto.to[0] - auto.from[0]) * e, auto.from[1] + (auto.to[1] - auto.from[1]) * e];
      if (auto.prev) this.deposit(auto.prev, at, dt, true, auto.vel);
      auto.prev = at;
      if (auto.t >= 1) this.auto = null;
      busy = true;
    }

    if (this.breath) {
      const level = this.breath(dt);
      if (level > 0.06) {
        const count = 2;
        for (let k = 0; k < count; k += 1) {
          const x = (Math.random() - 0.5) * 1.8;
          const y = 0.35 + Math.random() * 0.6;
          const sway = Math.sin(this.time * 0.7) * 0.4;
          this.sim.addGust(x, y, (sway + x * 0.3) * level * 3, -level * 3.4, true);
        }
      }
      busy = true;
    }

    busy = this.sim.step(dt, this.time) || busy;
    this.render();
    if (busy) this.kick();
    else this.last = null;
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.sim) return;
    const { width, height, size, cx, cy, dpr } = this.layout;
    const u = this.uniforms;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    this.pack();
    gl.uniform2f(u.uCenter, cx, cy);
    gl.uniform1f(u.uUnit, size / 2);
    gl.uniform2f(u.uSize, width, height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uSp, this.lattice.sp);
    gl.uniform2f(u.uLight, 0.55, 0.85);
    gl.uniform3f(u.uInk, INK[0], INK[1], INK[2]);
    gl.uniform3f(u.uHusk, HUSK[0], HUSK[1], HUSK[2]);
    gl.uniform3f(u.uShade, SHADE[0], SHADE[1], SHADE[2]);
    gl.uniform3f(u.uFluff, FLUFF[0], FLUFF[1], FLUFF[2]);
    for (const index of [2, 1, 0]) {
      const pass = this.passes[index];
      if (!pass.count) continue;
      gl.bindVertexArray(pass.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pass.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pass.data, 0, pass.count * 14);
      gl.uniform1i(u.uMode, pass.mode);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pass.count);
    }
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
      if (this.cornerBuffer) gl.deleteBuffer(this.cornerBuffer);
      this.passes?.forEach((pass) => {
        gl.deleteBuffer(pass.buffer);
        gl.deleteVertexArray(pass.vao);
      });
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
  }
}
