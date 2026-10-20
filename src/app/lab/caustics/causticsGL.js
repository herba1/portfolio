import { CAUSTIC_FS, CAUSTIC_VS, COMPOSE_FS, QUAD_VS, SURFACE_FS, WAVE_COUNT } from "./causticsShader";

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

function texParams(gl, filter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createCausticsGL(canvas) {
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
  const causticGain = floatTargets ? 0.25 : 0.125;

  const caustic = program(gl, CAUSTIC_VS, CAUSTIC_FS);
  const compose = program(gl, QUAD_VS, COMPOSE_FS);
  const surfaceProg = program(gl, QUAD_VS, SURFACE_FS);

  const emptyVao = gl.createVertexArray();
  const meshVao = gl.createVertexArray();
  const meshBuf = gl.createBuffer();
  const indexBuf = gl.createBuffer();
  gl.bindVertexArray(meshVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
  gl.bindVertexArray(null);
  let indexCount = 0;
  let meshKey = "";

  const floorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, floorTex);
  texParams(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([236, 244, 243, 255]));

  const simTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, simTex);
  texParams(gl, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
  let simW = 1;
  let simH = 1;

  const causticTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, causticTex);
  texParams(gl, gl.LINEAR);
  const causticFbo = gl.createFramebuffer();
  let targetW = 0;
  let targetH = 0;

  const surfTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, surfTex);
  texParams(gl, gl.LINEAR);
  const surfFbo = gl.createFramebuffer();
  let surfW = 0;
  let surfH = 0;

  function allocSurface(w, h) {
    if (w === surfW && h === surfH) return;
    surfW = w;
    surfH = h;
    gl.bindTexture(gl.TEXTURE_2D, surfTex);
    if (floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, surfFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surfTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function allocTarget(w, h) {
    if (w === targetW && h === targetH) return;
    targetW = w;
    targetH = h;
    gl.bindTexture(gl.TEXTURE_2D, causticTex);
    if (floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, causticFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, causticTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setMesh(cols, rows) {
    const key = `${cols}x${rows}`;
    if (key === meshKey) return;
    meshKey = key;
    const verts = new Float32Array((cols + 1) * (rows + 1) * 2);
    let k = 0;
    for (let j = 0; j <= rows; j += 1) {
      for (let i = 0; i <= cols; i += 1) {
        verts[k] = i / cols;
        verts[k + 1] = j / rows;
        k += 2;
      }
    }
    const idx = new Uint32Array(cols * rows * 6);
    k = 0;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const a = j * (cols + 1) + i;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        idx[k] = a;
        idx[k + 1] = b;
        idx[k + 2] = c;
        idx[k + 3] = b;
        idx[k + 4] = d;
        idx[k + 5] = c;
        k += 6;
      }
    }
    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    indexCount = idx.length;
  }

  function uploadFloor(source) {
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function uploadSim(data, w, h) {
    gl.bindTexture(gl.TEXTURE_2D, simTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (w !== simW || h !== simH) {
      simW = w;
      simH = h;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    }
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function surfaceUniforms(p, f) {
    gl.uniform4fv(p.loc("uWaves"), f.waves);
    gl.uniform2f(p.loc("uSimSpan"), f.simSpan[0], f.simSpan[1]);
    gl.uniform1f(p.loc("uSimOn"), f.simOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, simTex);
    gl.uniform1i(p.loc("uSim"), 2);
  }

  function draw(f) {
    allocTarget(f.targetW, f.targetH);
    allocSurface(f.surfW, f.surfH);
    setMesh(f.meshCols, f.meshRows);

    gl.bindFramebuffer(gl.FRAMEBUFFER, surfFbo);
    gl.viewport(0, 0, surfW, surfH);
    gl.useProgram(surfaceProg.prog);
    surfaceUniforms(surfaceProg, f);
    gl.uniform1f(surfaceProg.loc("uCell"), f.cell);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, causticFbo);
    gl.viewport(0, 0, targetW, targetH);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(caustic.prog);
    surfaceUniforms(caustic, f);
    gl.uniform2f(caustic.loc("uStage"), f.stage[0], f.stage[1]);
    gl.uniform4f(caustic.loc("uMesh"), -f.margin, -f.margin, f.stage[0] + 2 * f.margin, f.stage[1] + 2 * f.margin);
    gl.uniform3fv(caustic.loc("uSun"), f.sun);
    gl.uniform1f(caustic.loc("uDepth"), f.depth);
    gl.uniform1f(caustic.loc("uGain"), causticGain);
    gl.bindVertexArray(meshVao);
    const etas = f.chroma ? f.etas : [f.etas[1]];
    const masks = f.chroma
      ? [
          [true, false, false],
          [false, true, false],
          [false, false, true],
        ]
      : [[true, true, true]];
    etas.forEach((eta, i) => {
      const m = masks[i];
      gl.colorMask(m[0], m[1], m[2], false);
      gl.uniform1f(caustic.loc("uEta"), eta);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    });
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(compose.prog);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, surfTex);
    gl.uniform1i(compose.loc("uSurf"), 2);
    gl.uniform2f(compose.loc("uSurfSpan"), surfW * f.cell, surfH * f.cell);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, floorTex);
    gl.uniform1i(compose.loc("uFloor"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, causticTex);
    gl.uniform1i(compose.loc("uCaustic"), 1);
    gl.uniform2f(compose.loc("uStage"), f.stage[0], f.stage[1]);
    gl.uniform2f(compose.loc("uRes"), canvas.width, canvas.height);
    gl.uniform1f(compose.loc("uScale"), canvas.width / f.stage[0]);
    gl.uniform3fv(compose.loc("uSun"), f.sun);
    gl.uniform1f(compose.loc("uEta"), f.etas[1]);
    gl.uniform1f(compose.loc("uDepth"), f.viewDepth);
    gl.uniform1f(compose.loc("uCausticNorm"), 1 / causticGain);
    gl.uniform3fv(compose.loc("uAbsorb"), f.absorb);
    gl.uniform3fv(compose.loc("uAmbient"), f.ambient);
    gl.uniform3fv(compose.loc("uSunColor"), f.sunColor);
    gl.uniform3fv(compose.loc("uSky"), f.sky);
    gl.uniform3fv(compose.loc("uGround"), f.ground);
    gl.uniform1f(compose.loc("uFade"), f.fade);
    gl.uniform1f(compose.loc("uDeck"), f.deck || 0);
    gl.uniform3fv(compose.loc("uStone"), f.stone);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|software/i.test(rendererName);

  return {
    software,
    waveCount: WAVE_COUNT,
    resize,
    uploadFloor,
    uploadSim,
    draw,
    destroy() {
      gl.deleteProgram(caustic.prog);
      gl.deleteProgram(compose.prog);
      gl.deleteProgram(surfaceProg.prog);
      gl.deleteTexture(surfTex);
      gl.deleteFramebuffer(surfFbo);
      gl.deleteVertexArray(emptyVao);
      gl.deleteVertexArray(meshVao);
      gl.deleteBuffer(meshBuf);
      gl.deleteBuffer(indexBuf);
      gl.deleteTexture(floorTex);
      gl.deleteTexture(simTex);
      gl.deleteTexture(causticTex);
      gl.deleteFramebuffer(causticFbo);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
