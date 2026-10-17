import { ICE_FRAGMENT, ICE_VERTEX } from "./iceShader";

const UNIFORMS = [
  "uRes",
  "uShift",
  "uCamPos",
  "uCamMat",
  "uFocal",
  "uDims",
  "uSleeveDims",
  "uSleevePos",
  "uSleeveRot",
  "uRestPos",
  "uRestRot",
  "uSlotC",
  "uSlotH",
  "uExt",
  "uFrost",
  "uSeed",
  "uLabel",
  "uSleeveWet",
  "uFade",
  "uMelt",
  "uFace",
  "uPuddle",
  "uSleeve",
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

function dataTexture(gl, internal, format, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height);
  return { tex, internal, format, width, height };
}

export function createIceGL(canvas, sizes) {
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

  const vs = compile(gl, gl.VERTEX_SHADER, ICE_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, ICE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const melt = dataTexture(gl, gl.RG16F, gl.RG, sizes.melt, sizes.melt);
  const face = dataTexture(gl, gl.R16F, gl.RED, sizes.faceW, sizes.faceH);
  const puddle = dataTexture(gl, gl.R16F, gl.RED, sizes.puddle, sizes.puddle);
  const sleeves = new Map();

  function uploadData(target, data) {
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, target.width, target.height, target.format, gl.HALF_FLOAT, data);
  }

  function uploadSleeve(key, source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    sleeves.set(key, tex);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function bind(unit, tex, name) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc[name], unit);
  }

  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(loc.uShift, f.shift[0], f.shift[1]);
    gl.uniform3fv(loc.uCamPos, f.camPos);
    gl.uniformMatrix3fv(loc.uCamMat, false, f.camMat);
    gl.uniform1f(loc.uFocal, f.focal);
    gl.uniform4fv(loc.uDims, f.dims);
    gl.uniform4fv(loc.uSleeveDims, f.sleeveDims);
    gl.uniform3fv(loc.uSleevePos, f.sleevePos);
    gl.uniformMatrix3fv(loc.uSleeveRot, false, f.sleeveRot);
    gl.uniform3fv(loc.uRestPos, f.restPos);
    gl.uniformMatrix3fv(loc.uRestRot, false, f.restRot);
    gl.uniform3fv(loc.uSlotC, f.slotC);
    gl.uniform3fv(loc.uSlotH, f.slotH);
    gl.uniform2fv(loc.uExt, f.ext);
    gl.uniform2fv(loc.uFrost, f.frost);
    gl.uniform1f(loc.uSeed, f.seed);
    gl.uniform3fv(loc.uLabel, f.label);
    gl.uniform1f(loc.uSleeveWet, f.sleeveWet);
    gl.uniform1f(loc.uFade, f.fade);
    bind(0, melt.tex, "uMelt");
    bind(1, face.tex, "uFace");
    bind(2, puddle.tex, "uPuddle");
    bind(3, sleeves.get(f.sleeveKey) || null, "uSleeve");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const tex of sleeves.values()) gl.deleteTexture(tex);
    sleeves.clear();
    gl.deleteTexture(melt.tex);
    gl.deleteTexture(face.tex);
    gl.deleteTexture(puddle.tex);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return {
    uploadMelt: (data) => uploadData(melt, data),
    uploadFace: (data) => uploadData(face, data),
    uploadPuddle: (data) => uploadData(puddle, data),
    uploadSleeve,
    hasSleeve: (key) => sleeves.has(key),
    resize,
    draw,
    destroy,
  };
}
