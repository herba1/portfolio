import { PLOT_FRAGMENT, QUAD_VERTEX } from "./plotterShader";
import { readTone } from "./plotterTone";
import PlotterSound from "./plotterSound";

const ROWS = 1024;
const MAX_DPR = 2;
const BAND = 10;
const LIFT = 30;
const OVERHANG = 16;
const TRAVEL_LAMBDA = 7;
const TRAVEL_MAX = 1500;
const HOME = -24;

const PAPER = [0.961, 0.941, 0.91];

export const PENS = [
  { name: "Black and vermilion", ink: "#1a1a1a", accent: "#d8452f" },
  { name: "Indigo and ochre", ink: "#22305c", accent: "#d8962a" },
  { name: "Sepia and green", ink: "#3d2a1e", accent: "#2f8a5a" },
];

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
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

export default class PlotterEngine {
  constructor({ root, stage, canvas, gantry, mode = 0, pen = 0, onReady, onProgress, onError }) {
    this.root = root;
    this.stage = stage;
    this.canvas = canvas;
    this.gantry = gantry;
    this.onReady = onReady;
    this.onProgress = onProgress;
    this.onError = onError;
    this.rows = new Uint8Array(ROWS * 2);
    for (let i = 0; i < ROWS; i += 1) {
      this.rows[i * 2] = mode;
      this.rows[i * 2 + 1] = pen;
    }
    this.target = [mode, pen];
    this.phase = "idle";
    this.position = HOME;
    this.speed = 0;
    this.goal = HOME;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.aspect = 758 / 600;
    this.center = [0.47, 0.66];
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.toneReady = false;
    this.rowsDirty = true;
    this.lastProgress = -1;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sound = new PlotterSound();
    this.frame = this.frame.bind(this);
    this.handleVisibility = () => this.wake();
  }

