import { BLUR_FRAGMENT, BRIGHT_FRAGMENT, FINAL_FRAGMENT, FULL_VERTEX } from "./wordShader";

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

function program(gl, fragment, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, FULL_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link failed");
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(p, name);
  return { p, loc };
}

function texture(gl, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h) {
  const tex = texture(gl, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

export function createWordGL(canvas) {
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
  const bright = program(gl, BRIGHT_FRAGMENT, ["uTex"]);
  const blur = program(gl, BLUR_FRAGMENT, ["uTex", "uStep"]);
  const final = program(gl, FINAL_FRAGMENT, ["uImage", "uBloom", "uRes", "uCover", "uFocus", "uCam", "uFrame", "uFade", "uGrainScale", "uBlur"]);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const shots = [];
  const scratch = [];

  const pass = (prog, out) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const bind = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  function addImage(source) {
    const tex = texture(gl, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    const bw = Math.max(8, Math.round(source.width / 8));
    const bh = Math.max(8, Math.round(source.height / 8));
    const a = target(gl, bw, bh);
    const b = target(gl, bw, bh);
    gl.useProgram(bright.p);
    bind(0, tex, bright.loc.uTex);
    pass(bright, a);
    for (const r of [1, 2, 3]) {
      gl.useProgram(blur.p);
      bind(0, a.tex, blur.loc.uTex);
      gl.uniform2f(blur.loc.uStep, r / bw, 0);
      pass(blur, b);
      gl.useProgram(blur.p);
      bind(0, b.tex, blur.loc.uTex);
      gl.uniform2f(blur.loc.uStep, 0, r / bh);
      pass(blur, a);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(b.tex);
    gl.deleteFramebuffer(b.fb);
    scratch.push(a.fb);
    shots.push({ tex, bloom: a.tex, size: [source.width, source.height] });
    return shots.length - 1;
  }

  function setSize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function draw(index, u) {
    const shot = shots[index];
    if (!shot || gl.isContextLost()) return;
    gl.useProgram(final.p);
    bind(0, shot.tex, final.loc.uImage);
    bind(1, shot.bloom, final.loc.uBloom);
    gl.uniform2f(final.loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(final.loc.uCover, u.cover[0], u.cover[1]);
    gl.uniform2f(final.loc.uFocus, u.focus[0], u.focus[1]);
    gl.uniform4f(final.loc.uCam, u.cam[0], u.cam[1], u.cam[2], u.cam[3]);
    gl.uniform1f(final.loc.uFrame, u.frame);
    gl.uniform1f(final.loc.uFade, u.fade);
    gl.uniform1f(final.loc.uGrainScale, u.grain);
    gl.uniform1f(final.loc.uBlur, u.blur);
    pass(final, null);
  }

  function destroy() {
    for (const s of shots) {
      gl.deleteTexture(s.tex);
      gl.deleteTexture(s.bloom);
    }
    for (const fb of scratch) gl.deleteFramebuffer(fb);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(bright.p);
    gl.deleteProgram(blur.p);
    gl.deleteProgram(final.p);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { addImage, setSize, draw, destroy, sizeOf: (i) => shots[i]?.size || [1, 1] };
}
