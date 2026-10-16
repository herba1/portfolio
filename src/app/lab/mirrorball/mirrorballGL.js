import { GLINT_FS, SCENE_FS, SCENE_VS, SPECK_FS, SPECK_VS } from "./mirrorballShader";

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

function noiseField(size) {
  const out = new Uint8Array(size * size * 4);
  let seed = 917;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const layer = (cells, octaves) => {
    const field = new Float32Array(size * size);
    let amp = 0.5;
    let total = 0;
    for (let o = 0; o < octaves; o += 1) {
      const c = cells << o;
      const lattice = new Float32Array(c * c);
      for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
      for (let y = 0; y < size; y += 1) {
        const fy = (y / size) * c;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        const y1 = (y0 + 1) % c;
        for (let x = 0; x < size; x += 1) {
          const fx = (x / size) * c;
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const x1 = (x0 + 1) % c;
          const a = lattice[y0 * c + x0];
          const b = lattice[y0 * c + x1];
          const d = lattice[y1 * c + x0];
          const e = lattice[y1 * c + x1];
          field[y * size + x] += (a + (b - a) * sx + (d - a + (a - b - d + e) * sx) * sy) * amp;
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < field.length; i += 1) field[i] /= total;
    return field;
  };
  const r = layer(4, 4);
  const g = layer(16, 3);
  const a = layer(8, 4);
  for (let i = 0; i < size * size; i += 1) {
    out[i * 4] = Math.round(r[i] * 255);
    out[i * 4 + 1] = Math.round(g[i] * 255);
    out[i * 4 + 2] = Math.round(rand() * 255);
    out[i * 4 + 3] = Math.round(a[i] * 255);
  }
  return out;
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
  const glint = program(gl, SPECK_VS, GLINT_FS);

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

  const atlasTex = texture2D(gl, { filter: gl.LINEAR_MIPMAP_LINEAR, wrapS: gl.REPEAT });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.generateMipmap(gl.TEXTURE_2D);

  const noiseTex = texture2D(gl, { filter: gl.LINEAR_MIPMAP_LINEAR, wrapS: gl.REPEAT });
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseField(256));
  gl.generateMipmap(gl.TEXTURE_2D);

  const maskTex = texture2D(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const lightTex = texture2D(gl, { filter: gl.NEAREST });
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    allocTargets(w, h);
  }

  function uploadAtlas(source) {
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
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
    common(speck, f);
    gl.uniform1f(speck.loc("uSpread"), f.spread);
    gl.uniform1f(speck.loc("uRayGain"), f.rayGain);
    gl.uniform1f(speck.loc("uSpeckGain"), f.speckGain);
    gl.uniform1f(speck.loc("uLightScale"), lightScale);
    gl.uniform1i(speck.loc("uMode"), 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.uniform1i(speck.loc("uMode"), 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(scene.prog);
    gl.bindVertexArray(emptyVao);
    const units = [
      ["uFacets", facetTex],
      ["uAtlas", atlasTex],
      ["uMask", maskTex],
      ["uSpecks", lightTex],
      ["uGlow", glowTex],
      ["uNoise", noiseTex],
    ];
    units.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(scene.loc(name), i);
    });
    common(scene, f);
    gl.uniform2f(scene.loc("uRes"), w, h);
    gl.uniform1f(scene.loc("uTime"), f.time);
    gl.uniform1f(scene.loc("uLightInv"), 1 / lightScale);
    gl.uniform1f(scene.loc("uFrag"), f.frag);
    gl.uniform1f(scene.loc("uEnvLod"), f.envLod);
    gl.uniform1f(scene.loc("uHaze"), f.haze);
    gl.uniform1f(scene.loc("uSeed"), f.seed);
    gl.uniform1f(scene.loc("uMaskOn"), f.maskOn ? 1 : 0);
    gl.uniform1f(scene.loc("uPhotoOn"), f.photoOn);
    gl.uniform1f(scene.loc("uFade"), f.fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(glint.prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, facetTex);
    gl.uniform1i(glint.loc("uFacets"), 0);
    common(glint, f);
    gl.uniform1f(glint.loc("uSpread"), f.spread);
    gl.uniform1f(glint.loc("uGlintGain"), f.glintGain);
    gl.uniform1f(glint.loc("uFade"), f.fade);
    gl.uniform1i(glint.loc("uMode"), 2);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function destroy() {
    gl.deleteTexture(facetTex);
    gl.deleteTexture(atlasTex);
    gl.deleteTexture(maskTex);
    gl.deleteTexture(noiseTex);
    gl.deleteTexture(lightTex);
    gl.deleteTexture(glowTex);
    gl.deleteFramebuffer(fbo);
    gl.deleteBuffer(cornerBuf);
    gl.deleteBuffer(facetBuf);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(emptyVao);
    gl.deleteProgram(scene.prog);
    gl.deleteProgram(speck.prog);
    gl.deleteProgram(glint.prog);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { resize, uploadAtlas, uploadMask, draw, destroy };
}
