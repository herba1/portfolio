import { POSTER_FRAGMENT, QUAD_VERTEX } from "./posterShader";
import { readTone } from "./posterTone";
import PosterSound from "./posterSound";

const ROWS = 1024;
const MAX_DPR = 2;
const PULL_MS = 1250;
const FLOOD_MS = 520;
const OVERRUN = 14;
const POSTER_ASPECT = 0.72;
const PAGE = [0.925, 0.918, 0.902];
const STOCK = [0.966, 0.951, 0.922];

export const PALETTES = [
  { name: "Navy and red", inks: ["#00324c", "#d81b21", "#7ea4ae", "#fde4a8"] },
  { name: "Pine and orange", inks: ["#0f3a33", "#e5582a", "#93c4b0", "#f7e6b6"] },
  { name: "Plum and pink", inks: ["#2b1a3c", "#e2457a", "#b2a6d8", "#f8e9ac"] },
];

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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

function texture(gl, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export default class PosterEngine {
  constructor({ root, stage, canvas, squeegee, exposure, palette, word, fontFamily, onReady, onError, onPulling }) {
    this.root = root;
    this.stage = stage;
    this.canvas = canvas;
    this.squeegee = squeegee;
    this.onReady = onReady;
    this.onError = onError;
    this.onPulling = onPulling;
    this.fontFamily = fontFamily;
    this.target = [Math.round(exposure * 255), palette, 1, 0];
    this.rows = new Uint8Array(ROWS * 4);
    for (let i = 0; i < ROWS; i += 1) this.rows.set(this.target, i * 4);
    this.word = word;
    this.wordVersion = 0;
    this.phase = "idle";
    this.position = -OVERRUN;
    this.from = -OVERRUN;
    this.to = 0;
    this.started = 0;
    this.duration = PULL_MS;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.toneAspect = 0.9;
    this.raf = 0;
    this.visible = true;
    this.destroyed = false;
    this.rowsDirty = true;
    this.pulling = false;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sound = new PosterSound();
    this.frame = this.frame.bind(this);
    this.handleVisibility = () => this.wake();
  }

  start(image) {
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) {
      this.onError?.();
      return;
    }
    this.gl = gl;
    try {
      this.program = link(gl, QUAD_VERTEX, POSTER_FRAGMENT);
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
    const tone = readTone(image);
    this.toneAspect = tone.aspect;
    this.toneTexture = texture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tone.width, tone.height, 0, gl.RGBA, gl.FLOAT, tone.data);
    this.rowTexture = texture(gl, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.rows);
    this.wordTextures = [texture(gl, gl.LINEAR), texture(gl, gl.LINEAR)];
    this.wordCanvas = document.createElement("canvas");
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
    this.drawWord(0, this.word);
    this.drawWord(1, this.word);
    this.render();
    this.onReady?.();
  }

  layout() {
    const { w, h } = this.rect;
    const margin = Math.round(w * 0.05);
    const imageW = w - margin * 2;
    const imageH = Math.round(imageW / this.toneAspect);
    const bandY = margin + imageH + Math.round(margin * 0.5);
    const bandH = h - bandY - margin;
    this.image = [margin, margin, imageW, imageH];
    this.band = [margin, bandY, imageW, Math.max(8, bandH)];
  }

  resize() {
    if (!this.gl || this.destroyed) return;
    const host = this.root.getBoundingClientRect();
    const box = this.stage.getBoundingClientRect();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(host.width * dpr);
    this.canvas.height = Math.round(host.height * dpr);
    let h = box.height;
    let w = h * POSTER_ASPECT;
    if (w > box.width) {
      w = box.width;
      h = w / POSTER_ASPECT;
    }
    const x = Math.round(box.left - host.left + (box.width - w) / 2);
    const y = Math.round(box.top - host.top + (box.height - h) / 2);
    const changed = Math.round(w) !== this.rect.w || Math.round(h) !== this.rect.h;
    this.rect = { x, y, w: Math.round(w), h: Math.round(h) };
    this.layout();
    const style = this.root.style;
    style.setProperty("--poster-x", `${x}px`);
    style.setProperty("--poster-y", `${y}px`);
    style.setProperty("--poster-w", `${this.rect.w}px`);
    style.setProperty("--poster-h", `${this.rect.h}px`);
    if (changed && this.wordTextures) {
      this.drawWord(0, this.slotWords?.[0] ?? this.word);
      this.drawWord(1, this.slotWords?.[1] ?? this.word);
    }
    this.placeSqueegee();
    this.render();
  }

  drawWord(slot, word) {
    const gl = this.gl;
    if (!gl) return;
    this.slotWords = this.slotWords || [this.word, this.word];
    this.slotWords[slot] = word;
    const [, , bw, bh] = this.band;
    const scale = this.dpr;
    const canvas = this.wordCanvas;
    canvas.width = Math.max(8, Math.round(bw * scale));
    canvas.height = Math.max(8, Math.round(bh * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const text = word.trim() || " ";
    let size = canvas.height * 0.86;
    ctx.font = `800 ${size}px ${this.fontFamily}`;
    const measured = ctx.measureText(text).width;
    const maxWidth = canvas.width * 0.88;
    if (measured > maxWidth) size *= maxWidth / measured;
    ctx.font = `800 ${size}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || size * 0.7;
    const descent = metrics.actualBoundingBoxDescent || 0;
    const baseline = canvas.height / 2 + (ascent - descent) / 2;
    ctx.fillStyle = "#fff";
    ctx.fillText(text, canvas.width / 2, baseline);
    gl.bindTexture(gl.TEXTURE_2D, this.wordTextures[slot]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, canvas);
  }

  setWord(word) {
    if (!this.gl || word === this.slotWords?.[this.target[3] ? 1 : 0]) return;
    this.wordVersion += 1;
    const slot = this.wordVersion % 2;
    this.drawWord(slot, word);
    this.retarget({ word: slot });
  }

  setExposure(value) {
    this.retarget({ exposure: value });
  }

  setPalette(index) {
    this.retarget({ palette: index });
  }

  retarget({ exposure, palette, word }) {
    if (!this.gl) return;
    if (this.phase === "pull") this.commit(this.position - 3);
    const next = [...this.target];
    if (exposure != null) next[0] = Math.round(exposure * 255);
    if (palette != null) next[1] = palette;
    if (word != null) next[3] = word ? 255 : 0;
    if (next[0] === this.target[0] && next[1] === this.target[1] && next[3] === this.target[3]) return;
    next[2] = (this.target[2] % 250) + 1;
    this.target = next;
    if (this.reduced) {
      for (let i = 0; i < ROWS; i += 1) this.rows.set(this.target, i * 4);
      this.rowsDirty = true;
      this.render();
      return;
    }
    if (this.phase === "idle" || this.phase === "park") this.beginPull();
    this.wake();
  }

  isTarget(i) {
    const o = i * 4;
    return this.rows[o] === this.target[0] && this.rows[o + 1] === this.target[1] && this.rows[o + 3] === this.target[3];
  }

  mismatched() {
    for (let i = 0; i < ROWS; i += 1) if (!this.isTarget(i)) return true;
    return false;
  }

  commit(y) {
    const limit = Math.min(ROWS, Math.floor((y / this.rect.h) * ROWS));
    for (let i = 0; i < limit; i += 1) {
      if (this.isTarget(i)) continue;
      this.rows.set(this.target, i * 4);
      this.rowsDirty = true;
    }
  }

  beginPull() {
    this.phase = "pull";
    this.from = -OVERRUN;
    this.to = this.rect.h + OVERRUN;
    this.duration = PULL_MS;
    this.started = performance.now();
    this.position = this.from;
    this.sound.stroke(PULL_MS / 1000, 1);
    this.setPulling(true);
  }

  beginFlood() {
    this.phase = "flood";
    this.from = this.position;
    this.to = -OVERRUN;
    this.duration = FLOOD_MS;
    this.started = performance.now();
    this.sound.stroke(FLOOD_MS / 1000, 0.45);
  }

  setPulling(on) {
    if (this.pulling === on) return;
    this.pulling = on;
    this.onPulling?.(on);
  }

  step(now) {
    const t = Math.min(1, (now - this.started) / this.duration);
    const eased = easeInOut(t);
    this.position = this.from + (this.to - this.from) * eased;
    if (this.phase === "pull") {
      this.commit(this.position - 3);
      if (t >= 1) {
        this.commit(this.rect.h + 1);
        if (this.mismatched()) this.beginFlood();
        else {
          this.phase = "park";
          this.from = this.position;
          this.to = this.rect.h + OVERRUN + 28;
          this.duration = 260;
          this.started = now;
          this.setPulling(false);
        }
      }
    } else if (this.phase === "flood") {
      if (t >= 1) this.beginPull();
    } else if (this.phase === "park") {
      if (t >= 1) this.phase = "idle";
    }
  }

  placeSqueegee() {
    const el = this.squeegee;
    if (!el) return;
    const { x, y, w } = this.rect;
    el.style.transform = `translate3d(${x - 18}px, ${y + this.position}px, 0)`;
    el.style.width = `${w + 36}px`;
    if (this.phase === "pull" || this.phase === "flood") el.setAttribute("data-shown", "");
    else el.removeAttribute("data-shown");
    if (this.phase === "flood") el.setAttribute("data-lifted", "");
    else el.removeAttribute("data-lifted");
  }

  wake() {
    if (this.destroyed || !this.gl) return;
    if (!this.visible || document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    if (!this.raf && this.phase !== "idle") this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    this.step(now);
    this.placeSqueegee();
    this.render();
    if (this.phase !== "idle" && this.visible && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.image) return;
    if (this.rowsDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.rowTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, this.rows);
      this.rowsDirty = false;
    }
    const { program, uniforms: u } = this.program;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u[name], unit);
    };
    bind(0, this.toneTexture, "uTone");
    bind(1, this.wordTextures[0], "uWord0");
    bind(2, this.wordTextures[1], "uWord1");
    bind(3, this.rowTexture, "uRows");
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform4f(u.uRect, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    gl.uniform4f(u.uImage, ...this.image);
    gl.uniform4f(u.uBand, ...this.band);
    gl.uniform1f(u.uSqueegee, this.position);
    gl.uniform1f(u.uActive, this.phase === "pull" ? 1 : 0);
    gl.uniform4f(u.uTarget, this.target[0] / 255, this.target[1] / 255, this.target[2] / 255, this.target[3] / 255);
    gl.uniform3fv(u.uInks, PALETTES.flatMap((p) => p.inks.flatMap(hexToRgb)));
    gl.uniform3f(u.uPage, ...PAGE);
    gl.uniform3f(u.uStock, ...STOCK);
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
      this.wordTextures?.forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(this.buffer);
      gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
  }
}
