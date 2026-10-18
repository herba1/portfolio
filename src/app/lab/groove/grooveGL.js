import { GROOVE_FS, GROOVE_VS } from "./grooveShader";

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

function texture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 20, 255]));
  gl.generateMipmap(gl.TEXTURE_2D);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return tex;
}

export function createGrooveGL(canvas) {
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

  const vs = compile(gl, gl.VERTEX_SHADER, GROOVE_VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, GROOVE_FS);
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

  const vao = gl.createVertexArray();
  const photos = texture(gl);
  const labels = texture(gl);

  function upload(tex, source) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function draw(f) {
    const w = canvas.width;
    const h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photos);
    gl.uniform1i(loc("uPhotos"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, labels);
    gl.uniform1i(loc("uLabels"), 1);
    gl.uniform2f(loc("uRes"), w, h);
    gl.uniform2f(loc("uBox"), f.width, f.height);
    gl.uniform2f(loc("uCenter"), f.cx, f.cy);
    gl.uniform1f(loc("uFocal"), f.focal);
    gl.uniform1f(loc("uTilt"), f.tilt);
    gl.uniform1f(loc("uDist"), f.dist);
    gl.uniform1f(loc("uThick"), f.thick);
    gl.uniform1f(loc("uTheta"), f.theta);
    gl.uniform1f(loc("uSweep"), f.sweep);
    gl.uniform1i(loc("uSamples"), f.samples);
    gl.uniform3f(loc("uLight"), f.light[0], f.light[1], f.light[2]);
    gl.uniform2f(loc("uSlot"), f.slotA, f.slotB);
    gl.uniform1f(loc("uMix"), f.mix);
    gl.uniform1f(loc("uSlots"), f.slots);
    gl.uniform3f(loc("uToneA"), f.toneA[0], f.toneA[1], f.toneA[2]);
    gl.uniform3f(loc("uToneB"), f.toneB[0], f.toneB[1], f.toneB[2]);
    gl.uniform3f(loc("uGround"), f.ground[0], f.ground[1], f.ground[2]);
    gl.uniform1f(loc("uPhotoOn"), f.photoOn);
    gl.uniform1f(loc("uKappa"), f.kappa);
    gl.uniform2f(loc("uLobe"), f.lobe[0], f.lobe[1]);
    gl.uniform1f(loc("uGain"), f.gain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function destroy() {
    gl.deleteTexture(photos);
    gl.deleteTexture(labels);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(prog);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return {
    resize,
    draw,
    destroy,
    uploadPhotos: (source) => upload(photos, source),
    uploadLabels: (source) => upload(labels, source),
  };
}
