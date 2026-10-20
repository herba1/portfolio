import { NEEDLE_FRAGMENT, NEEDLE_VERTEX } from "./needleShader";

const UNIFORMS = ["uRes", "uDpr", "uView", "uEye", "uRec", "uStrobe", "uArmA", "uArmB", "uArmC", "uSeg", "uSide", "uFlags", "uLabel", "uGroove"];

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

export function createNeedleGL(canvas) {
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
  const vs = compile(gl, gl.VERTEX_SHADER, NEEDLE_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, NEEDLE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const vao = gl.createVertexArray();
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);

  const make = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 190, 170, 255]));
    return tex;
  };
  const label = make();
  const groove = make();
  const flags = { label: 0, groove: 0 };

  function setLabel(source) {
    gl.bindTexture(gl.TEXTURE_2D, label);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    flags.label = 1;
  }

  function setGroove({ width, data }) {
    gl.bindTexture(gl.TEXTURE_2D, groove);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    flags.groove = 1;
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
    gl.bindTexture(gl.TEXTURE_2D, label);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, groove);
    gl.uniform1i(loc.uLabel, 0);
    gl.uniform1i(loc.uGroove, 1);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, f.dpr);
    gl.uniform3f(loc.uView, f.cx, f.cy, f.scale);
    gl.uniform3f(loc.uEye, f.eye[0], f.eye[1], f.eye[2]);
    gl.uniform4f(loc.uRec, f.rec, f.plat, f.blurRec, f.blurPlat);
    gl.uniform4f(loc.uStrobe, f.strobeA, f.strobeB, f.lamp, f.press);
    gl.uniform4f(loc.uArmA, f.arm.p[0], f.arm.p[1], f.arm.j[0], f.arm.j[1]);
    gl.uniform4f(loc.uArmB, f.arm.s[0], f.arm.s[1], f.lift, 0);
    gl.uniform4f(loc.uArmC, f.arm.h[0], f.arm.h[1], f.arm.side, 0);
    gl.uniform4fv(loc.uSeg, f.segments);
    gl.uniform4f(loc.uSide, f.loop, f.rev, 0, 0);
    gl.uniform4f(loc.uFlags, flags.label, flags.groove, f.rot, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    gl.deleteTexture(label);
    gl.deleteTexture(groove);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { setLabel, setGroove, resize, draw, destroy, flags };
}
