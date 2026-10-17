import { ART_SIZE, COVER_SRC, FELT_SIZE, MAP_SIZE, PRINTS, buildCover, buildDustMap, buildFelt, buildFibres, buildSurface } from "./dustArt";
import DustCloud, { MAX_SPECKS } from "./dustCloud";
import {
  BG_FRAGMENT,
  COVER_FRAGMENT,
  FIBRE_FRAGMENT,
  FIBRE_VERTEX,
  MAX_SEGMENTS,
  QUAD_VERTEX,
  SEED_FRAGMENT,
  SIM_FRAGMENT,
  SPECK_FRAGMENT,
  SPECK_VERTEX,
} from "./dustShader";

const MAX_DPR = 2;
const SIM_RES = 1024;
const TILT = -0.045;
const SETTLE_SECONDS = 3.6;
const EXPOSURE = 2.15;
const AUTO_SECONDS = 1.9;
const FIBRE_SEGS = 14;
const FIBRE_FLOATS = 6;
const MAX_FIBRE_VERTS = 32 * FIBRE_SEGS * 6;
const SPAWN_PER_MASS = 0.085;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

function link(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.bindAttribLocation(program, 0, "aState");
  gl.bindAttribLocation(program, 0, "aVert");
  gl.bindAttribLocation(program, 1, "aLook");
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

function sansFamily(el) {
  const family = getComputedStyle(el).fontFamily;
  return family || "system-ui, sans-serif";
}

export default class DustEngine {
  constructor({ host, canvas, cursor, meter, insets, embedded, onReady, onFail }) {
    this.host = host;
    this.canvas = canvas;
    this.cursor = cursor;
    this.meter = meter;
    this.insets = insets;
    this.embedded = embedded;
    this.onReady = onReady;
    this.onFail = onFail;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.cloud = new DustCloud(29);
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cover = { cx: 0, cy: 0, size: 100, cos: Math.cos(TILT), sin: Math.sin(TILT) };
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.pointer = null;
    this.auto = null;
    this.settle = null;
    this.hover = null;
    this.glint = { x: 0, y: 0, vx: 0, vy: 0, placed: false };
    this.segData = new Float32Array(MAX_SEGMENTS * 4);
    this.segProps = new Float32Array(MAX_SEGMENTS * 4);
    this.segCount = 0;
    this.strokeSeed = 0;
    this.shownClean = -1;
    this.meterClock = 0;
    this.fibreShadow = new Float32Array(MAX_FIBRE_VERTS * FIBRE_FLOATS);
    this.fibreBody = new Float32Array(MAX_FIBRE_VERTS * FIBRE_FLOATS);
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      leave: (e) => {
        if (e.pointerType === "mouse") {
          this.hover = null;
          this.hideCursor();
          this.wake();
        }
      },
      dbl: (e) => {
        if (e.target.closest?.("button, a, input")) return;
        this.redust();
      },
      visibility: () => this.checkVisibility(),
      lost: (e) => e.preventDefault(),
    };
  }

  start() {
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
    this.host.addEventListener("dblclick", this.handlers.dbl);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.host);
    this.resize();
    this.load();
    return true;
  }

  setupGl() {
    const gl = this.gl;
    this.float = Boolean(gl.getExtension("EXT_color_buffer_float"));
    this.store = this.float ? 1 : 2;
    this.programs = {
      seed: link(gl, QUAD_VERTEX, SEED_FRAGMENT),
      sim: link(gl, QUAD_VERTEX, SIM_FRAGMENT),
      bg: link(gl, QUAD_VERTEX, BG_FRAGMENT),
      cover: link(gl, QUAD_VERTEX, COVER_FRAGMENT),
      speck: link(gl, SPECK_VERTEX, SPECK_FRAGMENT),
      fibre: link(gl, FIBRE_VERTEX, FIBRE_FRAGMENT),
    };
    this.triBuffer = gl.createBuffer();
    this.triVao = gl.createVertexArray();
    gl.bindVertexArray(this.triVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.speckBuffer = gl.createBuffer();
    this.speckVao = gl.createVertexArray();
    gl.bindVertexArray(this.speckVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.speckBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_SPECKS * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    this.fibreBuffer = gl.createBuffer();
    this.fibreVao = gl.createVertexArray();
    gl.bindVertexArray(this.fibreVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fibreBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_FIBRE_VERTS * FIBRE_FLOATS * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, FIBRE_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FIBRE_FLOATS * 4, 16);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  texture({ width, height, data, source, internal, format, type, repeat = false, mips = false }) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
  }

  makeTarget(width, height, format) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (format === "rgba16f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
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

  async load() {
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = COVER_SRC;
      await Promise.all([img.decode(), document.fonts?.ready]);
      if (this.destroyed || !this.gl) return;
      const gl = this.gl;
      const family = sansFamily(this.host);
      const art = buildCover(img, family);
      const surface = buildSurface();
      const felt = buildFelt();
      const map = buildDustMap();
      this.base = map.base;
      this.order = map.order;
      this.mirror = new Float32Array(map.base);
      this.touch = new Float32Array(MAP_SIZE * MAP_SIZE);
      this.baseTotal = map.base.reduce((sum, v) => sum + v, 0);
      this.fibres = buildFibres(26).map((f) => ({ ...f, mode: "rest", u: f.home[0], v: f.home[1], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: f.angle, spin: 0, tilt: 0, tiltSpin: 0, alpha: 1, wait: 0 }));
      this.textures = {
        art: this.texture({ source: art, mips: true }),
        surf: this.texture({ width: ART_SIZE, height: ART_SIZE, data: surface, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, mips: true }),
        felt: this.texture({ width: FELT_SIZE, height: FELT_SIZE, data: felt, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, repeat: true, mips: true }),
        base: this.texture({ width: MAP_SIZE, height: MAP_SIZE, data: map.base, internal: gl.R16F, format: gl.RED, type: gl.FLOAT }),
      };
      const fmt = this.float ? "rgba16f" : "rgba8";
      this.rest = this.makeTarget(SIM_RES, SIM_RES, fmt);
      this.dust = [this.makeTarget(SIM_RES, SIM_RES, fmt), this.makeTarget(SIM_RES, SIM_RES, fmt)];
      this.dustRead = 0;
      this.seed(this.rest);
      this.seed(this.dust[0]);
      this.ready = true;
      this.renderBg();
      this.updateMeter(true);
      this.render();
      this.onReady?.();
      this.wake();
    } catch (error) {
      console.error(error);
      if (!this.ready) this.onFail?.();
    }
  }

  seed(target) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.seed;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.base);
    gl.uniform1i(uniforms.uBase, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.felt);
    gl.uniform1i(uniforms.uFelt, 1);
    const a = [];
    const b = [];
    for (const p of PRINTS) {
      a.push(p.x, p.y, p.rx, p.ry);
      b.push(Math.cos(p.rot), Math.sin(p.rot), p.depth, 0);
    }
    gl.uniform4fv(uniforms.uPrint, new Float32Array(a));
    gl.uniform4fv(uniforms.uPrintB, new Float32Array(b));
    gl.uniform1f(uniforms.uRes, target.width);
    gl.uniform1f(uniforms.uStore, this.store);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  layout() {
    const pad = this.insets?.() || { top: 16, bottom: 16, left: 16, right: 16 };
    const availW = Math.max(80, this.width - pad.left - pad.right);
    const availH = Math.max(80, this.height - pad.top - pad.bottom);
    const size = Math.max(60, Math.min(availW, availH, 780) * (this.embedded ? 0.86 : 0.97));
    this.cover.size = size;
    this.cover.cx = pad.left + availW / 2;
    this.cover.cy = pad.top + availH / 2;
    this.lamp = [this.cover.cx - size * 0.58, this.cover.cy - size * 0.82, size * 1.2];
    this.camera = Math.max(this.width, this.height) * 1.6;
    this.restGlint = [this.cover.cx - size * 0.16, this.cover.cy - size * 0.2];
    if (!this.glint.placed) {
      this.glint.x = this.restGlint[0];
      this.glint.y = this.restGlint[1];
      this.glint.placed = true;
    }
  }

  resize() {
    if (!this.gl) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const sameBox = width === this.width && height === this.height && dpr === this.dpr;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    const old = { ...this.cover };
    this.layout();
    if (sameBox && old.size === this.cover.size && old.cx === this.cover.cx && old.cy === this.cover.cy) return;
    if (old.size > 0 && this.glint.placed && old.cx) {
      const k = this.cover.size / old.size;
      this.glint.x = this.cover.cx + (this.glint.x - old.cx) * k;
      this.glint.y = this.cover.cy + (this.glint.y - old.cy) * k;
    }
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.dropTarget(this.bg);
    this.bg = this.makeTarget(this.canvas.width, this.canvas.height, "rgba8");
    if (this.ready) {
      this.renderBg();
      this.render();
    }
    this.wake();
  }

  coverUniforms(uniforms) {
    const gl = this.gl;
    const c = this.cover;
    gl.uniform2f(uniforms.uBox, this.width, this.height);
    gl.uniform1f(uniforms.uDpr, this.canvas.width / this.width);
    gl.uniform2f(uniforms.uCenter, c.cx, c.cy);
    gl.uniform1f(uniforms.uSize, c.size);
    gl.uniform2f(uniforms.uRot, c.cos, c.sin);
    gl.uniform3f(uniforms.uLamp, this.lamp[0], this.lamp[1], this.lamp[2]);
    gl.uniform1f(uniforms.uExposure, EXPOSURE);
  }

  renderBg() {
    const gl = this.gl;
    const { program, uniforms } = this.programs.bg;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bg.framebuffer);
    gl.viewport(0, 0, this.bg.width, this.bg.height);
    this.coverUniforms(uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  toUv(x, y) {
    const c = this.cover;
    const dx = x - c.cx;
    const dy = y - c.cy;
    return [(c.cos * dx + c.sin * dy) / c.size + 0.5, (-c.sin * dx + c.cos * dy) / c.size + 0.5];
  }

  toScreen(u, v) {
    const c = this.cover;
    const lx = (u - 0.5) * c.size;
    const ly = (v - 0.5) * c.size;
    return [c.cx + c.cos * lx - c.sin * ly, c.cy + c.sin * lx + c.cos * ly];
  }

  brushRadius() {
    return clamp(this.cover.size * 0.068, 16, 46);
  }

  pushSegment(x0, y0, x1, y1, radius, strength, rim) {
    if (this.segCount >= MAX_SEGMENTS) return;
    const [u0, v0] = this.toUv(x0, y0);
    const [u1, v1] = this.toUv(x1, y1);
    const i = this.segCount * 4;
    this.segData[i] = u0;
    this.segData[i + 1] = v0;
    this.segData[i + 2] = u1;
    this.segData[i + 3] = v1;
    this.segProps[i] = radius / this.cover.size;
    this.segProps[i + 1] = strength;
    this.segProps[i + 2] = this.strokeSeed;
    this.segProps[i + 3] = rim;
    this.segCount += 1;
  }

  scrubMirror(x0, y0, x1, y1, radius, strength) {
    const n = MAP_SIZE;
    const [u0, v0] = this.toUv(x0, y0);
    const [u1, v1] = this.toUv(x1, y1);
    const ru = radius / this.cover.size;
    const i0 = clamp(Math.floor((Math.min(u0, u1) - ru) * n), 0, n - 1);
    const i1 = clamp(Math.ceil((Math.max(u0, u1) + ru) * n), 0, n - 1);
    const j0 = clamp(Math.floor((Math.min(v0, v1) - ru) * n), 0, n - 1);
    const j1 = clamp(Math.ceil((Math.max(v0, v1) + ru) * n), 0, n - 1);
    if (u1 + ru < 0 && u0 + ru < 0) return;
    const du = u1 - u0;
    const dv = v1 - v0;
    const len2 = du * du + dv * dv;
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const u = (i + 0.5) / n;
        const v = (j + 0.5) / n;
        const t = len2 > 1e-12 ? clamp(((u - u0) * du + (v - v0) * dv) / len2, 0, 1) : 0;
        const r = Math.hypot(u - (u0 + du * t), v - (v0 + dv * t)) / ru;
        if (r >= 1) continue;
        const env = 1 - smoothstep(0.42, 1, r);
        const k = j * n + i;
        this.touch[k] = Math.max(this.touch[k], env * strength * 0.6);
      }
    }
  }

  applyMirror(spawn) {
    const n = MAP_SIZE;
    const cell = this.cover.size / n;
    const area = cell * cell;
    const p = spawn;
    const scale = SPAWN_PER_MASS * (1 + 1.6 * p.fast) * (this.reduced ? 0.3 : 1);
    let budget = 900;
    for (let k = 0; k < this.touch.length; k += 1) {
      const c = this.touch[k];
      if (c <= 0) continue;
      this.touch[k] = 0;
      const removed = this.mirror[k] * c;
      this.mirror[k] -= removed;
      let expect = removed * area * scale;
      const u = ((k % n) + Math.random()) / n;
      const v = (Math.floor(k / n) + Math.random()) / n;
      const [x, y] = this.toScreen(u, v);
      const side = (x - p.x) * p.nx + (y - p.y) * p.ny >= 0 ? 1 : -1;
      while (expect > 0 && budget > 0) {
        if (expect < 1 && Math.random() > expect) break;
        expect -= 1;
        budget -= 1;
        const jx = (Math.random() - 0.5) * cell;
        const jy = (Math.random() - 0.5) * cell;
        this.cloud.lift(x + jx, y + jy, p.vx, p.vy, p.nx, p.ny, side, p.fast);
      }
    }
  }

  liftFibres(x0, y0, x1, y1, radius, vx, vy, fast) {
    if (!this.fibres) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (const f of this.fibres) {
      if (f.mode !== "rest") continue;
      const [fx, fy] = this.toScreen(f.u, f.v);
      const t = len2 > 1e-6 ? clamp(((fx - x0) * dx + (fy - y0) * dy) / len2, 0, 1) : 0;
      const d = Math.hypot(fx - (x0 + dx * t), fy - (y0 + dy * t));
      if (d > radius * 0.9) continue;
      if (this.cloud.rand() < 0.15 * fast) continue;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const side = (fx - x0) * nx + (fy - y0) * ny >= 0 ? 1 : -1;
      f.mode = "air";
      f.x = fx;
      f.y = fy;
      f.z = 1;
      f.vx = vx * (0.25 + 0.3 * this.cloud.rand()) + nx * side * (30 + 60 * this.cloud.rand());
      f.vy = vy * (0.25 + 0.3 * this.cloud.rand()) + ny * side * (30 + 60 * this.cloud.rand());
      f.vz = (60 + this.cloud.rand() * 80) * (1 + 0.6 * fast);
      f.rot = f.angle + TILT;
      f.spin = (this.cloud.rand() - 0.5) * 2.4;
      f.tiltSpin = (this.cloud.rand() - 0.5) * 3;
    }
  }

  stepFibres(dt) {
    if (!this.fibres) return false;
    let moving = false;
    const t = this.cloud.time;
    const half = this.cover.size / 2;
    for (const f of this.fibres) {
      if (f.mode === "rest" || f.mode === "floor") continue;
      moving = true;
      if (f.mode === "fade") {
        f.alpha = Math.max(0, f.alpha - dt / 0.5);
        if (f.alpha <= 0) this.dropFibre(f);
        continue;
      }
      if (f.mode === "drop") {
        f.alpha = Math.min(1, f.alpha + dt / 0.8);
        if (f.wait > 0) {
          f.wait -= dt;
          f.alpha = 0;
          continue;
        }
      }
      const air = Math.min(1, f.z / 20);
      const fx = Math.sin(f.y * 0.011 + t * 0.37) * 16 + Math.sin(f.x * 0.006 - t * 0.23) * 10;
      const fy = Math.cos(f.x * 0.0105 - t * 0.31) * 16 + Math.cos(f.y * 0.0071 + t * 0.19) * 10;
      const drag = Math.exp(-dt * 1.7);
      f.vx = f.vx * drag + fx * air * dt;
      f.vy = f.vy * drag + fy * air * dt;
      f.vz = f.vz * Math.exp(-dt * 1.3) - 9 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.rot += f.spin * dt;
      f.spin *= Math.exp(-dt * 0.4);
      f.tilt += f.tiltSpin * dt * air;
      if (f.z <= 0) {
        f.z = 0;
        const [u, v] = this.toUv(f.x, f.y);
        const inside = Math.abs(u - 0.5) * this.cover.size < half - 4 && Math.abs(v - 0.5) * this.cover.size < half - 4;
        if (inside) {
          f.mode = "rest";
          f.u = u;
          f.v = v;
          f.angle = f.rot - TILT;
        } else {
          f.mode = "floor";
        }
        f.tilt = 0;
        f.alpha = 1;
      }
    }
    return moving;
  }

  dropFibre(f) {
    const [hx, hy] = this.toScreen(f.home[0], f.home[1]);
    f.mode = "drop";
    f.x = hx + (this.cloud.rand() - 0.5) * 40;
    f.y = hy - 20 - this.cloud.rand() * 30;
    f.z = 160 + this.cloud.rand() * 160;
    f.vx = (this.cloud.rand() - 0.5) * 10;
    f.vy = 8 + this.cloud.rand() * 8;
    f.vz = -10 - this.cloud.rand() * 20;
    f.alpha = 0;
    f.wait = this.cloud.rand() * 0.9;
    f.spin = (this.cloud.rand() - 0.5) * 1.4;
    f.tiltSpin = (this.cloud.rand() - 0.5) * 2;
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
    if (this.pointer) this.stepPointer(1 / 60);
    this.auto = null;
    this.strokeSeed = (this.strokeSeed + 7.31) % 97;
    this.pointer = { id: e.pointerId, x, y, lx: x, ly: y, points: [], speed: 0, vx: 0, vy: 0, fresh: true };
    this.hover = [x, y];
    this.host.setAttribute("data-pressed", "");
    this.placeCursor(x, y);
    this.wake();
  }

  pointerMove(e) {
    const [x, y] = this.localPoint(e);
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      this.hover = [x, y];
      if (!this.pointer) this.placeCursor(x, y);
      this.wake();
    }
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    const events = e.getCoalescedEvents?.() || [];
    const rect = this.host.getBoundingClientRect();
    for (const ev of events.length ? events : [e]) {
      p.points.push([ev.clientX - rect.left, ev.clientY - rect.top]);
      if (p.points.length > 256) p.points.shift();
    }
    this.hover = [x, y];
    this.wake();
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.released = true;
    this.host.removeAttribute("data-pressed");
    if (e.pointerType !== "mouse") {
      this.hideCursor();
      this.hover = null;
    }
    this.wake();
  }

  autoPoint(t) {
    const c = this.cover;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const lx = (-0.36 + 0.72 * e) * c.size;
    const ly = (0.04 - 0.1 * Math.sin(e * Math.PI * 1.2)) * c.size;
    return [c.cx + c.cos * lx - c.sin * ly, c.cy + c.sin * lx + c.cos * ly];
  }

  brushNow() {
    if (!this.ready) return;
    if (this.pointer) this.stepPointer(1 / 60);
    this.strokeSeed = (this.strokeSeed + 7.31) % 97;
    const [x, y] = this.autoPoint(0);
    this.auto = { t: 0 };
    this.pointer = { id: -1, x, y, lx: x, ly: y, points: [], speed: 0, vx: 0, vy: 0, fresh: true, synthetic: true };
    this.wake();
  }

  advanceAuto(dt) {
    const a = this.auto;
    const p = this.pointer;
    if (!a || !p) return;
    const prev = a.t;
    a.t = Math.min(1, a.t + dt / AUTO_SECONDS);
    for (let i = 1; i <= 4; i += 1) p.points.push(this.autoPoint(prev + ((a.t - prev) * i) / 4));
    if (a.t >= 1) {
      p.released = true;
      this.auto = null;
    }
  }

  redust() {
    if (!this.ready) return;
    this.settle = { t: 0, duration: this.reduced ? 0.8 : SETTLE_SECONDS, spawned: 0 };
    for (const f of this.fibres) {
      if (f.mode === "floor" || f.mode === "air") {
        f.mode = "fade";
      }
    }
    for (const f of this.fibres) {
      if (f.mode !== "rest") continue;
      const dh = Math.hypot(f.u - f.home[0], f.v - f.home[1]);
      if (dh > 0.02) f.mode = "fade";
    }
    this.wake();
  }

  stepSettle(dt) {
    const s = this.settle;
    if (!s) return -1;
    s.t += dt;
    const progress = Math.min(1.2, s.t / s.duration);
    for (let k = 0; k < this.mirror.length; k += 1) {
      const m = smoothstep(this.order[k] - 0.3, this.order[k] + 0.02, progress * 1.35 - 0.12);
      const target = this.base[k] * m;
      if (target > this.mirror[k]) this.mirror[k] = target;
    }
    if (!this.reduced) {
      const rate = 900 * (1 - smoothstep(0.55, 0.95, progress));
      const want = Math.floor(rate * dt + this.cloud.rand());
      for (let i = 0; i < want; i += 1) {
        const u = -0.05 + this.cloud.rand() * 1.1;
        const v = -0.05 + this.cloud.rand() * 1.1;
        const [x, y] = this.toScreen(u, v);
        const z = 30 + this.cloud.rand() * 200;
        this.cloud.fall(x, y, z, 12);
      }
    }
    if (progress >= 1.2) {
      this.settle = null;
      for (let k = 0; k < this.mirror.length; k += 1) this.mirror[k] = Math.max(this.mirror[k], this.base[k]);
      return 1.2;
    }
    return progress;
  }

  placeCursor(x, y) {
    if (!this.cursor) return;
    const r = this.brushRadius();
    this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(r / 32).toFixed(3)})`;
    this.cursor.setAttribute("data-shown", "");
  }

  hideCursor() {
    this.cursor?.removeAttribute("data-shown");
  }

  stepPointer(dt) {
    const p = this.pointer;
    if (!p) return false;
    const path = p.points;
    let length = 0;
    let fx = p.lx;
    let fy = p.ly;
    for (const [x, y] of path) {
      length += Math.hypot(x - fx, y - fy);
      fx = x;
      fy = y;
    }
    const step = Math.max(dt, 1 / 240);
    const raw = Math.min(length / step, 5000);
    const blend = 1 - Math.exp(-dt / 0.045);
    p.speed += (raw - p.speed) * blend;
    p.vx += (Math.min(5000, Math.max(-5000, (fx - p.lx) / step)) - p.vx) * blend;
    p.vy += (Math.min(5000, Math.max(-5000, (fy - p.ly) / step)) - p.vy) * blend;
    const fast = smoothstep(380, 2400, p.speed);
    const moving = smoothstep(6, 60, p.speed);
    const radius = this.brushRadius() * (1 - 0.12 * fast);
    const rate = 22 + (3 - 22) * fast;
    const strength = clamp((1 - Math.exp(-dt * rate)) * moving + 0.09 * fast, 0, 0.9);
    const rim = strength * 0.34;
    if (p.fresh) {
      this.pushSegment(p.lx, p.ly, p.lx + 0.01, p.ly, radius * 0.9, 0.16, 0.05);
      this.scrubMirror(p.lx, p.ly, p.lx + 0.01, p.ly, radius * 0.9, 0.16);
      p.fresh = false;
    }
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const spawn = { x: p.lx, y: p.ly, vx: p.vx, vy: p.vy, nx: -p.vy / sp, ny: p.vx / sp, fast };
    if (length > 0.5) {
      const pieces = Math.min(MAX_SEGMENTS - this.segCount, Math.max(1, Math.ceil(length / (radius * 0.5))));
      const stride = path.length / Math.max(1, pieces);
      let ax = p.lx;
      let ay = p.ly;
      for (let k = 1; k <= pieces; k += 1) {
        const [bx, by] = path[Math.max(0, Math.min(path.length - 1, Math.round(stride * k) - 1))];
        this.pushSegment(ax, ay, bx, by, radius, strength, rim);
        this.scrubMirror(ax, ay, bx, by, radius, strength);
        this.liftFibres(ax, ay, bx, by, radius, p.vx, p.vy, fast);
        ax = bx;
        ay = by;
      }
      p.lx = ax;
      p.ly = ay;
      p.x = ax;
      p.y = ay;
    }
    this.applyMirror(spawn);
    path.length = 0;
    if (!p.synthetic) this.placeCursor(p.x, p.y);
    if (p.released) this.pointer = null;
    return true;
  }

  stepGlint(dt) {
    const g = this.glint;
    const target = this.pointer && !this.pointer.synthetic ? [this.pointer.x, this.pointer.y] : this.hover || this.restGlint;
    if (this.reduced) {
      g.x = target[0];
      g.y = target[1];
      g.vx = 0;
      g.vy = 0;
      return false;
    }
    const omega = 7;
    const h = Math.min(dt, 1 / 30);
    const ax = omega * omega * (target[0] - g.x) - 2 * omega * g.vx;
    const ay = omega * omega * (target[1] - g.y) - 2 * omega * g.vy;
    g.vx += ax * h;
    g.vy += ay * h;
    g.x += g.vx * h;
    g.y += g.vy * h;
    const off = Math.hypot(target[0] - g.x, target[1] - g.y);
    const vel = Math.hypot(g.vx, g.vy);
    if (off < 0.2 && vel < 0.5) {
      g.x = target[0];
      g.y = target[1];
      g.vx = 0;
      g.vy = 0;
      return false;
    }
    return true;
  }

  eye() {
    const [lx, ly, lz] = this.lamp;
    const ez = this.cover.size * 2.4;
    const gx = this.glint.x;
    const gy = this.glint.y;
    return [(gx * (lz + ez) - lx * ez) / lz, (gy * (lz + ez) - ly * ez) / lz, ez];
  }

  runSim(settleProgress) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.sim;
    const read = this.dust[this.dustRead];
    const write = this.dust[1 - this.dustRead];
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, write.width, write.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(uniforms.uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rest.texture);
    gl.uniform1i(uniforms.uRest, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.felt);
    gl.uniform1i(uniforms.uFelt, 2);
    gl.uniform1f(uniforms.uRes, write.width);
    gl.uniform1f(uniforms.uStore, this.store);
    gl.uniform1i(uniforms.uCount, this.segCount);
    gl.uniform4fv(uniforms.uSeg, this.segData);
    gl.uniform4fv(uniforms.uSegP, this.segProps);
    gl.uniform1f(uniforms.uSettle, settleProgress);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dustRead = 1 - this.dustRead;
    this.segCount = 0;
  }

  drawCover() {
    const gl = this.gl;
    const { program, uniforms } = this.programs.cover;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const units = [
      ["uBg", this.bg.texture],
      ["uArt", this.textures.art],
      ["uSurf", this.textures.surf],
      ["uDust", this.dust[this.dustRead].texture],
      ["uFelt", this.textures.felt],
    ];
    units.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uniforms[name], i);
    });
    this.coverUniforms(uniforms);
    const eye = this.eye();
    gl.uniform3f(uniforms.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(uniforms.uStore, this.store);
    gl.uniform1f(uniforms.uDustTexel, 1 / SIM_RES);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  project(x, y, z) {
    const k = this.camera / Math.max(this.camera - z, 1);
    const mx = this.width / 2;
    const my = this.height / 2;
    return [mx + (x - mx) * k, my + (y - my) * k, k];
  }

  buildFibreVerts() {
    let ns = 0;
    let nb = 0;
    const shadow = this.fibreShadow;
    const body = this.fibreBody;
    const scale = this.cover.size;
    const [lx, ly, lz] = this.lamp;
    const pts = [];
    const shade = [];
    const push = (arr, n, x, y, across, alpha, tone, glint) => {
      const o = n * FIBRE_FLOATS;
      arr[o] = x;
      arr[o + 1] = y;
      arr[o + 2] = across;
      arr[o + 3] = alpha;
      arr[o + 4] = tone;
      arr[o + 5] = glint;
      return n + 1;
    };
    const strip = (arr, n, list, width, alpha, tone, glint) => {
      for (let i = 0; i < list.length - 1; i += 1) {
        if (n + 6 > MAX_FIBRE_VERTS) return n;
        const [x0, y0] = list[i];
        const [x1, y1] = list[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = (-(y1 - y0) / len) * (width / 2 + 0.8);
        const ny = ((x1 - x0) / len) * (width / 2 + 0.8);
        const edge = 1 + 1.6 / Math.max(width, 0.5);
        n = push(arr, n, x0 - nx, y0 - ny, -edge, alpha, tone, glint);
        n = push(arr, n, x0 + nx, y0 + ny, edge, alpha, tone, glint);
        n = push(arr, n, x1 - nx, y1 - ny, -edge, alpha, tone, glint);
        n = push(arr, n, x0 + nx, y0 + ny, edge, alpha, tone, glint);
        n = push(arr, n, x1 + nx, y1 + ny, edge, alpha, tone, glint);
        n = push(arr, n, x1 - nx, y1 - ny, -edge, alpha, tone, glint);
      }
      return n;
    };
    for (const f of this.fibres || []) {
      if (f.alpha <= 0.001) continue;
      let ox;
      let oy;
      let oz;
      let rot;
      let tilt;
      if (f.mode === "rest") {
        [ox, oy] = this.toScreen(f.u, f.v);
        oz = 0;
        rot = f.angle + TILT;
        tilt = 0;
      } else {
        ox = f.x;
        oy = f.y;
        oz = f.z;
        rot = f.rot;
        tilt = f.tilt;
      }
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      pts.length = 0;
      shade.length = 0;
      let kAvg = 0;
      for (const [px, py] of f.points) {
        const ax = px * scale;
        const ay = py * scale * ct;
        const az = py * scale * st;
        const wx = ox + c * ax - s * ay;
        const wy = oy + s * ax + c * ay;
        const wz = Math.max(0, oz + az) + 0.8;
        const [sx, sy, k] = this.project(wx, wy, wz);
        pts.push([sx, sy]);
        kAvg += k;
        const lift = wz / Math.max(lz - wz, 1);
        shade.push([wx + (wx - lx) * lift, wy + (wy - ly) * lift]);
      }
      kAvg /= f.points.length;
      const z = oz;
      const blur = z * 0.022;
      const width = f.width * kAvg + blur;
      const alpha = f.alpha * Math.min(1, (f.width * kAvg + 0.4) / (width + 0.4)) * 0.92;
      const glint = smoothstep(4, 120, z) * 1.4;
      const sWidth = f.width + z * 0.16;
      const sAlpha = f.alpha * (z > 2 ? 0.12 : 0.07) * Math.min(1, (f.width + 0.6) / sWidth) * (1 - smoothstep(60, 260, z));
      if (sAlpha > 0.004) ns = strip(shadow, ns, shade, sWidth, sAlpha, 1, 0);
      nb = strip(body, nb, pts, width, alpha, f.tone, glint);
    }
    return [ns, nb];
  }

  drawOverlays() {
    const gl = this.gl;
    const count = this.cloud.pack();
    const [ns, nb] = this.buildFibreVerts();
    if (!count && !nb && !ns) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (ns || nb) {
      const { program, uniforms } = this.programs.fibre;
      gl.useProgram(program);
      gl.bindVertexArray(this.fibreVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fibreBuffer);
      gl.uniform2f(uniforms.uBox, this.width, this.height);
      gl.uniform3f(uniforms.uLamp, this.lamp[0], this.lamp[1], this.lamp[2]);
      gl.uniform1f(uniforms.uExposure, EXPOSURE);
      if (ns) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fibreShadow, 0, ns * FIBRE_FLOATS);
        gl.uniform1f(uniforms.uShadow, 1);
        gl.drawArrays(gl.TRIANGLES, 0, ns);
      }
      if (nb) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fibreBody, 0, nb * FIBRE_FLOATS);
        gl.uniform1f(uniforms.uShadow, 0);
        gl.drawArrays(gl.TRIANGLES, 0, nb);
      }
    }
    if (count) {
      const { program, uniforms } = this.programs.speck;
      gl.useProgram(program);
      gl.bindVertexArray(this.speckVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.speckBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cloud.data, 0, count * 8);
      gl.uniform2f(uniforms.uBox, this.width, this.height);
      gl.uniform1f(uniforms.uDpr, this.canvas.width / this.width);
      gl.uniform1f(uniforms.uCam, this.camera);
      gl.uniform3f(uniforms.uLamp, this.lamp[0], this.lamp[1], this.lamp[2]);
      gl.uniform1f(uniforms.uExposure, EXPOSURE);
      gl.drawArrays(gl.POINTS, 0, count);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  render() {
    if (!this.ready) return;
    this.drawCover();
    this.drawOverlays();
  }

  updateMeter(force = false) {
    if (!this.meter || !this.mirror) return;
    let left = 0;
    for (let k = 0; k < this.mirror.length; k += 1) left += Math.min(this.mirror[k], this.base[k]);
    const clean = clamp(Math.round((1 - left / this.baseTotal) * 100), 0, 100);
    if (!force && clean === this.shownClean) return;
    this.shownClean = clean;
    this.meter.textContent = `${clean}%`;
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
    if (this.destroyed || !this.ready) return;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    if (dt <= 0) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.advanceAuto(dt);
    const touching = this.stepPointer(dt);
    const settleProgress = this.stepSettle(dt);
    if (this.segCount > 0 || settleProgress >= 0) this.runSim(settleProgress);
    const reach = this.cover.size * 0.5;
    this.cloud.step(dt, [this.cover.cx, this.cover.cy], reach);
    const fibresMoving = this.stepFibres(dt);
    const glinting = this.stepGlint(dt);
    this.render();
    this.meterClock += dt;
    if (this.meterClock > 0.12 || (!touching && settleProgress < 0)) {
      this.meterClock = 0;
      this.updateMeter();
    }
    const busy = touching || Boolean(this.pointer) || this.cloud.count > 0 || fibresMoving || glinting || settleProgress >= 0;
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
    this.host.removeEventListener("pointerleave", this.handlers.leave);
    this.host.removeEventListener("dblclick", this.handlers.dbl);
    const gl = this.gl;
    if (!gl) return;
    if (this.textures) Object.values(this.textures).forEach((t) => gl.deleteTexture(t));
    this.dropTarget(this.bg);
    this.dropTarget(this.rest);
    this.dust?.forEach((t) => this.dropTarget(t));
    Object.values(this.programs).forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteBuffer(this.triBuffer);
    gl.deleteBuffer(this.speckBuffer);
    gl.deleteBuffer(this.fibreBuffer);
    gl.deleteVertexArray(this.triVao);
    gl.deleteVertexArray(this.speckVao);
    gl.deleteVertexArray(this.fibreVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
