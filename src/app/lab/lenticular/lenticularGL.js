import { CARD_FRAGMENT, FULL_VERTEX } from "./lenticularShader";

const CARD_UNIFORMS = ["uArt", "uRes", "uDpr", "uCenter", "uHalf", "uRot", "uLift", "uDist", "uGround", "uRidges", "uFrames", "uGain", "uRadius", "uThick", "uReady", "uKey", "uSeed", "uGroundTint", "uSplit"];

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

function link(gl, fragment, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, FULL_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(program, name);
  return { program, loc };
}

export function createLenticularGL(canvas) {
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
  const card = link(gl, CARD_FRAGMENT, CARD_UNIFORMS);
  const vao = gl.createVertexArray();
  const sets = new Map();
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, blank);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([236, 232, 222, 255]));

  function bind(unit, target, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
  }

  function build(key, layers) {
    const size = Math.min(1024, maxSize);
    const array = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size, layers.length);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    layers.forEach((layer, i) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, layer);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    sets.set(key, { array, frames: layers.length, aspect: 1, size });
  }

  function evict(keep) {
    for (const [key, set] of sets) {
      if (!keep.includes(key)) {
        gl.deleteTexture(set.array);
        sets.delete(key);
      }
    }
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(f) {
    const set = sets.get(f.key);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(card.program);
    gl.bindVertexArray(vao);
    bind(0, gl.TEXTURE_2D_ARRAY, set ? set.array : blank);
    const l = card.loc;
    gl.uniform1i(l.uArt, 0);
    gl.uniform2f(l.uRes, canvas.width, canvas.height);
    gl.uniform1f(l.uDpr, f.dpr);
    gl.uniform2f(l.uCenter, f.cx, f.cy);
    gl.uniform2f(l.uHalf, f.hw, f.hh);
    gl.uniformMatrix3fv(l.uRot, false, f.rot);
    gl.uniform1f(l.uLift, f.lift);
    gl.uniform1f(l.uDist, f.dist);
    gl.uniform1f(l.uGround, f.ground);
    gl.uniform1f(l.uRidges, f.ridges);
    gl.uniform1f(l.uFrames, f.frames);
    gl.uniform1f(l.uSplit, set ? f.split : 99);
    gl.uniform1f(l.uGain, f.gain);
    gl.uniform1f(l.uRadius, f.radius);
    gl.uniform1f(l.uThick, f.thick);
    gl.uniform1f(l.uReady, set ? 1 : 0);
    gl.uniform3f(l.uKey, f.key3[0], f.key3[1], f.key3[2]);
    gl.uniform1f(l.uSeed, f.seed);
    gl.uniform3f(l.uGroundTint, f.tint[0], f.tint[1], f.tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const set of sets.values()) gl.deleteTexture(set.array);
    sets.clear();
    gl.deleteTexture(blank);
    gl.deleteProgram(card.program);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { build, size: Math.min(1024, maxSize), has: (key) => sets.has(key), aspectOf: (key) => sets.get(key)?.aspect, evict, resize, draw, destroy };
}
