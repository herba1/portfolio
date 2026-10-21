import { MOIRE_FRAGMENT, MOIRE_VERTEX } from "./moireShader";

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

export function createMoireGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, MOIRE_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, MOIRE_FRAGMENT);
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
  const textures = [gl.createTexture(), gl.createTexture()];
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (const tex of textures) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  }

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    upload(slot, data, w, h) {
      gl.bindTexture(gl.TEXTURE_2D, textures[slot]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    },
    render(s) {
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures[0]);
      gl.uniform1i(u.uImgA, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures[1]);
      gl.uniform1i(u.uImgB, 1);
      gl.uniform1f(u.uMix, s.mix);
      gl.uniform4fv(u.uRectA, s.rectA);
      gl.uniform4fv(u.uRectB, s.rectB);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uDpr, s.dpr);
      gl.uniform1f(u.uPeriod, s.period);
      gl.uniform1f(u.uTime, s.time);
      gl.uniform1f(u.uWarp, s.warp);
      gl.uniform1f(u.uFreq, s.freq);
      gl.uniform3f(u.uTop, s.dx, s.dy, s.theta);
      gl.uniform2f(u.uCenter, s.cx, s.cy);
      gl.uniform1f(u.uMaskOn, s.maskOn);
      gl.uniform2fv(u.uBand, s.band);
      gl.uniform1f(u.uFade, s.fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
