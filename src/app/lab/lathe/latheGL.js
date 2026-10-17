import { ROWS, W } from "./latheCut";
import { LATHE_FRAGMENT, LATHE_VERTEX } from "./latheShader";

const UNIFORMS = ["uRes", "uDpr", "uView", "uEye", "uRot", "uPlat", "uCut", "uArm", "uLens", "uGroove", "uChip", "uChipInfo", "uChipBox", "uHose", "uHoseBox", "uData"];

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

export function createLatheGL(canvas) {
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
  const vs = compile(gl, gl.VERTEX_SHADER, LATHE_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, LATHE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const vao = gl.createVertexArray();
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const data = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, data);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, ROWS, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function upload(groove) {
    if (groove.hi < groove.lo) return;
    const lo = Math.max(0, groove.lo);
    const hi = Math.min(ROWS - 1, groove.hi);
    gl.bindTexture(gl.TEXTURE_2D, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, lo, W, hi - lo + 1, gl.RGBA, gl.FLOAT, groove.data.subarray(lo * W * 4, (hi + 1) * W * 4));
    groove.lo = ROWS;
    groove.hi = -1;
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, data);
    gl.uniform1i(loc.uData, 0);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, f.dpr);
    gl.uniform3f(loc.uView, f.cx, f.cy, f.scale);
    gl.uniform3f(loc.uEye, f.eye[0], f.eye[1], f.eye[2]);
    gl.uniform1f(loc.uRot, f.rot);
    gl.uniform4fv(loc.uPlat, f.plat);
    gl.uniform4fv(loc.uCut, f.cut);
    gl.uniform4fv(loc.uArm, f.arm);
    gl.uniform4fv(loc.uLens, f.lens);
    gl.uniform4fv(loc.uGroove, f.groove);
    gl.uniform4fv(loc.uChip, f.chip);
    gl.uniform4fv(loc.uChipInfo, f.chipInfo);
    gl.uniform4fv(loc.uChipBox, f.chipBox);
    gl.uniform4fv(loc.uHose, f.hose);
    gl.uniform4fv(loc.uHoseBox, f.hoseBox);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    gl.deleteTexture(data);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { upload, resize, draw, destroy };
}
