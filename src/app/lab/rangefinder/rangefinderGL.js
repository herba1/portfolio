import { FINDER_FS, PRINT_FS, QUAD_VS, STATIC_FS } from "./rangefinderShader";

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader compile failed");
  }
  return shader;
}

function program(gl, vsSource, fsSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const cache = new Map();
  const loc = (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
    return cache.get(name);
  };
  return { prog, loc };
}

function params(gl, filter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export const PRINT_W = 720;
export const PRINT_H = 480;

export function createRangefinderGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const finder = program(gl, QUAD_VS, FINDER_FS);
  const baker = program(gl, QUAD_VS, STATIC_FS);
  const print = program(gl, QUAD_VS, PRINT_FS);
  const vao = gl.createVertexArray();

  const photoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, photoTex);
  params(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  const depthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  params(gl, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

  const printTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, printTex);
  params(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PRINT_W, PRINT_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const printFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, printFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, printTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const pixels = new Uint8ClampedArray(PRINT_W * PRINT_H * 4);

  const staticTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, staticTex);
  params(gl, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const staticFbo = gl.createFramebuffer();
  let staticW = 0;
  let staticH = 0;
  let baked = false;

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (w !== staticW || h !== staticH) {
      staticW = w;
      staticH = h;
      gl.bindTexture(gl.TEXTURE_2D, staticTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, staticFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staticTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    baked = false;
  }

  function setFrameUniforms(prog, f) {
    const L = prog.loc;
    gl.uniform2f(L("uRes"), canvas.width, canvas.height);
    gl.uniform1f(L("uScale"), f.scale);
    gl.uniform4f(L("uWin"), f.win[0], f.win[1], f.win[2], f.win[3]);
    gl.uniform1f(L("uWinR"), f.winR);
    gl.uniform1f(L("uBezel"), f.bezel);
    gl.uniform1f(L("uPlate"), f.plate);
  }

  function bake(f) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, staticFbo);
    gl.viewport(0, 0, staticW, staticH);
    gl.useProgram(baker.prog);
    gl.bindVertexArray(vao);
    setFrameUniforms(baker, f);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    baked = true;
  }

  function uploadScene(img, depth) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, photoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, depth.width, depth.height, 0, gl.RED, gl.UNSIGNED_BYTE, depth.bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  function bindScene(prog) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photoTex);
    gl.uniform1i(prog.loc("uPhoto"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(prog.loc("uDepth"), 1);
  }

  function draw(f) {
    if (!baked) bake(f);
    const w = canvas.width;
    const h = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(finder.prog);
    gl.bindVertexArray(vao);
    bindScene(finder);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, staticTex);
    gl.uniform1i(finder.loc("uStatic"), 2);
    const L = finder.loc;
    setFrameUniforms(finder, f);
    gl.uniform4f(L("uCrop"), f.crop[0], f.crop[1], f.crop[2], f.crop[3]);
    gl.uniform4f(L("uFrame"), f.frame[0], f.frame[1], f.frame[2], f.frame[3]);
    gl.uniform4f(L("uPatch"), f.patch[0], f.patch[1], f.patch[2], f.patch[3]);
    gl.uniform1f(L("uFocus"), f.focus);
    gl.uniform1f(L("uGhostK"), f.ghostK);
    gl.uniform1f(L("uLock"), f.lock);
    gl.uniform1f(L("uBlink"), f.blink);
    gl.uniform1f(L("uFade"), f.fade);
    gl.uniform2f(L("uEye"), f.eye[0], f.eye[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function renderPrint({ region, focus, cocK, cocMax, seed }) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, printFbo);
    gl.viewport(0, 0, PRINT_W, PRINT_H);
    gl.useProgram(print.prog);
    gl.bindVertexArray(vao);
    bindScene(print);
    const L = print.loc;
    gl.uniform4f(L("uRegion"), region[0], region[1], region[2], region[3]);
    gl.uniform2f(L("uSize"), PRINT_W, PRINT_H);
    gl.uniform1f(L("uFocus"), focus);
    gl.uniform1f(L("uCocK"), cocK);
    gl.uniform1f(L("uCocMax"), cocMax);
    gl.uniform1f(L("uSeed"), seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, PRINT_W, PRINT_H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return new ImageData(new Uint8ClampedArray(pixels), PRINT_W, PRINT_H);
  }

  function destroy() {
    gl.deleteTexture(photoTex);
    gl.deleteTexture(depthTex);
    gl.deleteTexture(printTex);
    gl.deleteTexture(staticTex);
    gl.deleteFramebuffer(staticFbo);
    gl.deleteProgram(baker.prog);
    gl.deleteFramebuffer(printFbo);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(finder.prog);
    gl.deleteProgram(print.prog);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { resize, uploadScene, draw, renderPrint, destroy };
}
