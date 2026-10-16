import { BAKE_FRAGMENT, CARD_FRAGMENT, FULL_VERTEX } from "./lenticularShader";

const BAKE_UNIFORMS = ["uCard", "uMask", "uBg", "uBody", "uPatch", "uSize", "uAspect", "uArt", "uPivot", "uLimbPivot", "uRoot", "uLimb", "uBall", "uBallTail", "uBgShift", "uSeed"];
const CARD_UNIFORMS = ["uArt", "uRes", "uDpr", "uCenter", "uHalf", "uRot", "uLift", "uDist", "uGround", "uRidges", "uFrames", "uGain", "uRadius", "uThick", "uReady", "uKey", "uSeed", "uGroundTint"];
const DEG = Math.PI / 180;

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
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of names) loc[name] = gl.getUniformLocation(program, name);
  return { program, loc };
}

export function createLenticularGL(canvas) {
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
  const bake = link(gl, BAKE_FRAGMENT, BAKE_UNIFORMS);
  const card = link(gl, CARD_FRAGMENT, CARD_UNIFORMS);
  const vao = gl.createVertexArray();
  const fbo = gl.createFramebuffer();
  const sets = new Map();
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, blank);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([236, 232, 222, 255]));

  function texture2D(source, mips) {
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

  function bind(unit, target, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
  }

  function build(key, spec, image, prep) {
    const width = Math.min(600, maxSize);
    const height = Math.round(width / prep.aspect);
    const frames = spec.frames.length;
    const cardTex = texture2D(image, true);
    const maskTex = texture2D(prep.masks, true);
    const bgTex = texture2D(prep.bg, false);
    const bodyTex = texture2D(prep.body, false);
    const array = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(Math.max(width, height))) + 1, gl.RGBA8, width, height, frames);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(bake.program);
    gl.bindVertexArray(vao);
    const l = bake.loc;
    bind(0, gl.TEXTURE_2D, cardTex);
    bind(1, gl.TEXTURE_2D, maskTex);
    bind(2, gl.TEXTURE_2D, bgTex);
    bind(3, gl.TEXTURE_2D, bodyTex);
    gl.uniform1i(l.uCard, 0);
    gl.uniform1i(l.uMask, 1);
    gl.uniform1i(l.uBg, 2);
    gl.uniform1i(l.uBody, 3);
    gl.uniform2f(l.uSize, width, height);
    gl.uniform1f(l.uAspect, prep.aspect);
    gl.uniform4f(l.uArt, spec.art[0], spec.art[1], spec.art[2], spec.art[3]);
    gl.uniform2f(l.uPivot, spec.pivot[0], spec.pivot[1]);
    gl.uniform2f(l.uLimbPivot, spec.limbPivot[0], spec.limbPivot[1]);
    gl.uniform2f(l.uPatch, spec.patch[0], spec.patch[1]);
    const rest = (frames - 1) / 2;
    spec.frames.forEach((frame, i) => {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, array, 0, i);
      const [ra, rdx, rdy, rs] = frame.root;
      const [la, ldx, ldy, behind] = frame.limb;
      gl.uniform4f(l.uRoot, ra * DEG, rdx, rdy, rs);
      gl.uniform4f(l.uLimb, la * DEG, ldx, ldy, behind);
      const ball = frame.ball || [0, 0, 0, 0, 0];
      gl.uniform4f(l.uBall, ball[0], ball[1], ball[2], 1);
      gl.uniform2f(l.uBallTail, ball[3], ball[4]);
      gl.uniform1f(l.uBgShift, (i - rest) * 0.0045);
      gl.uniform1f(l.uSeed, i * 1.37);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const tex of [cardTex, maskTex, bgTex, bodyTex]) gl.deleteTexture(tex);
    sets.set(key, { array, frames, aspect: prep.aspect });
  }

  function evict(keep) {
    for (const [key, set] of sets) {
      if (!keep.includes(key)) {
        gl.deleteTexture(set.array);
        sets.delete(key);
      }
    }
  }

  function resize(width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(f) {
    const set = sets.get(f.key);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(card.program);
    gl.bindVertexArray(vao);
    bind(0, gl.TEXTURE_2D_ARRAY, set ? set.array : blank);
    const l = card.loc;
    gl.uniform1i(l.uArt, 0);
    gl.uniform2f(l.uRes, canvas.width, canvas.height);
    gl.uniform1f(l.uDpr, f.dpr);
    gl.uniform2f(l.uCenter, f.cx, f.cy);
    gl.uniform2f(l.uHalf, f.hw, f.hh);
    gl.uniformMatrix3fv(l.uRot, false, f.rot);
    gl.uniform1f(l.uLift, f.lift);
    gl.uniform1f(l.uDist, f.dist);
    gl.uniform1f(l.uGround, f.ground);
    gl.uniform1f(l.uRidges, f.ridges);
    gl.uniform1f(l.uFrames, set ? set.frames : 1);
    gl.uniform1f(l.uGain, f.gain);
    gl.uniform1f(l.uRadius, f.radius);
    gl.uniform1f(l.uThick, f.thick);
    gl.uniform1f(l.uReady, set ? 1 : 0);
    gl.uniform3f(l.uKey, f.key3[0], f.key3[1], f.key3[2]);
    gl.uniform1f(l.uSeed, f.seed);
    gl.uniform3f(l.uGroundTint, f.tint[0], f.tint[1], f.tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const set of sets.values()) gl.deleteTexture(set.array);
    sets.clear();
    gl.deleteTexture(blank);
    gl.deleteProgram(bake.program);
    gl.deleteProgram(card.program);
    gl.deleteVertexArray(vao);
    gl.deleteFramebuffer(fbo);
    const loser = gl.getExtension("WEBGL_lose_context");
    if (loser) loser.loseContext();
  }

  return { build, has: (key) => sets.has(key), aspectOf: (key) => sets.get(key)?.aspect, evict, resize, draw, destroy };
}
