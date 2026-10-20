import {
  BRISTLES,
  COPY_FRAGMENT,
  PAINT_FRAGMENT,
  QUAD_VERTEX,
  RESAMPLE_FRAGMENT,
  SPLAT_FRAGMENT,
  STATE_FRAGMENT,
} from "./oilShader";
import { STUDY, TUBES } from "./oilArt";
import OilSound from "./oilSound";

const MAX_DPR = 2;
const MAX_TEXEL = 1.5;
const PAINT_ASPECT = 1.25;
const MIN_ASPECT = 1;
const FOLLOW = 26;
const TURN = 7;
const STEP = 3;
const MAX_STEPS = 24;
const RESERVOIR_RUN = 1100;
const DEPOSIT = 0.62;
const SCRAPE = 0.16;
const SMEAR = 0.92;
const PICKUP = 0.03;
const TOP_LAYER = 0.42;
const NORMAL_SCALE = 1.2;
const GROUND = [0.957, 0.945, 0.918];

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

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

function link(gl, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, QUAD_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(info || "link failed");
  }
  const uniforms = {};
  const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < total; i += 1) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tubeColor(index, mix = 0) {
  return TUBES[index].ryb.map((v) => v * (1 - mix));
}

export default class OilEngine {
  constructor({ root, stage, canvas, cursor, tube = 0, onReady, onError, onStroke }) {
    this.root = root;
    this.stage = stage;
    this.canvas = canvas;
    this.cursor = cursor;
    this.tube = tube;
    this.onReady = onReady;
    this.onError = onError;
    this.onStroke = onStroke;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.texel = 1;
    this.size = [1, 1];
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.dirty = true;
    this.down = false;
    this.pointer = null;
    this.tip = null;
    this.angle = Math.PI * 0.5;
    this.reservoir = 1;
    this.travel = 0;
    this.run = 0;
    this.pickupScale = 1;
    this.speed = 0;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sound = new OilSound();
    this.state = new Float32Array(BRISTLES * 4);
    this.segments = new Float32Array(BRISTLES * 4);
    this.bristleData = new Float32Array(BRISTLES * 2);
    this.makeBristles(7);
    this.frame = this.frame.bind(this);
    this.handleVisibility = () => this.wake();
  }

  makeBristles(seed) {
    const random = mulberry(seed);
    this.bristles = [];
    let clump = 0;
    for (let i = 0; i < BRISTLES; i += 1) {
      if (i % 4 === 0) clump = (random() - 0.5) * 0.022;
      const t = i / (BRISTLES - 1) - 0.5;
      this.bristles.push({
        offset: t * 0.96 + clump + (random() - 0.5) * 0.03,
        radius: 1 + random() * 0.8,
        load: 0.3 + random() * 0.7,
        lag: (random() - 0.5) * 0.22,
        rate: 0.004 + random() * 0.012,
        phase: random() * Math.PI * 2,
        sway: 0.008 + random() * 0.018,
        swayRate: 0.006 + random() * 0.02,
        swayPhase: random() * Math.PI * 2,
      });
    }
  }

