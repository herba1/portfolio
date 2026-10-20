import { LIGHT_TABLE_FRAGMENT, LIGHT_TABLE_VERTEX } from "./lightTableShader";
import { ATLAS_H, ATLAS_W } from "./lightTableFilm";

const UNIFORMS = [
  "uRes",
  "uDpr",
  "uScale",
  "uGlass",
  "uBezel",
  "uPower",
  "uCount",
  "uPose",
  "uSize",
  "uRect",
  "uTexel",
  "uAtlas",
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

export function createLightTableGL(canvas) {
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
  if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < ATLAS_W) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, LIGHT_TABLE_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, LIGHT_TABLE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const vao = gl.createVertexArray();
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const levels = Math.floor(Math.log2(ATLAS_W)) + 1;
  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, ATLAS_W, ATLAS_H);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const pose = new Float32Array(32);
  const size = new Float32Array(32);
  const rect = new Float32Array(32);

  function upload(piece, data) {
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, piece.at[0], piece.at[1], piece.px[0], piece.px[1], gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  function finish() {
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(frame) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, canvas.height / Math.max(1, frame.height));
    gl.uniform1f(loc.uScale, frame.scale);
    gl.uniform4f(loc.uGlass, frame.glass[0], frame.glass[1], frame.glass[2], frame.glass[3]);
    gl.uniform1f(loc.uBezel, frame.bezel);
    gl.uniform1f(loc.uPower, frame.power);
    gl.uniform1f(loc.uTexel, frame.texel);
    const n = Math.min(8, frame.pieces.length);
    for (let i = 0; i < n; i += 1) {
      const p = frame.pieces[i];
      pose.set([p.x, p.y, Math.cos(p.a), Math.sin(p.a)], i * 4);
      size.set([p.hw, p.hh, p.code, p.seed], i * 4);
      rect.set(p.rect, i * 4);
    }
    gl.uniform1i(loc.uCount, n);
    gl.uniform4fv(loc.uPose, pose);
    gl.uniform4fv(loc.uSize, size);
    gl.uniform4fv(loc.uRect, rect);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(loc.uAtlas, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    gl.deleteTexture(atlas);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { upload, finish, resize, draw, destroy };
}
