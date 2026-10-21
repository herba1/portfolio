import { CARD_FRAGMENT, COMPOSITE_FRAGMENT, DOWN_FRAGMENT, FULL_VERTEX, LINE_FRAGMENT } from "./refractorShader";

const UNIFORMS = ["uBack", "uRes", "uDpr", "uCenter", "uHalf", "uRot", "uLift", "uDist", "uGround", "uThick", "uKey", "uFill", "uFoil", "uData", "uReady", "uSeed", "uGroundTint"];
const STAR = 58 * (Math.PI / 180);
const STREAK_FALLS = [0.78, 0.84, 0.82, 0.55];
const STAR_FALLS = [0.85, 0.75, 0.55];

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

function link(gl, fragment, names) {
  const vs = compile(gl, gl.VERTEX_SHADER, FULL_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(info || "link failed");
  }
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(program, name);
  return { program, loc };
}

export function createRefractorGL(canvas) {
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
  const scene = link(gl, CARD_FRAGMENT, UNIFORMS);
  const down = link(gl, DOWN_FRAGMENT, ["uSrc", "uOut", "uBright"]);
  const line = link(gl, LINE_FRAGMENT, ["uSrc", "uStep", "uFall"]);
  const comp = link(gl, COMPOSITE_FRAGMENT, ["uScene", "uNear", "uWide", "uStreak", "uStarA", "uStarB", "uGain"]);
  const programs = [scene, down, line, comp];
  const half = !!gl.getExtension("EXT_color_buffer_float");
  const vao = gl.createVertexArray();
  const sets = new Map();
  let targets = null;
  let post = true;

  function texture(source, mips) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  function target(w, h, float) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h, ok };
  }

  function dropTargets() {
    if (!targets) return;
    for (const t of Object.values(targets)) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    targets = null;
  }

  function makeTargets(width, height) {
    dropTargets();
    const qw = Math.max(1, Math.ceil(width / 4));
    const qh = Math.max(1, Math.ceil(height / 4));
    const sh = Math.max(1, height);
    const ew = Math.max(1, Math.ceil(width / 8));
    const eh = Math.max(1, Math.ceil(height / 8));
    const build = (float) => ({
      scene: target(width, height, false),
      q: target(qw, qh, float),
      q1: target(qw, qh, float),
      near: target(qw, qh, float),
      f: target(qw, qh, float),
      f1: target(qw, qh, float),
      f2: target(qw, qh, float),
      starA: target(qw, qh, float),
      starB: target(qw, qh, float),
      s: target(qw, sh, float),
      s1: target(qw, sh, float),
      s2: target(qw, sh, float),
      streak: target(qw, sh, float),
      e: target(ew, eh, float),
      e1: target(ew, eh, float),
      wide: target(ew, eh, float),
    });
    targets = build(half);
    if (half && !Object.values(targets).every((t) => t.ok)) {
      dropTargets();
      targets = build(false);
    }
    post = Object.values(targets).every((t) => t.ok);
    if (!post) dropTargets();
  }

  function build(key, prep) {
    if (sets.has(key)) return;
    sets.set(key, { back: texture(prep.label, true), data: prep.data });
  }

  function evict(keep) {
    for (const [key, set] of sets) {
      if (keep.includes(key)) continue;
      gl.deleteTexture(set.back);
      sets.delete(key);
    }
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height || !targets) {
      canvas.width = width;
      canvas.height = height;
      makeTargets(width, height);
    }
  }

  function bind(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  function into(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height);
  }

  function downsample(src, dst, bright) {
    into(dst);
    gl.useProgram(down.program);
    bind(0, src.tex);
    gl.uniform1i(down.loc.uSrc, 0);
    gl.uniform2f(down.loc.uOut, dst.w, dst.h);
    gl.uniform1f(down.loc.uBright, bright);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function streakPass(src, dst, dx, dy, fall) {
    into(dst);
    gl.useProgram(line.program);
    bind(0, src.tex);
    gl.uniform1i(line.loc.uSrc, 0);
    gl.uniform2f(line.loc.uStep, dx / src.w, dy / src.h);
    gl.uniform1f(line.loc.uFall, fall);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function chain(src, a, b, dst, angle, base, falls) {
    const dx = Math.cos(angle) * base;
    const dy = Math.sin(angle) * base;
    let from = src;
    falls.forEach((fall, i) => {
      const to = i === falls.length - 1 ? dst : i % 2 === 0 ? a : b;
      const k = Math.pow(4, i);
      streakPass(from, to, dx * k, dy * k, fall);
      from = to;
    });
  }

  function drawScene(f, set) {
    gl.useProgram(scene.program);
    const loc = scene.loc;
    if (set) bind(0, set.back);
    gl.uniform1i(loc.uBack, 0);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uDpr, f.dpr);
    gl.uniform2f(loc.uCenter, f.cx, f.cy);
    gl.uniform2f(loc.uHalf, f.hw, f.hh);
    gl.uniformMatrix3fv(loc.uRot, false, f.rot);
    gl.uniform1f(loc.uLift, f.lift);
    gl.uniform1f(loc.uDist, f.dist);
    gl.uniform1f(loc.uGround, f.ground);
    gl.uniform1f(loc.uThick, f.thick);
    gl.uniform3f(loc.uKey, f.keyLight[0], f.keyLight[1], f.keyLight[2]);
    gl.uniform3f(loc.uFill, f.fillLight[0], f.fillLight[1], f.fillLight[2]);
    gl.uniform3f(loc.uFoil, f.foil[0], f.foil[1], f.foil[2]);
    gl.uniform1f(loc.uData, set ? set.data : 0.8);
    gl.uniform1f(loc.uReady, set ? 1 : 0);
    gl.uniform1f(loc.uSeed, f.seed);
    gl.uniform3f(loc.uGroundTint, f.tint[0], f.tint[1], f.tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function draw(f) {
    const set = sets.get(f.key);
    gl.bindVertexArray(vao);
    if (!post || !targets) {
      into(null);
      drawScene(f, set);
      return;
    }
    const t = targets;
    into(t.scene);
    drawScene(f, set);
    const px = Math.max(0.5, f.dpr);
    downsample(t.scene, t.q, 1);
    streakPass(t.q, t.q1, px * 0.75, 0, 0.62);
    streakPass(t.q1, t.near, 0, px * 0.75, 0.62);
    downsample(t.q, t.e, 0);
    streakPass(t.e, t.e1, px * 1.1, 0, 0.72);
    streakPass(t.e1, t.wide, 0, px * 1.1, 0.72);
    downsample(t.scene, t.f, 2);
    downsample(t.scene, t.s, 2);
    chain(t.s, t.s1, t.s2, t.streak, 0, px * 0.9, STREAK_FALLS);
    chain(t.f, t.f1, t.f2, t.starA, STAR, px * 0.6, STAR_FALLS);
    chain(t.f, t.f1, t.f2, t.starB, -STAR, px * 0.6, STAR_FALLS);
    into(null);
    gl.useProgram(comp.program);
    const units = [t.scene, t.near, t.wide, t.streak, t.starA, t.starB];
    const names = ["uScene", "uNear", "uWide", "uStreak", "uStarA", "uStarB"];
    units.forEach((u, i) => {
      bind(i, u.tex);
      gl.uniform1i(comp.loc[names[i]], i);
    });
    const g = f.glare;
    gl.uniform4f(comp.loc.uGain, g[0], g[1], g[2], g[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    evict([]);
    dropTargets();
    for (const p of programs) gl.deleteProgram(p.program);
    gl.deleteVertexArray(vao);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { build, has: (key) => sets.has(key), evict, resize, draw, destroy };
}
