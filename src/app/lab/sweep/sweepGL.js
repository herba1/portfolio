import { SWEEP_DISPLAY, SWEEP_PERSIST, SWEEP_VERTEX } from "./sweepShader";

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
  const vs = compile(gl, gl.VERTEX_SHADER, SWEEP_VERTEX);
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
    const name = info.name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

export function createGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let persist;
  let display;
  try {
    persist = program(gl, SWEEP_PERSIST);
    display = program(gl, SWEEP_DISPLAY);
  } catch {
    return null;
  }
  const float = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const vao = gl.createVertexArray();
  const textTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  let targets = [];
  let width = 0;
  let height = 0;

  const makeTarget = (w, h) => {
    const tex = gl.createTexture();
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, w, h);
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
    float,
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      dropTargets();
      targets = [makeTarget(w, h), makeTarget(w, h)];
    },
    render(f) {
      if (!width || gl.isContextLost()) return;
      gl.bindVertexArray(vao);
      if (f.text) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f.text);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      }
      const [prev, next] = targets;
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, width, height);
      gl.useProgram(persist.prog);
      const u = persist.uniforms;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(u.uPrev, 1);
      gl.uniform2f(u.uCenter, f.cx, f.cy);
      gl.uniform1f(u.uRadius, f.radius);
      gl.uniform1f(u.uA0, f.a0);
      gl.uniform1f(u.uDelta, f.delta);
      gl.uniform1f(u.uDt, f.dt);
      gl.uniform3f(u.uDecay, f.decay[0], f.decay[1], f.decay[2]);
      gl.uniform1f(u.uFloor, float ? 0.0006 : 0.006);
      gl.uniform1f(u.uTauR, f.tauR);
      gl.uniform1f(u.uTauG, f.tauG);
      gl.uniform1f(u.uStamp, f.stamp);
      gl.uniform1f(u.uSeed, f.seed);
      gl.uniform1f(u.uScale, f.scale);
      gl.uniform1i(u.uCount, f.count);
      if (f.count) {
        gl.uniform4fv(u.uBlips, f.blips);
        gl.uniform1fv(u.uAmp, f.amps);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, next.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(display.prog);
      const v = display.uniforms;
      gl.uniform1i(v.uAccum, 1);
      gl.uniform1i(v.uText, 0);
      gl.uniform2f(v.uRes, width, height);
      gl.uniform2f(v.uScene, width, height);
      gl.uniform2f(v.uCenter, f.cx, f.cy);
      gl.uniform1f(v.uRadius, f.radius);
      gl.uniform1f(v.uAngle, f.angle);
      gl.uniform1f(v.uBeamW, f.beamW);
      gl.uniform1f(v.uScale, f.scale);
      gl.uniform1f(v.uTime, f.time);
      gl.uniform1f(v.uPower, f.power);
      gl.uniform1f(v.uFlicker, f.flicker);
      gl.uniform1f(v.uCurve, f.curve);
      gl.uniform4f(v.uLock, f.lock[0], f.lock[1], f.lock[2], f.lock[3]);
      gl.uniform1i(v.uBoxCount, f.boxCount);
      gl.uniform1f(v.uDefault, f.defaultBright);
      if (f.boxCount) {
        gl.uniform4fv(v.uBoxes, f.boxes);
        gl.uniform1fv(v.uBright, f.bright);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      targets = [next, prev];
    },
    dispose() {
      dropTargets();
      gl.deleteTexture(textTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(persist.prog);
      gl.deleteProgram(display.prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
