import { LOUPE_FRAGMENT, LOUPE_VERTEX } from "./loupeShader";

const UNIFORMS = [
  "uRes",
  "uBox",
  "uDpr",
  "uTableMm",
  "uTexA",
  "uTexB",
  "uCardA",
  "uCardB",
  "uPoseA",
  "uPoseB",
  "uWearA",
  "uWearB",
  "uLens",
  "uLift",
  "uShowB",
  "uLensOn",
  "uSun",
];

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

export function createLoupeGL(canvas) {
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

  const vs = compile(gl, gl.VERTEX_SHADER, LOUPE_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, LOUPE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const vao = gl.createVertexArray();
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([240, 236, 226, 255]));

  const textures = new Map();

  function upload(key, image) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    textures.set(key, texture);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function bindCard(unit, key) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures.get(key) || blank);
  }

  function draw(frame) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    bindCard(0, frame.a.key);
    bindCard(1, frame.b ? frame.b.key : null);
    gl.uniform1i(loc.uTexA, 0);
    gl.uniform1i(loc.uTexB, 1);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(loc.uBox, frame.width, frame.height);
    gl.uniform1f(loc.uDpr, frame.dpr);
    gl.uniform1f(loc.uTableMm, frame.tableMm);
    const card = (layer, cardLoc, poseLoc, wearLoc) => {
      if (!layer) {
        gl.uniform4f(poseLoc, 0, 1, 0, 0);
        return;
      }
      gl.uniform4f(cardLoc, layer.x, layer.y, layer.hw, layer.hh);
      gl.uniform4f(poseLoc, layer.rot, layer.mmPx, textures.has(layer.key) ? 1 : 0, layer.lift);
      gl.uniform4f(wearLoc, layer.wear[0], layer.wear[1], layer.wear[2], layer.wear[3]);
    };
    card(frame.a, loc.uCardA, loc.uPoseA, loc.uWearA);
    card(frame.b, loc.uCardB, loc.uPoseB, loc.uWearB);
    gl.uniform1f(loc.uShowB, frame.b ? 1 : 0);
    gl.uniform4f(loc.uLens, frame.lens.x, frame.lens.y, frame.lens.r, frame.lens.zoom);
    gl.uniform1f(loc.uLift, frame.lens.lift);
    gl.uniform1f(loc.uLensOn, frame.lens.on ? 1 : 0);
    const reach = Math.min(1, Math.max(0, Math.log(frame.lens.zoom / 2) / Math.log(10)));
    const angle = 0.5 + reach * 2.5 + (frame.lens.x / Math.max(1, frame.width) - 0.5) * 0.5;
    const focus = reach * reach * (3 - 2 * reach);
    gl.uniform4f(loc.uSun, Math.cos(angle), Math.sin(angle), focus, reach);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const texture of textures.values()) gl.deleteTexture(texture);
    textures.clear();
    gl.deleteTexture(blank);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { upload, has: (key) => textures.has(key), resize, draw, destroy };
}
