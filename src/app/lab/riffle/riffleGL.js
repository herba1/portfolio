import { DEPTH_FRAGMENT, SHEET_FRAGMENT, SHEET_VERTEX, TABLE_FRAGMENT, TABLE_VERTEX } from "./riffleShader";

const SHEET_UNIFORMS = ["uDrawn", "uVP", "uMap", "uMapOff", "uCorner", "uCurlK", "uFlightD0", "uHalfT", "uFrames", "uShadow", "uLightVP", "uLight", "uCam", "uSwap", "uShadowTexel", "uPenScale", "uBias", "uCoverLayer", "uFlipDet"];
const TABLE_UNIFORMS = ["uVP", "uExtent", "uShadow", "uLightVP", "uShadowTexel", "uPenScale", "uBias", "uGround", "uFoot", "uFootRot"];

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

function link(gl, vertex, fragment, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(program, name);
  return { program, loc };
}

function sheetMesh(cols, rows) {
  const verts = [];
  const index = [];
  const push = (u, v, side, ox, oy) => {
    verts.push(u, v, side, ox, oy);
    return verts.length / 5 - 1;
  };
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const u = i / cols;
      const v = j / rows;
      push(u, v, 0, 0, 0);
    }
  }
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const edge = (points, ox, oy) => {
    let prevTop = -1;
    let prevBottom = -1;
    for (const [u, v] of points) {
      const top = push(u, v, 0, ox, oy);
      const bottom = push(u, v, 1, ox, oy);
      if (prevTop >= 0) index.push(prevTop, prevBottom, top, top, prevBottom, bottom);
      prevTop = top;
      prevBottom = bottom;
    }
  };
  const along = (n, f) => Array.from({ length: n + 1 }, (_, k) => f(k / n));
  edge(along(cols, (t) => [t, 1]), 0, 1);
  edge(along(cols, (t) => [t, 0]), 0, -1);
  edge(along(rows, (t) => [1, t]), 1, 0);
  edge(along(rows, (t) => [0, t]), -1, 0);
  return { verts: new Float32Array(verts), index: new Uint32Array(index) };
}

export function createRiffleGL(canvas, { instances, layers, texW, texH, shadowSize }) {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const sheet = link(gl, SHEET_VERTEX, SHEET_FRAGMENT, SHEET_UNIFORMS);
  const depth = link(gl, SHEET_VERTEX, DEPTH_FRAGMENT, ["uVP", "uMap", "uMapOff", "uCorner", "uCurlK", "uFlightD0", "uHalfT"]);
  const table = link(gl, TABLE_VERTEX, TABLE_FRAGMENT, TABLE_UNIFORMS);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

  const mesh = sheetMesh(40, 30);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);

  function sheetVao(byteLength) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 3; k += 1) {
      gl.enableVertexAttribArray(2 + k);
      gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(2 + k, 1);
    }
    gl.bindVertexArray(null);
    return { vao, buf };
  }

  const mainSet = sheetVao(instances * 48);
  const shadowSet = sheetVao(instances * 48);

  const tableVao = gl.createVertexArray();
  gl.bindVertexArray(tableVao);
  const tbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const frames = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, frames);
  const levels = Math.floor(Math.log2(Math.max(texW, texH))) + 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, texW, texH, layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);

  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, shadowSize, shadowSize);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let mipsWanted = false;

  function upload(layer, source) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, frames);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, texW, texH, 1, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function finishMips() {
    mipsWanted = true;
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function setSheetUniforms(loc, f) {
    gl.uniformMatrix3fv(loc.uMap, false, f.map);
    gl.uniform3fv(loc.uMapOff, f.mapOff);
    gl.uniform4fv(loc.uCorner, f.corner);
    gl.uniform1f(loc.uCurlK, f.curlK);
    gl.uniform1f(loc.uFlightD0, f.flightD0);
    gl.uniform1f(loc.uHalfT, f.halfT);
  }

  function draw(f) {
    if (mipsWanted) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, frames);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels - 1);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      mipsWanted = false;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mainSet.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.instances, 0, f.count * 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowSet.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.casters, 0, f.casterCount * 12);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, shadowSize, shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depth.program);
    gl.uniformMatrix4fv(depth.loc.uVP, false, f.lightVP);
    setSheetUniforms(depth.loc, f);
    gl.bindVertexArray(shadowSet.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_INT, 0, f.casterCount);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(f.ground[0], f.ground[1], f.ground[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, frames);

    gl.useProgram(table.program);
    const t = table.loc;
    gl.uniformMatrix4fv(t.uVP, false, f.vp);
    gl.uniform1f(t.uExtent, 12);
    gl.uniform1i(t.uShadow, 1);
    gl.uniformMatrix4fv(t.uLightVP, false, f.lightVP);
    gl.uniform1f(t.uShadowTexel, 1 / shadowSize);
    gl.uniform1f(t.uPenScale, f.penScale);
    gl.uniform1f(t.uBias, f.bias);
    gl.uniform3fv(t.uGround, f.ground);
    gl.uniform4fv(t.uFoot, f.foot);
    gl.uniform2fv(t.uFootRot, f.footRot);
    gl.bindVertexArray(tableVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(sheet.program);
    const l = sheet.loc;
    gl.uniformMatrix4fv(l.uVP, false, f.vp);
    setSheetUniforms(l, f);
    gl.uniform1i(l.uFrames, 0);
    gl.uniform1i(l.uShadow, 1);
    gl.uniformMatrix4fv(l.uLightVP, false, f.lightVP);
    gl.uniform3fv(l.uLight, f.light);
    gl.uniform3fv(l.uCam, f.cam);
    gl.uniform1f(l.uSwap, f.swap);
    gl.uniform1f(l.uShadowTexel, 1 / shadowSize);
    gl.uniform1f(l.uPenScale, f.penScale);
    gl.uniform1f(l.uBias, f.bias);
    gl.uniform1f(l.uCoverLayer, f.coverLayer);
    gl.uniform1f(l.uFlipDet, f.flipDet);
    gl.uniform1i(l.uDrawn, f.drawn);
    gl.bindVertexArray(mainSet.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_INT, 0, f.count);
    gl.bindVertexArray(null);
  }

  function destroy() {
    gl.deleteProgram(sheet.program);
    gl.deleteProgram(depth.program);
    gl.deleteProgram(table.program);
    gl.deleteBuffer(vbo);
    gl.deleteBuffer(ibo);
    gl.deleteBuffer(mainSet.buf);
    gl.deleteBuffer(shadowSet.buf);
    gl.deleteBuffer(tbo);
    gl.deleteVertexArray(mainSet.vao);
    gl.deleteVertexArray(shadowSet.vao);
    gl.deleteVertexArray(tableVao);
    gl.deleteTexture(frames);
    gl.deleteTexture(shadowTex);
    gl.deleteFramebuffer(shadowFbo);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { upload, finishMips, resize, draw, destroy };
}
