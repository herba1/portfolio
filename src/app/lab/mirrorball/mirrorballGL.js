import { BLUR_FS, DOWN_FS, SCENE_FS, SCENE_VS, SPECK_FS, SPECK_VS } from "./mirrorballShader";

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
  gl.bindAttribLocation(prog, 0, "aCorner");
  gl.bindAttribLocation(prog, 1, "aFacet");
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

function texture2D(gl, { filter = gl.LINEAR, wrapS = gl.CLAMP_TO_EDGE } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createMirrorGL(canvas, facets) {
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

  const scene = program(gl, SCENE_VS, SCENE_FS);
  const speck = program(gl, SPECK_VS, SPECK_FS);
  const down = program(gl, SCENE_VS, DOWN_FS);
  const blur = program(gl, SCENE_VS, BLUR_FS);

  const emptyVao = gl.createVertexArray();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const facetBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, facetBuf);
  gl.bufferData(gl.ARRAY_BUFFER, facets.instances, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  const count = facets.instances.length / 2;

  const facetTex = texture2D(gl, { filter: gl.NEAREST });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, facets.width, facets.height, 0, gl.RGBA, gl.FLOAT, facets.data);

  const atlasTexes = [0, 1].map(() => {
    const tex = texture2D(gl, { filter: gl.LINEAR_MIPMAP_LINEAR, wrapS: gl.REPEAT });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  });
  const tintTexes = [0, 1].map(() => {
    const tex = texture2D(gl, { filter: gl.NEAREST });
    const blank = new Float32Array(facets.width * facets.height * 4).fill(1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, facets.width, facets.height, 0, gl.RGBA, gl.FLOAT, blank);
    return tex;
  });
  let current = 0;

  const maskTex = texture2D(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const lightTex = texture2D(gl);
  const bloomTexes = [texture2D(gl), texture2D(gl)];
  const bloomFbos = [gl.createFramebuffer(), gl.createFramebuffer()];
  let bloomW = 1;
  let bloomH = 1;
  const glowTex = texture2D(gl, { filter: gl.NEAREST });
  const fbo = gl.createFramebuffer();
  let fboW = 0;
  let fboH = 0;

  function allocTargets(w, h) {
    if (w === fboW && h === fboH) return;
    fboW = w;
    fboH = h;
    for (const tex of [lightTex, glowTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, glowTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    bloomW = Math.max(1, Math.round(w / 4));
    bloomH = Math.max(1, Math.round(h / 4));
    bloomTexes.forEach((tex, i) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, bloomW, bloomH, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bloomW, bloomH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbos[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function pass(p, target, src, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(p.loc("uSrc"), 0);
  }

  function bloomPasses(w, h) {
    gl.disable(gl.BLEND);
    gl.bindVertexArray(emptyVao);
    pass(down, bloomFbos[0], lightTex, bloomW, bloomH);
    gl.uniform2f(down.loc("uSrcRes"), w, h);
    gl.uniform2f(down.loc("uDstRes"), bloomW, bloomH);
    gl.uniform1f(down.loc("uKnee"), 1.2 * lightScale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 0; i < 2; i += 1) {
      pass(blur, bloomFbos[1], bloomTexes[0], bloomW, bloomH);
      gl.uniform2f(blur.loc("uRes"), bloomW, bloomH);
      gl.uniform2f(blur.loc("uDir"), 1 + i, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(blur, bloomFbos[0], bloomTexes[1], bloomW, bloomH);
      gl.uniform2f(blur.loc("uRes"), bloomW, bloomH);
      gl.uniform2f(blur.loc("uDir"), 0, 1 + i);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    allocTargets(w, h);
  }

  function uploadCover(atlas, tint) {
    current = 1 - current;
    gl.bindTexture(gl.TEXTURE_2D, atlasTexes[current]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, tintTexes[current]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, facets.width, facets.height, 0, gl.RGBA, gl.FLOAT, tint);
  }

  function uploadMask(source) {
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function common(p, f) {
    gl.uniform4f(p.loc("uBall"), f.cx, f.cy, f.radius, f.focal);
    gl.uniform3f(p.loc("uCam"), f.cam[0], f.cam[1], f.cam[2]);
    gl.uniform1f(p.loc("uWall"), f.wall);
    gl.uniform4f(p.loc("uRoom"), f.room[0], f.room[1], f.room[2], f.room[3]);
    gl.uniform1f(p.loc("uMix"), f.mix);
    gl.uniformMatrix3fv(p.loc("uRot"), false, f.rot);
    if (f.rotPrev) gl.uniformMatrix3fv(p.loc("uRotPrev"), false, f.rotPrev);
    gl.uniform3f(p.loc("uLight"), f.light[0], f.light[1], f.light[2]);
    gl.uniform3f(p.loc("uGel"), f.gel[0], f.gel[1], f.gel[2]);
    gl.uniform1f(p.loc("uRings"), facets.height);
    gl.uniform2f(p.loc("uBox"), f.width, f.height);
  }

  function draw(f) {
    const w = canvas.width;
    const h = canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(speck.prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, facetTex);
    gl.uniform1i(speck.loc("uFacets"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tintTexes[current]);
    gl.uniform1i(speck.loc("uTint"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tintTexes[1 - current]);
    gl.uniform1i(speck.loc("uTintPrev"), 2);
    common(speck, f);
    gl.uniform1f(speck.loc("uSpread"), f.spread);
    gl.uniform1f(speck.loc("uRayGain"), f.rayGain);
    gl.uniform1f(speck.loc("uSpeckGain"), f.speckGain);
    gl.uniform1f(speck.loc("uLightScale"), lightScale);
    gl.uniform1i(speck.loc("uMode"), 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

    bloomPasses(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(scene.prog);
    gl.bindVertexArray(emptyVao);
    const units = [
      ["uMask", maskTex],
      ["uSpecks", lightTex],
      ["uBloom", bloomTexes[0]],
    ];
    units.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(scene.loc(name), i);
    });
    gl.uniform2f(scene.loc("uRes"), w, h);
    gl.uniform1f(scene.loc("uLightInv"), 1 / lightScale);
    gl.uniform1f(scene.loc("uSeed"), f.seed);
    gl.uniform1f(scene.loc("uMaskOn"), f.maskOn ? 1 : 0);
    gl.uniform1f(scene.loc("uFade"), f.fade);
    gl.uniform2f(scene.loc("uCenter"), (f.cx / f.width) * w, (1 - f.cy / f.height) * h);
    gl.uniform1f(scene.loc("uSwirl"), f.swirl);
    gl.uniform1f(scene.loc("uBend"), f.bend);
    gl.uniform1f(scene.loc("uTime"), f.time);
    gl.uniform1f(scene.loc("uBloomGain"), f.bloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
  }

  function destroy() {
    gl.deleteTexture(facetTex);
    atlasTexes.forEach((t) => gl.deleteTexture(t));
    tintTexes.forEach((t) => gl.deleteTexture(t));
    gl.deleteTexture(maskTex);
    gl.deleteTexture(lightTex);
    gl.deleteTexture(glowTex);
    bloomTexes.forEach((t) => gl.deleteTexture(t));
    bloomFbos.forEach((b) => gl.deleteFramebuffer(b));
    gl.deleteProgram(down.prog);
    gl.deleteProgram(blur.prog);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(cornerBuf);
    gl.deleteBuffer(facetBuf);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(emptyVao);
    gl.deleteProgram(scene.prog);
    gl.deleteProgram(speck.prog);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { resize, uploadCover, uploadMask, draw, destroy };
}
