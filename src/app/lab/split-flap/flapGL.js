import { COPY_FRAGMENT, COPY_VERTEX, FLAP_FRAGMENT, FLAP_VERTEX } from "./flapShader";

export const STRIDE = 12;
export const SLOTS = 4;

const CURVE = 0.45;
const FULL = [0, 0, 1, 1];

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

function program(gl, vsSource, fsSource, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(prog, name);
  return { prog, loc };
}

function texture(gl, mip) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createFlapGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const flap = program(gl, FLAP_VERTEX, FLAP_FRAGMENT, ["uRes", "uCell", "uPersp", "uCenter", "uDpr", "uRadius", "uGrid", "uTile", "uTiles", "uThick"]);
  const copy = program(gl, COPY_VERTEX, COPY_FRAGMENT, ["uGrid", "uSrc", "uCrop", "uCurve"]);

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  for (let i = 0; i < 3; i += 1) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }

  const copyVao = gl.createVertexArray();
  gl.bindVertexArray(copyVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const copyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, copyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 256 * 8, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  let copyCapacity = 256;
  const one = new Float32Array([0, 0]);

  const video = texture(gl, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.generateMipmap(gl.TEXTURE_2D);

  const frames = [texture(gl, true), texture(gl, true)];
  let ready = 0;
  let pending = -1;
  const sigTex = texture(gl, false);
  const pbo = gl.createBuffer();
  let fence = null;
  let sigW = 0;
  let sigH = 0;
  let sigPixels = new Uint8Array(4);

  const tiles = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let tileW = 1;
  let tileH = 1;
  let capacity = 0;
  const view = { w: 1, h: 1, dpr: 1, cell: [1, 1, 1, 1], persp: 1, center: [0, 0], radius: 1, grid: [1, 1], tile: [1, 1], thick: 1 };

  function attach(tex, layer) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    if (layer == null) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    } else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, layer);
  }

  function blit(src, crop, curve, w, h, grid, cells) {
    gl.useProgram(copy.prog);
    gl.bindVertexArray(copyVao);
    gl.uniform2f(copy.loc.uGrid, grid[0], grid[1]);
    gl.uniform4f(copy.loc.uCrop, crop[0], crop[1], crop[2], crop[3]);
    gl.uniform1f(copy.loc.uCurve, curve);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(copy.loc.uSrc, 0);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, w, h);
    gl.bindBuffer(gl.ARRAY_BUFFER, copyBuf);
    const list = cells || one;
    if (list.length / 2 > copyCapacity) {
      copyCapacity = Math.max(list.length / 2, Math.ceil(copyCapacity * 1.5));
      gl.bufferData(gl.ARRAY_BUFFER, copyCapacity * 8, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, list instanceof Float32Array ? list : new Float32Array(list));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, list.length / 2);
  }

  function setView(next) {
    Object.assign(view, next);
    const pw = Math.max(1, Math.round(view.w * view.dpr));
    const ph = Math.max(1, Math.round(view.h * view.dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    tileW = Math.max(1, Math.round(view.grid[0] * view.tile[0]));
    tileH = Math.max(1, Math.round(view.grid[1] * view.tile[1]));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, tileW, tileH, SLOTS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.clearColor(0.05, 0.048, 0.045, 1);
    for (let s = 0; s < SLOTS; s += 1) {
      attach(tiles, s);
      gl.viewport(0, 0, tileW, tileH);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const tex of frames) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tileW, tileH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      attach(tex);
      gl.viewport(0, 0, tileW, tileH);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (fence) gl.deleteSync(fence);
    fence = null;
    pending = -1;
    ready = 0;
  }

  function uploadVideo(source) {
    gl.bindTexture(gl.TEXTURE_2D, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function prepare(crop, w, h) {
    if (gl.isContextLost() || fence) return false;
    if (w !== sigW || h !== sigH) {
      sigW = w;
      sigH = h;
      gl.bindTexture(gl.TEXTURE_2D, sigTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      sigPixels = new Uint8Array(w * h * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    pending = 1 - ready;
    attach(frames[pending]);
    blit(video, crop, CURVE, tileW, tileH, [1, 1], null);
    gl.bindTexture(gl.TEXTURE_2D, frames[pending]);
    gl.generateMipmap(gl.TEXTURE_2D);
    attach(sigTex);
    blit(frames[pending], FULL, 0, w, h, [1, 1], null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return true;
  }

  function collect() {
    if (!fence || gl.isContextLost()) return null;
    const status = gl.clientWaitSync(fence, 0, 0);
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return null;
    gl.deleteSync(fence);
    fence = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, sigPixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    ready = pending;
    pending = -1;
    return sigPixels;
  }

  function capture(groups) {
    if (gl.isContextLost()) return;
    let any = false;
    for (const g of groups) if (g.length) any = true;
    if (!any) return;
    for (let s = 0; s < groups.length; s += 1) {
      if (!groups[s].length) continue;
      attach(tiles, s);
      blit(frames[ready], FULL, 0, tileW, tileH, view.grid, groups[s]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  function draw(data, count) {
    if (gl.isContextLost()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(flap.prog);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    if (count > capacity) {
      capacity = Math.max(count, Math.ceil(capacity * 1.5), 256);
      gl.bufferData(gl.ARRAY_BUFFER, capacity * STRIDE * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * STRIDE);
    gl.uniform2f(flap.loc.uRes, view.w, view.h);
    gl.uniform4f(flap.loc.uCell, ...view.cell);
    gl.uniform1f(flap.loc.uPersp, view.persp);
    gl.uniform2f(flap.loc.uCenter, ...view.center);
    gl.uniform1f(flap.loc.uDpr, view.dpr);
    gl.uniform1f(flap.loc.uRadius, view.radius);
    gl.uniform1f(flap.loc.uThick, view.thick);
    gl.uniform2f(flap.loc.uGrid, view.grid[0], view.grid[1]);
    gl.uniform2f(flap.loc.uTile, view.tile[0], view.tile[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles);
    gl.uniform1i(flap.loc.uTiles, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  function destroy() {
    if (fence) gl.deleteSync(fence);
    gl.deleteBuffer(corners);
    gl.deleteBuffer(instances);
    gl.deleteBuffer(copyBuf);
    gl.deleteBuffer(pbo);
    gl.deleteTexture(video);
    frames.forEach((t) => gl.deleteTexture(t));
    gl.deleteTexture(sigTex);
    gl.deleteTexture(tiles);
    gl.deleteFramebuffer(fbo);
    gl.deleteVertexArray(vao);
    gl.deleteVertexArray(copyVao);
    gl.deleteProgram(flap.prog);
    gl.deleteProgram(copy.prog);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { gl, setView, uploadVideo, prepare, collect, capture, draw, destroy };
}
