import { BUST_FINAL, BUST_MATCH, BUST_SCENE, BUST_VERTEX, NG, SUB_X, SUB_Y } from "./bustShader";
import { TILE, WEIGHTS } from "./bustGlyphs";

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

function program(gl, vs, source, names) {
  const fs = compile(gl, gl.FRAGMENT_SHADER, source);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link failed");
  gl.deleteShader(fs);
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(p, name);
  return { p, loc };
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

function drop(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function imageTexture(gl, source, mips) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

export function createBustGL(canvas) {
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

  const vs = compile(gl, gl.VERTEX_SHADER, BUST_VERTEX);
  const scene = program(gl, vs, BUST_SCENE, ["uOrigin", "uCell", "uFrame", "uYaw", "uLight", "uPhoto"]);
  const match = program(gl, vs, BUST_MATCH, ["uG", "uState", "uGlyph", "uMean", "uDt", "uInit", "uFade", "uContrast"]);
  const final = program(gl, vs, BUST_FINAL, ["uState", "uAtlas", "uRes", "uDpr", "uOrigin", "uCell", "uTile", "uAtlasSize", "uPaper", "uInk"]);
  const vao = gl.createVertexArray();

  let photo = null;
  let atlas = null;
  let atlasSize = [1, 1];
  let gbuf = null;
  let states = [null, null];
  let front = 0;
  let needsInit = true;
  let clip = "";

  function setPhoto(image) {
    photo = imageTexture(gl, image, true);
  }

  function setAtlas(atlasCanvas, glyph, mean) {
    atlas = imageTexture(gl, atlasCanvas, true);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    atlasSize = [atlasCanvas.width, atlasCanvas.height];
    gl.useProgram(match.p);
    gl.uniform4fv(match.loc.uGlyph, glyph);
    gl.uniform1fv(match.loc.uMean, mean);
  }

  function setGrid(cols, rows) {
    if (states[0] && states[0].w === cols && states[0].h === rows) return;
    drop(gl, gbuf);
    drop(gl, states[0]);
    drop(gl, states[1]);
    gbuf = target(gl, cols * SUB_X, rows * SUB_Y);
    states = [target(gl, cols, rows), target(gl, cols, rows)];
    front = 0;
    needsInit = true;
    clip = "";
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(f) {
    if (!photo || !atlas || !gbuf) return;
    gl.bindVertexArray(vao);

    if (f.scene) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, gbuf.fbo);
      gl.viewport(0, 0, gbuf.w, gbuf.h);
      const x0 = Math.max(0, Math.floor(((f.bounds[0] - f.origin[0]) / f.cell[0]) * SUB_X));
      const y0 = Math.max(0, Math.floor(((f.bounds[1] - f.origin[1]) / f.cell[1]) * SUB_Y));
      const x1 = Math.min(gbuf.w, Math.ceil(((f.bounds[2] - f.origin[0]) / f.cell[0]) * SUB_X));
      const y1 = Math.min(gbuf.h, Math.ceil(((f.bounds[3] - f.origin[1]) / f.cell[1]) * SUB_Y));
      const key = `${gbuf.w}:${gbuf.h}:${x0}:${y0}:${x1}:${y1}`;
      if (key !== clip) {
        gl.clearColor(0, 1, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        clip = key;
      }
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
      gl.useProgram(scene.p);
      gl.uniform2f(scene.loc.uOrigin, f.origin[0], f.origin[1]);
      gl.uniform2f(scene.loc.uCell, f.cell[0], f.cell[1]);
      gl.uniform3f(scene.loc.uFrame, f.cx, f.cy, f.scale);
      gl.uniform1f(scene.loc.uYaw, f.yaw);
      gl.uniform3f(scene.loc.uLight, f.light[0], f.light[1], f.light[2]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, photo);
      gl.uniform1i(scene.loc.uPhoto, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
    }

    const src = states[front];
    const dst = states[1 - front];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(match.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gbuf.tex);
    gl.uniform1i(match.loc.uG, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(match.loc.uState, 1);
    gl.uniform1f(match.loc.uDt, f.dt);
    gl.uniform1f(match.loc.uInit, needsInit || f.instant ? 1 : 0);
    gl.uniform1f(match.loc.uFade, f.fade);
    gl.uniform1f(match.loc.uContrast, f.contrast);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    needsInit = false;
    front = 1 - front;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(final.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.uniform1i(final.loc.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(final.loc.uAtlas, 1);
    gl.uniform2f(final.loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(final.loc.uDpr, f.dpr);
    gl.uniform2f(final.loc.uOrigin, f.origin[0], f.origin[1]);
    gl.uniform2f(final.loc.uCell, f.cell[0], f.cell[1]);
    gl.uniform4f(final.loc.uTile, TILE.w, TILE.h, TILE.pad, TILE.pad);
    gl.uniform2f(final.loc.uAtlasSize, atlasSize[0], atlasSize[1]);
    gl.uniform3f(final.loc.uPaper, f.paper[0], f.paper[1], f.paper[2]);
    gl.uniform3f(final.loc.uInk, f.ink[0], f.ink[1], f.ink[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    drop(gl, gbuf);
    drop(gl, states[0]);
    drop(gl, states[1]);
    if (photo) gl.deleteTexture(photo);
    if (atlas) gl.deleteTexture(atlas);
    gl.deleteProgram(scene.p);
    gl.deleteProgram(match.p);
    gl.deleteProgram(final.p);
    gl.deleteShader(vs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { setPhoto, setAtlas, setGrid, resize, draw, destroy, rows: WEIGHTS.length, glyphs: NG };
}
