import { FIELD_FRAGMENT, FIELD_VERTEX } from "./fieldShader";

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

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function createFieldGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, FIELD_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FIELD_FRAGMENT);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed");
  } catch {
    return null;
  }
  const u = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    u[info.name] = gl.getUniformLocation(prog, info.name);
  }
  const vao = gl.createVertexArray();
  const cellTex = gl.createTexture();
  const atlasTex = gl.createTexture();
  const setup = (tex) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  setup(cellTex);
  setup(atlasTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  let cellW = 0;
  let cellH = 0;
  let atlasCols = 16;
  const ground = hexToRgb("#050705");
  const ink = hexToRgb("#5cf58a");
  const hot = hexToRgb("#d6ffe0");

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    atlas(source, cw, ch, cols) {
      cellW = cw;
      cellH = ch;
      atlasCols = cols;
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    cells(data, cols, rows, fresh) {
      gl.bindTexture(gl.TEXTURE_2D, cellTex);
      if (fresh) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, cols, rows, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, data);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG_INTEGER, gl.UNSIGNED_BYTE, data);
    },
    render({ ox, oy, cols, rows, height, fade }) {
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cellTex);
      gl.uniform1i(u.uCells, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(u.uAtlas, 1);
      gl.uniform2f(u.uOrigin, ox, oy);
      gl.uniform2f(u.uCell, cellW, cellH);
      gl.uniform2f(u.uGrid, cols, rows);
      gl.uniform1f(u.uHeight, height);
      gl.uniform1f(u.uAtlasCols, atlasCols);
      gl.uniform3fv(u.uGround, ground);
      gl.uniform3fv(u.uInk, ink);
      gl.uniform3fv(u.uHot, hot);
      gl.uniform1f(u.uFade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(cellTex);
      gl.deleteTexture(atlasTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
