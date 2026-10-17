import { SHADOW_FRAGMENT, STRIP_FRAGMENT, STRIP_VERTEX } from "./boothShader";

const STRIP_UNIFORMS = ["uRes", "uOffset", "uTex", "uW", "uLen", "uPerf", "uCut", "uTear", "uWet", "uSeed", "uGloss", "uMouth"];
const SHADOW_UNIFORMS = ["uRes", "uOffset", "uW", "uLen", "uTop", "uClip", "uBlur", "uAlpha", "uMouth"];
const STRIDE = 5;

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

function program(gl, vsSource, fsSource, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.bindAttribLocation(prog, 1, "aUv");
  gl.bindAttribLocation(prog, 2, "aBend");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(prog, name);
  return { prog, loc };
}

export function createBoothGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const strip = program(gl, STRIP_VERTEX, STRIP_FRAGMENT, STRIP_UNIFORMS);
  const shadow = program(gl, STRIP_VERTEX, SHADOW_FRAGMENT, SHADOW_UNIFORMS);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * 4, 0);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * 4, 8);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE * 4, 16);
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  let mesh = new Float32Array(0);
  let width = 1;
  let height = 1;
  let cssW = 1;
  let cssH = 1;

  function texture(source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tex;
  }

  function freeTexture(tex) {
    if (tex) gl.deleteTexture(tex);
  }

  function resize(w, h, cw, ch) {
    width = w;
    height = h;
    cssW = cw;
    cssH = ch;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  function begin() {
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function upload(build, count, extend) {
    const need = count * STRIDE;
    if (mesh.length < need) mesh = new Float32Array(need * 2);
    build(mesh, extend);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.subarray(0, need), gl.DYNAMIC_DRAW);
  }

  function drawShadow(build, count, p) {
    gl.useProgram(shadow.prog);
    upload(build, count, p.blur * 1.6 + 2);
    const l = shadow.loc;
    gl.uniform2f(l.uRes, cssW, cssH);
    gl.uniform2f(l.uOffset, p.ox, p.oy);
    gl.uniform1f(l.uW, p.w);
    gl.uniform1f(l.uLen, p.len);
    gl.uniform1f(l.uTop, p.top);
    gl.uniform1f(l.uClip, p.clip);
    gl.uniform1f(l.uBlur, p.blur);
    gl.uniform1f(l.uAlpha, p.alpha);
    gl.uniform1f(l.uMouth, p.mouth ?? -1e5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
  }

  function drawStrip(build, count, p) {
    gl.useProgram(strip.prog);
    upload(build, count, 2.5);
    const l = strip.loc;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, p.tex);
    gl.uniform1i(l.uTex, 0);
    gl.uniform2f(l.uRes, cssW, cssH);
    gl.uniform2f(l.uOffset, 0, 0);
    gl.uniform1f(l.uW, p.w);
    gl.uniform1f(l.uLen, p.len);
    gl.uniform1f(l.uPerf, p.perf);
    gl.uniform4f(l.uCut, p.clip, p.tornTop ? 1 : 0, p.tornBottom ? 1 : 0, p.attached ? 1 : 0);
    gl.uniform3f(l.uTear, p.tear, p.tearSide, p.tearOpen);
    gl.uniform1f(l.uWet, p.wet);
    gl.uniform1f(l.uSeed, p.seed);
    gl.uniform1f(l.uGloss, p.gloss);
    gl.uniform1f(l.uMouth, p.mouth ?? -1e5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
  }

  function destroy() {
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(strip.prog);
    gl.deleteProgram(shadow.prog);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { gl, texture, freeTexture, resize, begin, drawShadow, drawStrip, destroy };
}