  start(image) {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.onError?.();
      return;
    }
    this.gl = gl;
    try {
      this.plot = link(gl, QUAD_VERTEX, PLOT_FRAGMENT);
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
    this.toneTexture = gl.createTexture();
    this.rowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.rowTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, ROWS, 0, gl.RG, gl.UNSIGNED_BYTE, this.rows);
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
    this.setImage(image, { first: true });
  }

  setImage(image, { first = false, center } = {}) {
    if (!this.gl || this.destroyed) return;
    const tone = readTone(image, { crop: first ? [0.02, 0.27, 0.015, 0.02] : [0, 0, 0, 0] });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.toneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tone.width, tone.height, 0, gl.RGBA, gl.FLOAT, tone.data);
    this.aspect = tone.aspect;
    this.center = center || [0.5, 0.5];
    if (first) this.center = [0.46, 0.6];
    this.toneReady = true;
    this.resize();
    if (first) {
      this.render();
      this.onReady?.();
    } else {
      for (let i = 0; i < ROWS; i += 1) this.rows[i * 2] = 7;
      this.rowsDirty = true;
      this.retarget(this.target[0], this.target[1]);
    }
  }

  resize() {
    if (!this.gl || this.destroyed) return;
    const host = this.root.getBoundingClientRect();
    const box = this.stage.getBoundingClientRect();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(host.width));
    const height = Math.max(1, Math.round(host.height));
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    let w = box.width;
    let h = w / this.aspect;
    if (h > box.height) {
      h = box.height;
      w = h * this.aspect;
    }
    const x = Math.round(box.left - host.left + (box.width - w) / 2);
    const y = Math.round(box.top - host.top + (box.height - h) / 2);
    this.rect = { x, y, w: Math.round(w), h: Math.round(h) };
    this.scale = Math.max(0.78, Math.min(1.15, Math.sqrt((this.rect.w * this.rect.h) / (700 * 554))));
    const style = this.root.style;
    style.setProperty("--plot-x", `${x}px`);
    style.setProperty("--plot-y", `${y}px`);
    style.setProperty("--plot-w", `${this.rect.w}px`);
    style.setProperty("--plot-h", `${this.rect.h}px`);
    this.placeGantry();
    this.render();
  }

  get plotSpeed() {
    return Math.max(120, Math.min(210, this.rect.h / 3));
  }

  rowAt(y) {
    return Math.max(0, Math.min(ROWS, Math.floor((y / this.rect.h) * ROWS)));
  }

  rowTop(index) {
    return (index / ROWS) * this.rect.h;
  }

  isTarget(index) {
    return this.rows[index * 2] === this.target[0] && this.rows[index * 2 + 1] === this.target[1];
  }

  firstOff(from) {
    for (let i = Math.max(0, from); i < ROWS; i += 1) if (!this.isTarget(i)) return i;
    return -1;
  }

  done() {
    return this.firstOff(0) === -1;
  }

  retarget(mode, pen) {
    if (this.phase === "plot") this.commit(this.position - BAND - 4);
    this.target = [mode, pen];
    if (this.reduced) {
      for (let i = 0; i < ROWS; i += 1) {
        this.rows[i * 2] = mode;
        this.rows[i * 2 + 1] = pen;
      }
      this.rowsDirty = true;
      this.render();
      this.report();
      return;
    }
    if (this.phase !== "plot") this.next();
    this.report();
    this.wake();
  }

  commit(limitY) {
    const limit = Math.min(ROWS, Math.floor((limitY / this.rect.h) * ROWS));
    for (let i = 0; i < limit; i += 1) {
      if (this.isTarget(i)) continue;
      this.rows[i * 2] = this.target[0];
      this.rows[i * 2 + 1] = this.target[1];
      this.rowsDirty = true;
    }
  }

  next() {
    const first = this.firstOff(0);
    if (first === -1) {
      this.phase = "home";
      this.goal = HOME;
    } else {
      this.phase = "travel";
      this.goal = Math.max(0, this.rowTop(first) - 2);
    }
    this.sound.setPlotting(false);
  }

  step(dt) {
    if (this.phase === "plot") {
      this.speed = damp(this.speed, this.plotSpeed, 4.5, dt);
      this.position += this.speed * dt;
      this.commit(this.position - BAND - 4);
      if (this.position - BAND - 4 >= this.rect.h) {
        this.commit(this.rect.h + 1);
        this.next();
      } else {
        const ahead = this.firstOff(this.rowAt(Math.max(0, this.position - BAND - 4)));
        if (ahead === -1) this.next();
        else if (this.rowTop(ahead) > this.position + 64) {
          this.phase = "travel";
          this.goal = this.rowTop(ahead) - 2;
          this.sound.setPlotting(false);
        }
      }
    } else if (this.phase === "travel" || this.phase === "home") {
      const before = this.position;
      let nextPosition = damp(this.position, this.goal, TRAVEL_LAMBDA, dt);
      const limit = TRAVEL_MAX * dt;
      nextPosition = before + Math.max(-limit, Math.min(limit, nextPosition - before));
      this.position = nextPosition;
      if (Math.abs(this.goal - this.position) < 0.6) {
        this.position = this.goal;
        if (this.phase === "home") {
          this.phase = "idle";
        } else {
          this.phase = "plot";
          this.speed = 0;
          this.sound.setPlotting(true);
        }
      }
    }
  }

  report() {
    let count = 0;
    for (let i = 0; i < ROWS; i += 1) if (this.isTarget(i)) count += 1;
    const progress = Math.round((count / ROWS) * 100);
    if (progress === this.lastProgress && this.phase !== "idle") return;
    this.lastProgress = progress;
    this.onProgress?.({ progress, busy: progress < 100 || this.phase === "plot" });
  }

  placeGantry() {
    if (!this.gantry) return;
    const { x, y, w } = this.rect;
    const shown = this.phase !== "idle" && this.phase !== "home";
    this.gantry.style.transform = `translate3d(${x - OVERHANG}px, ${y + this.position}px, 0)`;
    this.gantry.style.width = `${w + OVERHANG * 2}px`;
    if (shown) this.gantry.setAttribute("data-shown", "");
    else this.gantry.removeAttribute("data-shown");
  }

  wake() {
    if (this.destroyed || !this.gl) return;
    const running = this.visible && !document.hidden;
    if (!running) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.sound.setPlotting(false);
      return;
    }
    if (this.phase === "plot") this.sound.setPlotting(true);
    if (!this.raf && this.phase !== "idle") {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  frame(now) {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.step(dt);
    this.placeGantry();
    this.render();
    this.report();
    if (this.phase !== "idle" && this.visible && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.toneReady) return;
    if (this.rowsDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.rowTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, ROWS, gl.RG, gl.UNSIGNED_BYTE, this.rows);
      this.rowsDirty = false;
    }
    const { program, uniforms: u } = this.plot;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.toneTexture);
    gl.uniform1i(u.uTone, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rowTexture);
    gl.uniform1i(u.uRows, 1);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform4f(u.uRect, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    gl.uniform1f(u.uGantry, this.position);
    gl.uniform2f(u.uTarget, this.target[0], this.target[1]);
    gl.uniform1f(u.uActive, this.phase === "plot" ? 1 : 0);
    gl.uniform1f(u.uBand, BAND);
    gl.uniform1f(u.uLift, LIFT);
    gl.uniform1f(u.uScale, this.scale);
    gl.uniform2f(u.uCenter, this.center[0], this.center[1]);
    gl.uniform3f(u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform3fv(u.uInks, PENS.flatMap((pen) => hexToRgb(pen.ink)));
    gl.uniform3fv(u.uAccents, PENS.flatMap((pen) => hexToRgb(pen.accent)));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  unlockSound() {
    this.sound.unlock();
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
      gl.deleteTexture(this.toneTexture);
      gl.deleteTexture(this.rowTexture);
      gl.deleteBuffer(this.buffer);
      gl.deleteVertexArray(this.vao);
      if (this.plot) gl.deleteProgram(this.plot.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
  }
}
