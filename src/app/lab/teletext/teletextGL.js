import { TELETEXT_FRAGMENT, TELETEXT_VERTEX } from "./teletextShader";

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

export function createTeletextGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, TELETEXT_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, TELETEXT_FRAGMENT);
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
  ["uTex", "uRes", "uBox", "uSrc", "uTime", "uFade"].forEach((name) => {
    u[name] = gl.getUniformLocation(prog, name);
  });
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let width = 0;
  let height = 0;
  let srcW = 0;
  let srcH = 0;

  return {
    resize(w, h) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    },
    render({ image, upload, box, time, fade }) {
      if (!width || gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (upload) {
        srcW = image.width;
        srcH = image.height;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      gl.viewport(0, 0, width, height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uRes, width, height);
      gl.uniform4f(u.uBox, box[0], box[1], box[2], box[3]);
      gl.uniform2f(u.uSrc, srcW, srcH);
      gl.uniform1f(u.uTime, time);
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
