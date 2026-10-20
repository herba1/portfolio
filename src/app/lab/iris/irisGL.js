import { COMPOSE_FS, PREP_FS, QUAD_VS, SPRITE_FS, SPRITE_VS } from "./irisShader";

export const RADII = [0, 1.25, 2.5, 5, 9, 15];

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

function params(gl, target, filter) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createIrisGL(canvas) {
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
  const lightScale = floatTargets ? 1 : 1 / 32;

  const prep = program(gl, QUAD_VS, PREP_FS);
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

  const baseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, baseTex);
  params(gl, gl.TEXTURE_2D, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  const depthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  params(gl, gl.TEXTURE_2D, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));

  const levelsTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, levelsTex);
  params(gl, gl.TEXTURE_2D_ARRAY, gl.LINEAR);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, 1, 1, 6, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(24));

  const spriteTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, spriteTex);
  params(gl, gl.TEXTURE_2D, gl.LINEAR);
  const spriteFbo = gl.createFramebuffer();
  let fboW = 0;
  let fboH = 0;

  function allocTargets(w, h) {
    if (w === fboW && h === fboH) return;
    fboW = w;
    fboH = h;
    gl.bindTexture(gl.TEXTURE_2D, spriteTex);
    if (floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, spriteFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, spriteTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    allocTargets(w, h);
  }

  function uploadScene(scene) {
    const { width: W, height: H } = scene;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, baseTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(scene.base.data.buffer));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, scene.depthW, scene.depthH, 0, gl.RED, gl.UNSIGNED_BYTE, scene.depth);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, levelsTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, W, H, RADII.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(prep.prog);
    gl.bindVertexArray(emptyVao);
    gl.uniform2f(prep.loc("uSize"), W, H);
    gl.uniform1i(prep.loc("uBase"), 0);
    gl.uniform1i(prep.loc("uDepth"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    for (let i = 0; i < RADII.length; i += 1) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, levelsTex, 0, i);
      gl.uniform1f(prep.loc("uRadius"), RADII[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);

    gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, scene.lights, gl.STATIC_DRAW);
    lightCount = scene.count;
  }

  function draw(f) {
    const w = canvas.width;
    const h = canvas.height;

    const sf = f.spriteScale;
    const vw = Math.max(1, Math.round(w * sf));
    const vh = Math.max(1, Math.round(h * sf));
    gl.bindFramebuffer(gl.FRAMEBUFFER, spriteFbo);
    gl.viewport(0, 0, vw, vh);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (lightCount > 0 && f.fade > 0) {
      const sx = Math.max(0, Math.floor((f.cx - f.openVis) * sf - 2));
      const sy = Math.max(0, Math.floor((h - (f.cy + f.openVis)) * sf - 2));
      const sw = Math.min(vw - sx, Math.ceil(f.openVis * 2 * sf + 4));
      const sh = Math.min(vh - sy, Math.ceil(f.openVis * 2 * sf + 4));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sx, sy, Math.max(0, sw), Math.max(0, sh));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(sprite.prog);
      gl.bindVertexArray(vao);
      gl.uniform2f(sprite.loc("uRes"), w, h);
      gl.uniform4f(sprite.loc("uMap"), f.map[0], f.map[1], f.map[2], f.map[3]);
      gl.uniform2f(sprite.loc("uCenter"), f.cx, f.cy);
      gl.uniform1f(sprite.loc("uOpenMax"), f.openMax);
      gl.uniform1f(sprite.loc("uOpenVis"), f.openVis);
      gl.uniform1f(sprite.loc("uCoc"), f.coc);
      gl.uniform1f(sprite.loc("uFocus"), f.focus);
      gl.uniform1f(sprite.loc("uK"), f.k);
      gl.uniform1f(sprite.loc("uBoost"), f.boost);
      gl.uniform1f(sprite.loc("uSpike"), f.spike);
      gl.uniform1f(sprite.loc("uSpikeLen"), f.spikeLen);
      gl.uniform1f(sprite.loc("uRot"), f.rot);
      gl.uniform2fv(sprite.loc("uShape"), f.shapeC);
      gl.uniform1f(sprite.loc("uShapeRb"), f.shapeRb);
      gl.uniform1f(sprite.loc("uAA"), 1 / sf);
      gl.uniform1f(sprite.loc("uCat"), f.cat);
      gl.uniform1f(sprite.loc("uLightScale"), lightScale);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lightCount);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(compose.prog);
    gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, levelsTex);
    gl.uniform1i(compose.loc("uLevels"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(compose.loc("uDepth"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, spriteTex);
    gl.uniform1i(compose.loc("uSprites"), 2);
    gl.uniform2f(compose.loc("uRes"), w, h);
    gl.uniform2f(compose.loc("uCenter"), f.cx, f.cy);
    gl.uniform1f(compose.loc("uRl"), f.rl);
    gl.uniform1f(compose.loc("uPx"), f.px);
    gl.uniform2fv(compose.loc("uBladeC"), f.bladeC);
    gl.uniform2fv(compose.loc("uBladeN"), f.bladeN);
    gl.uniform1f(compose.loc("uRb"), f.rb);
    gl.uniform1f(compose.loc("uSpriteScale"), sf);
    gl.uniform1f(compose.loc("uRing"), f.ring);
    gl.uniform4f(compose.loc("uMap"), f.map[0], f.map[1], f.map[2], f.map[3]);
    gl.uniform1f(compose.loc("uK"), f.k);
    gl.uniform1f(compose.loc("uCoc"), f.coc);
    gl.uniform1f(compose.loc("uFocus"), f.focus);
    gl.uniform1f(compose.loc("uExposure"), f.exposure);
    gl.uniform1f(compose.loc("uVig"), f.vig);
    gl.uniform1f(compose.loc("uFade"), f.fade);
    gl.uniform1f(compose.loc("uLightInv"), 1 / lightScale);
    gl.uniform3f(compose.loc("uSpill"), f.spill[0], f.spill[1], f.spill[2]);
    gl.uniform1fv(compose.loc("uRadii"), RADII);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function destroy() {
    gl.deleteTexture(baseTex);
    gl.deleteTexture(depthTex);
    gl.deleteTexture(levelsTex);
    gl.deleteTexture(spriteTex);
    gl.deleteFramebuffer(spriteFbo);
    gl.deleteBuffer(cornerBuf);
    gl.deleteBuffer(lightBuf);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(emptyVao);
    gl.deleteProgram(prep.prog);
    gl.deleteProgram(sprite.prog);
    gl.deleteProgram(compose.prog);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { resize, uploadScene, draw, destroy };
}
