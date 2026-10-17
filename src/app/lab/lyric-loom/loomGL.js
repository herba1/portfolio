import { LOOM_FRAGMENT, LOOM_SHADOW_FRAGMENT, LOOM_VERTEX } from "./loomShader";

const ATTRIBS = ["aDyn0", "aDyn1", "aStat0", "aStat1"];

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

function link(gl, vs, fs) {
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  ATTRIBS.forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  return program;
}

function locations(gl, program, names) {
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(program, name);
  return loc;
}

const SHARED = ["uRes", "uHalf", "uPass", "uCount", "uWeave", "uExt", "uSpacing"];
const TAPE = [
  ...SHARED,
  "uAtlas",
  "uAtlasRows",
  "uAtlasW",
  "uRowH",
  "uScroll",
  "uTones",
  "uInk",
  "uInkAccent",
  "uGlow",
  "uZAmp",
];

export function createLoomGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, LOOM_VERTEX);
  const fsTape = compile(gl, gl.FRAGMENT_SHADER, LOOM_FRAGMENT);
  const fsShadow = compile(gl, gl.FRAGMENT_SHADER, LOOM_SHADOW_FRAGMENT);
  const tape = link(gl, vs, fsTape);
  const shadow = link(gl, vs, fsShadow);
  const tapeLoc = locations(gl, tape, TAPE);
  const shadowLoc = locations(gl, shadow, SHARED);

  const vao = gl.createVertexArray();
  const dynBuffer = gl.createBuffer();
  const statBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  let indexCount = 0;
  let atlas = null;
  let atlasRows = 1;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
  gl.bindBuffer(gl.ARRAY_BUFFER, statBuffer);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 16);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);

  function setGeometry(stat, index, dynLength) {
    gl.bindBuffer(gl.ARRAY_BUFFER, statBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, stat, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dynLength * 4, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    indexCount = index.length;
  }

  function updateDyn(dyn) {
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn);
  }

  function uploadAtlas(source, rows) {
    if (!atlas) atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    atlasRows = rows;
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function shared(loc, f, pass) {
    gl.uniform2f(loc.uRes, f.width, f.height);
    gl.uniform1f(loc.uHalf, f.half);
    gl.uniform1f(loc.uPass, pass);
    gl.uniform2f(loc.uCount, f.rows, f.cols);
    gl.uniform3f(loc.uWeave, f.weave[0], f.weave[1], f.weave[2]);
    gl.uniform1f(loc.uExt, f.ext);
    gl.uniform1f(loc.uSpacing, f.spacing);
  }

  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!indexCount || !atlas) return;
    gl.bindVertexArray(vao);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.useProgram(shadow);
    shared(shadowLoc, f, 1);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);

    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.useProgram(tape);
    shared(tapeLoc, f, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(tapeLoc.uAtlas, 0);
    gl.uniform1f(tapeLoc.uAtlasRows, atlasRows);
    gl.uniform1f(tapeLoc.uAtlasW, f.atlasW);
    gl.uniform1f(tapeLoc.uRowH, f.rowH);
    gl.uniform1f(tapeLoc.uScroll, f.scroll);
    gl.uniform3fv(tapeLoc.uTones, f.tones);
    gl.uniform3f(tapeLoc.uInk, f.ink[0], f.ink[1], f.ink[2]);
    gl.uniform3f(tapeLoc.uInkAccent, f.inkAccent[0], f.inkAccent[1], f.inkAccent[2]);
    gl.uniform3f(tapeLoc.uGlow, f.glow[0], f.glow[1], f.glow[2]);
    gl.uniform1f(tapeLoc.uZAmp, f.zAmp);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  function destroy() {
    if (atlas) gl.deleteTexture(atlas);
    gl.deleteBuffer(dynBuffer);
    gl.deleteBuffer(statBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(tape);
    gl.deleteProgram(shadow);
    gl.deleteShader(vs);
    gl.deleteShader(fsTape);
    gl.deleteShader(fsShadow);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { setGeometry, updateDyn, uploadAtlas, resize, draw, destroy, isLost: () => gl.isContextLost() };
}
