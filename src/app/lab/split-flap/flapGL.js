import { FLAP_FRAGMENT, FLAP_VERTEX } from "./flapShader";

const UNIFORMS = ["uRes", "uCell", "uPersp", "uCenter", "uDpr", "uRadius", "uAtlas", "uAtlasCell", "uAtlasCols", "uAtlasSize"];
export const STRIDE = 16;

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
  const vs = compile(gl, gl.VERTEX_SHADER, FLAP_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FLAP_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  for (let i = 0; i < 4; i += 1) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }
  gl.bindVertexArray(null);

  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  let capacity = 0;
  const view = { w: 1, h: 1, dpr: 1, cell: [1, 1, 1, 1], persp: 1, center: [0, 0], radius: 1, atlasCell: [1, 1], atlasCols: 1, atlasSize: [1, 1] };

  function setAtlas(source, cols, cellW, cellH) {
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    view.atlasCols = cols;
    view.atlasCell = [cellW, cellH];
    view.atlasSize = [source.width, source.height];
  }

  function setView(next) {
    Object.assign(view, next);
    const pw = Math.max(1, Math.round(view.w * view.dpr));
    const ph = Math.max(1, Math.round(view.h * view.dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
  }

  function draw(data, count) {
    if (gl.isContextLost()) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    if (count > capacity) {
      capacity = Math.max(count, Math.ceil(capacity * 1.5), 256);
      gl.bufferData(gl.ARRAY_BUFFER, capacity * STRIDE * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * STRIDE);
    gl.uniform2f(loc.uRes, view.w, view.h);
    gl.uniform4f(loc.uCell, ...view.cell);
    gl.uniform1f(loc.uPersp, view.persp);
    gl.uniform2f(loc.uCenter, ...view.center);
    gl.uniform1f(loc.uDpr, view.dpr);
    gl.uniform1f(loc.uRadius, view.radius);
    gl.uniform2f(loc.uAtlasCell, ...view.atlasCell);
    gl.uniform1f(loc.uAtlasCols, view.atlasCols);
    gl.uniform2f(loc.uAtlasSize, ...view.atlasSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(loc.uAtlas, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  function destroy() {
    gl.deleteBuffer(corners);
    gl.deleteBuffer(instances);
    gl.deleteTexture(atlas);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { gl, setAtlas, setView, draw, destroy };
}
