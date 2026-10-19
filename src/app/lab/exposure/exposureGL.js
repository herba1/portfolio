import { BLUR_FRAGMENT, FINAL_FRAGMENT, FULL_VERTEX, SCENE_FRAGMENT, TEXT_FRAGMENT } from "./exposureShader";

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

export function createExposureGL(canvas) {
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
  const half = Boolean(gl.getExtension("EXT_color_buffer_float"));

  const scene = program(gl, SCENE_FRAGMENT, ["uTex", "uLod", "uKnee"]);
  const textPass = program(gl, TEXT_FRAGMENT, ["uTex", "uLod"]);
  const blur = program(gl, BLUR_FRAGMENT, ["uTex", "uStep"]);
  const final = program(gl, FINAL_FRAGMENT, [
    "uImage",
    "uBloom",
    "uHalo",
    "uText",
    "uTextBloom",
    "uTextHalo",
    "uRes",
    "uCover",
    "uFocus",
    "uCam",
    "uEv",
    "uFrame",
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

  const targets = new Set();
  const target = (w, h) => {
    const tex = texture(gl, false);
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = { tex, fb, w, h };
    targets.add(t);
    return t;
  };
  const drop = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
    targets.delete(t);
  };

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

  const unbindAll = () => {
    for (let i = 0; i < 6; i += 1) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  };

  const blurChain = (a, b, radii) => {
    for (const r of radii) {
      gl.useProgram(blur.p);
      bind(0, a.tex, blur.loc.uTex);
      gl.uniform2f(blur.loc.uStep, r / a.w, 0);
      pass(blur, b);
      gl.useProgram(blur.p);
      bind(0, b.tex, blur.loc.uTex);
      gl.uniform2f(blur.loc.uStep, 0, r / a.h);
      pass(blur, a);
    }
  };

  const image = texture(gl, true);
  const text = texture(gl, true);
  let imageSize = [1, 1];
  let bloom = null;
  let halo = null;
  let textBloom = null;
  let textHalo = null;
  let scratchA = null;
  let scratchB = null;

  const sceneInto = (out, lod, knee, scratch, radii) => {
    gl.useProgram(scene.p);
    bind(0, image, scene.loc.uTex);
    gl.uniform1f(scene.loc.uLod, lod);
    gl.uniform1f(scene.loc.uKnee, knee);
    pass(scene, out);
    blurChain(out, scratch, radii);
  };

  function setImage(source) {
    unbindAll();
    gl.bindTexture(gl.TEXTURE_2D, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    imageSize = [source.width, source.height];
    drop(bloom);
    drop(halo);
    const bw = Math.max(8, Math.round(source.width / 4));
    const bh = Math.max(8, Math.round(source.height / 4));
    bloom = target(bw, bh);
    const sb = target(bw, bh);
    sceneInto(bloom, 2, 0, sb, [1, 2]);
    drop(sb);
    const hw = Math.max(8, Math.round(source.width / 8));
    const hh = Math.max(8, Math.round(source.height / 8));
    halo = target(hw, hh);
    const sh = target(hw, hh);
    sceneInto(halo, 3, 0.55, sh, [1, 2, 3.5]);
    drop(sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setSize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const tw = Math.max(4, Math.round(w / 4));
    const th = Math.max(4, Math.round(h / 4));
    if (!textBloom || textBloom.w !== tw || textBloom.h !== th) {
      drop(textBloom);
      drop(scratchA);
      textBloom = target(tw, th);
      scratchA = target(tw, th);
    }
    const hw = Math.max(4, Math.round(w / 8));
    const hh = Math.max(4, Math.round(h / 8));
    if (!textHalo || textHalo.w !== hw || textHalo.h !== hh) {
      drop(textHalo);
      drop(scratchB);
      textHalo = target(hw, hh);
      scratchB = target(hw, hh);
    }
  }

  function setText(source) {
    unbindAll();
    gl.bindTexture(gl.TEXTURE_2D, text);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (!textBloom) return;
    gl.useProgram(textPass.p);
    bind(0, text, textPass.loc.uTex);
    gl.uniform1f(textPass.loc.uLod, 2);
    pass(textPass, textBloom);
    blurChain(textBloom, scratchA, [1, 2]);
    gl.useProgram(textPass.p);
    bind(0, text, textPass.loc.uTex);
    gl.uniform1f(textPass.loc.uLod, 3);
    pass(textPass, textHalo);
    blurChain(textHalo, scratchB, [1, 2, 3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function draw(u) {
    if (gl.isContextLost() || !bloom || !textBloom) return;
    gl.useProgram(final.p);
    bind(0, image, final.loc.uImage);
    bind(1, bloom.tex, final.loc.uBloom);
    bind(2, halo.tex, final.loc.uHalo);
    bind(3, text, final.loc.uText);
    bind(4, textBloom.tex, final.loc.uTextBloom);
    bind(5, textHalo.tex, final.loc.uTextHalo);
    gl.uniform2f(final.loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(final.loc.uCover, u.cover[0], u.cover[1]);
    gl.uniform2f(final.loc.uFocus, u.focus[0], u.focus[1]);
    gl.uniform4f(final.loc.uCam, u.cam[0], u.cam[1], u.cam[2], u.cam[3]);
    gl.uniform1f(final.loc.uEv, u.ev);
    gl.uniform1f(final.loc.uFrame, u.frame);
    gl.uniform1f(final.loc.uFade, u.fade);
    gl.uniform1f(final.loc.uGrainScale, u.grain);
    pass(final, null);
  }

  function destroy() {
    for (const t of [...targets]) drop(t);
    gl.deleteTexture(image);
    gl.deleteTexture(text);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(scene.p);
    gl.deleteProgram(textPass.p);
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
  };
}
