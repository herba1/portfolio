import { SPLICE_FRAGMENT, SPLICE_VERTEX } from "./spliceShader";

const UNIFORMS = ["uRes", "uDpr", "uView", "uA", "uB", "uB2", "uRazor", "uRazor2", "uPencil", "uTab", "uTab2", "uPress", "uBubble", "uMisc", "uWaveInfo", "uMarks", "uWave"];

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

export function createSpliceGL(canvas) {
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
  const vs = compile(gl, gl.VERTEX_SHADER, SPLICE_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SPLICE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const vao = gl.createVertexArray();
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const marks = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, marks);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(256 * 4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const wave = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, wave);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(8));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  function setMarks(data) {
    gl.bindTexture(gl.TEXTURE_2D, marks);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, data);
  }

  function setWave({ width, height, data }) {
    gl.bindTexture(gl.TEXTURE_2D, wave);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, marks);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wave);
    gl.uniform1i(loc.uMarks, 0);
    gl.uniform1i(loc.uWave, 1);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, f.dpr);
    gl.uniform4fv(loc.uView, f.view);
    gl.uniform4fv(loc.uA, f.a);
    gl.uniform4fv(loc.uB, f.b);
    gl.uniform4fv(loc.uB2, f.b2);
    gl.uniform4fv(loc.uRazor, f.razor);
    gl.uniform4fv(loc.uRazor2, f.razor2);
    gl.uniform4fv(loc.uPencil, f.pencil);
    gl.uniform4fv(loc.uTab, f.tab);
    gl.uniform4fv(loc.uTab2, f.tab2);
    gl.uniform4fv(loc.uPress, f.press);
    gl.uniform4fv(loc.uBubble, f.bubbles);
    gl.uniform4fv(loc.uMisc, f.misc);
    gl.uniform4fv(loc.uWaveInfo, f.waveInfo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    gl.deleteTexture(marks);
    gl.deleteTexture(wave);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { setMarks, setWave, resize, draw, destroy };
}
