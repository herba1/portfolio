import { SETLIST } from "./ghostSet";
import { COMPOSITE_FRAGMENT, DOWN_FRAGMENT, QUAD_VERTEX, UP_FRAGMENT } from "./ghostShader";

const MAX_DPR = 2;
const GHOSTS = 4;
const VMAX = 4.5;
const AMAX = 34;
const OMEGA = 7.2;
const LEVELS = 7;
const CARRY = 0.62;
const COOL = [0.36, 0.5, 1.0];
const WHEEL_QUIET = 0.14;
const RUBBER = 0.22;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
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
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function readVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function trackingFor(size) {
  return -0.043 * (size - 12);
}

function rubber(raw, lo, hi) {
  if (raw < lo) return lo - RUBBER * (1 - Math.exp(-(lo - raw) / RUBBER));
  if (raw > hi) return hi + RUBBER * (1 - Math.exp(-(raw - hi) / RUBBER));
  return raw;
}

function unrubber(p, lo, hi) {
  if (p < lo) return lo + RUBBER * Math.log(Math.max(1e-6, 1 - (lo - p) / RUBBER));
  if (p > hi) return hi - RUBBER * Math.log(Math.max(1e-6, 1 - (p - hi) / RUBBER));
  return p;
}

export default class GhostEngine {
  constructor({ host, canvas, embedded, onSelect, onReady, onFail, onGrab }) {
    this.host = host;
    this.canvas = canvas;
    this.embedded = embedded;
    this.onSelect = onSelect;
    this.onReady = onReady;
    this.onFail = onFail;
    this.onGrab = onGrab;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.count = SETLIST.length;
    this.p = 0;
    this.pRaw = 0;
    this.v = 0;
    this.mode = "idle";
    this.target = 0;
    this.omega = OMEGA;
    this.trail = 0;
    this.selected = 0;
    this.pointer = null;
    this.wheel = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      wheel: (e) => this.onWheel(e),
      visibility: () => this.checkVisibility(),
      lost: (e) => e.preventDefault(),
    };
  }

  async start() {
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
    this.sans = readVar("--font-sans", "ui-sans-serif, system-ui, sans-serif");
    const weight = parseInt(readVar("--text-display--font-weight", "600"), 10);
    this.weight = Number.isFinite(weight) ? weight : 600;
    try {
      await document.fonts.load(`${this.weight} 200px ${this.sans}`, "Come Together Something Taxman");
    } catch {}
    if (this.destroyed) return false;
    this.text = document.createElement("canvas");
    this.ctx = this.text.getContext("2d", { alpha: false });
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.host.addEventListener("pointerdown", this.handlers.down);
    this.host.addEventListener("pointermove", this.handlers.move);
    this.host.addEventListener("pointerup", this.handlers.up);
    this.host.addEventListener("pointercancel", this.handlers.up);
    this.host.addEventListener("wheel", this.handlers.wheel, { passive: false });
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.host);
    this.resize();
    if (!this.reduced) {
      this.p = -0.62;
      this.pRaw = this.p;
      this.v = 0.4;
      this.settle(0);
    }
    this.render();
    this.ready = true;
    this.onReady?.();
    this.wake();
    return true;
  }

  setupGl() {
    const gl = this.gl;
    this.float = Boolean(gl.getExtension("EXT_color_buffer_float"));
    this.programs = {
      down: link(gl, DOWN_FRAGMENT),
      up: link(gl, UP_FRAGMENT),
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
    this.textTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  makeTarget(width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  dropTarget(target) {
    if (!target || !this.gl) return;
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  freeChain() {
    this.downs?.forEach((t) => this.dropTarget(t));
    this.ups?.forEach((t) => this.dropTarget(t));
    this.downs = null;
    this.ups = null;
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
    const cw = Math.round(width * dpr);
    const ch = Math.round(height * dpr);
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.text.width = cw;
    this.text.height = ch;
    this.freeChain();
    this.downs = [];
    this.ups = [];
    let w = cw;
    let h = ch;
    for (let i = 0; i < LEVELS; i += 1) {
      w = Math.max(2, Math.ceil(w / 2));
      h = Math.max(2, Math.ceil(h / 2));
      this.downs.push(this.makeTarget(w, h));
      this.ups.push(i < LEVELS - 1 ? this.makeTarget(w, h) : null);
    }
    this.shift = dpr >= 1.5 ? 1 : 0;
    this.layout();
    if (this.ready) this.render();
  }

  layout() {
    const W = this.width;
    const H = this.height;
    const narrow = W / H < 0.95;
    const ctx = this.ctx;
    const L = W * 1.14 + 48;
    const amp = L * 0.042;
    this.slot = L;
    this.amp = amp;
    const fitW = W * (narrow ? 0.84 : 0.78);
    const top = this.embedded ? H * 0.08 : narrow ? 184 : 156;
    const room = Math.max(H * 0.2, H * 0.6 - top);
    const capLine = Math.min(H * (narrow ? 0.15 : 0.3), (room / (narrow ? 1.74 : 0.72)) * 0.92);
    let blockHalf = 0;
    this.titles = SETLIST.map((item) => {
      const lines = narrow ? item.lines : [item.title];
      ctx.font = `${this.weight} 100px ${this.sans}`;
      let size = Infinity;
      for (const line of lines) {
        const n = line.length;
        const a = ctx.measureText(line).width / 100;
        const k = a - 0.043 * (n - 1);
        const fit = (fitW - 0.516 * (n - 1)) / Math.max(0.1, k);
        size = Math.min(size, fit);
      }
      size = Math.max(14, Math.min(size, capLine));
      const tracking = trackingFor(size);
      const font = `${this.weight} ${size.toFixed(2)}px ${this.sans}`;
      ctx.font = font;
      const cap = ctx.measureText("H").actualBoundingBoxAscent || size * 0.7;
      const gap = size * 1.02;
      const glyphs = [];
      lines.forEach((line, li) => {
        const total = ctx.measureText(line).width + tracking * (line.length - 1);
        const normal = (li - (lines.length - 1) / 2) * gap;
        for (let c = 0; c < line.length; c += 1) {
          const ch = line[c];
          if (ch === " ") continue;
          const left = ctx.measureText(line.slice(0, c)).width + tracking * c;
          const w = ctx.measureText(ch).width;
          glyphs.push({ ch, along: left + w / 2 - total / 2, normal, half: w / 2 });
        }
      });
      const half = ((lines.length - 1) * gap) / 2 + cap / 2;
      blockHalf = Math.max(blockHalf, half);
      return { font, size, cap, glyphs, half, lineWidth: Math.max(1, size * 0.011) };
    });
    this.cy = Math.max(H * (narrow ? 0.34 : 0.38), top + blockHalf + 12);
    const span = L * 2.7;
    const step = 1;
    const samples = Math.ceil((span * 2) / step) + 1;
    const xs = new Float32Array(samples);
    const ys = new Float32Array(samples);
    const ss = new Float32Array(samples);
    let s = 0;
    for (let i = 0; i < samples; i += 1) {
      const u = -span + i * step;
      xs[i] = W / 2 + u;
      ys[i] = this.cy + amp * (1 - Math.cos((Math.PI * u) / L));
      if (i > 0) s += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      ss[i] = s;
    }
    const mid = Math.round(span / step);
    const s0 = ss[mid];
    for (let i = 0; i < samples; i += 1) ss[i] -= s0;
    this.path = { xs, ys, ss, samples };
    this.slotArc = this.arcAtU(L);
  }

  arcAtU(u) {
    const { xs, ss, samples } = this.path;
    const x = this.width / 2 + u;
    const i = clamp(Math.floor(x - xs[0]), 0, samples - 2);
    const f = clamp(x - xs[0] - i, 0, 1);
    return ss[i] + (ss[i + 1] - ss[i]) * f;
  }

  pointAt(s) {
    const { xs, ys, ss, samples } = this.path;
    let lo = 0;
    let hi = samples - 1;
    if (s <= ss[0]) hi = 1;
    else if (s >= ss[hi]) lo = hi - 1;
    else {
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (ss[m] <= s) lo = m;
        else hi = m;
      }
    }
    const span = ss[hi] - ss[lo] || 1;
    const f = (s - ss[lo]) / span;
    const dx = xs[hi] - xs[lo];
    const dy = ys[hi] - ys[lo];
    return { x: xs[lo] + dx * f, y: ys[lo] + dy * f, angle: Math.atan2(dy, dx) };
  }

  neonAt(p) {
    const a = clamp(Math.floor(p), 0, this.count - 1);
    const b = clamp(a + 1, 0, this.count - 1);
    const t = smoothstep(0.2, 0.8, p - Math.floor(p));
    const ca = SETLIST[a].neon;
    const cb = SETLIST[b].neon;
    return [0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * t);
  }

  drawGlyphs(title, centre, style, kind) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.width;
    ctx.font = title.font;
    if (kind === "fill") ctx.fillStyle = style;
    else {
      ctx.strokeStyle = style;
      ctx.lineWidth = title.lineWidth;
    }
    const lift = title.cap / 2;
    for (const g of title.glyphs) {
      const pt = this.pointAt(centre + g.along);
      if (pt.x < -title.size * 1.5 || pt.x > W + title.size * 1.5) continue;
      const cos = Math.cos(pt.angle);
      const sin = Math.sin(pt.angle);
      const x = pt.x - sin * g.normal;
      const y = pt.y + cos * g.normal;
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * x, dpr * y);
      if (kind === "fill") ctx.fillText(g.ch, -g.half, lift);
      else ctx.strokeText(g.ch, -g.half, lift);
    }
  }

  drawText() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.text.width, this.text.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const trail = this.trail;
    const ghostAmount = smoothstep(3, 48, Math.abs(trail));
    for (let i = 0; i < this.count; i += 1) {
      const d = i - this.p;
      if (Math.abs(d) > 1.7) continue;
      const title = this.titles[i];
      const centre = d * this.slotArc;
      if (ghostAmount > 0.001) {
        for (let k = GHOSTS; k >= 1; k -= 1) {
          const t = k / GHOSTS;
          const a = ghostAmount * Math.pow(1 - k / (GHOSTS + 1), 1.5) * 0.9;
          if (a < 0.004) continue;
          const g = Math.round(255 * a);
          const b = Math.round(255 * a * t);
          this.drawGlyphs(title, centre + trail * t, `rgb(0 ${g} ${b})`, "stroke");
        }
      }
      const power = 0.16 + 0.84 * Math.exp(-((d / 0.44) ** 2));
      this.drawGlyphs(title, centre, `rgb(${Math.round(255 * power)} 0 0)`, "fill");
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  pass(program, target, bind) {
    const gl = this.gl;
    gl.useProgram(program.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height);
    bind(program.uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bindTex(unit, texture, location) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.downs) return;
    this.drawText();
    gl.bindVertexArray(this.triVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.text);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    let source = { texture: this.textTexture, width: this.canvas.width, height: this.canvas.height };
    for (const target of this.downs) {
      const from = source;
      this.pass(this.programs.down, target, (u) => {
        this.bindTex(0, from.texture, u.uSource);
        gl.uniform2f(u.uTexel, 1 / from.width, 1 / from.height);
      });
      source = target;
    }
    let upper = this.downs[LEVELS - 1];
    const stop = 1 + this.shift;
    for (let i = LEVELS - 2; i >= stop; i -= 1) {
      const from = upper;
      const base = this.downs[i];
      this.pass(this.programs.up, this.ups[i], (u) => {
        this.bindTex(0, from.texture, u.uSource);
        this.bindTex(1, base.texture, u.uBase);
        gl.uniform2f(u.uTexel, 0.5 / from.width, 0.5 / from.height);
        gl.uniform1f(u.uCarry, CARRY);
      });
      upper = this.ups[i];
    }
    const s = this.shift;
    const neon = this.neonAt(this.p);
    const warm = neon.map((c, i) => c * 0.55 + COOL[i] * 0.45);
    this.pass(this.programs.composite, null, (u) => {
      this.bindTex(0, this.textTexture, u.uText);
      this.bindTex(1, this.downs[1 + s].texture, u.uMid);
      this.bindTex(2, this.downs[2 + s].texture, u.uCore);
      this.bindTex(3, this.ups[1 + s].texture, u.uNear);
      this.bindTex(4, this.ups[3 + s].texture, u.uWide);
      gl.uniform3f(u.uNeon, neon[0], neon[1], neon[2]);
      gl.uniform3f(u.uGhostWarm, warm[0], warm[1], warm[2]);
      gl.uniform3f(u.uCool, COOL[0], COOL[1], COOL[2]);
      gl.uniform1f(u.uGlow, 1);
    });
    gl.bindVertexArray(null);
  }

  emitSelect(index) {
    if (index === this.selected) return;
    this.selected = index;
    this.onSelect?.(index);
  }

  settle(target) {
    const T = clamp(Math.round(target), 0, this.count - 1);
    this.v = clamp(this.v, -VMAX, VMAX);
    const x0 = this.p - T;
    let omega = this.reduced ? OMEGA * 1.6 : OMEGA;
    if (x0 * this.v < 0 && Math.abs(x0) > 1e-4) omega = Math.max(omega, Math.min(30, (Math.abs(this.v) / Math.abs(x0)) * 1.02));
    this.omega = omega;
    this.target = T;
    this.mode = "settle";
    this.emitSelect(T);
    this.wake();
  }

  release() {
    const v = clamp(this.v, -VMAX, VMAX);
    this.v = v;
    let T = Math.round(this.p + v * 0.3);
    if (v > 0.6) T = Math.max(T, Math.ceil(this.p - 0.04));
    if (v < -0.6) T = Math.min(T, Math.floor(this.p + 0.04));
    this.settle(T);
  }

  step(delta) {
    const base = this.mode === "settle" ? this.target : Math.round(this.p);
    this.settle(base + delta);
  }

  select(index) {
    this.settle(index);
  }

  first() {
    this.settle(0);
  }

  lastTrack() {
    this.settle(this.count - 1);
  }

  grab() {
    this.pRaw = unrubber(this.p, 0, this.count - 1);
    this.wheel = null;
  }

  pointerDown(e) {
    if (e.button > 0 || !this.ready) return;
    if (e.target.closest?.("button, a, input")) return;
    this.host.setPointerCapture?.(e.pointerId);
    this.grab();
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, trace: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
    this.mode = "drag";
    this.onGrab?.(true);
    this.wake();
  }

  pointerMove(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.dx += e.clientX - p.x;
    p.dy += e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.trace.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (p.trace.length > 12) p.trace.shift();
    this.wake();
  }

  flickVelocity(p, now) {
    const end = p.trace[p.trace.length - 1];
    if (!end || now - end.t > 100) return 0;
    const recent = p.trace.filter((s) => end.t - s.t < 160);
    if (recent.length < 2) return 0;
    const a = recent[0];
    const b = recent[recent.length - 1];
    const span = Math.max(16, b.t - a.t) / 1000;
    const travel = -((b.x - a.x) / this.slotArc) - (this.embedded ? 0 : (b.y - a.y) / this.height);
    return travel / span;
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.released = true;
    p.flick = this.flickVelocity(p, e.timeStamp);
    this.wake();
  }

  onWheel(e) {
    if (!this.ready) return;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (this.embedded && !horizontal) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    const delta = (horizontal ? e.deltaX : e.deltaY) * unit;
    if (this.mode === "drag") return;
    if (!this.wheel) {
      this.wheel = { start: this.mode === "settle" ? this.target : this.p, goal: this.mode === "settle" ? this.target : this.p, quiet: 0 };
    }
    const w = this.wheel;
    w.goal = clamp(w.goal + delta / (this.height * 0.75), -0.3, this.count - 0.7);
    w.quiet = 0;
    this.mode = "wheel";
    this.emitSelect(clamp(Math.round(w.goal), 0, this.count - 1));
    this.wake();
  }

  springTo(goal, omega, dt) {
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i += 1) {
      const x = this.p - goal;
      let a = -omega * omega * x - 2 * omega * this.v;
      if (a * this.v >= 0) a = clamp(a, -AMAX, AMAX);
      this.v = clamp(this.v + a * h, -VMAX, VMAX);
      this.p += this.v * h;
    }
  }

  physics(dt) {
    if (this.mode === "drag") {
      const ptr = this.pointer;
      const before = this.p;
      const ds = -(ptr.dx / this.slotArc) - (this.embedded ? 0 : ptr.dy / this.height);
      ptr.dx = 0;
      ptr.dy = 0;
      this.pRaw += ds;
      this.p = rubber(this.pRaw, 0, this.count - 1);
      const inst = (this.p - before) / dt;
      this.v += (inst - this.v) * (1 - Math.exp(-dt / 0.045));
      this.emitSelect(clamp(Math.round(this.p), 0, this.count - 1));
      if (ptr.released) {
        this.v = ptr.flick;
        this.pointer = null;
        this.onGrab?.(false);
        this.release();
      }
      return;
    }
    if (this.mode === "wheel") {
      const w = this.wheel;
      this.springTo(w.goal, 9, dt);
      w.quiet += dt;
      if (w.quiet > WHEEL_QUIET) {
        const moved = w.goal - w.start;
        const T = Math.abs(moved) < 0.5 && Math.abs(moved) > 0.06 ? Math.round(w.start) + Math.sign(moved) : Math.round(w.goal);
        this.wheel = null;
        this.settle(T);
      }
      return;
    }
    if (this.mode === "settle") {
      this.springTo(this.target, this.omega, dt);
      if (Math.abs(this.p - this.target) < 2e-4 && Math.abs(this.v) < 2e-3) {
        this.p = this.target;
        this.pRaw = this.p;
        this.v = 0;
        this.mode = "idle";
      }
    }
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

  frame(now) {
    this.raf = 0;
    if (this.destroyed) return;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    if (dt <= 0) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.physics(dt);
    const speed = this.v;
    const goal = Math.sign(speed) * this.width * 0.42 * (1 - Math.exp(-Math.abs(speed) / 2.2));
    const rising = Math.abs(goal) > Math.abs(this.trail);
    const tau = rising ? 0.07 : 0.2;
    this.trail += (goal - this.trail) * (1 - Math.exp(-dt / tau));
    if (Math.abs(this.trail) < 0.3 && this.mode === "idle") this.trail = 0;
    this.render();
    const busy = this.mode !== "idle" || Math.abs(this.trail) > 0;
    if (busy) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.canvas.removeEventListener("webglcontextlost", this.handlers.lost);
    this.host.removeEventListener("pointerdown", this.handlers.down);
    this.host.removeEventListener("pointermove", this.handlers.move);
    this.host.removeEventListener("pointerup", this.handlers.up);
    this.host.removeEventListener("pointercancel", this.handlers.up);
    this.host.removeEventListener("wheel", this.handlers.wheel);
    const gl = this.gl;
    if (!gl) return;
    this.freeChain();
    Object.values(this.programs).forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteTexture(this.textTexture);
    gl.deleteBuffer(this.triBuffer);
    gl.deleteVertexArray(this.triVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
    if (this.text) {
      this.text.width = 1;
      this.text.height = 1;
    }
  }
}
