import { TERMINAL_DISPLAY, TERMINAL_PERSIST, TERMINAL_VERTEX } from "./terminalShader";

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

function program(gl, fragment) {
  const vs = compile(gl, gl.VERTEX_SHADER, TERMINAL_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    uniforms[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

export function createGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let persist;
  let display;
  try {
    persist = program(gl, TERMINAL_PERSIST);
    display = program(gl, TERMINAL_DISPLAY);
  } catch {
    return null;
  }
  const vao = gl.createVertexArray();
  const sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let targets = [];
  let width = 0;
  let height = 0;

  const makeTarget = (w, h) => {
    const tex = gl.createTexture();
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  };

  const dropTargets = () => {
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    targets = [];
  };

  return {
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      dropTargets();
      targets = [makeTarget(w, h), makeTarget(w, h)];
    },
    render({ source, upload, decay, time, power, flicker, curve, sceneW, sceneH }) {
      if (!width || gl.isContextLost()) return;
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      if (upload) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }
      const [prev, next] = targets;
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, width, height);
      gl.useProgram(persist.prog);
      gl.uniform1i(persist.uniforms.uSceneTex, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(persist.uniforms.uPrev, 1);
      gl.uniform2f(persist.uniforms.uSize, width, height);
      gl.uniform1f(persist.uniforms.uDecay, decay);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, next.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(display.prog);
      gl.uniform1i(display.uniforms.uAccum, 1);
      gl.uniform2f(display.uniforms.uRes, width, height);
      gl.uniform2f(display.uniforms.uScene, sceneW, sceneH);
      gl.uniform1f(display.uniforms.uTime, time);
      gl.uniform1f(display.uniforms.uPower, power);
      gl.uniform1f(display.uniforms.uFlicker, flicker);
      gl.uniform1f(display.uniforms.uCurve, curve);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      targets = [next, prev];
    },
    dispose() {
      dropTargets();
      gl.deleteTexture(sceneTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(persist.prog);
      gl.deleteProgram(display.prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
