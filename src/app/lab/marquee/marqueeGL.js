import { MARQUEE_FRAGMENT, MARQUEE_VERTEX } from "./marqueeShader";

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

export function createMarqueeGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, MARQUEE_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, MARQUEE_FRAGMENT);
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
  ["uDots", "uRes", "uOrigin", "uGrid", "uPitch", "uFade"].forEach((name) => {
    u[name] = gl.getUniformLocation(prog, name);
  });
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  let width = 0;
  let height = 0;
  let gridW = 0;
  let gridH = 0;

  return {
    resize(w, h) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    },
    render({ dots, cols, rows, origin, pitch, fade }) {
      if (!width || gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (cols !== gridW || rows !== gridH) {
        gridW = cols;
        gridH = rows;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, dots);
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED, gl.UNSIGNED_BYTE, dots);
      }
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.viewport(0, 0, width, height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform1i(u.uDots, 0);
      gl.uniform2f(u.uRes, width, height);
      gl.uniform2f(u.uOrigin, origin[0], origin[1]);
      gl.uniform2f(u.uGrid, cols, rows);
      gl.uniform1f(u.uPitch, pitch);
      gl.uniform1f(u.uFade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
