import { PRESETS, SAND, gardenField, layoutGarden } from "./sandtableGarden";
import {
  BAKE_FRAGMENT,
  BOARD_FRAGMENT,
  CARVE_FRAGMENT,
  MAX_TINES,
  QUAD_VERTEX,
  RELAX_FRAGMENT,
  RENDER_FRAGMENT,
  RESAMPLE_FRAGMENT,
  STAT_FRAGMENT,
} from "./sandtableShader";

const MAX_DPR = 2;
const LIGHT = (() => {
  const x = -0.76;
  const y = -0.65;
  const l = Math.hypot(x, y);
  return [x / l, y / l];
})();
const ELEVATION = (17 * Math.PI) / 180;
const WALL_PX = 9;
const SWEEP_SECONDS = 1.55;
const RELAX_FRAMES = 80;
const STAT_EVERY = 0.22;

const TOOLS = {
  rake: { tines: 5, radius: 5.2, spacing: 14.5, depth: 4.4, half: 40, outer: 0, lower: 1.3 },
  finger: { tines: 1, radius: 8.5, spacing: 0, depth: 5.4, half: 0, outer: 0, lower: 0 },
};

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

function easeInOut(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export default class SandtableEngine {
  constructor({ box, host, canvas, insets, embedded, onReady, onFail, onStatus }) {
    this.box = box;
    this.host = host;
    this.canvas = canvas;
    this.insets = insets;
    this.embedded = embedded;
    this.onReady = onReady;
    this.onFail = onFail;
    this.onStatus = onStatus;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.preset = 0;
    this.nextPreset = 0;
    this.tool = "rake";
    this.touched = false;
    this.relaxLeft = 0;
    this.sweep = null;
    this.statClock = 0;
    this.statDirty = true;
    this.exposed = 0;
    this.covers = new Map();
    this.pointer = null;
    this.head = { x: 0, y: 0, tx: 0, ty: 0, dir: [1, 0], lift: 1, liftTarget: 1, alpha: 0, alphaTarget: 0, placed: false };
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      leave: (e) => {
        if (e.pointerType === "mouse" && !this.pointer) {
          this.head.alphaTarget = 0;
          this.wake();
        }
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
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) {
      this.onFail?.();
      return false;
    }
    this.gl = gl;
    try {
      this.programs = {
        carve: link(gl, CARVE_FRAGMENT),
        relax: link(gl, RELAX_FRAGMENT),
        board: link(gl, BOARD_FRAGMENT),
        resample: link(gl, RESAMPLE_FRAGMENT),
        bake: link(gl, BAKE_FRAGMENT),
        stat: link(gl, STAT_FRAGMENT),
        render: link(gl, RENDER_FRAGMENT),
      };
    } catch (error) {
      console.error(error);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.onFail?.();
      return false;
    }
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
    this.statTarget = this.makeTarget(32, 32, "rgba8", false);
    this.statPixels = new Uint8Array(32 * 32 * 4);

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
    this.intersection.observe(this.box);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.box);
    this.resize();
    this.loadCover(0).then((cover) => {
      if (this.destroyed || !this.gl) return;
      if (!cover) {
        this.onFail?.();
        return;
      }
      this.slotA = 0;
      this.slotB = 0;
      this.ready = true;
      this.statDirty = true;
      this.renderAll(true);
      this.onReady?.();
      this.wake();
      for (let i = 1; i < PRESETS.length; i += 1) this.loadCover(i);
    });
    return true;
  }

  makeTarget(width, height, format, nearest = true) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (format === "r32f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
    else if (format === "rgba16f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
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

  upload(target, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, target.width, target.height, gl.RED, gl.FLOAT, data);
  }

  loadCover(index) {
    if (this.covers.has(index)) return this.covers.get(index).promise;
    const entry = { texture: null, promise: null };
    const img = new Image();
    img.decoding = "async";
    img.src = PRESETS[index].cover;
    entry.promise = img
      .decode()
      .then(() => {
        if (this.destroyed || !this.gl) return null;
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
        entry.texture = texture;
        return texture;
      })
      .catch(() => null);
    this.covers.set(index, entry);
    return entry.promise;
  }

  layout() {
    const rect = this.box.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const inset = this.insets(width, height);
    const ow = Math.max(120, width - inset.left - inset.right);
    const oh = Math.max(120, height - inset.top - inset.bottom);
    const frame = Math.round(Math.min(30, Math.max(14, Math.min(ow, oh) * 0.04)));
    const outer = [inset.left, inset.top, ow, oh];
    const bed = [inset.left + frame, inset.top + frame, ow - frame * 2, oh - frame * 2];
    return { width, height, outer, bed, frame };
  }

  resize() {
    if (!this.gl) return;
    const { width, height, outer, bed, frame } = this.layout();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const sameBed = this.bed && Math.abs(this.bed[2] - bed[2]) < 1 && Math.abs(this.bed[3] - bed[3]) < 1;
    this.outer = outer;
    this.frameW = frame;
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    if (!sameBed) this.rebuildField(bed);
    this.bed = bed;
    this.garden = layoutGarden(bed[2], bed[3]);
    if (this.ready) this.renderAll(true);
  }

  rebuildField(bed) {
    const gl = this.gl;
    const long = Math.max(bed[2], bed[3]);
    const cellPx = Math.max(2, long / 620);
    const cellsX = Math.max(16, Math.round(bed[2] / cellPx));
    const cellsY = Math.max(16, Math.round(bed[3] / cellPx));
    const old = this.heights;
    const oldCells = this.cells;
    const oldCellPx = this.cellPx;
    const fresh = [this.makeTarget(cellsX, cellsY, "r32f"), this.makeTarget(cellsX, cellsY, "r32f")];
    this.cells = [cellsX, cellsY];
    this.cellPx = cellPx;
    this.cellPxXY = [bed[2] / cellsX, bed[3] / cellsY];
    if (old && this.touched) {
      const { program, uniforms } = this.programs.resample;
      gl.useProgram(program);
      gl.bindVertexArray(this.triVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fresh[0].framebuffer);
      gl.viewport(0, 0, cellsX, cellsY);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, old[this.read].texture);
      gl.uniform1i(uniforms.uHeight, 0);
      gl.uniform2f(uniforms.uCells, oldCells[0], oldCells[1]);
      gl.uniform2f(uniforms.uDst, cellsX, cellsY);
      gl.uniform1f(uniforms.uScale, oldCellPx / cellPx);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      this.upload(fresh[0], gardenField(cellsX, cellsY, cellPx, bed[2], bed[3]));
    }
    if (old) old.forEach((t) => this.dropTarget(t));
    this.heights = fresh;
    this.read = 0;
    this.dropTarget(this.bakeTarget);
    this.bakeTarget = this.makeTarget(cellsX, cellsY, "rgba16f", false);
    this.dropTarget(this.targetField);
    this.targetField = this.makeTarget(cellsX, cellsY, "r32f");
    if (this.sweep) this.sweep.cellsChanged = true;
    this.relax(this.touched ? 4 : 24);
    this.statDirty = true;
  }

  bindHeight(uniforms) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heights[this.read].texture);
    gl.uniform1i(uniforms.uHeight, 0);
    gl.uniform2f(uniforms.uCells, this.cells[0], this.cells[1]);
  }

  pass(name, setup) {
    const gl = this.gl;
    const { program, uniforms } = this.programs[name];
    const write = this.heights[1 - this.read];
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, write.width, write.height);
    this.bindHeight(uniforms);
    setup(uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.read = 1 - this.read;
  }

  relax(iterations) {
    const gl = this.gl;
    for (let i = 0; i < iterations; i += 1) {
      this.pass("relax", (u) => {
        gl.uniform1f(u.uTalus, SAND.talus);
        gl.uniform1f(u.uRate, 0.11);
      });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  carve(ax, ay, bx, by, na, nb, depthScale) {
    const gl = this.gl;
    const tool = TOOLS[this.tool];
    const c = this.cellPx;
    const scale = this.toolScale();
    const radius = (tool.radius * scale) / c;
    const spacing = (tool.spacing * scale) / c;
    const reach = (tool.tines - 1) * 0.5 * spacing + Math.max(spacing * 0.5, radius * 1.3) + radius * 3.8 + 2;
    this.pass("carve", (u) => {
      gl.uniform2f(u.uA, ax / c, ay / c);
      gl.uniform2f(u.uB, bx / c, by / c);
      gl.uniform2f(u.uNA, na[0], na[1]);
      gl.uniform2f(u.uNB, nb[0], nb[1]);
      gl.uniform1i(u.uTines, Math.min(MAX_TINES, tool.tines));
      gl.uniform1f(u.uSpacing, spacing);
      gl.uniform1f(u.uRadius, radius);
      gl.uniform1f(u.uDepth, (tool.depth * scale * depthScale) / c);
      gl.uniform1f(u.uReach, reach);
      gl.uniform1f(u.uOuterShare, tool.outer);
      gl.uniform1f(u.uLower, (tool.lower * scale * depthScale) / c);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.touched = true;
    this.relaxLeft = RELAX_FRAMES;
    this.statDirty = true;
  }

  toolScale() {
    const short = Math.min(this.bed?.[2] || 600, this.bed?.[3] || 600);
    return Math.min(1.15, Math.max(0.78, short / 560));
  }

  boardStep() {
    const s = this.sweep;
    const gl = this.gl;
    if (s.cellsChanged) {
      this.upload(this.targetField, s.makeField());
      s.cellsChanged = false;
    }
    const frontCells = (s.front * this.cells[0]) / this.bed[2];
    this.pass("board", (u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.targetField.texture);
      gl.uniform1i(u.uTarget, 1);
      gl.uniform1f(u.uFront, frontCells);
      gl.uniform1f(u.uBand, 22 / this.cellPx);
      gl.uniform1f(u.uBulge, 3.4 / this.cellPx);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.relaxLeft = RELAX_FRAMES;
    this.statDirty = true;
  }

  bake() {
    const gl = this.gl;
    const { program, uniforms } = this.programs.bake;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeTarget.framebuffer);
    gl.viewport(0, 0, this.cells[0], this.cells[1]);
    this.bindHeight(uniforms);
    gl.uniform2f(uniforms.uLight, LIGHT[0], LIGHT[1]);
    gl.uniform1f(uniforms.uTanE, Math.tan(ELEVATION));
    gl.uniform1f(uniforms.uWall, (SAND.depthPx + WALL_PX) / this.cellPx);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  measure() {
    const gl = this.gl;
    const { program, uniforms } = this.programs.stat;
    const [tx, ty, tw, th] = this.garden.tile;
    const c = this.cellPx;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statTarget.framebuffer);
    gl.viewport(0, 0, 32, 32);
    this.bindHeight(uniforms);
    gl.uniform4f(uniforms.uTile, tx / c, ty / c, tw / c, th / c);
    gl.uniform1f(uniforms.uLimit, 0.9 / c);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, this.statPixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let sum = 0;
    for (let i = 0; i < 1024; i += 1) sum += this.statPixels[i * 4];
    const exposed = sum / (1024 * 255);
    this.exposed = exposed;
    this.statDirty = false;
    this.onStatus?.(Math.round(exposed * 100));
  }

  presetUniforms(u, suffix, index, unit) {
    const gl = this.gl;
    const preset = PRESETS[index];
    const cover = this.covers.get(index)?.texture || this.covers.get(this.slotA)?.texture;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, cover);
    gl.uniform1i(u[`uCover${suffix}`], unit);
    gl.uniform4fv(u[`uCrop${suffix}`], preset.crop);
    gl.uniform3fv(u[`uSand${suffix}`], preset.sand);
    gl.uniform3fv(u[`uDeep${suffix}`], preset.sandDeep);
  }

  draw() {
    const gl = this.gl;
    const { program, uniforms: u } = this.programs.render;
    gl.useProgram(program);
    gl.bindVertexArray(this.triVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bakeTarget.texture);
    gl.uniform1i(u.uBake, 0);
    this.presetUniforms(u, "A", this.slotA, 1);
    this.presetUniforms(u, "B", this.slotB, 2);
    gl.uniform2f(u.uBox, this.width, this.height);
    gl.uniform1f(u.uDpr, this.canvas.width / this.width);
    gl.uniform4fv(u.uOuter, this.outer);
    gl.uniform4fv(u.uBed, this.bed);
    gl.uniform2f(u.uCellPx, this.cellPxXY[0], this.cellPxXY[1]);
    gl.uniform2f(u.uCells, this.cells[0], this.cells[1]);
    gl.uniform4fv(u.uTile, this.garden.tile);
    gl.uniform1f(u.uFront, this.sweep ? this.sweep.front : -1e5);
    gl.uniform1f(u.uBoardOn, this.sweep ? 1 : 0);
    gl.uniform2f(u.uLight, LIGHT[0], LIGHT[1]);
    gl.uniform1f(u.uSinE, Math.sin(ELEVATION));
    gl.uniform1f(u.uCosE, Math.cos(ELEVATION));
    const h = this.head;
    const tool = TOOLS[this.tool];
    const scale = this.toolScale();
    gl.uniform2f(u.uHead, this.bed[0] + h.x, this.bed[1] + h.y);
    gl.uniform2f(u.uHeadDir, h.dir[0], h.dir[1]);
    gl.uniform1f(u.uHeadLift, h.lift);
    gl.uniform1f(u.uHeadAlpha, h.alpha);
    gl.uniform1f(u.uHeadHalf, ((tool.tines - 1) * 0.5 * tool.spacing + tool.radius + 6) * scale);
    gl.uniform1f(u.uHeadR, tool.radius * scale);
    gl.uniform1f(u.uTineGap, tool.spacing * scale);
    gl.uniform1f(u.uTineCount, tool.tines);
    gl.uniform1f(u.uTool, this.tool === "rake" ? 0 : 1);
    gl.uniform1f(u.uRelief, 1.05);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderAll(rebake) {
    if (!this.ready || !this.gl) return;
    if (rebake) this.bake();
    this.draw();
  }

  setTool(name) {
    if (!TOOLS[name]) return;
    this.tool = name;
    this.renderAll(false);
  }

  smooth() {
    if (!this.ready) return;
    this.startSweep(this.slotB, "flat");
  }

  select(index) {
    if (!this.ready || index < 0 || index >= PRESETS.length) return;
    this.loadCover(index).then((tex) => {
      if (this.destroyed || !tex) return;
      this.startSweep(index, "garden");
    });
  }

  startSweep(index, mode) {
    if (this.sweep) this.finishSweep();
    const bed = this.bed;
    const makeField = () => gardenField(this.cells[0], this.cells[1], this.cellPx, this.bed[2], this.bed[3], mode);
    this.upload(this.targetField, makeField());
    this.slotB = index;
    this.sweep = { t: 0, front: -40, from: -40, to: bed[2] + 48, makeField, mode, cellsChanged: false };
    if (this.reduced) {
      this.sweep.front = bed[2] + 100;
      this.boardStep();
      this.finishSweep();
      this.relax(6);
      this.renderAll(true);
      return;
    }
    this.wake();
  }

  finishSweep() {
    if (!this.sweep) return;
    this.sweep.front = this.bed[2] + 100;
    this.boardStep();
    this.slotA = this.slotB;
    this.touched = this.sweep.mode !== "garden";
    this.sweep = null;
  }

  localPoint(e) {
    const rect = this.box.getBoundingClientRect();
    return [e.clientX - rect.left - this.bed[0], e.clientY - rect.top - this.bed[1]];
  }

  pointerDown(e) {
    if (e.button > 0 || !this.ready) return;
    if (e.target.closest?.("button, input, label, a")) return;
    this.host.setPointerCapture?.(e.pointerId);
    const [x, y] = this.localPoint(e);
    const h = this.head;
    h.tx = x;
    h.ty = y;
    h.x = x;
    h.y = y;
    h.placed = true;
    h.alphaTarget = 1;
    h.liftTarget = 0;
    this.pointer = { id: e.pointerId, type: e.pointerType, cx: h.x, cy: h.y, travel: 0, aimed: false, speed: 0, released: false, dirN: [-h.dir[1], h.dir[0]] };
    this.box.setAttribute("data-raking", "");
    this.wake();
  }

  pointerMove(e) {
    if (!this.ready) return;
    const p = this.pointer;
    if (p && p.id !== e.pointerId) return;
    if (!p && e.pointerType !== "mouse") return;
    const [x, y] = this.localPoint(e);
    const h = this.head;
    h.tx = x;
    h.ty = y;
    if (!p) {
      if (!h.placed || h.alpha < 0.02) {
        h.x = x;
        h.y = y;
        h.placed = true;
      }
      h.alphaTarget = 1;
      h.liftTarget = 1;
    }
    this.wake();
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.released = true;
    this.box.removeAttribute("data-raking");
    this.wake();
  }

  stepHead(dt) {
    const h = this.head;
    const follow = 1 - Math.exp(-dt / 0.022);
    const px = h.x;
    const py = h.y;
    h.x += (h.tx - h.x) * follow;
    h.y += (h.ty - h.y) * follow;
    const dx = h.x - px;
    const dy = h.y - py;
    const len = Math.hypot(dx, dy);
    const p = this.pointer;
    if (len > 0.25) {
      const speed = len / Math.max(dt, 1 / 240);
      const turn = p && !p.aimed ? 1 : 1 - Math.exp(-dt / (p ? 0.07 : 0.12));
      const k = turn * smoothstep(0.25, 2.5, len);
      let nx = h.dir[0] + (dx / len - h.dir[0]) * k;
      let ny = h.dir[1] + (dy / len - h.dir[1]) * k;
      const nl = Math.hypot(nx, ny);
      if (nl > 1e-4) {
        nx /= nl;
        ny /= nl;
        h.dir = [nx, ny];
      }
      if (p) {
        p.speed += (Math.min(speed, 5000) - p.speed) * (1 - Math.exp(-dt / 0.06));
        p.travel += len;
        if (!p.aimed && p.travel > 3) {
          p.aimed = true;
          p.cx = px;
          p.cy = py;
          p.dirN = [-h.dir[1], h.dir[0]];
        }
      }
    } else if (p) {
      p.speed *= Math.exp(-dt / 0.06);
    }
    const lf = 1 - Math.exp(-dt / 0.09);
    h.lift += (h.liftTarget - h.lift) * lf;
    const af = 1 - Math.exp(-dt / 0.14);
    h.alpha += (h.alphaTarget - h.alpha) * af;
    if (Math.abs(h.alpha - h.alphaTarget) < 0.004) h.alpha = h.alphaTarget;
    if (Math.abs(h.lift - h.liftTarget) < 0.004) h.lift = h.liftTarget;
    return len > 0.05 || h.alpha !== h.alphaTarget || h.lift !== h.liftTarget || Math.hypot(h.tx - h.x, h.ty - h.y) > 0.1;
  }

  stepPointer() {
    const p = this.pointer;
    const h = this.head;
    if (!p) return false;
    if (p.aimed) {
      const len = Math.hypot(h.x - p.cx, h.y - p.cy);
      if (len >= this.cellPx * 0.7) {
        const nb = [-h.dir[1], h.dir[0]];
        const depthScale = 1 - 0.32 * smoothstep(700, 2800, p.speed);
        this.carve(p.cx, p.cy, h.x, h.y, p.dirN, nb, depthScale);
        p.cx = h.x;
        p.cy = h.y;
        p.dirN = nb;
      }
    }
    if (p.released) {
      this.pointer = null;
      h.liftTarget = 1;
      h.alphaTarget = p.type === "mouse" ? 1 : 0;
    }
    return true;
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
    let changed = false;
    if (this.sweep) {
      const s = this.sweep;
      s.t = Math.min(1, s.t + dt / SWEEP_SECONDS);
      s.front = s.from + (s.to - s.from) * easeInOut(s.t);
      this.boardStep();
      changed = true;
      if (s.t >= 1) this.finishSweep();
    }
    const headMoving = this.stepHead(dt);
    const touching = this.stepPointer();
    if (this.relaxLeft > 0) {
      this.relax(Math.min(8, Math.max(2, Math.round(dt * 300))));
      this.relaxLeft -= 1;
      changed = true;
    }
    if (changed) this.bake();
    this.statClock += dt;
    if (this.statDirty && this.statClock >= STAT_EVERY) {
      this.statClock = 0;
      this.measure();
    }
    this.draw();
    const busy = Boolean(this.sweep) || touching || headMoving || this.relaxLeft > 0 || this.statDirty;
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
    this.heights?.forEach((t) => this.dropTarget(t));
    this.dropTarget(this.bakeTarget);
    this.dropTarget(this.targetField);
    this.dropTarget(this.statTarget);
    for (const entry of this.covers.values()) if (entry.texture) gl.deleteTexture(entry.texture);
    Object.values(this.programs || {}).forEach(({ program }) => gl.deleteProgram(program));
    gl.deleteBuffer(this.triBuffer);
    gl.deleteVertexArray(this.triVao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
