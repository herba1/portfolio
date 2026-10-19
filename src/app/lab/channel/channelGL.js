import { CHANNEL_FRAGMENT, CHANNEL_VERTEX } from "./channelShader";

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

function mipTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createChannelGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, CHANNEL_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, CHANNEL_FRAGMENT);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
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
  const covers = new Map();
  const captionTex = mipTexture(gl);
  gl.bindTexture(gl.TEXTURE_2D, captionTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const blank = mipTexture(gl);
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  let width = 0;
  let height = 0;

  return {
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    },
    addCover(key, image) {
      if (covers.has(key)) return;
      const tex = mipTexture(gl);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      covers.set(key, tex);
    },
    hasCover(key) {
      return covers.has(key);
    },
    setCaption(source) {
      gl.bindTexture(gl.TEXTURE_2D, captionTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    render(p) {
      if (!width || gl.isContextLost()) return;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      const cover = covers.get(p.cover);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cover || blank);
      gl.uniform1i(u.uCover, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, captionTex);
      gl.uniform1i(u.uCaption, 1);
      gl.uniform2f(u.uRes, width, height);
      gl.uniform2f(u.uScreen, p.screenW, p.screenH);
      gl.uniform1f(u.uTime, p.time);
      gl.uniform1f(u.uStatic, p.static);
      gl.uniform1f(u.uRoll, p.roll);
      gl.uniform1f(u.uBar, p.bar);
      gl.uniform1f(u.uDegauss, p.degauss);
      gl.uniform1f(u.uHasCover, cover ? 1 : 0);
      gl.uniform4f(u.uKen, p.ken[0], p.ken[1], p.ken[2], 0);
      gl.uniform1f(u.uCurve, p.curve);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      for (const tex of covers.values()) gl.deleteTexture(tex);
      covers.clear();
      gl.deleteTexture(captionTex);
      gl.deleteTexture(blank);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
