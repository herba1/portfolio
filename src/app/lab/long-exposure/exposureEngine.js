import { COMPOSITE_FRAGMENT, MAX_LAMPS, MAX_TAPS, QUAD_VERTEX, RADIANCE_FRAGMENT, SCENE_FRAGMENT, STROKE_FRAGMENT, STROKE_VERTEX } from "./exposureShader";
import { AUTO_FIGURES, LAMPS, LIGHTS, SCENE_ALBUM, SEED_SHOTS, figurePath, paintScene } from "./exposureScenes";

const MAX_DPR = 2;
const MAX_SEGMENTS = 4096;
const FLOATS = 11;
const SCENE_RATE = 0.05;
const PREVIEW = 0.085;
const LAMP_RATE = 0.55;
const TORCH = 1.15;
const SIGMA = 0.0042;
const MIN_SECONDS = 0.35;
const GHOST_SECONDS = 0.28;
const RETURN_SECONDS = 0.7;
const HOLD_SECONDS = 0.36;
const AUTO_SECONDS = 4.2;

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

function link(gl, vertexSource, fragmentSource, attributes) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  attributes.forEach((name, i) => gl.bindAttribLocation(program, i, name));
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

class Torch {
  constructor() {
    this.reset(0, 0);
  }

  reset(x, y) {
    this.px = x;
    this.py = y;
    this.mx = x;
    this.my = y;
    this.pending = [];
    this.speed = 0;
    this.debt = 0;
  }

  push(x, y) {
    this.pending.push([x, y]);
  }

  drain(flush, scale) {
    const out = [];
    for (const [qx, qy] of this.pending) {
      const nx = (this.px + qx) * 0.5;
      const ny = (this.py + qy) * 0.5;
      const chord = Math.hypot(nx - this.mx, ny - this.my) + Math.hypot(this.px - this.mx, this.py - this.my);
      const pieces = Math.min(12, Math.max(1, Math.ceil((chord * scale) / 5)));
      let ax = this.mx;
      let ay = this.my;
      for (let k = 1; k <= pieces; k += 1) {
        const t = k / pieces;
        const u = 1 - t;
        const bx = u * u * this.mx + 2 * u * t * this.px + t * t * nx;
        const by = u * u * this.my + 2 * u * t * this.py + t * t * ny;
        out.push([ax, ay, bx, by]);
        ax = bx;
        ay = by;
      }
      this.mx = nx;
      this.my = ny;
      this.px = qx;
      this.py = qy;
    }
    this.pending.length = 0;
    if (flush && Math.hypot(this.px - this.mx, this.py - this.my) > 0.01) {
      out.push([this.mx, this.my, this.px, this.py]);
      this.mx = this.px;
      this.my = this.py;
    }
    return out;
  }
}