  start() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) {
      this.onError?.();
      return;
    }
    gl.getExtension("OES_texture_float_linear");
    this.gl = gl;
    try {
      this.programs = {
        state: link(gl, STATE_FRAGMENT),
        splat: link(gl, SPLAT_FRAGMENT),
        copy: link(gl, COPY_FRAGMENT),
        paint: link(gl, PAINT_FRAGMENT),
        resample: link(gl, RESAMPLE_FRAGMENT),
      };
    } catch {
      this.onError?.();
      return;
    }
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.stateTargets = [this.makeTarget(BRISTLES, 1, false), this.makeTarget(BRISTLES, 1, false)];
    this.canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.wake();
    });
    this.intersection.observe(this.root);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.root);
    this.resizer.observe(this.stage);
    this.resize();
    this.paintStudy();
    this.render();
    this.onReady?.();
  }

  makeTarget(width, height, linear = true) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  dropTarget(target) {
    if (!target || !this.gl) return;
    this.gl.deleteTexture(target.texture);
    this.gl.deleteFramebuffer(target.framebuffer);
  }

  resize() {
    if (!this.gl || this.destroyed) return;
    const host = this.root.getBoundingClientRect();
    const box = this.stage.getBoundingClientRect();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const aspect = Math.max(MIN_ASPECT, Math.min(PAINT_ASPECT, box.width / Math.max(1, box.height)));
    let w = box.width;
    let h = w / aspect;
    if (h > box.height) {
      h = box.height;
      w = h * aspect;
    }
    const x = Math.round(box.left - host.left + (box.width - w) / 2);
    const y = Math.round(box.top - host.top + (box.height - h) / 2);
    const rect = { x, y, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    const texel = Math.min(MAX_TEXEL, dpr);
    const size = [Math.max(2, Math.round(rect.w * texel)), Math.max(2, Math.round(rect.h * texel))];
    const changed = !this.paint || size[0] !== this.size[0] || size[1] !== this.size[1];
    this.rect = rect;
    this.dpr = dpr;
    this.texel = texel;
    this.unit = Math.min(rect.w, rect.h) / 2;
    this.brushWidth = Math.max(26, Math.min(64, this.unit * 0.17));
    const style = this.canvas.style;
    style.left = `${rect.x}px`;
    style.top = `${rect.y}px`;
    style.width = `${rect.w}px`;
    style.height = `${rect.h}px`;
    this.canvas.width = Math.round(rect.w * dpr);
    this.canvas.height = Math.round(rect.h * dpr);
    const rootStyle = this.root.style;
    rootStyle.setProperty("--oil-x", `${rect.x}px`);
    rootStyle.setProperty("--oil-y", `${rect.y}px`);
    rootStyle.setProperty("--oil-w", `${rect.w}px`);
    rootStyle.setProperty("--oil-h", `${rect.h}px`);
    rootStyle.setProperty("--oil-brush", `${Math.round(this.brushWidth)}px`);
    if (changed) this.resizePaint(size);
    this.dirty = true;
    this.render();
  }

  resizePaint(size) {
    const gl = this.gl;
    const previous = this.paint;
    const scratch = this.scratch;
    this.paint = this.makeTarget(size[0], size[1]);
    this.scratch = this.makeTarget(size[0], size[1]);
    this.size = size;
    if (previous) {
      const { program, uniforms: u } = this.programs.resample;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.paint.framebuffer);
      gl.viewport(0, 0, size[0], size[1]);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, previous.texture);
      gl.uniform1i(u.uSource, 0);
      gl.uniform2f(u.uSize, size[0], size[1]);
      this.draw();
      this.dropTarget(previous);
      this.dropTarget(scratch);
    } else {
      this.clearPaint();
    }
  }

  clearPaint() {
    const gl = this.gl;
    for (const target of [this.paint, this.scratch]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  toTexel(x, y) {
    return [x * this.texel, (this.rect.h - y) * this.texel];
  }

  loadBrush(color) {
    for (let i = 0; i < BRISTLES; i += 1) {
      this.state[i * 4] = color[0];
      this.state[i * 4 + 1] = color[1];
      this.state[i * 4 + 2] = color[2];
      this.state[i * 4 + 3] = 1;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.stateTargets[0].texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BRISTLES, 1, gl.RGBA, gl.FLOAT, this.state);
    this.reservoir = 1;
  }

  bristleLine(tip, angle, width, out, slot) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = 0; i < BRISTLES; i += 1) {
      const bristle = this.bristles[i];
      const along = (bristle.offset + bristle.sway * Math.sin((this.run || 0) * bristle.swayRate + bristle.swayPhase)) * width;
      const lag = bristle.lag * width * 0.25;
      out[i * 4 + slot] = tip[0] + cos * along - sin * lag;
      out[i * 4 + slot + 1] = tip[1] + sin * along + cos * lag;
    }
  }

  stamp(from, to, angleFrom, angleTo, width, load) {
    const gl = this.gl;
    const spacing = width / BRISTLES;
    this.bristleLine(from, angleFrom, width, this.segments, 0);
    this.bristleLine(to, angleTo, width, this.segments, 2);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let reach = 0;
    for (let i = 0; i < BRISTLES; i += 1) {
      const radius = spacing * this.bristles[i].radius * 1.15;
      this.bristleData[i * 2] = radius;
      const bristle = this.bristles[i];
      const skip = 0.72 + 0.28 * Math.sin(this.run * bristle.rate + bristle.phase);
      this.bristleData[i * 2 + 1] = bristle.load * skip;
      reach = Math.max(reach, radius);
      for (const k of [0, 2]) {
        minX = Math.min(minX, this.segments[i * 4 + k]);
        maxX = Math.max(maxX, this.segments[i * 4 + k]);
        minY = Math.min(minY, this.segments[i * 4 + k + 1]);
        maxY = Math.max(maxY, this.segments[i * 4 + k + 1]);
      }
    }
    const pad = reach + 2;
    const sx = Math.max(0, Math.floor(minX - pad));
    const sy = Math.max(0, Math.floor(minY - pad));
    const ex = Math.min(this.size[0], Math.ceil(maxX + pad));
    const ey = Math.min(this.size[1], Math.ceil(maxY + pad));
    if (ex <= sx || ey <= sy) return;

    const stateProgram = this.programs.state;
    const [stateA, stateB] = this.stateTargets;
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateB.framebuffer);
    gl.viewport(0, 0, BRISTLES, 1);
    gl.useProgram(stateProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(stateProgram.uniforms.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paint.texture);
    gl.uniform1i(stateProgram.uniforms.uPaint, 1);
    gl.uniform2f(stateProgram.uniforms.uSize, this.size[0], this.size[1]);
    gl.uniform4fv(stateProgram.uniforms.uSeg, this.segments);
    gl.uniform1f(stateProgram.uniforms.uPickup, PICKUP * this.pickupScale * (1.3 - load * 0.6));
    this.draw();
    this.stateTargets = [stateB, stateA];

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(sx, sy, ex - sx, ey - sy);
    const splat = this.programs.splat;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scratch.framebuffer);
    gl.viewport(0, 0, this.size[0], this.size[1]);
    gl.useProgram(splat.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paint.texture);
    gl.uniform1i(splat.uniforms.uPaint, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, stateB.texture);
    gl.uniform1i(splat.uniforms.uState, 1);
    gl.uniform2f(splat.uniforms.uSize, this.size[0], this.size[1]);
    gl.uniform4fv(splat.uniforms.uSeg, this.segments);
    gl.uniform2fv(splat.uniforms.uBristle, this.bristleData);
    gl.uniform2f(splat.uniforms.uMotion, to[0] - from[0], to[1] - from[1]);
    gl.uniform1f(splat.uniforms.uLoad, DEPOSIT * Math.max(0.22, load));
    gl.uniform1f(splat.uniforms.uScrape, SCRAPE);
    gl.uniform1f(splat.uniforms.uSmear, SMEAR);
    gl.uniform1f(splat.uniforms.uTop, TOP_LAYER);
    this.draw();

    const copy = this.programs.copy;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paint.framebuffer);
    gl.useProgram(copy.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scratch.texture);
    gl.uniform1i(copy.uniforms.uSource, 0);
    this.draw();
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dirty = true;
  }

  sweep(from, to, angleFrom, angleTo, width, load) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(length / (STEP * this.texel))));
    let delta = angleTo - angleFrom;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    let previous = from;
    let previousAngle = angleFrom;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      const angle = angleFrom + delta * t;
      this.run += length / steps;
      this.stamp(previous, point, previousAngle, angle, width, load);
      previous = point;
      previousAngle = angle;
    }
  }

  paintStudy() {
    const unit = this.unit * this.texel;
    const center = [this.size[0] / 2, this.size[1] / 2];
    const width = this.brushWidth * this.texel;
    this.pickupScale = 0.45;
    STUDY.forEach((stroke, index) => {
      this.makeBristles(31 + index * 17);
      this.run = index * 97;
      this.loadBrush(tubeColor(stroke.tube, stroke.mix));
      const points = stroke.points.map(([px, py]) => [center[0] + px * unit, center[1] - py * unit]);
      let angle = null;
      let run = 0;
      for (let i = 0; i < points.length; i += 1) {
        const from = points[Math.max(0, i - 1)];
        const to = points[i];
        const heading = Math.atan2(to[1] - from[1], to[0] - from[0]);
        const target = i === 0 ? Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]) + Math.PI / 2 : heading + Math.PI / 2;
        const next = angle == null ? target : this.nearestAngle(angle, target, 0.55);
        if (i > 0) {
          const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
          const before = stroke.load * Math.exp(-run / (RESERVOIR_RUN * this.texel));
          run += length;
          this.sweep(from, to, angle, next, width * stroke.width, before);
        } else {
          this.sweep(to, to, next, next, width * stroke.width, stroke.load);
        }
        angle = next;
      }
    });
    this.pickupScale = 1;
    this.makeBristles(7);
    this.loadBrush(tubeColor(this.tube));
  }

  nearestAngle(current, target, amount) {
    let delta = target - current;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (delta > Math.PI / 2) delta -= Math.PI;
    if (delta < -Math.PI / 2) delta += Math.PI;
    return current + delta * amount;
  }

  local(clientX, clientY) {
    const box = this.canvas.getBoundingClientRect();
    return [clientX - box.left, clientY - box.top];
  }

  setTube(index) {
    this.tube = index;
    if (this.gl) this.loadBrush(tubeColor(index));
  }

  press(clientX, clientY) {
    if (!this.gl) return;
    this.sound.unlock();
    const point = this.local(clientX, clientY);
    this.pointer = point;
    this.tip = point.slice();
    this.down = true;
    this.travel = 0;
    this.strokeSeed = (this.strokeSeed || 0) + 1;
    this.makeBristles(101 + this.strokeSeed * 13);
    this.loadBrush(tubeColor(this.tube));
    const texel = this.toTexel(point[0], point[1]);
    this.sweep(texel, texel, this.angle, this.angle, this.brushWidth * this.texel, 1);
    this.placeCursor();
    this.render();
    this.wake();
  }

  hover(clientX, clientY) {
    const point = this.local(clientX, clientY);
    this.pointer = point;
    if (!this.down) {
      this.tip = point;
      this.placeCursor();
    } else {
      this.wake();
    }
  }

  release() {
    if (!this.down) return;
    this.down = false;
    this.sound.setSpeed(0);
    this.onStroke?.();
  }

  leave() {
    this.cursor?.removeAttribute("data-shown");
  }

  reset() {
    if (!this.gl) return;
    this.clearPaint();
    this.paintStudy();
    this.dirty = true;
    this.render();
  }

  step(dt) {
    if (!this.down || !this.pointer || !this.tip) return false;
    const target = this.pointer;
    const lambda = this.reduced ? 60 : FOLLOW;
    const next = [damp(this.tip[0], target[0], lambda, dt), damp(this.tip[1], target[1], lambda, dt)];
    const dx = next[0] - this.tip[0];
    const dy = next[1] - this.tip[1];
    const length = Math.hypot(dx, dy);
    this.speed = damp(this.speed, length / Math.max(dt, 0.001), 10, dt);
    this.sound.setSpeed(this.speed);
    if (length < 0.15) return Math.hypot(target[0] - this.tip[0], target[1] - this.tip[1]) > 0.3;
    const heading = Math.atan2(-dy, dx) + Math.PI / 2;
    const turn = 1 - Math.exp(-TURN * dt * Math.min(1, length / 3));
    const angle = this.nearestAngle(this.angle, heading, turn);
    const load = Math.exp(-this.travel / RESERVOIR_RUN);
    this.sweep(this.toTexel(this.tip[0], this.tip[1]), this.toTexel(next[0], next[1]), this.angle, angle, this.brushWidth * this.texel, load);
    this.travel += length;
    this.angle = angle;
    this.tip = next;
    return true;
  }

  placeCursor() {
    if (!this.cursor || !this.tip) return;
    const deg = (-this.angle * 180) / Math.PI;
    this.cursor.style.transform = `translate3d(${this.rect.x + this.tip[0]}px, ${this.rect.y + this.tip[1]}px, 0) rotate(${deg}deg)`;
    this.cursor.setAttribute("data-shown", "");
  }

  wake() {
    if (this.destroyed || !this.gl) return;
    const running = this.visible && !document.hidden;
    if (!running) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.sound.setSpeed(0);
      return;
    }
    if (!this.raf && (this.down || this.dirty)) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  frame(now) {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const moving = this.step(dt);
    this.placeCursor();
    this.render();
    if ((this.down || moving) && this.visible && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.paint || !this.dirty) return;
    this.dirty = false;
    const { program, uniforms: u } = this.programs.paint;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paint.texture);
    gl.uniform1i(u.uPaint, 0);
    gl.uniform2f(u.uSize, this.size[0], this.size[1]);
    gl.uniform2f(u.uOutput, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTexel, this.texel);
    gl.uniform1f(u.uNormalScale, NORMAL_SCALE);
    gl.uniform3f(u.uLight, 0, 1, 0.6);
    gl.uniform1f(u.uRoughness, 0.075);
    gl.uniform1f(u.uF0, 0.05);
    gl.uniform1f(u.uDiffuse, 0.28);
    gl.uniform1f(u.uSpecular, 0.5);
    gl.uniform3f(u.uGround, GROUND[0], GROUND[1], GROUND[2]);
    this.draw();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    this.sound.close();
    const gl = this.gl;
    if (gl) {
      this.dropTarget(this.paint);
      this.dropTarget(this.scratch);
      for (const target of this.stateTargets || []) this.dropTarget(target);
      gl.deleteBuffer(this.buffer);
      gl.deleteVertexArray(this.vao);
      for (const entry of Object.values(this.programs || {})) gl.deleteProgram(entry.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
  }
}

