import FogDrips, { MAX_DRIPS } from "./fogDrips";
import { layoutWord, pointAlong, strokeLength } from "./fogHand";
import { BLUR_FRAGMENT, COMPOSITE_FRAGMENT, COPY_FRAGMENT, FIELD_FRAGMENT, MAX_SEGMENTS, QUAD_VERTEX, RESAMPLE_FRAGMENT } from "./fogShader";
import { SCENES } from "./fogScenes";

const MAX_DPR = 2;
const BLUR_WIDTH = 360;
const FADE_SECONDS = 0.9;
const FOG_EVAP = 1 / 38;
const WATER_EVAP = 1 / 44;
const RESIDUE_DECAY = 1 / 300;
const BREATH_RATE = 1.7;
const QUANTUM = 0.004;
const SETTLE_SECONDS = 58;
const WRITE_SPEED = 430;
const INTRO_EVAP = 10;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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

export default class FogEngine {
  constructor({ host, canvas, cursor, onReady, onFail, onMic }) {
    this.host = host;
    this.canvas = canvas;
    this.cursor = cursor;
    this.onReady = onReady;
    this.onFail = onFail;
    this.onMic = onMic;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.drips = new FogDrips(9);
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.sleptAt = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.warmed = false;
    this.live = false;
    this.clock = 0;
    this.settleAt = 0;
    this.current = null;
    this.previous = null;
    this.fade = 1;
    this.loadToken = 0;
    this.decayDebt = 0;
    this.residueDebt = 0;
    this.warmLeft = 0;
    this.pointer = null;
    this.hover = null;
    this.script = null;
    this.sources = [];
    this.keyBreath = null;
    this.mic = null;
    this.breathSeed = 0;
    this.strokeSeed = 0;
    this.wordFlip = 0;
    this.segData = new Float32Array(MAX_SEGMENTS * 4);
    this.segProps = new Float32Array(MAX_SEGMENTS * 4);
    this.segCount = 0;
    this.breathData = new Float32Array(8);
    this.breathSeeds = new Float32Array(2);
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      leave: (e) => {
        if (e.pointerType === "mouse") this.hideCursor();
      },
      visibility: () => this.checkVisibility(),
      lost: (e) => e.preventDefault(),
    };
  }

  start(sceneId) {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      this.onFail?.();
      return false;
    }
    this.gl = gl;
    try {
      this.setupGl();
    } catch (error) {
      console.error(error);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.onFail?.();
      return false;
    }
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.host.addEventListener("pointerdown", this.handlers.down);
    this.host.addEventListener("pointermove", this.handlers.move);
    this.host.addEventListener("pointerup", this.handlers.up);
    this.host.addEventListener("pointercancel", this.handlers.up);
    this.host.addEventListener("pointerleave", this.handlers.leave);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.host);
    this.resize();
    this.setScene(sceneId);
    return true;
  }

  setupGl() {
    const gl = this.gl;
    this.float = Boolean(gl.getExtension("EXT_color_buffer_float"));
    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    this.programs = {
      copy: link(gl, COPY_FRAGMENT),
      resample: link(gl, RESAMPLE_FRAGMENT),
      blur: link(gl, BLUR_FRAGMENT),
      field: link(gl, FIELD_FRAGMENT),
      composite: link(gl, COMPOSITE_FRAGMENT),
    };
    this.triBuffer = gl.createBuffer();
    this.triVao = gl.createVertexArray();
    gl.bindVertexArray(this.triVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  makeTarget(width, height, wide) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (wide && this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  dropTarget(target) {
    if (!target || !this.gl) return;
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  resize() {
    if (!this.gl) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.drips.resize(width, height);
    const fw = Math.max(8, Math.ceil(width / 2));
    const fh = Math.max(8, Math.ceil(height / 2));
    const old = this.fields ? this.fields[this.fieldRead] : null;
    const fresh = [this.makeTarget(fw, fh, true), this.makeTarget(fw, fh, true)];
    if (old) {
      const gl = this.gl;
      const { program, uniforms } = this.programs.resample;
      gl.useProgram(program);
      gl.bindVertexArray(this.triVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fresh[0].framebuffer);
      gl.viewport(0, 0, fw, fh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, old.texture);
      gl.uniform1i(uniforms.uSource, 0);
      gl.uniform2f(uniforms.uRes, fw, fh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.fields.forEach((t) => this.dropTarget(t));
    }
    this.fields = fresh;
    this.fieldRead = 0;
    for (const slot of [this.current, this.previous]) if (slot) this.mapSlot(slot);
    if (this.ready) this.render();
  }

  setScene(id) {
    const scene = SCENES.find((s) => s.id === id) || SCENES[0];
    const token = ++this.loadToken;
    if (this.current && this.current.scene === scene) return;
    const img = new Image();
    img.decoding = "async";
    img.src = scene.src;
    img
      .decode()
      .then(() => {
        if (this.destroyed || token !== this.loadToken || !this.gl) return;
        const slot = this.buildSlot(scene, img);
        if (this.previous) this.freeSlot(this.previous);
        this.previous = this.current;
        this.current = slot;
        this.fade = this.previous && !this.reduced ? 0 : 1;
        if (!this.warmed) this.warmUp();
        this.ready = true;
        this.render();
        this.onReady?.();
        this.wake();
      })
      .catch(() => {
        if (!this.ready) this.onFail?.();
      });
  }

  buildSlot(scene, img) {
    const gl = this.gl;
    const sharp = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sharp);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    const [cx, cy, cw, ch] = scene.crop;
    const cropW = img.naturalWidth * cw;
    const cropH = img.naturalHeight * ch;
    const bw = BLUR_WIDTH;
    const bh = Math.max(8, Math.round((BLUR_WIDTH * cropH) / cropW));
    const a = this.makeTarget(bw, bh, false);
    const b = this.makeTarget(bw, bh, false);
    const copy = this.programs.copy;
    gl.useProgram(copy.program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.viewport(0, 0, bw, bh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sharp);
    gl.uniform1i(copy.uniforms.uImage, 0);
    gl.uniform4f(copy.uniforms.uCrop, cx, cy, cw, ch);
    gl.uniform2f(copy.uniforms.uRes, bw, bh);
    gl.uniform1f(copy.uniforms.uLod, Math.max(0, Math.log2(Math.max(1e-3, cropW / bw))));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const blur = this.programs.blur;
    gl.useProgram(blur.program);
    gl.uniform1i(blur.uniforms.uSource, 0);
    gl.uniform2f(blur.uniforms.uRes, bw, bh);
    for (const spread of [1, 1.8, 2.6]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, a.texture);
      gl.uniform2f(blur.uniforms.uDir, spread, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, b.texture);
      gl.uniform2f(blur.uniforms.uDir, 0, spread);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dropTarget(b);
    const slot = { scene, sharp, blur: a, cropW, cropH, map: [0, 0, 1, 1], lod: 0 };
    this.mapSlot(slot);
    return slot;
  }

  mapSlot(slot) {
    const fit = Math.max(this.width / slot.cropW, this.height / slot.cropH);
    const [fx, fy] = slot.scene.focus;
    const offX = (this.width - slot.cropW * fit) * fx;
    const offY = (this.height - slot.cropH * fit) * fy;
    slot.map = [offX, offY, 1 / (slot.cropW * fit), 1 / (slot.cropH * fit)];
    slot.lod = Math.log2(Math.max(1e-3, 1 / (fit * this.dpr)));
  }

  freeSlot(slot) {
    if (!slot || !this.gl) return;
    this.gl.deleteTexture(slot.sharp);
    this.dropTarget(slot.blur);
  }

  minDim() {
    return Math.min(this.width, this.height);
  }

  fingerRadius() {
    return Math.min(12.5, Math.max(8.5, this.minDim() * 0.014));
  }

  breathReach() {
    const m = this.minDim();
    return [Math.min(40, 14 + m * 0.03), Math.min(200, 30 + m * 0.16)];
  }

  wake() {
    if (this.raf || this.destroyed || !this.gl || !this.visible || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  checkVisibility() {
    if (document.hidden || !this.visible) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.wake();
  }

  goLive() {
    if (!this.live) {
      this.live = true;
      this.settleAt = this.clock + SETTLE_SECONDS;
    }
  }

  touch() {
    this.goLive();
    this.settleAt = this.clock + SETTLE_SECONDS;
  }

  localPoint(e) {
    const rect = this.host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  pointerDown(e) {
    if (e.button > 0 || !this.gl || !this.ready) return;
    if (e.target.closest?.("button, input, label, a")) return;
    this.host.setPointerCapture?.(e.pointerId);
    const [x, y] = this.localPoint(e);
    if (this.pointer) this.releasePointer(this.pointer);
    this.script = null;
    this.touch();
    this.strokeSeed = (this.strokeSeed + 1.618) % 31;
    this.pointer = { id: e.pointerId, x, y, ax: x, ay: y, lx: x, ly: y, points: [], mode: "pending", held: 0, speed: 0, released: false, source: null };
    this.hover = [x, y];
    this.host.setAttribute("data-pressed", "");
    this.placeCursor(x, y);
    this.wake();
  }

  pointerMove(e) {
    const [mx, my] = this.localPoint(e);
    this.hover = [mx, my];
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      if (!this.pointer) this.placeCursor(mx, my);
    }
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    const events = e.getCoalescedEvents?.() || [];
    const rect = this.host.getBoundingClientRect();
    for (const ev of events.length ? events : [e]) {
      p.points.push([ev.clientX - rect.left, ev.clientY - rect.top]);
      if (p.points.length > 256) p.points.shift();
    }
    p.x = mx;
    p.y = my;
    this.wake();
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.released = true;
    this.host.removeAttribute("data-pressed");
    this.host.removeAttribute("data-breathing");
    if (e.pointerType !== "mouse") this.hideCursor();
    this.wake();
  }

  settleInk(ink) {
    if (!ink || !ink.carry) return;
    this.drips.pour(ink.lx, ink.ly + this.fingerRadius() * 0.8, ink.carry);
    ink.carry = 0;
  }

  releasePointer(p) {
    if (p.source) p.source.live = false;
    if (p.mode === "write") this.settleInk(p);
    if (p.mode === "pending") {
      if (this.drips.fogAt(p.ax, p.ay) > 0.12) {
        const r = this.fingerRadius();
        this.strokeSeed = (this.strokeSeed + 1.618) % 31;
        this.pushSegment(p.ax, p.ay, p.ax + 0.01, p.ay + 0.6, r, 1, 0);
        this.drips.pour(p.ax, p.ay + r * 0.8, this.drips.wipe(p.ax, p.ay, p.ax + 0.01, p.ay + 0.6, r, 1));
      } else {
        this.addSource(p.ax, p.ay, false, 0.32);
      }
    }
    this.pointer = null;
  }

  placeCursor(x, y) {
    if (!this.cursor) return;
    const r = this.fingerRadius();
    this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(r / 16).toFixed(3)})`;
    this.cursor.setAttribute("data-shown", "");
  }

  hideCursor() {
    this.cursor?.removeAttribute("data-shown");
  }

  addSource(x, y, live, hold = 0) {
    this.breathSeed = (this.breathSeed + 7.31) % 97;
    const source = { x, y, age: 0, tail: 0, live, hold, seed: this.breathSeed, strength: 1 };
    this.sources.push(source);
    while (this.sources.length > 2) {
      const drop = this.sources.findIndex((s) => !s.live);
      this.sources.splice(drop >= 0 ? drop : 0, 1);
    }
    this.host.setAttribute("data-breathing", "");
    return source;
  }

  breathNow(down) {
    if (!this.ready) return;
    if (down) {
      if (this.keyBreath) return;
      this.touch();
      const [x, y] = this.hover || [this.width * 0.5, this.height * 0.5];
      this.keyBreath = this.addSource(x, y, true);
    } else if (this.keyBreath) {
      this.keyBreath.live = false;
      this.keyBreath = null;
    }
    this.wake();
  }

  writeNow() {
    if (!this.ready) return;
    this.touch();
    if (this.pointer) this.releasePointer(this.pointer);
    const word = this.wordFlip % 2 === 0 ? "hi" : "sideB";
    this.wordFlip += 1;
    const m = this.minDim();
    const width = word === "hi" ? Math.min(150, m * 0.22) : Math.min(320, this.width * 0.5);
    const cx = this.width * 0.5;
    const cy = this.height * 0.48;
    this.script = this.buildScript(word, cx, cy, width, 1.5);
    this.wake();
  }

  buildScript(word, cx, cy, width, breathFor) {
    const strokes = layoutWord(word, cx, cy, width, this.strokeSeed + 1);
    const steps = [
      { kind: "breath", x: cx - width * 0.08, y: cy + width * 0.04, dur: breathFor },
      { kind: "wait", dur: 0.35 },
    ];
    strokes.forEach((stroke, i) => {
      steps.push({ kind: "stroke", points: stroke, length: strokeLength(stroke) });
      if (i < strokes.length - 1) steps.push({ kind: "wait", dur: 0.12 });
    });
    return { steps, index: 0, t: 0, done: 0, ink: null };
  }

  advanceScript(dt) {
    const s = this.script;
    if (!s) return false;
    let left = dt;
    while (left > 0 && s.index < s.steps.length) {
      const step = s.steps[s.index];
      if (step.kind === "wait") {
        const use = Math.min(left, step.dur - s.t);
        s.t += use;
        left -= use;
        if (s.t >= step.dur - 1e-6) this.nextStep(s);
      } else if (step.kind === "breath") {
        if (!step.source) step.source = this.addSource(step.x, step.y, true);
        const use = Math.min(left, step.dur - s.t);
        s.t += use;
        left -= use;
        if (s.t >= step.dur - 1e-6) {
          step.source.live = false;
          step.source.cut = true;
          this.nextStep(s);
        }
      } else {
        if (!s.ink) {
          const [x, y] = step.points[0];
          this.strokeSeed = (this.strokeSeed + 1.618) % 31;
          s.ink = { lx: x, ly: y, x, y, points: [], speed: WRITE_SPEED, fresh: true };
        }
        const total = step.length;
        const from = s.done;
        const to = Math.min(total, s.done + WRITE_SPEED * left);
        const used = (to - from) / WRITE_SPEED;
        const pieces = Math.max(1, Math.ceil((to - from) / 4));
        for (let k = 1; k <= pieces; k += 1) s.ink.points.push(pointAlong(step.points, from + ((to - from) * k) / pieces));
        s.done = to;
        left -= Math.max(used, 1e-4);
        this.inkPath(s.ink, dt, false);
        if (s.done >= total - 1e-6) {
          this.settleInk(s.ink);
          s.ink = null;
          s.done = 0;
          this.nextStep(s);
        }
      }
    }
    if (s.index >= s.steps.length) this.script = null;
    return true;
  }

  nextStep(s) {
    s.index += 1;
    s.t = 0;
  }

  pushSegment(x0, y0, x1, y1, radius, strength, mode) {
    if (this.segCount >= MAX_SEGMENTS) return;
    const i = this.segCount * 4;
    this.segData[i] = x0;
    this.segData[i + 1] = y0;
    this.segData[i + 2] = x1;
    this.segData[i + 3] = y1;
    this.segProps[i] = radius;
    this.segProps[i + 1] = strength;
    this.segProps[i + 2] = mode;
    this.segProps[i + 3] = this.strokeSeed;
    this.segCount += 1;
  }

  inkPath(ink, dt, measure) {
    const path = ink.points;
    let length = 0;
    let fx = ink.lx;
    let fy = ink.ly;
    for (const [x, y] of path) {
      length += Math.hypot(x - fx, y - fy);
      fx = x;
      fy = y;
    }
    if (measure) {
      const raw = length / Math.max(dt, 1 / 240);
      ink.speed += (Math.min(raw, 5000) - ink.speed) * (1 - Math.exp(-dt / 0.06));
    }
    const fast = smoothstep(500, 3200, ink.speed);
    const radius = this.fingerRadius() * (1 - 0.24 * fast);
    const strength = 1 - 0.16 * fast;
    if (ink.fresh) {
      this.pushSegment(ink.lx, ink.ly, ink.lx + 0.01, ink.ly, radius, strength, 0);
      ink.carry = this.drips.wipe(ink.lx, ink.ly, ink.lx + 0.01, ink.ly, radius, 1);
      ink.fresh = false;
    }
    if (length > 0.4) {
      const room = Math.max(1, MAX_SEGMENTS - 16 - this.segCount);
      const pieces = Math.min(room, Math.max(1, Math.ceil(length / (radius * 0.5))));
      const stride = path.length / pieces;
      let ax = ink.lx;
      let ay = ink.ly;
      for (let k = 1; k <= pieces; k += 1) {
        const [bx, by] = path[Math.max(0, Math.min(path.length - 1, Math.round(stride * k) - 1))];
        this.pushSegment(ax, ay, bx, by, radius, strength, 0);
        ink.carry = (ink.carry || 0) + this.drips.wipe(ax, ay, bx, by, radius, 1 - fast * 0.7);
        const run = Math.hypot(bx - ax, by - ay);
        const leak = ink.carry * (1 - Math.exp(-run / (by > ay ? 140 : 60)));
        this.drips.pour(bx, by + radius * 0.8, leak);
        ink.carry -= leak;
        ax = bx;
        ay = by;
      }
      ink.lx = ax;
      ink.ly = ay;
    }
    path.length = 0;
    return length;
  }

  stepPointer(dt) {
    const p = this.pointer;
    if (!p) return false;
    p.held += dt;
    const moved = Math.hypot(p.x - p.ax, p.y - p.ay);
    if (p.mode === "pending") {
      if (moved > 7) {
        p.mode = "write";
        p.fresh = true;
      } else if (p.held > 0.16) {
        p.mode = "breath";
        p.source = this.addSource(p.ax, p.ay, true);
        this.host.setAttribute("data-breathing", "");
        p.points.length = 0;
      }
    } else if (p.mode === "breath" && moved > 14) {
      p.source.live = false;
      p.source.cut = true;
      p.source = null;
      p.mode = "write";
      p.fresh = true;
      const [sx, sy] = p.points.length ? p.points[0] : [p.x, p.y];
      p.lx = sx;
      p.ly = sy;
      this.host.removeAttribute("data-breathing");
    }
    if (p.mode === "write") {
      this.inkPath(p, dt, true);
      this.settleAt = this.clock + SETTLE_SECONDS;
    } else {
      p.points.length = 0;
    }
    this.placeCursor(p.x, p.y);
    if (p.released) this.releasePointer(p);
    return true;
  }

  stepSources(dt) {
    const data = this.breathData;
    data.fill(0);
    const [s0, s1] = this.breathReach();
    let alive = false;
    const kept = [];
    for (const s of this.sources) {
      s.age += dt;
      if (!s.live && !(s.hold > 0 && s.age < s.hold)) s.tail += dt;
      const rise = smoothstep(0, 0.16, s.age);
      const tire = 0.42 + 0.58 * Math.exp(-Math.max(0, s.age - 2.4) / 1.6);
      const fall = s.live || (s.hold > 0 && s.age < s.hold) ? 1 : Math.exp(-s.tail / (s.cut ? 0.05 : 0.22));
      const envelope = rise * tire * fall * s.strength;
      const grow = 1 - Math.exp(-s.age / (s.hold > 0 ? 0.6 : 1.25));
      s.sigma = s0 + (s1 - s0) * grow * (s.hold > 0 ? 0.45 : 1);
      s.amount = envelope > 0.01 ? envelope * BREATH_RATE * dt : 0;
      if (s.live || (s.tail < 0.9 && fall > 0.01)) kept.push(s);
    }
    this.sources = kept;
    for (let k = 0; k < Math.min(2, kept.length); k += 1) {
      const s = kept[k];
      data[k * 4] = s.x;
      data[k * 4 + 1] = s.y;
      data[k * 4 + 2] = s.sigma;
      data[k * 4 + 3] = s.amount;
      this.breathSeeds[k] = s.seed;
      this.drips.breathe(s.x, s.y, s.sigma * 1.05, s.amount);
      if (s.amount > 0) alive = true;
    }
    if (alive) {
      this.warmLeft = 2;
      this.settleAt = this.clock + SETTLE_SECONDS;
    }
    if (!kept.some((s) => s.live)) this.host.removeAttribute("data-breathing");
    return kept.length > 0;
  }

  async enableMic() {
    if (this.mic || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const context = new Ctx();
      const node = context.createMediaStreamSource(stream);
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      node.connect(filter);
      filter.connect(analyser);
      this.mic = { stream, context, analyser, buffer: new Float32Array(analyser.fftSize), level: 0, source: null };
      this.touch();
      this.wake();
      return true;
    } catch {
      return false;
    }
  }

  disableMic() {
    const mic = this.mic;
    if (!mic) return;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.context.close().catch(() => {});
    if (mic.source) mic.source.live = false;
    this.mic = null;
    this.wake();
  }

  stepMic(dt) {
    const mic = this.mic;
    if (!mic) return false;
    mic.analyser.getFloatTimeDomainData(mic.buffer);
    let sum = 0;
    for (let i = 0; i < mic.buffer.length; i += 1) sum += mic.buffer[i] * mic.buffer[i];
    const rms = Math.sqrt(sum / mic.buffer.length);
    mic.level += (rms - mic.level) * (1 - Math.exp(-dt / 0.08));
    const blowing = smoothstep(0.035, 0.16, mic.level);
    if (blowing > 0.05) {
      if (!mic.source || !mic.source.live) {
        const [x, y] = this.hover || [this.width * 0.5, this.height * 0.55];
        mic.source = this.addSource(x, y, true);
      }
      mic.source.strength = 0.4 + 0.8 * blowing;
      this.touch();
    } else if (mic.source) {
      mic.source.live = false;
      mic.source = null;
    }
    return true;
  }

  stepDrips(dt) {
    const moving = this.drips.step(dt);
    const room = MAX_SEGMENTS - this.segCount;
    const trails = this.drips.trails;
    for (let i = 0; i < Math.min(room, trails.length); i += 1) {
      const [x0, y0, x1, y1, r] = trails[i];
      this.pushSegment(x0, y0, x1, y1, r * 0.92, 1, 1);
      this.drips.wipe(x0, y0, x1, y1, r * 0.9, 0);
    }
    if (moving) this.settleAt = Math.max(this.settleAt, this.clock + SETTLE_SECONDS * 0.6);
    return this.drips.drips.length > 0;
  }

  runField(dt) {
    const fogStep = this.decayDebt * FOG_EVAP;
    let evap = 0;
    let waterEvap = 0;
    if (fogStep >= QUANTUM || (!this.float && fogStep >= 1.5 / 255)) {
      evap = fogStep;
      waterEvap = this.decayDebt * WATER_EVAP;
      this.drips.evaporate(evap * 1.15);
      this.decayDebt = 0;
    }
    let residue = 0;
    if (this.residueDebt * RESIDUE_DECAY >= (this.float ? QUANTUM : 1.5 / 255)) {
      residue = this.residueDebt * RESIDUE_DECAY;
      this.residueDebt = 0;
    }
    const breathing = this.breathData[3] > 0 || this.breathData[7] > 0;
    if (!this.segCount && !breathing && evap === 0 && residue === 0 && this.warmLeft <= 0) return;
    const gl = this.gl;
    const read = this.fields[this.fieldRead];
    const write = this.fields[1 - this.fieldRead];
    const { program, uniforms } = this.programs.field;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, write.width, write.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(uniforms.uPrev, 0);
    gl.uniform2f(uniforms.uRes, write.width, write.height);
    gl.uniform2f(uniforms.uBox, this.width, this.height);
    gl.uniform1f(uniforms.uDt, dt);
    gl.uniform1f(uniforms.uBreathing, breathing ? 1 : 0);
    gl.uniform1f(uniforms.uEvap, evap);
    gl.uniform1f(uniforms.uWaterEvap, waterEvap);
    gl.uniform1f(uniforms.uResidueDecay, residue);
    gl.uniform4fv(uniforms.uBreath, this.breathData);
    gl.uniform2f(uniforms.uBreathSeed, this.breathSeeds[0], this.breathSeeds[1]);
    gl.uniform1i(uniforms.uCount, this.segCount);
    if (this.segCount > 0) {
      gl.uniform4fv(uniforms.uSeg, this.segData);
      gl.uniform4fv(uniforms.uSegP, this.segProps);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fieldRead = 1 - this.fieldRead;
    this.segCount = 0;
  }

  simulate(dt) {
    this.clock += dt;
    this.decayDebt += dt;
    this.residueDebt += dt;
    this.warmLeft = Math.max(0, this.warmLeft - dt);
    const scripted = this.advanceScript(dt);
    const touching = this.stepPointer(dt);
    const listening = this.stepMic(dt);
    const breathing = this.stepSources(dt);
    const dripping = this.stepDrips(dt);
    this.runField(dt);
    return scripted || touching || listening || breathing || dripping || this.warmLeft > 0;
  }

  warmUp() {
    this.warmed = true;
    const w = this.width;
    const h = this.height;
    const narrow = w < 640;
    const width = narrow ? Math.min(260, w * 0.62) : Math.min(340, Math.max(220, w * 0.24));
    const cx = narrow ? w * 0.42 : w * 0.24;
    const cy = narrow ? h * 0.6 : h * 0.62;
    const script = this.buildScript("sideB", cx + width * 0.04, cy, width, 2.6);
    script.steps.splice(1, 0, { kind: "breath", x: cx - width * 0.32, y: cy + width * 0.3, dur: 1.4 });
    this.script = script;
    const dt = 1 / 20;
    let guard = 0;
    while (this.script && guard < 600) {
      this.simulate(dt);
      guard += 1;
    }
    for (let i = 0; i < 8; i += 1) this.simulate(dt);
    for (let i = 0; i < INTRO_EVAP / 0.25; i += 1) this.simulate(0.25);
    this.sources.length = 0;
    this.drips.drips = this.drips.drips.filter((d) => d.mass > 0.3);
    for (const d of this.drips.drips) {
      d.speed = 0;
      d.stretch = 0;
      d.grow = 1;
    }
    this.host.removeAttribute("data-breathing");
    this.clock = 0;
    this.live = false;
  }

  setSlotUniforms(uniforms, suffix, slot, unit) {
    const gl = this.gl;
    const s = slot.scene;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, slot.sharp);
    gl.uniform1i(uniforms[`uSharp${suffix}`], unit);
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    gl.bindTexture(gl.TEXTURE_2D, slot.blur.texture);
    gl.uniform1i(uniforms[`uBlur${suffix}`], unit + 1);
    gl.uniform4fv(uniforms[`uCrop${suffix}`], s.crop);
    gl.uniform4fv(uniforms[`uMap${suffix}`], slot.map);
    gl.uniform4fv(uniforms[`uGrade${suffix}`], s.grade);
    gl.uniform4fv(uniforms[`uTint${suffix}`], s.tint);
    gl.uniform1f(uniforms[`uLod${suffix}`], slot.lod);
  }

  render() {
    if (!this.current || !this.gl) return;
    const gl = this.gl;
    const { program, uniforms } = this.programs.composite;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const cur = this.current;
    const prev = this.previous || cur;
    const mix = this.fade >= 1 ? 1 : this.fade * this.fade * (3 - 2 * this.fade);
    this.setSlotUniforms(uniforms, "B", cur, 0);
    this.setSlotUniforms(uniforms, "A", prev, 2);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.fields[this.fieldRead].texture);
    gl.uniform1i(uniforms.uField, 4);
    const la = prev.scene.light;
    const lb = cur.scene.light;
    gl.uniform3f(uniforms.uLight, la[0] + (lb[0] - la[0]) * mix, la[1] + (lb[1] - la[1]) * mix, la[2] + (lb[2] - la[2]) * mix);
    gl.uniform1f(uniforms.uGlow, prev.scene.glow + (cur.scene.glow - prev.scene.glow) * mix);
    gl.uniform1f(uniforms.uMix, mix);
    gl.uniform2f(uniforms.uBox, this.width, this.height);
    gl.uniform1f(uniforms.uDpr, this.canvas.width / this.width);
    const count = this.drips.pack();
    gl.uniform1i(uniforms.uDripCount, count);
    gl.uniform4fv(uniforms.uDrip, this.drips.data, 0, MAX_DRIPS * 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  frame(now) {
    this.raf = 0;
    if (this.destroyed || !this.current) return;
    if (!this.last && this.sleptAt && now > this.sleptAt) this.residueDebt += Math.min(600, (now - this.sleptAt) / 1000);
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    this.sleptAt = now;
    if (dt <= 0) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    let busy = false;
    if (this.live) {
      busy = this.simulate(dt) || this.clock < this.settleAt;
    } else if (this.pointer || this.script || this.sources.length || this.mic) {
      this.goLive();
      busy = true;
    }
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / FADE_SECONDS);
      busy = true;
    } else if (this.previous) {
      this.freeSlot(this.previous);
      this.previous = null;
    }
    this.render();
    if (busy || this.pointer || this.mic) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.disableMic();
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.canvas.removeEventListener("webglcontextlost", this.handlers.lost);
    this.host.removeEventListener("pointerdown", this.handlers.down);
    this.host.removeEventListener("pointermove", this.handlers.move);
    this.host.removeEventListener("pointerup", this.handlers.up);
    this.host.removeEventListener("pointercancel", this.handlers.up);
    this.host.removeEventListener("pointerleave", this.handlers.leave);
    const gl = this.gl;
    if (!gl) return;
    this.freeSlot(this.current);
    this.freeSlot(this.previous);
    this.fields?.forEach((t) => this.dropTarget(t));
    Object.values(this.programs).forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteBuffer(this.triBuffer);
    gl.deleteVertexArray(this.triVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