export default class ExposureEngine {
  constructor({ frame, canvas, cursor, blink, time, onState, onReady, onFail, onSeed, onDeveloped }) {
    this.frame = frame;
    this.canvas = canvas;
    this.cursor = cursor;
    this.blink = blink;
    this.time = time;
    this.onState = onState;
    this.onReady = onReady;
    this.onFail = onFail;
    this.onSeed = onSeed;
    this.onDeveloped = onDeveloped;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.mode = "boot";
    this.light = 0;
    this.lightMix = null;
    this.exposure = 0;
    this.lastSeconds = 0;
    this.accMix = 1;
    this.ghostMix = 0;
    this.holdLeft = 0;
    this.seed = 1;
    this.clock = 0;
    this.shake = { x: 0, y: 0, vx: 0, vy: 0, p1: 0.3, p2: 1.7, p3: 2.9, p4: 4.1 };
    this.torch = new Torch();
    this.pointer = null;
    this.auto = null;
    this.shotLights = new Set();
    this.segments = new Float32Array(MAX_SEGMENTS * FLOATS);
    this.lampData = new Float32Array(MAX_LAMPS * 4);
    this.lampTint = new Float32Array(MAX_LAMPS * 3);
    this.urls = new Set();
    this.shotId = 0;
    this.segCount = 0;
    this.frameStep = this.frameStep.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      leave: (e) => {
        if (e.pointerType === "mouse" && !this.pointer) this.hideCursor();
      },
      visibility: () => this.checkVisibility(),
      lost: (e) => e.preventDefault(),
    };
    LAMPS.forEach((lamp, i) => {
      this.lampTint.set(lamp.tint, i * 3);
    });
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
      return;
    }
    this.gl = gl;
    try {
      this.setupGl();
    } catch {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.onFail?.();
      return;
    }
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.frame.addEventListener("pointerdown", this.handlers.down);
    this.frame.addEventListener("pointermove", this.handlers.move);
    this.frame.addEventListener("pointerup", this.handlers.up);
    this.frame.addEventListener("pointercancel", this.handlers.up);
    this.frame.addEventListener("pointerleave", this.handlers.leave);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.frame);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.frame);
    this.resize();
    const img = new Image();
    img.decoding = "async";
    img.src = SCENE_ALBUM.cover;
    img
      .decode()
      .then(() => {
        if (this.destroyed || !this.gl) return;
        this.uploadPhoto(paintScene(img));
        this.develop();
      })
      .catch(() => this.onFail?.());
  }

  setupGl() {
    const gl = this.gl;
    this.float = Boolean(gl.getExtension("EXT_color_buffer_float"));
    this.programs = {
      radiance: link(gl, QUAD_VERTEX, RADIANCE_FRAGMENT, ["aPosition"]),
      scene: link(gl, QUAD_VERTEX, SCENE_FRAGMENT, ["aPosition"]),
      stroke: link(gl, STROKE_VERTEX, STROKE_FRAGMENT, ["aPosition", "aSeg", "aProp", "aColor"]),
      composite: link(gl, QUAD_VERTEX, COMPOSITE_FRAGMENT, ["aPosition"]),
    };
    this.triBuffer = gl.createBuffer();
    this.triVao = gl.createVertexArray();
    gl.bindVertexArray(this.triVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quadBuffer = gl.createBuffer();
    this.segBuffer = gl.createBuffer();
    this.segVao = gl.createVertexArray();
    gl.bindVertexArray(this.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.segments.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const accH = Math.min(1200, Math.max(640, Math.round(Math.min(window.innerHeight || 800, 900) * Math.min(MAX_DPR, window.devicePixelRatio || 1))));
    this.accW = Math.round(accH * 0.8);
    this.accH = accH;
    this.levels = Math.floor(Math.log2(Math.max(this.accW, this.accH))) + 1;
    this.acc = this.makeTarget();
    this.ghost = this.makeTarget();
  }

  makeTarget(plain = false) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, plain ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const levels = plain ? 1 : this.levels;
    if (this.float) gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, this.accW, this.accH);
    else gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, this.accW, this.accH);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer };
  }

  uploadPhoto(img) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.photo = texture;
    this.radiance = this.makeTarget(true);
    this.setLamps(0, 0.8);
    const { program, uniforms } = this.programs.radiance;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.radiance.framebuffer);
    gl.viewport(0, 0, this.accW, this.accH);
    this.sceneUniforms(uniforms, 0);
    gl.uniform2f(uniforms.uRes, this.accW, this.accH);
    gl.uniform1f(uniforms.uSceneRate, SCENE_RATE);
    gl.uniform1f(uniforms.uLampRate, LAMP_RATE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  resize() {
    if (!this.gl) return;
    const rect = this.frame.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (this.ready) this.composite();
  }

  setLight(index) {
    this.light = Math.max(0, Math.min(LIGHTS.length - 1, index));
    this.paintCursor();
  }

  setLamps(t, strength) {
    LAMPS.forEach((lamp, i) => {
      const pulse = 0.72 + 0.28 * Math.sin(t * lamp.beat * 2.4 + i * 1.7);
      this.lampData[i * 4] = lamp.at[0];
      this.lampData[i * 4 + 1] = lamp.at[1];
      this.lampData[i * 4 + 2] = lamp.r;
      this.lampData[i * 4 + 3] = lamp.w * pulse * strength;
    });
  }

  sceneUniforms(uniforms, unit) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.photo);
    gl.uniform1i(uniforms.uPhoto, unit);
    gl.uniform4fv(uniforms.uLamps, this.lampData);
    gl.uniform3fv(uniforms.uLampTint, this.lampTint);
    gl.uniform1f(uniforms.uAspect, 0.8);
  }

  clearAcc(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.accW, this.accH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  stepShake(dt, t) {
    const s = this.shake;
    const amp = this.reduced ? 0.0008 : 0.0026;
    const tx = amp * (Math.sin(t * 1.3 + s.p1) + 0.6 * Math.sin(t * 3.1 + s.p2) + 0.25 * Math.sin(t * 11.0 + s.p3));
    const ty = amp * (Math.sin(t * 1.1 + s.p3) + 0.6 * Math.sin(t * 2.7 + s.p4) + 0.25 * Math.sin(t * 9.0 + s.p1));
    const k = 70;
    const c = 2 * Math.sqrt(k) * 0.8;
    s.vx += ((tx - s.x) * k - s.vx * c) * dt;
    s.vy += ((ty - s.y) * k - s.vy * c) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }

  jolt(scale = 1) {
    const s = this.shake;
    const a = Math.random() * Math.PI * 2;
    const m = (this.reduced ? 0.01 : 0.07) * scale;
    s.vx += Math.cos(a) * m;
    s.vy += Math.sin(a) * m - m * 0.6;
    s.p1 = Math.random() * 6.28;
    s.p2 = Math.random() * 6.28;
    s.p3 = Math.random() * 6.28;
    s.p4 = Math.random() * 6.28;
  }

  drawScene(seconds, shakes) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.scene;
    const taps = Math.max(1, Math.min(MAX_TAPS, shakes.length / 2));
    const pulse = 0.9 + 0.1 * Math.sin(this.clock * 2.3);
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.framebuffer);
    gl.viewport(0, 0, this.accW, this.accH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.radiance.texture);
    gl.uniform1i(uniforms.uRadiance, 0);
    gl.uniform2f(uniforms.uRes, this.accW, this.accH);
    gl.uniform2fv(uniforms.uShakes, shakes);
    gl.uniform1i(uniforms.uTaps, taps);
    gl.uniform1f(uniforms.uGain, (seconds * pulse) / taps);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  collectStroke(torch, dt, t, lightIndex, flush) {
    const W = this.accW;
    const H = this.accH;
    const segs = torch.drain(flush, W);
    let total = 0;
    const lens = segs.map(([ax, ay, bx, by]) => {
      const l = Math.hypot((bx - ax) * W, (by - ay) * H);
      total += l;
      return l;
    });
    const raw = dt > 0 ? total / dt / W : 0;
    const wasMoving = torch.speed > 0.12;
    torch.speed += (Math.min(raw, 6) - torch.speed) * (1 - Math.exp(-Math.max(dt, 1e-3) / 0.07));
    const fast = smoothstep(0.2, 2.6, torch.speed);
    const sigma = SIGMA * W * (1.35 - 0.6 * fast);
    const flicker = 1 + 0.06 * Math.sin(t * 47.0) + 0.04 * Math.sin(t * 13.0 + 1.3);
    let held = Math.max(dt, 0);
    if (total < 0.6 && wasMoving && torch.debt + held < 0.25 && !flush) {
      torch.debt += held;
      return;
    }
    if (total >= 0.6 && torch.speed > 0.05) held = Math.min((total / W) / torch.speed, held * 2.5, 0.25);
    held += torch.debt;
    torch.debt = 0;
    const energy = TORCH * W * held * flicker;
    const color = LIGHTS[lightIndex].rgb;
    const data = this.segments;
    const put = (ax, ay, bx, by, e) => {
      if (this.segCount >= MAX_SEGMENTS) this.drawSegments();
      const o = this.segCount * FLOATS;
      data[o] = ax * W;
      data[o + 1] = ay * H;
      data[o + 2] = bx * W;
      data[o + 3] = by * H;
      data[o + 4] = sigma;
      data[o + 5] = e;
      data[o + 6] = 4.0;
      data[o + 7] = 0;
      data[o + 8] = color[0];
      data[o + 9] = color[1];
      data[o + 10] = color[2];
      this.segCount += 1;
    };
    if (total < 0.6) {
      if (energy > 0) put(torch.mx, torch.my, torch.mx, torch.my, energy);
    } else if (energy > 0) segs.forEach(([ax, ay, bx, by], i) => put(ax, ay, bx, by, (energy * lens[i]) / total));
    else {
      const e = TORCH * W * (1 / 120);
      segs.forEach(([ax, ay, bx, by], i) => put(ax, ay, bx, by, (e * lens[i]) / total));
    }
    this.shotLights.add(lightIndex);
  }

  drawSegments() {
    const count = this.segCount;
    if (!count) return;
    this.segCount = 0;
    const gl = this.gl;
    const { program, uniforms } = this.programs.stroke;
    gl.useProgram(program);
    gl.bindVertexArray(this.segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.segments, 0, count * FLOATS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.framebuffer);
    gl.viewport(0, 0, this.accW, this.accH);
    gl.uniform2f(uniforms.uBox, this.accW, this.accH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  mip() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.acc.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  composite() {
    const gl = this.gl;
    if (!gl || !this.radiance) return;
    const { program, uniforms } = this.programs.composite;
    const seconds = this.mode === "exposing" ? this.exposure : this.lastSeconds;
    const sceneSoFar = SCENE_RATE * (this.mode === "exposing" ? this.exposure : 0);
    const livePart = this.mode === "exposing" ? Math.max(0, 1 - sceneSoFar / PREVIEW) : 1 - this.accMix;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.radiance.texture);
    gl.uniform1i(uniforms.uRadiance, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.acc.texture);
    gl.uniform1i(uniforms.uAcc, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ghost.texture);
    gl.uniform1i(uniforms.uGhost, 2);
    gl.uniform1f(uniforms.uGhostMix, this.ghostMix);
    gl.uniform2f(uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(uniforms.uPreview, (PREVIEW / SCENE_RATE) * livePart);
    gl.uniform1f(uniforms.uAccMix, this.mode === "exposing" ? 1 : this.accMix);
    const exposed = this.mode === "exposing" || this.accMix > 0 ? seconds : 0;
    const noiseLive = 0.022;
    const noiseShot = 0.02 + 0.05 * Math.sqrt(Math.min(1, exposed / 20));
    gl.uniform1f(uniforms.uNoise, noiseLive + (noiseShot - noiseLive) * (this.mode === "exposing" ? 1 : this.accMix));
    gl.uniform1f(uniforms.uSeed, this.seed);
    gl.uniform1f(uniforms.uHot, Math.min(0.0006, exposed * 0.00003) * (this.mode === "exposing" ? 1 : this.accMix));
    gl.uniform1f(uniforms.uBloom, 1);
    gl.uniform1f(uniforms.uLodBase, Math.max(0, Math.log2(this.accH / 640)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  snapshot() {
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    return new Promise((resolve) => {
      out.toBlob(
        (blob) => {
          if (!blob || this.destroyed) {
            resolve(null);
            return;
          }
          const url = URL.createObjectURL(blob);
          this.urls.add(url);
          const img = new Image();
          img.src = url;
          img.decode().then(
            () => resolve(url),
            () => resolve(url),
          );
        },
        "image/jpeg",
        0.92,
      );
    });
  }

  release(url) {
    if (!url || !this.urls.has(url)) return;
    URL.revokeObjectURL(url);
    this.urls.delete(url);
  }

  simulateShot(shot) {
    this.clearAcc(this.acc);
    this.shotLights = new Set();
    this.jolt(0.6);
    const dt = 1 / 60;
    const shakes = [];
    const every = Math.max(1, Math.ceil(shot.seconds / dt / MAX_TAPS));
    const torches = shot.strokes.map((st, i) => ({ ...st, torch: new Torch(), path: figurePath(st.figure, st.seconds, i * 2.1 + shot.seconds), live: false }));
    let step = 0;
    for (let t = 0; t < shot.seconds; t += dt, step += 1) {
      this.stepShake(dt, t);
      if (step % every === 0) shakes.push(this.shake.x, this.shake.y);
      for (const st of torches) {
        const local = t - st.from;
        if (local < 0 || local > st.seconds) {
          if (st.live) {
            this.collectStroke(st.torch, dt, t, st.light, true);
            st.live = false;
            st.done = true;
          }
          continue;
        }
        if (!st.live && !st.done) {
          const [x, y] = st.path(0);
          st.torch.reset(x, y);
          st.live = true;
        }
        for (let k = 1; k <= 2; k += 1) {
          const [x, y] = st.path(local - dt + (dt * k) / 2);
          st.torch.push(x, y);
        }
        this.collectStroke(st.torch, dt, t, st.light, false);
      }
    }
    this.clock = shot.seconds;
    this.drawScene(shot.seconds, shakes);
    this.drawSegments();
    this.mip();
  }

  async develop() {
    const shots = [];
    const reviewAt = SEED_SHOTS.length - 1;
    this.mode = "review";
    this.accMix = 1;
    for (let i = 0; i < SEED_SHOTS.length; i += 1) {
      const shot = SEED_SHOTS[i];
      this.seed = 3 + i * 7.31;
      this.lastSeconds = shot.seconds;
      this.simulateShot(shot);
      this.composite();
      shots.push({ seconds: shot.seconds, lights: shot.strokes.map((s) => s.light), pending: this.snapshot() });
    }
    this.lastSeconds = SEED_SHOTS[reviewAt].seconds;
    this.ready = true;
    this.composite();
    this.setReadout(this.lastSeconds);
    this.setMode("review");
    const urls = await Promise.all(shots.map((s) => s.pending));
    if (this.destroyed) return;
    this.onSeed?.(shots.map((s, i) => ({ id: `seed-${i}`, url: urls[i], seconds: s.seconds, lights: s.lights })).filter((s) => s.url));
    this.onReady?.();
  }

  setMode(mode) {
    this.mode = mode;
    this.onState?.(mode);
  }

  setReadout(seconds) {
    if (!this.time) return;
    const text = `${seconds.toFixed(1)}s`;
    if (this.time.textContent !== text) this.time.textContent = text;
  }

  localPoint(e) {
    const rect = this.frame.getBoundingClientRect();
    return [(e.clientX - rect.left) / Math.max(1, rect.width), (e.clientY - rect.top) / Math.max(1, rect.height)];
  }

  openShutter(x, y) {
    const gl = this.gl;
    if (!gl || !this.ready) return;
    const prevMix = this.mode === "exposing" ? 0 : this.accMix;
    const swap = this.ghost;
    this.ghost = this.acc;
    this.acc = swap;
    this.ghostMix = prevMix;
    this.clearAcc(this.acc);
    this.mip();
    this.torch.reset(x, y);
    this.exposure = 0;
    this.holdLeft = 0;
    this.accMix = 1;
    this.seed = Math.random() * 100;
    this.shotLights = new Set();
    this.jolt(1);
    this.setMode("exposing");
    this.setReadout(0);
    this.wake();
  }

  closeShutter() {
    if (this.mode !== "exposing") return;
    this.collectStroke(this.torch, 0, this.clock, this.light, true);
    this.drawSegments();
    this.mip();
    const seconds = this.exposure;
    this.lastSeconds = seconds;
    this.ghostMix = 0;
    this.setReadout(seconds);
    if (seconds < MIN_SECONDS) {
      this.setMode("returning");
      this.holdLeft = 0;
      this.wake();
      return;
    }
    this.seed = Math.random() * 100;
    this.setMode("review");
    this.composite();
    const pending = this.snapshot();
    const lights = [...this.shotLights];
    this.holdLeft = HOLD_SECONDS;
    if (this.blink && !this.reduced) {
      this.blink.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.35 },
          { opacity: 0, offset: 1 },
        ],
        { duration: 220, easing: "ease-out" },
      );
    }
    const id = `shot-${(this.shotId += 1)}`;
    pending.then((url) => {
      if (!url || this.destroyed) return;
      this.onDeveloped?.({ id, url, seconds, lights: lights.length ? lights : [this.light] });
    });
    this.wake();
  }

  pointerDown(e) {
    if (e.button > 0 || !this.gl || !this.ready) return;
    if (this.pointer || this.auto) return;
    this.frame.setPointerCapture?.(e.pointerId);
    const [x, y] = this.localPoint(e);
    this.pointer = { id: e.pointerId };
    this.frame.setAttribute("data-pressed", "");
    this.placeCursor(x, y);
    this.openShutter(x, y);
  }

  pointerMove(e) {
    const [x, y] = this.localPoint(e);
    if (e.pointerType === "mouse" || e.pointerType === "pen") this.placeCursor(x, y);
    if (!this.pointer || this.pointer.id !== e.pointerId || this.mode !== "exposing") return;
    const events = e.getCoalescedEvents?.() || [];
    for (const ev of events.length ? events : [e]) {
      const [cx, cy] = this.localPoint(ev);
      this.torch.push(cx, cy);
    }
    if (e.pointerType !== "mouse") this.placeCursor(x, y);
  }

  pointerUp(e) {
    if (!this.pointer || this.pointer.id !== e.pointerId) return;
    this.pointer = null;
    this.frame.removeAttribute("data-pressed");
    if (e.pointerType !== "mouse") this.hideCursor();
    this.closeShutter();
  }

  autoExpose() {
    if (!this.ready || this.pointer || this.auto) return;
    const figure = AUTO_FIGURES[this.shotId % AUTO_FIGURES.length];
    const path = figurePath(figure, AUTO_SECONDS, this.shotId * 1.3);
    const [x, y] = path(0);
    this.auto = { path, t: 0, lead: 0.5 };
    this.openShutter(x, y);
  }

  advanceAuto(dt) {
    const a = this.auto;
    if (!a) return;
    a.t += dt;
    const local = a.t - a.lead;
    if (local >= 0 && local <= AUTO_SECONDS) {
      for (let k = 1; k <= 4; k += 1) {
        const [x, y] = a.path(Math.max(0, local - dt + (dt * k) / 4));
        this.torch.push(x, y);
      }
    }
    if (a.t >= AUTO_SECONDS + a.lead * 2) {
      this.auto = null;
      this.closeShutter();
    }
  }

  placeCursor(x, y) {
    if (!this.cursor) return;
    this.cursor.style.transform = `translate3d(${(x * this.width).toFixed(1)}px, ${(y * this.height).toFixed(1)}px, 0)`;
    this.cursor.setAttribute("data-shown", "");
  }

  paintCursor() {
    this.cursor?.style.setProperty("--long-exposure-light", LIGHTS[this.light].swatch);
  }

  hideCursor() {
    this.cursor?.removeAttribute("data-shown");
  }

  wake() {
    if (this.raf || this.destroyed || !this.gl || !this.visible || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frameStep);
  }

  checkVisibility() {
    if (document.hidden || !this.visible) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.pointer && document.hidden) {
        this.pointer = null;
        this.frame.removeAttribute("data-pressed");
        this.closeShutter();
      }
      return;
    }
    this.wake();
  }

  frameStep(now) {
    this.raf = 0;
    if (this.destroyed || !this.ready) return;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    let busy = false;
    if (this.mode === "exposing") {
      this.advanceAuto(dt);
      if (this.mode === "exposing") {
        this.exposure += dt;
        this.clock += dt;
        this.stepShake(dt, this.clock);
        this.drawScene(dt, [this.shake.x, this.shake.y]);
        this.collectStroke(this.torch, dt, this.clock, this.light, false);
        this.drawSegments();
        this.mip();
        this.seed = (this.seed + 1.618) % 97;
        this.ghostMix = Math.max(0, this.ghostMix - dt / GHOST_SECONDS);
        this.setReadout(this.exposure);
        busy = true;
      }
    }
    if (this.mode === "review" && this.holdLeft > 0) {
      this.holdLeft = Math.max(0, this.holdLeft - dt);
      if (this.holdLeft === 0) this.setMode("returning");
      busy = true;
    }
    if (this.mode === "returning") {
      this.accMix = Math.max(0, this.accMix - dt / (this.reduced ? 0.2 : RETURN_SECONDS));
      if (this.accMix === 0) {
        this.setMode("live");
        this.setReadout(0);
      } else busy = true;
    }
    this.composite();
    if (busy) this.raf = requestAnimationFrame(this.frameStep);
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.canvas.removeEventListener("webglcontextlost", this.handlers.lost);
    this.frame.removeEventListener("pointerdown", this.handlers.down);
    this.frame.removeEventListener("pointermove", this.handlers.move);
    this.frame.removeEventListener("pointerup", this.handlers.up);
    this.frame.removeEventListener("pointercancel", this.handlers.up);
    this.frame.removeEventListener("pointerleave", this.handlers.leave);
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    const gl = this.gl;
    if (!gl) return;
    for (const target of [this.acc, this.ghost]) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    if (this.photo) gl.deleteTexture(this.photo);
    if (this.radiance) {
      gl.deleteFramebuffer(this.radiance.framebuffer);
      gl.deleteTexture(this.radiance.texture);
    }
    Object.values(this.programs).forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteBuffer(this.triBuffer);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.segBuffer);
    gl.deleteVertexArray(this.triVao);
    gl.deleteVertexArray(this.segVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
