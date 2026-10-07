import { COPIER_VERTEX, DISPLAY_FRAGMENT, PRINT_FRAGMENT } from "./copierShader";
import { SHEET_HEIGHT, SHEET_WIDTH } from "./copierParams";

const PRINT_UNIFORMS = [
  "uSource",
  "uLedger",
  "uSheet",
  "uSourceSize",
  "uSourceBase",
  "uPrinted",
  "uFlip",
  "uLid",
  "uThreshold",
  "uContrast",
  "uGrain",
  "uStreaks",
  "uGeneration",
  "uPreset",
  "uSeed",
  "uDrum",
  "uPaper",
  "uInk",
  "uInkB",
];

const DISPLAY_UNIFORMS = [
  "uSource",
  "uPrint",
  "uSheet",
  "uSourceBase",
  "uPose",
  "uPrinted",
  "uLamp",
  "uLampGlow",
  "uPxPerCss",
  "uAppear",
  "uGrab",
  "uFresh",
  "uPaper",
  "uPlaten",
  "uInkRing",
];

const PRINT_KEY_LENGTH = 22;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Copier shader failed: ${log}`);
  }
  return shader;
}

function link(gl, fragmentSource, names) {
  const vertex = compile(gl, gl.VERTEX_SHADER, COPIER_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Copier program failed: ${gl.getProgramInfoLog(program)}`);
  }
  const locations = {};
  for (const name of names) locations[name] = gl.getUniformLocation(program, name);
  return { program, locations };
}

function identityLedger() {
  const ledger = new Float32Array(SHEET_HEIGHT * 4);
  for (let row = 0; row < SHEET_HEIGHT; row += 1) {
    const i = row * 4;
    ledger[i] = SHEET_WIDTH / 2;
    ledger[i + 1] = SHEET_HEIGHT / 2;
    ledger[i + 2] = 0;
    ledger[i + 3] = 1;
  }
  return ledger;
}

export function createCopierGL(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  try {
    return new CopierGL(canvas, gl);
  } catch {
    return null;
  }
}

class CopierGL {
  constructor(canvas, gl) {
    this.kind = "webgl2";
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.source = null;
    this.ledger = null;
    this.frame = null;
    this.printedRows = 0;
    this.printValid = false;
    this.printKey = new Float32Array(PRINT_KEY_LENGTH);
    this.nextKey = new Float32Array(PRINT_KEY_LENGTH);
    this.pixels = null;
    this.onRestored = null;
    this.handleLost = (event) => {
      event.preventDefault();
      this.lost = true;
    };
    this.handleRestored = () => {
      this.lost = false;
      this.init();
      if (this.source) this.uploadSource(this.source.image, this.source.width, this.source.height);
      if (this.ledger && this.printedRows > 0) this.uploadLedger(this.ledger, 0, this.printedRows);
      if (this.onRestored) this.onRestored();
    };
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
    this.init();
  }

  init() {
    const gl = this.gl;
    this.print = link(gl, PRINT_FRAGMENT, PRINT_UNIFORMS);
    this.display = link(gl, DISPLAY_FRAGMENT, DISPLAY_UNIFORMS);
    this.vao = gl.createVertexArray();

    this.sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

    this.ledgerTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.ledgerTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, SHEET_HEIGHT, 0, gl.RGBA, gl.FLOAT, identityLedger());

    this.printTexture = gl.createTexture();
    this.printWidth = 0;
    this.printHeight = 0;
    this.printFramebuffer = gl.createFramebuffer();
    this.allocatePrint();

