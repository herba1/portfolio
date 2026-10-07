import {
  DISPLAY_FRAGMENT,
  FIBRE_FRAGMENT,
  LIFT_FRAGMENT,
  MAX_STAMPS,
  OFFPRINT_FRAGMENT,
  QUAD_VERTEX,
  REDUCE_FRAGMENT,
  STAMP_FRAGMENT,
  STEP_FRAGMENT,
  TINT_FRAGMENT,
} from "./wetInkShader";

const FLOAT_RANGE = [1, 1, 1, 1];
const PACKED_RANGE = [2, 3.2, 4, 2];
const NO_LIFT = [1, 1, 1, 1];
const PROBE_CELL = 8;

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

function link(gl, vertexShader, fragmentSource) {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
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
    const name = info.name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

export default class InkSim {
  static create(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return null;
    try {
      return new InkSim(canvas, gl);
    } catch {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    }
  }

  constructor(canvas, gl) {
    this.kind = "webgl";
    this.canvas = canvas;
    this.gl = gl;
    this.simWidth = 0;
    this.simHeight = 0;
    this.probesWater = true;
    this.targets = null;
    this.tints = null;
    this.tintRead = 0;
    this.fibre = null;
    this.offprintTarget = null;
    this.reduceTarget = null;
    this.probeBuffer = null;
    this.probePixels = null;
    this.probeFence = null;
    this.probeWidth = 0;
    this.probeHeight = 0;
    this.read = 0;
    this.seedClock = 0;
    this.segments = new Float32Array(MAX_STAMPS * 4);
    this.nibs = new Float32Array(MAX_STAMPS * 4);
    this.vertex = compile(gl, gl.VERTEX_SHADER, QUAD_VERTEX);
    this.programs = {
      stamp: link(gl, this.vertex, STAMP_FRAGMENT),
      step: link(gl, this.vertex, STEP_FRAGMENT),
      lift: link(gl, this.vertex, LIFT_FRAGMENT),
      display: link(gl, this.vertex, DISPLAY_FRAGMENT),
      offprint: link(gl, this.vertex, OFFPRINT_FRAGMENT),
      tint: link(gl, this.vertex, TINT_FRAGMENT),
      reduce: link(gl, this.vertex, REDUCE_FRAGMENT),
      fibre: link(gl, this.vertex, FIBRE_FRAGMENT),
    };
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.format = this.probeFormat();
    this.range = this.format.packed ? PACKED_RANGE : FLOAT_RANGE;
    this.quantise = this.format.packed ? 1 : 0;
    this.half = this.format.half ? 1 : 0;
  }

  probeFormat() {
    const gl = this.gl;
    const full = gl.getExtension("EXT_color_buffer_float");
    const half = full || gl.getExtension("EXT_color_buffer_half_float");
    const fullLinear = gl.getExtension("OES_texture_float_linear");
    if (full && fullLinear && this.renderable(gl.RGBA32F, gl.FLOAT)) return { internal: gl.RGBA32F, type: gl.FLOAT, packed: false, half: false };
    if (half && this.renderable(gl.RGBA16F, gl.HALF_FLOAT)) return { internal: gl.RGBA16F, type: gl.HALF_FLOAT, packed: false, half: true };
    return { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, packed: true, half: false };
  }

  renderable(internal, type) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return complete;
  }

  makeTexture(width, height, packed) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (packed) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, this.format.internal, width, height, 0, gl.RGBA, this.format.type, null);
    return texture;
  }

  makeTarget(width, height, packed) {
    const gl = this.gl;
    const texture = this.makeTexture(width, height, packed);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer };
  }

  dropTarget(target) {
    if (!target) return;
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  resize(width, height) {
    if (width === this.simWidth && height === this.simHeight) return;
    const gl = this.gl;
    const packed = this.format.packed;
    const previous = this.targets;
    const previousRead = previous ? previous[this.read] : null;
    const previousTints = this.tints;
    const previousWidth = this.simWidth;
    const previousHeight = this.simHeight;
    const next = [this.makeTarget(width, height, packed), this.makeTarget(width, height, packed)];
    const nextTints = [this.makeTarget(width, height, true), this.makeTarget(width, height, true)];
    this.simWidth = width;
    this.simHeight = height;
    if (previousRead) {
      this.runLift(previousRead.texture, next[0], -1, 0.01, NO_LIFT);
    }
    if (previousTints) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousTints[this.tintRead].framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, nextTints[0].framebuffer);
      gl.blitFramebuffer(0, 0, previousWidth, previousHeight, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.dropTarget(previousTints[0]);
      this.dropTarget(previousTints[1]);
    }
    if (previous) {
      this.dropTarget(previous[0]);
      this.dropTarget(previous[1]);
    }
    this.targets = next;
    this.read = 0;
    this.tints = nextTints;
    this.tintRead = 0;
    this.dropTarget(this.fibre);
    this.fibre = this.makeTarget(width, height, true);
    gl.useProgram(this.programs.fibre.program);
    this.drawInto(this.fibre, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dropTarget(this.offprintTarget);
    this.offprintTarget = this.makeTarget(width, height, true);
    this.resizeProbe(width, height);
  }

  resizeProbe(width, height) {
    const gl = this.gl;
    this.dropProbeFence();
    this.dropTarget(this.reduceTarget);
    this.probeWidth = Math.ceil(width / PROBE_CELL);
    this.probeHeight = Math.ceil(height / PROBE_CELL);
    this.reduceTarget = this.makeTarget(this.probeWidth, this.probeHeight, true);
    const bytes = this.probeWidth * this.probeHeight * 4;
    if (!this.probeBuffer) this.probeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.probeBuffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.probePixels = new Uint8Array(bytes);
  }

  dropProbeFence() {
    if (!this.probeFence) return;
    this.gl.deleteSync(this.probeFence);
    this.probeFence = null;
  }

  requestWaterProbe() {
    if (!this.targets || !this.reduceTarget || this.probeFence) return false;
    const gl = this.gl;
    const entry = this.programs.reduce;
    gl.useProgram(entry.program);
    gl.uniform4fv(entry.uniforms.uRange, this.range);
    this.bindTexture(0, this.targets[this.read].texture, entry.uniforms.uState);
    this.drawInto(this.reduceTarget, this.probeWidth, this.probeHeight);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.probeBuffer);
    gl.readPixels(0, 0, this.probeWidth, this.probeHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.probeFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return Boolean(this.probeFence);
  }

  readWaterProbe() {
    const fence = this.probeFence;
    if (!fence) return -1;
    const gl = this.gl;
    const status = gl.clientWaitSync(fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return -1;
    this.dropProbeFence();
    if (status === gl.WAIT_FAILED) return -1;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.probeBuffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.probePixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const pixels = this.probePixels;
    let deepest = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > deepest) deepest = pixels[i];
    }
    const encoded = deepest / 255;
    return encoded * encoded * 2;
  }

  clearTint() {
    if (!this.tints) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    for (const target of this.tints) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setDisplaySize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  bindTexture(unit, texture, location) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  }

  nextSeed() {
    this.seedClock = (this.seedClock + 37.13) % 997;
    return this.seedClock;
  }

  useCommon(entry) {
    const gl = this.gl;
    gl.useProgram(entry.program);
    gl.uniform2f(entry.uniforms.uSimRes, this.simWidth, this.simHeight);
    if (entry.uniforms.uRange) gl.uniform4fv(entry.uniforms.uRange, this.range);
    if (entry.uniforms.uQuantise) gl.uniform1f(entry.uniforms.uQuantise, this.quantise);
    if (entry.uniforms.uHalf) gl.uniform1f(entry.uniforms.uHalf, this.half);
    if (entry.uniforms.uSeed) gl.uniform1f(entry.uniforms.uSeed, this.nextSeed());
  }

  drawInto(target, width, height) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, width, height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  swap() {
    this.read = 1 - this.read;
  }

  stamp(segments, nibs, count, settings) {
    if (!this.targets || count <= 0) return;
    const gl = this.gl;
    const entry = this.programs.stamp;
    let offset = 0;
    while (offset < count) {
      const batch = Math.min(MAX_STAMPS, count - offset);
      this.segments.set(segments.subarray(offset * 4, (offset + batch) * 4));
      this.nibs.set(nibs.subarray(offset * 4, (offset + batch) * 4));
      this.stampTint(batch, settings.ink);
      this.useCommon(entry);
      this.bindTexture(0, this.targets[this.read].texture, entry.uniforms.uState);
      gl.uniform1f(entry.uniforms.uConcentration, settings.concentration);
      gl.uniform1f(entry.uniforms.uPoolConcentration, settings.poolConcentration);
      gl.uniform1f(entry.uniforms.uSmear, settings.smear);
      gl.uniform1i(entry.uniforms.uCount, batch);
      gl.uniform4fv(entry.uniforms.uSegments, this.segments);
      gl.uniform4fv(entry.uniforms.uNibs, this.nibs);
      this.drawInto(this.targets[1 - this.read], this.simWidth, this.simHeight);
      this.swap();
      offset += batch;
    }
  }

  stampTint(batch, ink) {
    const gl = this.gl;
    const entry = this.programs.tint;
    gl.useProgram(entry.program);
    gl.uniform2f(entry.uniforms.uSimRes, this.simWidth, this.simHeight);
    gl.uniform4fv(entry.uniforms.uRange, this.range);
    gl.uniform3fv(entry.uniforms.uInk, ink);
    gl.uniform1i(entry.uniforms.uCount, batch);
    gl.uniform4fv(entry.uniforms.uSegments, this.segments);
    gl.uniform4fv(entry.uniforms.uNibs, this.nibs);
    this.bindTexture(0, this.targets[this.read].texture, entry.uniforms.uState);
    this.bindTexture(1, this.tints[this.tintRead].texture, entry.uniforms.uTint);
    this.drawInto(this.tints[1 - this.tintRead], this.simWidth, this.simHeight);
    this.tintRead = 1 - this.tintRead;
  }

  step(dt, settings) {
    if (!this.targets) return;
    const gl = this.gl;
    const entry = this.programs.step;
    this.useCommon(entry);
    this.bindTexture(0, this.targets[this.read].texture, entry.uniforms.uState);
    this.bindTexture(1, this.fibre.texture, entry.uniforms.uFibre);
    gl.uniform1f(entry.uniforms.uDt, dt);
    gl.uniform1f(entry.uniforms.uAbsorb, settings.absorb);
    gl.uniform1f(entry.uniforms.uDry, settings.dry);
    gl.uniform1f(entry.uniforms.uPin, settings.pin);
    gl.uniform1f(entry.uniforms.uMobility, settings.mobility);
    gl.uniform1f(entry.uniforms.uGranulation, settings.granulation);
    this.drawInto(this.targets[1 - this.read], this.simWidth, this.simHeight);
    this.swap();
  }

  runLift(sourceTexture, target, front, feather, keep, sourceRange = this.range) {
    const gl = this.gl;
    const entry = this.programs.lift;
    this.useCommon(entry);
    this.bindTexture(0, sourceTexture, entry.uniforms.uSource);
    gl.uniform4fv(entry.uniforms.uSourceRange, sourceRange);
    gl.uniform1f(entry.uniforms.uFront, front);
    gl.uniform1f(entry.uniforms.uFeather, feather);
    gl.uniform4fv(entry.uniforms.uKeep, keep);
    this.drawInto(target, this.simWidth, this.simHeight);
  }

  lift(front, feather, keep) {
    if (!this.targets) return;
    this.runLift(this.targets[this.read].texture, this.targets[1 - this.read], front, feather, keep);
    this.swap();
  }

  render(settings) {
    if (!this.targets) return;
    const gl = this.gl;
    const entry = this.programs.display;
    gl.useProgram(entry.program);
    gl.uniform2f(entry.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(entry.uniforms.uSimRes, this.simWidth, this.simHeight);
    gl.uniform4fv(entry.uniforms.uRange, this.range);
    gl.uniform3fv(entry.uniforms.uInk, settings.ink);
    gl.uniform3fv(entry.uniforms.uPaper, settings.paper);
    gl.uniform1f(entry.uniforms.uGranulation, settings.granulation);
    gl.uniform1f(entry.uniforms.uSheen, settings.sheen);
    this.bindTexture(0, this.targets[this.read].texture, entry.uniforms.uState);
    this.bindTexture(1, this.fibre.texture, entry.uniforms.uFibre);
    this.bindTexture(2, this.tints[this.tintRead].texture, entry.uniforms.uTint);
    this.drawInto(null, this.canvas.width, this.canvas.height);
  }

  offprint(settings) {
    if (!this.targets) return null;
    const gl = this.gl;
    const entry = this.programs.offprint;
    gl.useProgram(entry.program);
    gl.uniform2f(entry.uniforms.uSimRes, this.simWidth, this.simHeight);
    gl.uniform4fv(entry.uniforms.uRange, this.range);
    gl.uniform3fv(entry.uniforms.uInk, settings.ink);
    gl.uniform3fv(entry.uniforms.uBlotter, settings.blotter);
    this.bindTexture(0, this.targets[this.read].texture, entry.uniforms.uState);
    this.bindTexture(1, this.fibre.texture, entry.uniforms.uFibre);
    this.bindTexture(2, this.tints[this.tintRead].texture, entry.uniforms.uTint);
    this.drawInto(this.offprintTarget, this.simWidth, this.simHeight);
    const pixels = new Uint8ClampedArray(this.simWidth * this.simHeight * 4);
    gl.readPixels(0, 0, this.simWidth, this.simHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(pixels, this.simWidth, this.simHeight);
  }

  destroy() {
    const gl = this.gl;
    if (this.targets) {
      this.dropTarget(this.targets[0]);
      this.dropTarget(this.targets[1]);
    }
    if (this.tints) {
      this.dropTarget(this.tints[0]);
      this.dropTarget(this.tints[1]);
    }
    this.dropTarget(this.offprintTarget);
    this.dropTarget(this.fibre);
    this.dropTarget(this.reduceTarget);
    this.dropProbeFence();
    if (this.probeBuffer) gl.deleteBuffer(this.probeBuffer);
    for (const entry of Object.values(this.programs)) gl.deleteProgram(entry.program);
    gl.deleteShader(this.vertex);
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    this.targets = null;
    this.tints = null;
    this.fibre = null;
    this.reduceTarget = null;
    this.probeBuffer = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
