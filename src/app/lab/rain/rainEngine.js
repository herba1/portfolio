import RainSim, { MAX_DROPS } from "./rainSim";
import { BLUR_FRAGMENT, COMPOSITE_FRAGMENT, COPY_FRAGMENT, DROP_FRAGMENT, DROP_VERTEX, FIELD_EDGE, MASK_FRAGMENT, MAX_SEGMENTS, QUAD_VERTEX } from "./rainShader";
import { RAIN_DEFAULT, SCENES } from "./rainScenes";

const MAX_DPR = 2;
const REFOG_SECONDS = 15;
const FADE_SECONDS = 0.9;
const WARM_SECONDS = 16;
const GHOST_AT = 13.2;
const BLUR_WIDTH = 320;
const AUTO_SECONDS = 1.1;

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

function link(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.bindAttribLocation(program, 1, "aDrop");
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

function ghostPath(width, height) {
  const points = [];
  for (let i = 0; i <= 14; i += 1) {
    const t = i / 14;
    const x = width * (0.16 + 0.62 * t);
    const y = height * (0.66 - 0.2 * t - 0.1 * Math.sin(t * Math.PI));
    points.push([x, y]);
  }
  return points;
}

function autoPoint(width, height, t) {
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const x = width * (0.2 + 0.6 * e);
  const y = height * (0.6 - 0.16 * e - 0.12 * Math.sin(e * Math.PI));
  return [x, y];
}

export default class RainEngine {
  constructor({ host, canvas, cursor, onReady, onFail }) {
    this.host = host;
    this.canvas = canvas;
    this.cursor = cursor;
    this.onReady = onReady;
    this.onFail = onFail;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sim = new RainSim(11);
    this.sim.rate = RAIN_DEFAULT;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.warmed = false;
    this.ready = false;
    this.current = null;
    this.previous = null;
    this.fade = 1;
    this.loadToken = 0;
    this.decayDebt = 0;
    this.refogLeft = 0;
    this.pointer = null;
    this.auto = null;
    this.segData = new Float32Array(MAX_SEGMENTS * 4);
    this.segProps = new Float32Array(MAX_SEGMENTS * 4);
    this.segCount = 0;
    this.strokeSeed = 0;
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
    } catch {
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
      copy: link(gl, QUAD_VERTEX, COPY_FRAGMENT),
      blur: link(gl, QUAD_VERTEX, BLUR_FRAGMENT),
      drop: link(gl, DROP_VERTEX, DROP_FRAGMENT),
      mask: link(gl, QUAD_VERTEX, MASK_FRAGMENT),
      composite: link(gl, QUAD_VERTEX, COMPOSITE_FRAGMENT),
    };
    this.store = this.float ? [1, 1] : [0.25, 1 / 48];
    this.triBuffer = gl.createBuffer();
    this.triVao = gl.createVertexArray();
    gl.bindVertexArray(this.triVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quadBuffer = gl.createBuffer();
    this.dropBuffer = gl.createBuffer();
    this.dropVao = gl.createVertexArray();
    gl.bindVertexArray(this.dropVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dropBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_DROPS * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  makeTarget(width, height, format) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (format === "rg16f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, width, height, 0, gl.RG, gl.HALF_FLOAT, null);
    else if (format === "rgba16f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
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
    this.sim.resize(width, height);
    this.dropTarget(this.heightTarget);
    this.heightTarget = this.makeTarget(this.canvas.width, this.canvas.height, this.float ? "rg16f" : "rgba8");
    const oldMask = this.masks ? this.masks[this.maskRead] : null;
    const maskFormat = this.float ? "rgba16f" : "rgba8";
    const mw = Math.max(8, Math.ceil(width / 2));
    const mh = Math.max(8, Math.ceil(height / 2));
    const fresh = [this.makeTarget(mw, mh, maskFormat), this.makeTarget(mw, mh, maskFormat)];
    if (oldMask) {
      this.runMask(oldMask, fresh[0], 0, 0);
      this.masks.forEach((t) => this.dropTarget(t));
    }
    this.masks = fresh;
    this.maskRead = 0;
    for (const slot of [this.current, this.previous]) if (slot) this.mapSlot(slot);
    if (this.ready) this.render();
    this.wake();
  }

  setScene(id) {
    const scene = SCENES.find((s) => s.id === id) || SCENES[0];
    const token = ++this.loadToken;
    if (this.current && this.current.scene === scene) return;
    this.loadImage(scene)
      .then((img) => {
        if (this.destroyed || token !== this.loadToken || !this.gl) return;
        const slot = this.buildSlot(scene, img);
        if (this.previous && this.fade < 0.5) {
          this.freeSlot(this.current);
        } else {
          if (this.previous) this.freeSlot(this.previous);
          this.previous = this.current;
        }
        this.current = slot;
        this.fade = this.previous && !this.reduced ? 0 : 1;
        if (!this.warmed) {
          this.warmUp();
          window.setTimeout(() => !this.destroyed && this.preload(), 600);
        }
        this.ready = true;
        this.render();
        this.onReady?.();
        this.wake();
      })
      .catch(() => {
        if (!this.ready) this.onFail?.();
      });
  }

  loadImage(scene) {
    if (!this.images) this.images = new Map();
    if (!this.images.has(scene.id)) {
      this.images.set(
        scene.id,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => img.decode().catch(() => {}).then(() => resolve(img));
          img.onerror = () => {
            this.images.delete(scene.id);
            reject(new Error("image failed"));
          };
          img.src = scene.src;
        }),
      );
    }
    return this.images.get(scene.id);
  }

  preload() {
    for (const scene of SCENES) this.loadImage(scene).catch(() => {});
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
    const cropW = (img.naturalWidth || img.width) * cw;
    const cropH = (img.naturalHeight || img.height) * ch;
    const bw = BLUR_WIDTH;
    const bh = Math.max(8, Math.round((BLUR_WIDTH * cropH) / cropW));
    const a = this.makeTarget(bw, bh, "rgba8");
    const b = this.makeTarget(bw, bh, "rgba8");
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
    gl.uniform1f(copy.uniforms.uLod, Math.max(0, Math.log2(cropW / bw)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const blur = this.programs.blur;
    gl.useProgram(blur.program);
    gl.uniform1i(blur.uniforms.uSource, 0);
    gl.uniform2f(blur.uniforms.uRes, bw, bh);
    for (const spread of [1, 1.7]) {
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

  setRain(value) {
    this.sim.rate = Math.min(1, Math.max(0, value));
    this.wake();
  }

  wipeRadius() {
    return Math.min(46, Math.max(24, Math.min(this.width, this.height) * 0.045));
  }

  pushSegment(x0, y0, x1, y1, radius, strength, wipeness) {
    if (this.segCount >= MAX_SEGMENTS) return;
    const i = this.segCount * 4;
    this.segData[i] = x0;
    this.segData[i + 1] = y0;
    this.segData[i + 2] = x1;
    this.segData[i + 3] = y1;
    this.segProps[i] = radius;
    this.segProps[i + 1] = strength;
    this.segProps[i + 2] = wipeness;
    this.segProps[i + 3] = this.strokeSeed;
    this.segCount += 1;
  }

  pushTrails(list) {
    const room = MAX_SEGMENTS - this.segCount;
    if (room <= 0) return;
    const chosen = list.length > room ? [...list].sort((a, b) => b[4] - a[4]).slice(0, room) : list;
    for (const t of chosen) this.pushSegment(t[0], t[1], t[2], t[3], t[4] * 0.95, 0.74, 0);
  }

  runMask(read, write, decay, count) {
    const gl = this.gl;
    const { program, uniforms } = this.programs.mask;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, write.width, write.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(uniforms.uPrev, 0);
    gl.uniform2f(uniforms.uRes, write.width, write.height);
    gl.uniform2f(uniforms.uBox, this.width, this.height);
    gl.uniform1f(uniforms.uDecay, decay);
    gl.uniform1i(uniforms.uCount, count);
    if (count > 0) {
      gl.uniform4fv(uniforms.uSeg, this.segData);
      gl.uniform4fv(uniforms.uSegP, this.segProps);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  stepMask(decaySeconds) {
    this.decayDebt += decaySeconds / REFOG_SECONDS;
    const minStep = this.float ? 0 : 1.5 / 255;
    let decay = 0;
    if (this.decayDebt > minStep) {
      decay = this.decayDebt;
      this.decayDebt = 0;
    }
    if (!this.segCount && decay === 0) return;
    const read = this.masks[this.maskRead];
    const write = this.masks[1 - this.maskRead];
    this.runMask(read, write, decay, this.segCount);
    this.maskRead = 1 - this.maskRead;
    this.segCount = 0;
  }

  warmUp() {
    this.warmed = true;
    const sim = this.sim;
    const dt = 1 / 30;
    const chunk = 8;
    const ghost = ghostPath(this.width, this.height);
    let ghostDone = false;
    let t = 0;
    const starts = new Map();
    for (let i = 0; t < WARM_SECONDS; i += 1) {
      sim.step(dt, true);
      t += dt;
      for (const d of sim.trails) if (!starts.has(d)) starts.set(d, [d.px, d.py]);
      if (!ghostDone && t >= GHOST_AT) {
        ghostDone = true;
        this.strokeSeed = 2.7;
        const radius = this.wipeRadius();
        for (let k = 1; k < ghost.length; k += 1) {
          const [x0, y0] = ghost[k - 1];
          const [x1, y1] = ghost[k];
          sim.wipe(x0, y0, x1, y1, radius);
          this.pushSegment(x0, y0, x1, y1, radius, 1, 1);
        }
      }
      if ((i + 1) % chunk === 0) {
        const list = [];
        for (const [d, s] of starts) if (!d.dead) list.push([s[0], s[1], d.x, d.y, d.r]);
        this.pushTrails(list);
        starts.clear();
        this.decayDebt = 0;
        this.stepMask(dt * chunk);
      }
    }
    this.decayDebt = 0;
  }

  localPoint(e) {
    const rect = this.host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  pointerDown(e) {
    if (e.button > 0 || !this.gl) return;
    if (e.target.closest?.("button, input, label, a")) return;
    this.host.setPointerCapture?.(e.pointerId);
    const [x, y] = this.localPoint(e);
    if (this.pointer) this.stepPointer(1 / 60, false);
    this.pointer = null;
    this.auto = null;
    this.strokeSeed = (this.strokeSeed + 1.618) % 31;
    this.pointer = { id: e.pointerId, x, y, lx: x, ly: y, points: [], speed: 0, fresh: true };
    this.host.setAttribute("data-pressed", "");
    this.placeCursor(x, y);
    this.wake();
  }

  pointerMove(e) {
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      const [x, y] = this.localPoint(e);
      if (!this.pointer) this.placeCursor(x, y);
    }
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    const events = e.getCoalescedEvents?.() || [];
    const rect = this.host.getBoundingClientRect();
    for (const ev of events.length ? events : [e]) {
      p.points.push([ev.clientX - rect.left, ev.clientY - rect.top]);
      if (p.points.length > 256) p.points.shift();
    }
    this.wake();
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.released = true;
    this.host.removeAttribute("data-pressed");
    if (e.pointerType !== "mouse") this.hideCursor();
    this.wake();
  }

  wipeNow() {
    if (!this.ready) return;
    if (this.pointer) this.stepPointer(1 / 60, false);
    this.strokeSeed = (this.strokeSeed + 1.618) % 31;
    const [x, y] = autoPoint(this.width, this.height, 0);
    this.auto = { t: 0 };
    this.pointer = { id: -1, x, y, lx: x, ly: y, points: [], speed: 0, fresh: true, synthetic: true };
    this.wake();
  }

  placeCursor(x, y) {
    if (!this.cursor) return;
    const fast = this.pointer ? smoothstep(400, 2400, this.pointer.speed) : 0;
    const r = this.wipeRadius() * (1 - 0.2 * fast);
    this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(r / 32).toFixed(3)})`;
    this.cursor.setAttribute("data-shown", "");
  }

  hideCursor() {
    this.cursor?.removeAttribute("data-shown");
  }

  advanceAuto(dt) {
    const a = this.auto;
    const p = this.pointer;
    if (!a || !p) return;
    a.t = Math.min(1, a.t + dt / AUTO_SECONDS);
    const steps = 4;
    for (let i = 1; i <= steps; i += 1) {
      const tt = Math.max(0, a.t - (dt / AUTO_SECONDS) * (1 - i / steps));
      p.points.push(autoPoint(this.width, this.height, tt));
    }
    if (a.t >= 1) {
      p.released = true;
      this.auto = null;
    }
  }

  stepPointer(dt, measure = true) {
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
    if (measure) {
      const raw = length / Math.max(dt, 1 / 240);
      p.speed += (Math.min(raw, 4000) - p.speed) * (1 - Math.exp(-dt / 0.05));
    }
    const fast = smoothstep(400, 2400, p.speed);
    const radius = this.wipeRadius() * (1 - 0.2 * fast);
    const strength = 1 - 0.12 * fast;
    if (p.fresh) {
      this.pushSegment(p.lx, p.ly, p.lx + 0.01, p.ly, radius, strength, 1);
      this.sim.wipe(p.lx, p.ly, p.lx + 0.01, p.ly, radius);
      p.fresh = false;
    }
    if (length > 0.5) {
      const pieces = Math.min(12, Math.max(1, Math.ceil(length / (radius * 0.6))));
      const stride = path.length / pieces;
      let ax = p.lx;
      let ay = p.ly;
      for (let k = 1; k <= pieces; k += 1) {
        const [bx, by] = path[Math.max(0, Math.min(path.length - 1, Math.round(stride * k) - 1))];
        this.pushSegment(ax, ay, bx, by, radius, strength, 1);
        this.sim.wipe(ax, ay, bx, by, radius);
        ax = bx;
        ay = by;
      }
      p.lx = ax;
      p.ly = ay;
      p.x = ax;
      p.y = ay;
    }
    path.length = 0;
    if (!p.synthetic || this.cursor?.hasAttribute("data-shown")) this.placeCursor(p.x, p.y);
    this.refogLeft = REFOG_SECONDS * 1.4;
    if (p.released) {
      this.pointer = null;
      if (p.synthetic) this.hideCursor();
    }
    return true;
  }

  drawDrops() {
    const gl = this.gl;
    const count = this.sim.pack();
    const target = this.heightTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count > 0) {
      const { program, uniforms } = this.programs.drop;
      gl.useProgram(program);
      gl.bindVertexArray(this.dropVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dropBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sim.data, 0, count * 4);
      gl.uniform2f(uniforms.uBox, this.width, this.height);
      gl.uniform2f(uniforms.uStore, this.store[0], this.store[1]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    gl.uniform4fv(uniforms[`uFog${suffix}`], s.fog);
    gl.uniform1f(uniforms[`uLod${suffix}`], slot.lod);
  }

  composite() {
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
    gl.bindTexture(gl.TEXTURE_2D, this.heightTarget.texture);
    gl.uniform1i(uniforms.uHeight, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.masks[this.maskRead].texture);
    gl.uniform1i(uniforms.uMask, 5);
    gl.uniform1f(uniforms.uMix, mix);
    gl.uniform2f(uniforms.uBox, this.width, this.height);
    gl.uniform1f(uniforms.uDpr, this.canvas.width / this.width);
    gl.uniform2f(uniforms.uStore, this.store[0], this.store[1]);
    gl.uniform1f(uniforms.uFogAmount, prev.scene.fogAmount + (cur.scene.fogAmount - prev.scene.fogAmount) * mix);
    gl.uniform1f(uniforms.uEdge, FIELD_EDGE);
    gl.uniform1f(uniforms.uMag, 3.1);
    gl.uniform1f(uniforms.uMagBase, 28);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  render() {
    if (!this.current) return;
    this.drawDrops();
    this.composite();
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
    if (this.destroyed || !this.current) return;
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    if (dt <= 0) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const ambient = !this.reduced;
    this.advanceAuto(dt);
    const touching = this.stepPointer(dt);
    this.sim.step(dt, ambient);
    const trails = [];
    for (const d of this.sim.trails) trails.push([d.px, d.py, d.x, d.y, d.r]);
    this.pushTrails(trails);
    this.refogLeft = Math.max(0, this.refogLeft - dt);
    this.stepMask(dt);
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / FADE_SECONDS);
    else if (this.previous) {
      this.freeSlot(this.previous);
      this.previous = null;
    }
    this.render();
    const busy = ambient || touching || Boolean(this.pointer) || this.fade < 1 || this.refogLeft > 0;
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
    const gl = this.gl;
    if (!gl) return;
    this.freeSlot(this.current);
    this.freeSlot(this.previous);
    this.dropTarget(this.heightTarget);
    this.masks?.forEach((t) => this.dropTarget(t));
    Object.values(this.programs).forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteBuffer(this.triBuffer);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.dropBuffer);
    gl.deleteVertexArray(this.triVao);
    gl.deleteVertexArray(this.dropVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
