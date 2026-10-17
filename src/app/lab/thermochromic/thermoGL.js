import { THERMO_FRAGMENT, THERMO_SIM, THERMO_VERTEX } from "./thermoShader";
import { FIELD, GROUND } from "./thermoSleeves";

const RENDER_UNIFORMS = [
  "uBox",
  "uDpr",
  "uGround",
  "uLight",
  "uPoseA",
  "uPoseB",
  "uMiscA",
  "uMiscB",
  "uPhotoA",
  "uPhotoB",
  "uHeatA",
  "uHeatB",
  "uMaskA",
  "uMaskB",
  "uGrainA",
  "uGrainB",
];

const SIM_UNIFORMS = ["uField", "uDiff", "uCool", "uH", "uSegA", "uSegB", "uCount", "uStamp", "uStampAmp"];

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

export function createThermoGL(canvas) {
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
  const floatOk = Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const render = link(gl, THERMO_VERTEX, THERMO_FRAGMENT, RENDER_UNIFORMS);
  const sim = link(gl, THERMO_VERTEX, THERMO_SIM, SIM_UNIFORMS);
  const vao = gl.createVertexArray();
  const sleeves = new Map();
  const segA = new Float32Array(20);
  const segB = new Float32Array(20);

  function fieldTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, FIELD, FIELD, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FIELD, FIELD, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) throw new Error("heat field not renderable");
    return { texture, fbo };
  }

  function imageTexture(source, mips) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  function add(key, photo, mask, grain) {
    if (sleeves.has(key)) return;
    sleeves.set(key, {
      photo: imageTexture(photo, false),
      mask: imageTexture(mask, true),
      grain: imageTexture(grain, false),
      fields: [fieldTexture(), fieldTexture()],
      read: 0,
    });
  }

  function step(key, params) {
    const s = sleeves.get(key);
    if (!s) return;
    const src = s.fields[s.read];
    const dst = s.fields[1 - s.read];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, FIELD, FIELD);
    gl.useProgram(sim.program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.uniform1i(sim.loc.uField, 0);
    gl.uniform1f(sim.loc.uDiff, params.diff);
    gl.uniform1f(sim.loc.uCool, params.cool);
    gl.uniform1f(sim.loc.uH, params.h);
    const count = Math.min(5, params.segs.length);
    for (let i = 0; i < count; i += 1) {
      const seg = params.segs[i];
      segA.set([seg.x0, seg.y0, seg.x1, seg.y1], i * 4);
      segB.set([seg.radius, seg.rate, seg.target, 0], i * 4);
    }
    gl.uniform4fv(sim.loc.uSegA, segA);
    gl.uniform4fv(sim.loc.uSegB, segB);
    gl.uniform1i(sim.loc.uCount, count);
    const stamp = params.stamp;
    if (stamp) gl.uniform4f(sim.loc.uStamp, stamp.x, stamp.y, stamp.rot, stamp.scale);
    gl.uniform1f(sim.loc.uStampAmp, stamp ? stamp.amp : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    s.read = 1 - s.read;
  }

  function clearField(key) {
    const s = sleeves.get(key);
    if (!s) return;
    gl.clearColor(0, 0, 0, 1);
    for (const f of s.fields) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function bindSleeve(unit, layer, names) {
    const s = layer ? sleeves.get(layer.key) : null;
    const fallback = sleeves.values().next().value;
    const use = s || fallback;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, use.photo);
    gl.uniform1i(render.loc[names.photo], unit);
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    gl.bindTexture(gl.TEXTURE_2D, use.fields[use.read].texture);
    gl.uniform1i(render.loc[names.heat], unit + 1);
    gl.activeTexture(gl.TEXTURE0 + unit + 2);
    gl.bindTexture(gl.TEXTURE_2D, use.mask);
    gl.uniform1i(render.loc[names.mask], unit + 2);
    gl.activeTexture(gl.TEXTURE0 + unit + 3);
    gl.bindTexture(gl.TEXTURE_2D, use.grain);
    gl.uniform1i(render.loc[names.grain], unit + 3);
    if (!s) {
      gl.uniform4f(render.loc[names.pose], -9999, -9999, 1, 0);
      gl.uniform4f(render.loc[names.misc], 0, 0, 0, 0);
      return;
    }
    gl.uniform4f(render.loc[names.pose], layer.x, layer.y, layer.hs, layer.rot);
    gl.uniform4f(render.loc[names.misc], layer.lift, layer.seed, 1, 0);
  }

  function draw(frame) {
    if (!sleeves.size) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(render.program);
    gl.bindVertexArray(vao);
    gl.uniform2f(render.loc.uBox, frame.width, frame.height);
    gl.uniform1f(render.loc.uDpr, canvas.width / Math.max(1, frame.width));
    gl.uniform3f(render.loc.uGround, GROUND[0] / 255, GROUND[1] / 255, GROUND[2] / 255);
    gl.uniform2f(render.loc.uLight, frame.light[0], frame.light[1]);
    bindSleeve(0, frame.a, { photo: "uPhotoA", heat: "uHeatA", mask: "uMaskA", grain: "uGrainA", pose: "uPoseA", misc: "uMiscA" });
    bindSleeve(4, frame.b, { photo: "uPhotoB", heat: "uHeatB", mask: "uMaskB", grain: "uGrainB", pose: "uPoseB", misc: "uMiscB" });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const s of sleeves.values()) {
      gl.deleteTexture(s.photo);
      gl.deleteTexture(s.mask);
      gl.deleteTexture(s.grain);
      for (const f of s.fields) {
        gl.deleteTexture(f.texture);
        gl.deleteFramebuffer(f.fbo);
      }
    }
    sleeves.clear();
    for (const p of [render, sim]) {
      gl.deleteProgram(p.program);
      gl.deleteShader(p.vs);
      gl.deleteShader(p.fs);
    }
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { add, has: (key) => sleeves.has(key), step, clearField, resize, draw, destroy, precise: floatOk };
}
