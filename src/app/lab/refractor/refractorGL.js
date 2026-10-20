import { CARD_FRAGMENT, FULL_VERTEX } from "./refractorShader";

const UNIFORMS = ["uBack", "uRes", "uDpr", "uCenter", "uHalf", "uRot", "uLift", "uDist", "uGround", "uThick", "uKey", "uFill", "uFoil", "uData", "uReady", "uSeed", "uGroundTint"];

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

export function createRefractorGL(canvas) {
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
  const vs = compile(gl, gl.VERTEX_SHADER, FULL_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, CARD_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
  const vao = gl.createVertexArray();
  const sets = new Map();

  function texture(source, mips) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  function build(key, prep) {
    if (sets.has(key)) return;
    sets.set(key, { back: texture(prep.label, true), data: prep.data });
  }

  function evict(keep) {
    for (const [key, set] of sets) {
      if (keep.includes(key)) continue;
      gl.deleteTexture(set.back);
      sets.delete(key);
    }
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function bind(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  function draw(f) {
    const set = sets.get(f.key);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    if (set) bind(0, set.back);
    gl.uniform1i(loc.uBack, 0);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, f.dpr);
    gl.uniform2f(loc.uCenter, f.cx, f.cy);
    gl.uniform2f(loc.uHalf, f.hw, f.hh);
    gl.uniformMatrix3fv(loc.uRot, false, f.rot);
    gl.uniform1f(loc.uLift, f.lift);
    gl.uniform1f(loc.uDist, f.dist);
    gl.uniform1f(loc.uGround, f.ground);
    gl.uniform1f(loc.uThick, f.thick);
    gl.uniform3f(loc.uKey, f.keyLight[0], f.keyLight[1], f.keyLight[2]);
    gl.uniform3f(loc.uFill, f.fillLight[0], f.fillLight[1], f.fillLight[2]);
    gl.uniform3f(loc.uFoil, f.foil[0], f.foil[1], f.foil[2]);
    gl.uniform1f(loc.uData, set ? set.data : 0.8);
    gl.uniform1f(loc.uReady, set ? 1 : 0);
    gl.uniform1f(loc.uSeed, f.seed);
    gl.uniform3f(loc.uGroundTint, f.tint[0], f.tint[1], f.tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    evict([]);
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { build, has: (key) => sets.has(key), evict, resize, draw, destroy };
}
