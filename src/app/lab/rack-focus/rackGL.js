import { BLUR_FS, COMPOSE_FS, QUAD_VS, SPRITE_FS, SPRITE_VS } from "./rackShader";

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

function program(gl, vsSource, fsSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const cache = new Map();
  const loc = (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
    return cache.get(name);
  };
  return { prog, loc };
}

function texParams(gl, minFilter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createRackGL(canvas) {
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

  const floatTargets = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const lightScale = floatTargets ? 1 : 1 / 24;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|software/i.test(rendererName);

  const blur = program(gl, QUAD_VS, BLUR_FS);
  const sprite = program(gl, SPRITE_VS, SPRITE_FS);
  const compose = program(gl, QUAD_VS, COMPOSE_FS);

  const emptyVao = gl.createVertexArray();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const lightBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);
  let lightCount = 0;

  function makeTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    texParams(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return tex;
  }

  const bgTex = makeTexture();
  const typeTex = makeTexture();
  const sizes = { bg: [1, 1], type: [1, 1] };

  function target(internal, format, type) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    texParams(gl, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    const t = { tex, fbo, w: 0, h: 0 };
    t.alloc = (w, h) => {
      if (w === t.w && h === t.h) return;
      t.w = w;
      t.h = h;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    return t;
  }

  const bgBlur = floatTargets ? target(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : target(gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const typeBlur = target(gl.R8, gl.RED, gl.UNSIGNED_BYTE);
  const lights = floatTargets ? target(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : target(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);

  function upload(tex, source, srgb) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    texParams(gl, gl.LINEAR_MIPMAP_LINEAR);
  }

  function uploadBackground(source) {
    upload(bgTex, source, true);
    sizes.bg = [source.width, source.height];
  }

  function uploadType(source) {
    upload(typeTex, source, false);
    sizes.type = [source.width, source.height];
  }

  function uploadLights(data, count) {
    gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    lightCount = count;
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function runBlur(dst, src, size, radiusPx, breath, alpha) {
    dst.alloc(...size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(blur.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(blur.loc("uSource"), 0);
    gl.uniform2f(blur.loc("uSize"), dst.w, dst.h);
    gl.uniform2f(blur.loc("uSourceSize"), alpha ? sizes.type[0] : sizes.bg[0], alpha ? sizes.type[1] : sizes.bg[1]);
    gl.uniform1f(blur.loc("uRadius"), radiusPx);
    gl.uniform1f(blur.loc("uBreath"), breath);
    gl.uniform1i(blur.loc("uAlpha"), alpha ? 1 : 0);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function draw(f) {
    const w = canvas.width;
    const h = canvas.height;
    const half = [Math.max(1, Math.round(w * f.blurScale)), Math.max(1, Math.round(h * f.blurScale))];
    const bgSrcScale = sizes.bg[0] / f.stage[0];
    const typeSrcScale = sizes.type[0] / f.stage[0];
    if (f.bgRadius > 0.6) runBlur(bgBlur, bgTex, half, f.bgRadius * bgSrcScale, f.breath, false);
    if (f.typeRadius > 0.6) runBlur(typeBlur, typeTex, half, f.typeRadius * typeSrcScale, f.breath, true);
    if (bgBlur.w === 0) bgBlur.alloc(1, 1);
    if (typeBlur.w === 0) typeBlur.alloc(1, 1);

    lights.alloc(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lights.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(sprite.prog);
    gl.uniform2f(sprite.loc("uStage"), f.stage[0], f.stage[1]);
    gl.uniform1f(sprite.loc("uPhi"), f.phi);
    gl.uniform1f(sprite.loc("uK"), f.k);
    gl.uniform1f(sprite.loc("uBreath"), f.breath);
    gl.uniform1f(sprite.loc("uPx"), w / f.stage[0]);
    gl.uniform1f(sprite.loc("uBlades"), f.blades);
    gl.uniform1f(sprite.loc("uRot"), f.bladeRot);
    gl.uniform1f(sprite.loc("uOut"), lightScale);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lightCount);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(compose.prog);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(compose.loc(name), unit);
    };
    bind(0, bgTex, "uBg");
    bind(1, bgBlur.tex, "uBgBlur");
    bind(2, typeTex, "uType");
    bind(3, typeBlur.tex, "uTypeBlur");
    bind(4, lights.tex, "uLights");
    gl.uniform2f(compose.loc("uRes"), w, h);
    gl.uniform1f(compose.loc("uBreath"), f.breath);
    gl.uniform1f(compose.loc("uBgRadius"), f.bgRadius * (w / f.stage[0]));
    gl.uniform1f(compose.loc("uTypeRadius"), f.typeRadius * (w / f.stage[0]));
    gl.uniform1f(compose.loc("uLightScale"), 1 / lightScale);
    gl.uniform1f(compose.loc("uExposure"), f.exposure);
    gl.uniform1f(compose.loc("uFade"), f.fade);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  return {
    software,
    lightScale,
    resize,
    uploadBackground,
    uploadType,
    uploadLights,
    draw,
    destroy() {
      [blur, sprite, compose].forEach((p) => gl.deleteProgram(p.prog));
      gl.deleteVertexArray(emptyVao);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(lightBuf);
      [bgTex, typeTex, bgBlur.tex, typeBlur.tex, lights.tex].forEach((t) => gl.deleteTexture(t));
      [bgBlur.fbo, typeBlur.fbo, lights.fbo].forEach((fb) => gl.deleteFramebuffer(fb));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
