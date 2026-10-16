import { RISO_FRAGMENT, RISO_VERTEX } from "./risoShader";
import { TEX_H, TEX_W } from "./risoPosters";

const UNIFORMS = [
  "uRes",
  "uBox",
  "uDpr",
  "uTexA",
  "uTexB",
  "uPoseA",
  "uPoseB",
  "uOffA",
  "uOffB",
  "uInkA0",
  "uInkA1",
  "uInkB0",
  "uInkB1",
  "uScreenA",
  "uScreenB",
  "uMiscA",
  "uMiscB",
  "uShowB",
];

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

export function createRisoGL(canvas) {
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

  const vs = compile(gl, gl.VERTEX_SHADER, RISO_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, RISO_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const vao = gl.createVertexArray();
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const textures = new Map();

  function upload(key, data) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_W, TEX_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    textures.set(key, texture);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function sheet(unit, layer, names) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, (layer && textures.get(layer.key)) || blank);
    gl.uniform1i(loc[names.tex], unit);
    if (!layer) {
      gl.uniform4f(loc[names.pose], -9999, -9999, 1, 0);
      return;
    }
    gl.uniform4f(loc[names.pose], layer.x, layer.y, layer.hw, layer.rot);
    gl.uniform4f(loc[names.off], layer.off[0], layer.off[1], layer.off[2], layer.off[3]);
    gl.uniform3f(loc[names.ink0], layer.ink0[0], layer.ink0[1], layer.ink0[2]);
    gl.uniform3f(loc[names.ink1], layer.ink1[0], layer.ink1[1], layer.ink1[2]);
    gl.uniform4f(loc[names.screen], layer.screen[0], layer.screen[1], layer.screen[2], layer.screen[3]);
    gl.uniform3f(loc[names.misc], layer.lift, layer.seed, layer.press);
  }

  function draw(frame) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(loc.uBox, frame.width, frame.height);
    gl.uniform1f(loc.uDpr, frame.dpr);
    sheet(0, frame.a, { tex: "uTexA", pose: "uPoseA", off: "uOffA", ink0: "uInkA0", ink1: "uInkA1", screen: "uScreenA", misc: "uMiscA" });
    sheet(1, frame.b, { tex: "uTexB", pose: "uPoseB", off: "uOffB", ink0: "uInkB0", ink1: "uInkB1", screen: "uScreenB", misc: "uMiscB" });
    gl.uniform1f(loc.uShowB, frame.b ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const texture of textures.values()) gl.deleteTexture(texture);
    textures.clear();
    gl.deleteTexture(blank);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { upload, has: (key) => textures.has(key), resize, draw, destroy };
}
