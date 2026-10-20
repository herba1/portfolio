import { SCOPE_BEAM, SCOPE_BEAM_VERTEX, SCOPE_DECAY, SCOPE_DISPLAY, SCOPE_FULL_VERTEX } from "./scopeShader";

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

function program(gl, vertex, fragment) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
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

export const MAX_SEGMENTS = 4096;

export function createScopeGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const floatOk = Boolean(gl.getExtension("EXT_color_buffer_float"));
  gl.getExtension("OES_texture_float_linear");
  let decay;
  let beam;
  let display;
  try {
    decay = program(gl, SCOPE_FULL_VERTEX, SCOPE_DECAY);
    beam = program(gl, SCOPE_BEAM_VERTEX, SCOPE_BEAM);
    display = program(gl, SCOPE_FULL_VERTEX, SCOPE_DISPLAY);
  } catch {
    return null;
  }
  const emptyVao = gl.createVertexArray();
  const beamVao = gl.createVertexArray();
  const segBuffer = gl.createBuffer();
  const energyBuffer = gl.createBuffer();
  gl.bindVertexArray(beamVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, segBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_SEGMENTS * 16, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, energyBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_SEGMENTS * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);

  let targets = [];
  let width = 0;
  let height = 0;

  const makeTarget = (w, h) => {
    const tex = gl.createTexture();
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, floatOk ? gl.RGBA16F : gl.RGBA8, w, h);
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
    floatOk,
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      dropTargets();
      targets = [makeTarget(w, h), makeTarget(w, h)];
    },
    render({ segs, energy, count, decayFactor, sigma, exposure, time, dpr, rows, radius }) {
      if (!width || gl.isContextLost()) return;
      const [prev, next] = targets;
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(emptyVao);
      gl.useProgram(decay.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(decay.uniforms.uPrev, 0);
      gl.uniform2f(decay.uniforms.uSize, width, height);
      gl.uniform1f(decay.uniforms.uDecay, decayFactor);
      gl.uniform1f(decay.uniforms.uFloor, floatOk ? 0.00002 : 1.2 / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (count > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(beam.prog);
        gl.uniform2f(beam.uniforms.uRes, width, height);
        gl.uniform1f(beam.uniforms.uSigma, sigma);
        gl.bindVertexArray(beamVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, segBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, segs, 0, count * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, energyBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, energy, 0, count);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        gl.disable(gl.BLEND);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, next.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(emptyVao);
      gl.useProgram(display.prog);
      gl.uniform1i(display.uniforms.uAccum, 0);
      gl.uniform2f(display.uniforms.uRes, width, height);
      gl.uniform1f(display.uniforms.uExposure, exposure);
      gl.uniform1f(display.uniforms.uTime, time);
      gl.uniform1f(display.uniforms.uDpr, dpr);
      gl.uniform1f(display.uniforms.uRadius, radius);
      gl.uniform1f(display.uniforms.uRows, rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      targets = [next, prev];
    },
    dispose() {
      dropTargets();
      gl.deleteBuffer(segBuffer);
      gl.deleteBuffer(energyBuffer);
      gl.deleteVertexArray(emptyVao);
      gl.deleteVertexArray(beamVao);
      gl.deleteProgram(decay.prog);
      gl.deleteProgram(beam.prog);
      gl.deleteProgram(display.prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
