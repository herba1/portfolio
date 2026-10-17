import { RAKING_BAKE, RAKING_FRAGMENT, RAKING_VERTEX } from "./rakingShader";

const MAIN_UNIFORMS = [
  "uRes",
  "uView",
  "uCard",
  "uShape",
  "uWarp",
  "uCrease",
  "uFold",
  "uCorners",
  "uLamp",
  "uLight",
  "uMicro",
  "uMat",
  "uBounds",
  "uInk",
  "uHasCard",
  "uFront",
  "uBack",
  "uFrontBake",
  "uBackBake",
];

const BAKE_UNIFORMS = ["uSrc", "uSize", "uDims", "uPrint", "uPrint2"];

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

function link(gl, vsSource, fsSource, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(program, name);
  return { program, vs, fs, loc };
}

export function createRakingGL(canvas) {
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

  const main = link(gl, RAKING_VERTEX, RAKING_FRAGMENT, MAIN_UNIFORMS);
  const bake = link(gl, RAKING_VERTEX, RAKING_BAKE, BAKE_UNIFORMS);
  const vao = gl.createVertexArray();
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  const sets = new Map();
  const owned = [];

  function makeTexture(source, width, height) {
    const texture = gl.createTexture();
    owned.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    if (source) gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  function bakeSide(src, width, height, card, side) {
    const target = makeTexture(null, width, height);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, width, height);
    gl.useProgram(bake.program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(bake.loc.uSrc, 0);
    gl.uniform2f(bake.loc.uSize, width, height);
    gl.uniform4f(bake.loc.uDims, card.hw, card.hh, card.seed, side);
    gl.uniform4f(bake.loc.uPrint, ...card.print);
    gl.uniform4f(bake.loc.uPrint2, ...card.print2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.generateMipmap(gl.TEXTURE_2D);
    return target;
  }

  function upload(key, image, backCanvas, card) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const front = makeTexture(image);
    const back = makeTexture(backCanvas);
    const frontBake = bakeSide(front, width, height, card, 0);
    const backBake = bakeSide(back, width, height, card, 1);
    sets.set(key, { front, back, frontBake, backBake, texelMm: (2 * card.hw) / width });
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function bind(unit, texture, name) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(main.loc[name], unit);
  }

  function draw(f) {
    const set = f.card ? sets.get(f.card.key) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(main.program);
    gl.bindVertexArray(vao);
    const L = main.loc;
    gl.uniform2f(L.uRes, canvas.width, canvas.height);
    gl.uniform4f(L.uView, f.cx, f.cy, f.pxPerMm, f.scale);
    gl.uniform4f(L.uLamp, f.lamp.x, f.lamp.y, f.lamp.z, f.lamp.power);
    gl.uniform4f(L.uLight, f.bulb, f.falloff, f.intensity, f.steps);
    gl.uniform1f(L.uHasCard, set ? 1 : 0);
    if (set) {
      const c = f.card;
      const texelMm = set.texelMm;
      const pixMm = 1 / (f.pxPerMm * f.scale);
      const lod = Math.log2(Math.max(pixMm / texelMm, 1e-3));
      gl.uniform4f(L.uCard, c.x, c.y, c.rot, c.theta);
      gl.uniform4f(L.uShape, c.hw, c.hh, c.thick, c.cup);
      gl.uniform4f(L.uWarp, c.twist, c.lift, c.seed, 0);
      gl.uniform4f(L.uCrease, ...c.crease);
      gl.uniform4f(L.uFold, ...c.fold);
      gl.uniform4f(L.uCorners, ...c.corners);
      gl.uniform4f(L.uMicro, f.micro, lod, f.ambient, texelMm);
      gl.uniform4f(L.uMat, ...c.material);
      gl.uniform4f(L.uBounds, c.top, c.reach, f.exposure, 0);
      gl.uniform3f(L.uInk, ...c.ink);
      bind(0, set.front, "uFront");
      bind(1, set.back, "uBack");
      bind(2, set.frontBake, "uFrontBake");
      bind(3, set.backBake, "uBackBake");
    } else {
      gl.uniform4f(L.uMicro, f.micro, 0, f.ambient, 0.05);
      gl.uniform4f(L.uBounds, 0, 0, f.exposure, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const texture of owned) gl.deleteTexture(texture);
    owned.length = 0;
    sets.clear();
    for (const p of [main, bake]) {
      gl.deleteProgram(p.program);
      gl.deleteShader(p.vs);
      gl.deleteShader(p.fs);
    }
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { upload, has: (key) => sets.has(key), resize, draw, destroy };
}
