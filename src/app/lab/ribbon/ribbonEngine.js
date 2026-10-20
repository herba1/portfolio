import { RIBBON_FRAGMENT, RIBBON_VERTEX } from "./ribbonShader";

export const DEFAULT_LINE = "everything in its right place";
export const MAX_TWIST = 3;

const SEGMENTS = 960;
const TEX_H = 256;
const SEPARATOR = "\u2003\u2003";
const IDLE_SPEED = 0.012;
const MAX_SPEED = 0.55;
const FOV = (26 * Math.PI) / 180;
const PAPER = [0.945, 0.937, 0.914];
const INK = [0.086, 0.082, 0.071];
const FAR_INK = [0.47, 0.455, 0.42];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function perspective(fov, aspect, near, far, shiftY) {
  const f = 1 / Math.tan(fov / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[8] = 0;
  out[9] = -shiftY;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(eye) {
  const z = normalize3(eye);
  const x = normalize3(cross3([0, 1, 0], z));
  const y = cross3(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[4] = x[1];
  out[8] = x[2];
  out[1] = y[0];
  out[5] = y[1];
  out[9] = y[2];
  out[2] = z[0];
  out[6] = z[1];
  out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w];
}

export function createRibbon(host, { canvas, onTwist, onReady, onFail, insets }) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
  if (!gl) {
    onFail?.();
    return { destroy() {}, setText() {}, setTwist() {}, nudge() {} };
  }

  let ribbon;
  try {
    ribbon = program(gl, RIBBON_VERTEX, RIBBON_FRAGMENT);
  } catch {
    onFail?.();
    return { destroy() {}, setText() {}, setTwist() {}, nudge() {} };
  }

  const uv = new Float32Array((SEGMENTS + 1) * 4);
  for (let i = 0; i <= SEGMENTS; i += 1) {
    const u = i / SEGMENTS - 0.5;
    uv.set([u, 0, u, 1], i * 4);
  }
  const ribbonVao = gl.createVertexArray();
  gl.bindVertexArray(ribbonVao);
  const ribbonBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const aUV = gl.getAttribLocation(ribbon.p, "aUV");
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const texture = gl.createTexture();
  const maxTex = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const textCanvas = document.createElement("canvas");
  const tctx = textCanvas.getContext("2d");
  const family = getComputedStyle(host).fontFamily || "sans-serif";

  const state = {
    width: 1,
    height: 1,
    dpr: 1,
    text: DEFAULT_LINE,
    reps: 0,
    band: 0.3,
    scroll: 0,
    speed: IDLE_SPEED,
    twist: 1,
    twistVel: 0,
    twistTarget: 1,
    viewProj: null,
    eye: [0, 0, 5],
    pxPerLoop: 1000,
    pxPerTwist: 120,
    visible: true,
    running: false,
    raf: 0,
    last: 0,
    drag: null,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ready: false,
    destroyed: false,
    reportedTwist: 1,
  };

  function drawText() {
    const fontPx = 168;
    tctx.font = `600 ${fontPx}px ${family}`;
    const tracking = (-0.043 * (fontPx - 12)) / fontPx;
    if ("letterSpacing" in tctx) tctx.letterSpacing = `${tracking}em`;
    const phrase = state.text + SEPARATOR;
    const phraseW = tctx.measureText(phrase).width;
    const narrow = state.width < 640;
    const target = narrow ? 0.4 : 0.3;
    const ideal = (2 * Math.PI * TEX_H) / (target * phraseW);
    let reps = state.reps;
    if (!reps || Math.abs(ideal - reps) > 0.6) reps = Math.max(1, Math.round(ideal));
    state.reps = reps;
    let scale = 1;
    if (reps * phraseW > maxTex) scale = maxTex / (reps * phraseW);
    const w = Math.max(64, Math.round(reps * phraseW * scale));
    const h = Math.round(TEX_H * scale);
    textCanvas.width = w;
    textCanvas.height = h;
    tctx.setTransform(w / (reps * phraseW), 0, 0, h / TEX_H, 0, 0);
    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, reps * phraseW, TEX_H);
    tctx.font = `600 ${fontPx}px ${family}`;
    if ("letterSpacing" in tctx) tctx.letterSpacing = `${tracking}em`;
    tctx.textBaseline = "alphabetic";
    tctx.fillStyle = "#fff";
    const m = tctx.measureText("Hxgy");
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    const baseline = TEX_H / 2 + (ascent - descent) / 2;
    for (let i = 0; i < reps; i += 1) tctx.fillText(phrase, i * phraseW, baseline);
    state.band = (2 * Math.PI * TEX_H) / (reps * phraseW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, textCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    frame();
  }

  function fitCamera() {
    const { width, height } = state;
    const aspect = width / height;
    const inset = insets?.() || { top: 96, bottom: 96 };
    const narrow = width < 640;
    const elev = ((aspect < 0.8 ? 34 : narrow ? 28 : 21) * Math.PI) / 180;
    const R = 1;
    const H = state.band;
    const pts = [];
    for (let i = 0; i < 48; i += 1) {
      const a = (i / 48) * Math.PI * 2;
      for (const y of [-H / 2, H / 2]) pts.push([Math.sin(a) * (R + H * 0.35), y, Math.cos(a) * (R + H * 0.35)]);
    }
    const topNdc = 1 - (2 * inset.top) / height;
    const botNdc = -1 + (2 * inset.bottom) / height;
    const side = narrow ? 16 : 48;
    const maxX = Math.min(1 - (2 * side) / width, narrow ? 1 : 0.8);
    const fits = (dist) => {
      const eye = [0, Math.sin(elev) * dist, Math.cos(elev) * dist];
      const vp = multiply(perspective(FOV, aspect, 0.1, 50, 0), lookAt(eye));
      let minY = Infinity;
      let maxY = -Infinity;
      let wide = 0;
      for (const p of pts) {
        const [x, y] = project(vp, p);
        wide = Math.max(wide, Math.abs(x));
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return { ok: wide <= maxX && maxY - minY <= topNdc - botNdc, minY, maxY };
    };
    let lo = 1.5;
    let hi = 40;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid).ok) hi = mid;
      else lo = mid;
    }
    const dist = hi;
    const { minY, maxY } = fits(dist);
    const shift = (topNdc + botNdc) / 2 - (minY + maxY) / 2;
    const eye = [0, Math.sin(elev) * dist, Math.cos(elev) * dist];
    state.eye = eye;
    state.viewProj = multiply(perspective(FOV, aspect, 0.1, 50, shift), lookAt(eye));
    const a = project(state.viewProj, [0, 0, R]);
    const b = project(state.viewProj, [0.01, 0, R]);
    const pxPerWorld = (Math.abs(b[0] - a[0]) * width) / 2 / 0.01;
    state.pxPerLoop = pxPerWorld * Math.PI * 2;
    state.pxPerTwist = clamp(height * 0.16, 80, 140);
  }

  function resize() {
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wasNarrow = state.width < 640;
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    state.dpr = dpr;
    canvas.width = Math.round(state.width * dpr);
    canvas.height = Math.round(state.height * dpr);
    if (wasNarrow !== state.width < 640) state.reps = 0;
    drawText();
    fitCamera();
    frame();
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.useProgram(ribbon.p);
    gl.uniformMatrix4fv(ribbon.u.uViewProj, false, state.viewProj);
    gl.uniform1f(ribbon.u.uRadius, 1);
    gl.uniform1f(ribbon.u.uBand, state.band);
    gl.uniform1f(ribbon.u.uTwist, state.twist);
    gl.uniform1f(ribbon.u.uRoll, 0);
    gl.uniform1f(ribbon.u.uYaw, -Math.PI * 2 * state.scroll);
    gl.uniform1f(ribbon.u.uLean, 0);
    gl.uniform3fv(ribbon.u.uEye, state.eye);
    gl.uniform1f(ribbon.u.uScroll, 0);
    gl.uniform3fv(ribbon.u.uInk, INK);
    gl.uniform3fv(ribbon.u.uFar, FAR_INK);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(ribbon.u.uText, 0);
    gl.bindVertexArray(ribbonVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(null);
  }

  function settled() {
    const idle = state.reduced ? 0 : IDLE_SPEED;
    return !state.drag && Math.abs(state.speed - idle) < 1e-4 && Math.abs(state.twist - state.twistTarget) < 1e-4 && Math.abs(state.twistVel) < 1e-4 && idle === 0;
  }

  function step(now) {
    state.raf = 0;
    if (state.destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - (state.last || now)) / 1000));
    state.last = now;
    const idle = state.reduced ? 0 : IDLE_SPEED;
    if (!state.drag) {
      state.speed = idle + (state.speed - idle) * Math.exp(-dt * 1.3);
      state.scroll += state.speed * dt;
      const k = 70;
      const c = 2 * Math.sqrt(k);
      const acc = k * (state.twistTarget - state.twist) - c * state.twistVel;
      state.twistVel += acc * dt;
      state.twist += state.twistVel * dt;
    } else {
      state.twist = damp(state.twist, state.twistTarget, 18, dt);
      state.twistVel = 0;
    }
    state.scroll -= Math.floor(state.scroll);
    const shown = Math.round(clamp(state.twistTarget, 0, MAX_TWIST));
    if (shown !== state.reportedTwist) {
      state.reportedTwist = shown;
      onTwist?.(shown);
    }
    render();
    if (!state.ready) {
      state.ready = true;
      onReady?.();
    }
    if (settled()) {
      state.twist = state.twistTarget;
      state.running = false;
      state.last = 0;
      return;
    }
    if (state.visible) state.raf = requestAnimationFrame(step);
    else {
      state.running = false;
      state.last = 0;
    }
  }

  function frame() {
    if (state.destroyed || !state.viewProj) return;
    if (!state.raf && state.visible) {
      state.running = true;
      state.raf = requestAnimationFrame(step);
    }
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    state.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, axis: null, twist0: state.twistTarget, samples: [{ t: e.timeStamp, s: state.scroll }] };
    state.speed = 0;
    host.setAttribute("data-dragging", "");
    frame();
  }

  function onMove(e) {
    const d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    d.x = e.clientX;
    d.y = e.clientY;
    const tx = e.clientX - d.sx;
    const ty = e.clientY - d.sy;
    if (!d.axis && Math.hypot(tx, ty) > 6) d.axis = Math.abs(tx) >= Math.abs(ty) ? "x" : "y";
    if (d.axis === "x") {
      state.scroll -= dx / state.pxPerLoop;
      const now = e.timeStamp;
      d.samples.push({ t: now, s: state.scroll });
      while (d.samples.length > 2 && now - d.samples[0].t > 120) d.samples.shift();
    } else if (d.axis === "y") {
      state.twistTarget = clamp(d.twist0 - ty / state.pxPerTwist, 0, MAX_TWIST);
    }
    frame();
  }

  function onUp(e) {
    const d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    state.drag = null;
    host.removeAttribute("data-dragging");
    if (d.axis === "x" && d.samples.length > 1) {
      const a = d.samples[0];
      const b = d.samples[d.samples.length - 1];
      const span = Math.max(16, b.t - a.t) / 1000;
      const recent = e.timeStamp - b.t < 140;
      state.speed = recent ? clamp((b.s - a.s) / span, -MAX_SPEED, MAX_SPEED) : 0;
    } else {
      state.speed = 0;
    }
    state.twistTarget = Math.round(clamp(state.twistTarget, 0, MAX_TWIST));
    frame();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);

  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting && document.visibilityState === "visible";
    if (state.visible) frame();
  });
  io.observe(host);
  const onVisibility = () => {
    state.visible = document.visibilityState === "visible";
    if (state.visible) frame();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotion = () => {
    state.reduced = motionQuery.matches;
    frame();
  };
  motionQuery.addEventListener?.("change", onMotion);

  const onContextLost = (e) => {
    e.preventDefault();
    onFail?.();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  document.fonts
    .load(`600 168px ${family}`, state.text)
    .catch(() => null)
    .then(() => {
      if (state.destroyed) return;
      resize();
    });

  return {
    setText(text) {
      const next = text.replace(/\s+/g, " ").trim() || DEFAULT_LINE;
      if (next === state.text) return;
      state.text = next;
      drawText();
      fitCamera();
      frame();
    },
    setTwist(n) {
      state.twistTarget = clamp(Math.round(n), 0, MAX_TWIST);
      frame();
    },
    nudge(dir) {
      state.speed = clamp(state.speed + dir * 0.09, -MAX_SPEED, MAX_SPEED);
      frame();
    },
    twistBy(dir) {
      state.twistTarget = clamp(Math.round(state.twistTarget) + dir, 0, MAX_TWIST);
      frame();
    },
    destroy() {
      state.destroyed = true;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener?.("change", onMotion);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteTexture(texture);
      gl.deleteBuffer(ribbonBuf);
      gl.deleteVertexArray(ribbonVao);
      gl.deleteProgram(ribbon.p);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
