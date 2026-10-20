import { VFD_FRAGMENT, VFD_VERTEX } from "./vfdShader";

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

function texture(gl, mip) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createVfdGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VFD_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, VFD_FRAGMENT);
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
  ["uScene", "uMask", "uRes", "uMesh", "uTime", "uFade", "uFil"].forEach((name) => {
    u[name] = gl.getUniformLocation(prog, name);
  });
  const vao = gl.createVertexArray();
  const sceneTex = texture(gl, true);
  const maskTex = texture(gl, false);
  let width = 0;
  let height = 0;

  return {
    resize(w, h) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    },
    mask(source) {
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    render({ scene, mesh, time, fade, filaments }) {
      if (!width || gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.viewport(0, 0, width, height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform1i(u.uScene, 0);
      gl.uniform1i(u.uMask, 1);
      gl.uniform2f(u.uRes, width, height);
      gl.uniform1f(u.uMesh, mesh);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uFade, fade);
      gl.uniform4f(u.uFil, filaments[0] ?? -1, filaments[1] ?? -1, filaments[2] ?? -1, filaments[3] ?? -1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(sceneTex);
      gl.deleteTexture(maskTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