    this.bakeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bakeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SHEET_WIDTH, SHEET_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.bakeFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bakeTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.printValid = false;
  }

  allocatePrint() {
    const gl = this.gl;
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    if (width === this.printWidth && height === this.printHeight) return;
    this.printWidth = width;
    this.printHeight = height;
    gl.bindTexture(gl.TEXTURE_2D, this.printTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.printFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.printTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.printValid = false;
  }

  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (!this.lost) this.allocatePrint();
  }

  uploadSource(image, width, height) {
    this.source = { image, width, height };
    this.printValid = false;
    if (this.lost) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  uploadLedger(ledger, fromRow, toRow) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.ledgerTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, fromRow, 1, toRow - fromRow, gl.RGBA, gl.FLOAT, ledger, fromRow * 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  writeRows(ledger, fromRow, toRow, frame) {
    this.ledger = ledger;
    this.frame = frame;
    this.printedRows = Math.max(this.printedRows, toRow);
    if (this.lost || toRow <= fromRow) return;
    this.uploadLedger(ledger, fromRow, toRow);
    if (this.printStale(frame)) this.drawPrint(frame, 0, this.printedRows);
    else this.drawPrint(frame, fromRow, toRow);
  }

  resetRows() {
    this.printedRows = 0;
  }

  printStale(frame) {
    const key = this.nextKey;
    key[0] = frame.threshold;
    key[1] = frame.contrast;
    key[2] = frame.grain;
    key[3] = frame.streaks;
    key[4] = frame.generation;
    key[5] = frame.preset;
    key[6] = frame.seed;
    key[7] = frame.drum;
    key[8] = frame.lid;
    key[9] = frame.paper[0];
    key[10] = frame.paper[1];
    key[11] = frame.paper[2];
    key[12] = frame.ink[0];
    key[13] = frame.ink[1];
    key[14] = frame.ink[2];
    key[15] = frame.inkB[0];
    key[16] = frame.inkB[1];
    key[17] = frame.inkB[2];
    key[18] = frame.sourceWidth;
    key[19] = frame.sourceHeight;
    key[20] = frame.baseWidth;
    key[21] = frame.baseHeight;
    let stale = !this.printValid;
    for (let i = 0; i < PRINT_KEY_LENGTH; i += 1) {
      if (this.printKey[i] !== key[i]) {
        stale = true;
        this.printKey[i] = key[i];
      }
    }
    return stale;
  }

  bindPrint(frame, flip) {
    const gl = this.gl;
    const u = this.print.locations;
    gl.useProgram(this.print.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(u.uSource, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.ledgerTexture);
    gl.uniform1i(u.uLedger, 1);
    gl.uniform2f(u.uSheet, SHEET_WIDTH, SHEET_HEIGHT);
    gl.uniform2f(u.uSourceSize, frame.sourceWidth, frame.sourceHeight);
    gl.uniform2f(u.uSourceBase, frame.baseWidth, frame.baseHeight);
    gl.uniform1f(u.uPrinted, this.printedRows);
    gl.uniform1f(u.uFlip, flip ? 1 : 0);
    gl.uniform1f(u.uLid, frame.lid);
    gl.uniform1f(u.uThreshold, frame.threshold);
    gl.uniform1f(u.uContrast, frame.contrast);
    gl.uniform1f(u.uGrain, frame.grain);
    gl.uniform1f(u.uStreaks, frame.streaks);
    gl.uniform1f(u.uGeneration, frame.generation);
    gl.uniform1f(u.uPreset, frame.preset);
    gl.uniform1f(u.uSeed, frame.seed);
    gl.uniform1f(u.uDrum, frame.drum);
    gl.uniform3fv(u.uPaper, frame.paper);
    gl.uniform3fv(u.uInk, frame.ink);
    gl.uniform3fv(u.uInkB, frame.inkB);
  }

  drawPrint(frame, fromRow, toRow) {
    if (toRow <= fromRow) return;
    const gl = this.gl;
    const width = this.printWidth;
    const height = this.printHeight;
    const rowsToPixels = height / SHEET_HEIGHT;
    const top = Math.max(0, Math.floor(fromRow * rowsToPixels));
    const bottom = Math.min(height, Math.ceil(toRow * rowsToPixels));
    if (bottom <= top) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.printFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, height - bottom, width, bottom - top);
    this.bindPrint(frame, false);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (fromRow === 0) this.printValid = true;
  }

  render(frame) {
    if (this.lost) return;
    this.frame = frame;
    const gl = this.gl;
    if (this.printedRows > 0 && this.printStale(frame)) this.drawPrint(frame, 0, this.printedRows);
    const u = this.display.locations;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.display.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(u.uSource, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.printTexture);
    gl.uniform1i(u.uPrint, 1);
    gl.uniform2f(u.uSheet, SHEET_WIDTH, SHEET_HEIGHT);
    gl.uniform2f(u.uSourceBase, frame.baseWidth, frame.baseHeight);
    gl.uniform4f(u.uPose, frame.poseX, frame.poseY, frame.poseAngle, frame.poseScale);
    gl.uniform1f(u.uPrinted, Math.min(frame.printed, this.printedRows));
    gl.uniform1f(u.uLamp, frame.lamp);
    gl.uniform1f(u.uLampGlow, frame.lampGlow);
    gl.uniform1f(u.uPxPerCss, frame.pxPerCss);
    gl.uniform1f(u.uAppear, frame.appear);
    gl.uniform1f(u.uGrab, frame.grab);
    gl.uniform1f(u.uFresh, frame.fresh);
    gl.uniform3fv(u.uPaper, frame.paper);
    gl.uniform3fv(u.uPlaten, frame.platen);
    gl.uniform3fv(u.uInkRing, frame.ring);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bake(frame) {
    if (this.lost || this.printedRows <= 0) return null;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFramebuffer);
    gl.viewport(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    this.bindPrint(frame, true);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!this.pixels) this.pixels = new ImageData(SHEET_WIDTH, SHEET_HEIGHT);
    gl.readPixels(0, 0, SHEET_WIDTH, SHEET_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(this.pixels.data.buffer));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sheet = document.createElement("canvas");
    sheet.width = SHEET_WIDTH;
    sheet.height = SHEET_HEIGHT;
    sheet.getContext("2d").putImageData(this.pixels, 0, 0);
    return sheet;
  }

  dispose() {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    if (!gl.isContextLost()) {
      gl.deleteTexture(this.sourceTexture);
      gl.deleteTexture(this.ledgerTexture);
      gl.deleteTexture(this.printTexture);
      gl.deleteTexture(this.bakeTexture);
      gl.deleteFramebuffer(this.printFramebuffer);
      gl.deleteFramebuffer(this.bakeFramebuffer);
      gl.deleteVertexArray(this.vao);
      gl.deleteProgram(this.print.program);
      gl.deleteProgram(this.display.program);
    }
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
    this.source = null;
    this.ledger = null;
    this.frame = null;
    this.pixels = null;
  }
}
