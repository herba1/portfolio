import { LOUVRE_FRAGMENT, MAX_BLADES, QUAD_VERTEX } from "./louvresShader";

const MAX_DPR = 2;
const REST = 0.32;
const RESTORE = 9;
const DAMP = 3.3;
const COUPLE = 70;
const COUPLE_DAMP = 1.4;
const HAND = 120;
const SWEEP = 26;
const LIMIT = 1.3;
const LIMIT_STIFF = 520;
const HARD = 1.52;
const SUBSTEP = 1 / 240;
const CROP = [0.05, 0.04, 0.95, 0.86];
const IMAGE_SRC = "/scorch/valley.webp";

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

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export default class LouvresEngine {
  constructor({ host, canvas, floorShare, ceiling, onReady, onFail }) {
    this.host = host;
    this.canvas = canvas;
    this.floorShare = floorShare;
    this.ceiling = ceiling;
    this.onReady = onReady;
    this.onFail = onFail;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.count = 0;
    this.spacing = 60;
    this.angle = new Float32Array(MAX_BLADES).fill(REST);
    this.spin = new Float32Array(MAX_BLADES);
    this.accel = new Float32Array(MAX_BLADES);
    this.raf = 0;
    this.last = 0;
    this.carry = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.hand = null;
    this.sweep = null;
    this.introPending = !this.reduced;
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
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
      this.program = link(gl, QUAD_VERTEX, LOUVRE_FRAGMENT);
    } catch {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.onFail?.();
      return false;
    }
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.host.addEventListener("pointerdown", this.handlers.down);
    this.host.addEventListener("pointermove", this.handlers.move);
    this.host.addEventListener("pointerup", this.handlers.up);
    this.host.addEventListener("pointercancel", this.handlers.up);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.host);
    this.resize();
    this.loadImage();
    return true;
  }

  loadImage() {
    const img = new Image();
    img.decoding = "async";
    img.src = IMAGE_SRC;
    img
      .decode()
      .then(() => {
        if (this.destroyed || !this.gl) return;
        const gl = this.gl;
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.imageAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        this.ready = true;
        this.render();
        this.onReady?.();
        if (this.introPending) {
          this.introPending = false;
          this.startSweep(1, 0.55, 2.2, 0.45);
        }
      })
      .catch(() => this.onFail?.());
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
    const count = Math.max(9, Math.min(24, Math.round(width / 78)));
    if (count !== this.count) {
      this.count = count;
      this.angle.fill(REST);
      this.spin.fill(0);
    }
    this.spacing = width / count;
    if (this.ready) this.render();
  }

  floorLine() {
    return this.height * (1 - this.floorShare());
  }

  localX(e) {
    const rect = this.host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  pointerDown(e) {
    if (e.button > 0 || !this.ready) return;
    if (e.target.closest?.("button, input, label, a")) return;
    this.host.setPointerCapture?.(e.pointerId);
    const [x, y] = this.localX(e);
    this.sweep = null;
    this.hand = { id: e.pointerId, x, y, px: x, vx: 0, gain: 1, fresh: true };
    this.host.setAttribute("data-pressed", "");
    this.wake();
  }

  pointerMove(e) {
    const hand = this.hand;
    if (!hand || hand.id !== e.pointerId) return;
    const [x, y] = this.localX(e);
    hand.x = x;
    hand.y = y;
    this.wake();
  }

  pointerUp(e) {
    const hand = this.hand;
    if (!hand || hand.id !== e.pointerId) return;
    this.hand = null;
    this.host.removeAttribute("data-pressed");
    this.wake();
  }

  startSweep(direction, gain, seconds, delay = 0) {
    if (!this.ready || this.hand) return;
    const reach = this.spacing * 1.5;
    const from = direction > 0 ? -reach : this.width + reach;
    const to = direction > 0 ? this.width + reach : -reach;
    this.sweep = { from, to, t: -delay, seconds, gain, x: from, px: from, vx: 0 };
    this.wake();
  }

  nudge(direction) {
    this.startSweep(direction, 0.9, 1.3);
  }

  trackHand(hand, dt) {
    const raw = (hand.x - hand.px) / dt;
    hand.px = hand.x;
    if (hand.fresh) {
      hand.fresh = false;
      return;
    }
    hand.vx += (raw - hand.vx) * (1 - Math.exp(-dt / 0.03));
  }

  advanceSweep(dt) {
    const s = this.sweep;
    if (!s) return null;
    s.t += dt;
    if (s.t < 0) return null;
    const k = Math.min(1, s.t / s.seconds);
    s.x = s.from + (s.to - s.from) * easeInOut(k);
    const raw = (s.x - s.px) / dt;
    s.px = s.x;
    s.vx += (raw - s.vx) * (1 - Math.exp(-dt / 0.03));
    if (k >= 1) {
      this.sweep = null;
      return null;
    }
    return s;
  }

  step(dt, drivers) {
    const n = this.count;
    const angle = this.angle;
    const spin = this.spin;
    const accel = this.accel;
    const reach = this.spacing * 1.05;
    let time = this.carry + dt;
    while (time >= SUBSTEP) {
      time -= SUBSTEP;
      for (let i = 0; i < n; i += 1) {
        const left = i > 0 ? i - 1 : i;
        const right = i < n - 1 ? i + 1 : i;
        let a = -RESTORE * (angle[i] - REST) - DAMP * spin[i];
        a += COUPLE * (angle[left] + angle[right] - 2 * angle[i]);
        a += COUPLE_DAMP * (spin[left] + spin[right] - 2 * spin[i]);
        const over = Math.abs(angle[i]) - LIMIT;
        if (over > 0) a -= Math.sign(angle[i]) * LIMIT_STIFF * over + 6 * spin[i];
        const pivot = (i + 0.5) * this.spacing;
        for (const d of drivers) {
          const off = (pivot - d.x) / reach;
          const weight = Math.exp(-off * off);
          if (weight < 0.002) continue;
          const push = 1.45 * Math.tanh((d.vx / (this.spacing * 16)) * d.gain);
          const target = REST + push;
          a += weight * (HAND * (target - angle[i]) + SWEEP * push - 4 * spin[i]);
        }
        accel[i] = a;
      }
      for (let i = 0; i < n; i += 1) {
        spin[i] += accel[i] * SUBSTEP;
        angle[i] += spin[i] * SUBSTEP;
        if (angle[i] > HARD) {
          angle[i] = HARD;
          spin[i] = Math.min(0, spin[i]);
        } else if (angle[i] < -HARD) {
          angle[i] = -HARD;
          spin[i] = Math.max(0, spin[i]);
        }
      }
    }
    this.carry = time;
  }

  settled() {
    for (let i = 0; i < this.count; i += 1) {
      if (Math.abs(this.angle[i] - REST) > 3e-4 || Math.abs(this.spin[i]) > 3e-3) return false;
    }
    return true;
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.ready) return;
    const { program, uniforms } = this.program;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr;
    const floor = this.floorLine() * dpr;
    const spacing = this.spacing * dpr;
    const cropW = CROP[2] - CROP[0];
    const cropH = (CROP[3] - CROP[1]) * (this.imageAspect || 1);
    const top = this.ceiling() * dpr;
    const perPx = Math.min(cropW / w, cropH / Math.max(1, floor - top)) / 1.06;
    const cx = (CROP[0] + CROP[2]) / 2;
    const cy = (CROP[1] + CROP[3]) / 2;
    const uvScaleY = perPx / (this.imageAspect || 1);
    const offsetX = cx - (w / 2) * perPx;
    const offsetY = cy - (top + (floor - top) * 0.55) * uvScaleY;
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(uniforms.uImage, 0);
    gl.uniform2f(uniforms.uRes, w, h);
    gl.uniform1fv(uniforms.uAngles, this.angle);
    gl.uniform1i(uniforms.uCount, this.count);
    gl.uniform1f(uniforms.uSpacing, spacing);
    gl.uniform1f(uniforms.uFloor, floor);
    gl.uniform1f(uniforms.uCeiling, top);
    gl.uniform1f(uniforms.uHorizon, floor - Math.max(h * 0.36, floor * 0.5));
    gl.uniform1f(uniforms.uDepth, spacing * 1.8);
    gl.uniform1f(uniforms.uThrow, spacing * 7);
    gl.uniform1f(uniforms.uSkew, -w * 0.16);
    gl.uniform1f(uniforms.uDpr, dpr);
    gl.uniform1f(uniforms.uSamples, dpr < 1.5 ? 2 : 1);
    gl.uniform4f(uniforms.uCover, offsetX, offsetY, perPx, uvScaleY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
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
    const drivers = [];
    if (this.hand) {
      this.trackHand(this.hand, dt);
      drivers.push(this.hand);
    }
    const sweep = this.advanceSweep(dt);
    if (sweep) drivers.push(sweep);
    this.step(dt, drivers);
    const busy = Boolean(this.hand) || Boolean(this.sweep) || !this.settled();
    if (!busy) {
      this.angle.fill(REST);
      this.spin.fill(0);
    }
    this.render();
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
    const gl = this.gl;
    if (!gl) return;
    if (this.texture) gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program.program);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
