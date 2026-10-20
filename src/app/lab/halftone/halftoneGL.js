import { HALFTONE_FRAGMENT, HALFTONE_VERTEX } from "./halftoneShader";

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

function texture(gl, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, HALFTONE_VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, HALFTONE_FRAGMENT);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  } catch {
    return null;
  }
  const u = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    u[info.name] = gl.getUniformLocation(prog, info.name);
  }
  const vao = gl.createVertexArray();
  const plates = [texture(gl, gl.LINEAR), texture(gl, gl.LINEAR)];
  for (const p of plates) {
    gl.bindTexture(gl.TEXTURE_2D, p);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }
  const dispTex = texture(gl, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, dispTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));
  let width = 0;
  let height = 0;

  return {
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
    },
    plate(index, source) {
      gl.bindTexture(gl.TEXTURE_2D, plates[index]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    disp(data, nx, ny) {
      gl.bindTexture(gl.TEXTURE_2D, dispTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, nx, ny, 0, gl.RG, gl.FLOAT, data);
    },
    render(f) {
      if (!width || gl.isContextLost()) return;
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, width, height);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, plates[f.plateA]);
      gl.uniform1i(u.uPlateA, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, plates[1 - f.plateA]);
      gl.uniform1i(u.uPlateB, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, dispTex);
      gl.uniform1i(u.uDisp, 2);
      gl.uniform2f(u.uRes, width, height);
      gl.uniform1f(u.uScale, f.scale);
      gl.uniform2f(u.uOrigin, f.origin[0], f.origin[1]);
      gl.uniform4f(u.uArt, f.art[0], f.art[1], f.art[2], f.art[3]);
      gl.uniform2f(u.uDispCell, f.dispCell, f.dispCell);
      gl.uniform2f(u.uDispCount, f.nx, f.ny);
      gl.uniform1f(u.uCell, f.cell);
      gl.uniform1f(u.uAngle, f.angle);
      gl.uniform1f(u.uShape, f.shape);
      gl.uniform1f(u.uClean, f.clean);
      gl.uniform1f(u.uMix, f.mix);
      gl.uniform1f(u.uTime, f.time);
      gl.uniform1f(u.uFade, f.fade);
      gl.uniform3f(u.uPaper, f.paper[0], f.paper[1], f.paper[2]);
      gl.uniform3f(u.uInk, f.ink[0], f.ink[1], f.ink[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      for (const p of plates) gl.deleteTexture(p);
      gl.deleteTexture(dispTex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
