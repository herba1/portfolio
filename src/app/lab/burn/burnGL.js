import { FRAGMENT, VERTEX } from "./burnShader";

const UNIFORMS = [
  "uRes", "uDpr", "uEye", "uCenter", "uRot", "uRadius", "uSpin", "uBlur", "uInk", "uKey", "uFill", "uAlpha",
  "uEnvShift", "uBurn", "uPlan", "uMarks", "uMarkCount", "uLaser", "uLaserAngle",
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

export function createBurnGL(canvas) {
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
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
  const vao = gl.createVertexArray();

  function makeTexture(source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (source && source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, source ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  let ink = makeTexture(null);

  function setInk(source, fresh) {
    if (fresh) {
      gl.deleteTexture(ink);
      ink = makeTexture(source);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, ink);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (f.box) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(f.box[0], f.box[1], f.box[2], f.box[3]);
    }
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ink);
    gl.uniform1i(loc.uInk, 0);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, f.dpr);
    gl.uniform3f(loc.uEye, f.eye[0], f.eye[1], f.eye[2]);
    gl.uniform3f(loc.uCenter, f.center[0], f.center[1], f.center[2]);
    gl.uniformMatrix3fv(loc.uRot, false, f.rot);
    gl.uniform1f(loc.uRadius, f.radius);
    gl.uniform1f(loc.uSpin, f.spin);
    gl.uniform1f(loc.uBlur, f.blur);
    gl.uniform3f(loc.uKey, f.key[0], f.key[1], f.key[2]);
    gl.uniform3f(loc.uFill, f.fill[0], f.fill[1], f.fill[2]);
    gl.uniform1f(loc.uAlpha, f.alpha);
    gl.uniform2f(loc.uEnvShift, f.envShift[0], f.envShift[1]);
    gl.uniform1f(loc.uBurn, f.burn);
    gl.uniform1f(loc.uPlan, f.plan);
    gl.uniform1fv(loc.uMarks, f.marks);
    gl.uniform1f(loc.uMarkCount, f.markCount);
    gl.uniform1f(loc.uLaser, f.laser);
    gl.uniform1f(loc.uLaserAngle, f.laserAngle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    gl.deleteTexture(ink);
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { setInk, resize, draw, destroy };
}
