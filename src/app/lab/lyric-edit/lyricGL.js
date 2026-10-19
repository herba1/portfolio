import { BLUR_FRAGMENT, BRIGHT_FRAGMENT, FINAL_FRAGMENT, FULL_VERTEX } from "./lyricShader";

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
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return t;
}

function target(gl, w, h) {
  const tex = texture(gl, false);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

function dropTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
}

export function createLyricGL(canvas) {
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
  const blur = program(gl, BLUR_FRAGMENT, ["uTex", "uStep", "uLod"]);
  const final = program(gl, FINAL_FRAGMENT, [
    "uImage",
    "uBloom",
    "uText",
    "uGlow",
    "uRes",
    "uCover",
    "uFocus",
    "uCam",
    "uFrame",
    "uFlash",
    "uFade",
    "uGrainScale",
  ]);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const image = texture(gl, true);
  const text = texture(gl, true);
  let bloomA = null;
  let bloomB = null;
  let glowA = null;
  let glowB = null;
  let imageSize = [1, 1];

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

  const blurInto = (src, a, b, lod, radii) => {
    let from = src;
    let fromW = a.w;
    let fromH = a.h;
    let first = true;
    for (const r of radii) {
      gl.useProgram(blur.p);
      bind(0, from, blur.loc.uTex);
      gl.uniform2f(blur.loc.uStep, r / fromW, 0);
      gl.uniform1f(blur.loc.uLod, first ? lod : 0);
      pass(blur, b);
      gl.useProgram(blur.p);
      bind(0, b.tex, blur.loc.uTex);
      gl.uniform2f(blur.loc.uStep, 0, r / b.h);
      gl.uniform1f(blur.loc.uLod, 0);
      pass(blur, a);
      from = a.tex;
      fromW = a.w;
      fromH = a.h;
      first = false;
    }
    return fromH;
  };

  function setImage(source) {
    gl.bindTexture(gl.TEXTURE_2D, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    imageSize = [source.width, source.height];
    dropTarget(gl, bloomA);
    dropTarget(gl, bloomB);
    const bw = Math.max(8, Math.round(source.width / 8));
    const bh = Math.max(8, Math.round(source.height / 8));
    bloomA = target(gl, bw, bh);
    bloomB = target(gl, bw, bh);
    gl.useProgram(bright.p);
    bind(0, image, bright.loc.uTex);
    pass(bright, bloomA);
    blurInto(bloomA.tex, bloomA, bloomB, 0, [1, 2, 3.5]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setSize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const gw = Math.max(4, Math.round(w / 4));
    const gh = Math.max(4, Math.round(h / 4));
    if (!glowA || glowA.w !== gw || glowA.h !== gh) {
      dropTarget(gl, glowA);
      dropTarget(gl, glowB);
      glowA = target(gl, gw, gh);
      glowB = target(gl, gw, gh);
    }
  }

  function setText(source) {
    gl.bindTexture(gl.TEXTURE_2D, text);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (glowA) blurInto(text, glowA, glowB, 2, [1, 2.2]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function draw(u) {
    if (gl.isContextLost() || !glowA || !bloomA) return;
    gl.useProgram(final.p);
    bind(0, image, final.loc.uImage);
    bind(1, bloomA.tex, final.loc.uBloom);
    bind(2, text, final.loc.uText);
    bind(3, glowA.tex, final.loc.uGlow);
    gl.uniform2f(final.loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(final.loc.uCover, u.cover[0], u.cover[1]);
    gl.uniform2f(final.loc.uFocus, u.focus[0], u.focus[1]);
    gl.uniform4f(final.loc.uCam, u.cam[0], u.cam[1], u.cam[2], u.cam[3]);
    gl.uniform1f(final.loc.uFrame, u.frame);
    gl.uniform1f(final.loc.uFlash, u.flash);
    gl.uniform1f(final.loc.uFade, u.fade);
    gl.uniform1f(final.loc.uGrainScale, u.grain);
    pass(final, null);
  }

  function destroy() {
    dropTarget(gl, bloomA);
    dropTarget(gl, bloomB);
    dropTarget(gl, glowA);
    dropTarget(gl, glowB);
    gl.deleteTexture(image);
    gl.deleteTexture(text);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(bright.p);
    gl.deleteProgram(blur.p);
    gl.deleteProgram(final.p);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return {
    setImage,
    setSize,
    setText,
    draw,
    destroy,
    get imageSize() {
      return imageSize;
    },
    lost: () => gl.isContextLost(),
  };
}
