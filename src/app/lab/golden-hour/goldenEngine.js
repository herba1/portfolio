import { SUNRISE, SUNSET, dayState, formatTime, hoursFromAngle, toSrgbString } from "./goldenDay";
import { QUAD_VS, SCENE_FS } from "./goldenShader";

const PAPER = [236, 230, 220];
const WINDOW = [0.45, 3.65, 0.8, 4.5];
const WINDOW_Z = 3.6;
const CAM = [0.15, 3.1, 11.5];
const TARGET = [0.05, 1.0, 1.2];
const MAX_RATE = 5;
const GOLDEN = 18.75;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function createScene(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SCENE_FS);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const names = ["uRes", "uCamPos", "uCamF", "uCamR", "uCamU", "uFocal", "uCenter", "uSun", "uLight", "uShadow", "uTint", "uAmbient", "uFog0", "uFog1", "uBounce", "uRays", "uDrift", "uFade", "uPaper", "uWin", "uWinZ", "uRaySteps"];
  const u = {};
  names.forEach((n) => {
    u[n] = gl.getUniformLocation(prog, n);
  });
  const vao = gl.createVertexArray();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const software = /swiftshader|llvmpipe|software/i.test(String(renderer || ""));
  return {
    software,
    resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    draw(f) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform3fv(u.uCamPos, f.cam.pos);
      gl.uniform3fv(u.uCamF, f.cam.f);
      gl.uniform3fv(u.uCamR, f.cam.r);
      gl.uniform3fv(u.uCamU, f.cam.u);
      gl.uniform1f(u.uFocal, f.cam.focal);
      gl.uniform2f(u.uCenter, f.cam.cx, f.cam.cy);
      gl.uniform3fv(u.uSun, f.day.dir);
      gl.uniform3fv(u.uLight, f.day.light);
      gl.uniform3fv(u.uShadow, f.day.shadow);
      gl.uniform1f(u.uTint, f.day.tint);
      gl.uniform1f(u.uAmbient, f.day.ambient);
      gl.uniform3fv(u.uFog0, f.day.fog0);
      gl.uniform3fv(u.uFog1, f.day.fog1);
      gl.uniform1f(u.uBounce, f.day.bounce);
      gl.uniform1f(u.uRays, f.day.rays);
      gl.uniform1f(u.uDrift, f.drift);
      gl.uniform1f(u.uFade, f.fade);
      gl.uniform3f(u.uPaper, PAPER[0] / 255, PAPER[1] / 255, PAPER[2] / 255);
      gl.uniform4f(u.uWin, WINDOW[0], WINDOW[1], WINDOW[2], WINDOW[3]);
      gl.uniform1f(u.uWinZ, WINDOW_Z);
      gl.uniform1i(u.uRaySteps, f.steps);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function startingHour() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= SUNRISE + 0.5 && h <= SUNSET + 0.3 ? h : GOLDEN;
}

export function createGoldenHour({ box, canvas, dial, sun, readout, embedded, onReady }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createScene(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");
  const home = startingHour();
  const st = { hours: reduced ? home : home - 1.1, target: home, rate: 2.2, drag: null };
  const view = { width: 1, height: 1, dpr: 1 };
  let cam = null;
  let fade = reduced ? 1 : 0;
  let introDelay = reduced ? 0 : 0.35;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let readySent = false;
  let shownMinute = -1;
  let shownDark = null;

  function camera() {
    const w = view.width;
    const h = view.height;
    const narrow = w < 640;
    const focal = Math.min(w * 1.87, h * (narrow ? 1.5 : 1.9)) * view.dpr;
    const f = norm(sub(TARGET, CAM));
    const r = norm(cross(f, [0, 1, 0]));
    const up = cross(r, f);
    const cy = (1 - (embedded ? 0.6 : narrow ? 0.66 : 0.64)) * h * view.dpr;
    return { pos: CAM, f, r, u: up, focal, cx: 0.5 * w * view.dpr, cy };
  }

  function layout() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    view.width = w;
    view.height = h;
    const budget = gl.software ? 900000 : 2200000;
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    view.dpr = Math.max(0.5, Math.min(dprCap, Math.sqrt(budget / (w * h))));
    gl.resize(Math.max(1, Math.round(w * view.dpr)), Math.max(1, Math.round(h * view.dpr)));
    cam = camera();
  }

  function syncDom(day) {
    const minute = Math.round(day.hours * 60) % 1440;
    if (minute !== shownMinute) {
      shownMinute = minute;
      const label = formatTime(day.hours);
      if (readout) readout.textContent = label;
      dial?.setAttribute("aria-valuetext", label);
      dial?.setAttribute("aria-valuenow", String(minute));
    }
    if (sun) {
      const a = day.dial;
      sun.setAttribute("cx", (44 + 24 * Math.cos(a)).toFixed(2));
      sun.setAttribute("cy", (36 - 24 * Math.sin(a)).toFixed(2));
      sun.style.fill = toSrgbString(day.hue);
    }
    if (day.dark !== shownDark) {
      shownDark = day.dark;
      if (day.dark) box.dataset.dark = "";
      else delete box.dataset.dark;
    }
  }

  function render() {
    if (!cam) return;
    const day = dayState(st.hours);
    gl.draw({
      cam,
      day,
      drift: st.hours * 2.6,
      fade: 1 - Math.pow(1 - fade, 3),
      steps: gl.software ? 10 : 18,
    });
    syncDom(day);
    if (!readySent && fade > 0) {
      readySent = true;
      onReady?.();
    }
  }

  function simulate(dt) {
    const diff = st.target - st.hours;
    if (Math.abs(diff) < 0.0015) {
      st.hours = st.target;
      st.rate = 8;
      return false;
    }
    let step = diff * (1 - Math.exp(-dt * (reduced ? 40 : st.rate)));
    const cap = MAX_RATE * dt;
    step = clamp(step, -cap, cap);
    st.hours += step;
    return true;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    let busy = false;
    if (fade < 1) {
      fade = Math.min(1, fade + dt / 0.7);
      busy = true;
    }
    if (introDelay > 0) {
      introDelay -= dt;
      busy = true;
    } else busy = simulate(dt) || busy;
    if (st.drag) busy = true;
    render();
    if (busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function setTarget(h, rate = 8) {
    introDelay = 0;
    st.rate = rate;
    st.target = h;
    wake();
  }

  function unwrapNear(h, ref) {
    let v = h;
    while (v - ref > 12) v -= 24;
    while (ref - v > 12) v += 24;
    return v;
  }

  function onCanvasDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag) return;
    canvas.setPointerCapture?.(e.pointerId);
    introDelay = 0;
    st.drag = { kind: "canvas", id: e.pointerId, x0: e.clientX, y0: e.clientY, h0: st.target, live: e.pointerType === "mouse" };
    box.dataset.grabbing = "";
    wake();
  }

  function onCanvasMove(e) {
    const d = st.drag;
    if (!d || d.kind !== "canvas" || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.live) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.2 && embedded) {
        onCanvasUp(e);
        return;
      }
      d.live = true;
      d.x0 = e.clientX;
      return;
    }
    const span = Math.max(view.width, 640);
    setTarget(d.h0 + ((e.clientX - d.x0) / span) * 10);
  }

  function onCanvasUp(e) {
    const d = st.drag;
    if (!d || d.kind !== "canvas" || e.pointerId !== d.id) return;
    st.drag = null;
    delete box.dataset.grabbing;
    wake();
  }

  function dialHours(e) {
    const r = dial.getBoundingClientRect();
    const sx = r.width / 88;
    const sy = r.height / 64;
    const x = (e.clientX - r.left) / sx - 44;
    const y = 36 - (e.clientY - r.top) / sy;
    return hoursFromAngle(Math.atan2(y, x));
  }

  function onDialDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag) return;
    e.stopPropagation();
    dial.setPointerCapture?.(e.pointerId);
    st.drag = { kind: "dial", id: e.pointerId };
    box.dataset.grabbing = "";
    setTarget(unwrapNear(dialHours(e), st.target));
  }

  function onDialMove(e) {
    const d = st.drag;
    if (!d || d.kind !== "dial" || e.pointerId !== d.id) return;
    setTarget(unwrapNear(dialHours(e), st.target));
  }

  function onDialUp(e) {
    const d = st.drag;
    if (!d || d.kind !== "dial" || e.pointerId !== d.id) return;
    st.drag = null;
    delete box.dataset.grabbing;
    wake();
  }

  function onKey(e) {
    let next = null;
    const big = e.shiftKey ? 6 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = st.target + (10 / 60) * big;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = st.target - (10 / 60) * big;
    else if (e.key === "PageUp") next = st.target + 1;
    else if (e.key === "PageDown") next = st.target - 1;
    else if (e.key === "Home") next = unwrapNear(SUNRISE, st.target);
    else if (e.key === "End") next = unwrapNear(SUNSET, st.target);
    else if (e.key === "n" || e.key === "N") next = unwrapNear(startingHour(), st.target);
    if (next === null) return;
    e.preventDefault();
    setTarget(next);
  }

  layout();

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layout();
    if (gl) render();
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onCanvasDown);
  canvas.addEventListener("pointermove", onCanvasMove);
  canvas.addEventListener("pointerup", onCanvasUp);
  canvas.addEventListener("pointercancel", onCanvasUp);
  dial?.addEventListener("pointerdown", onDialDown);
  dial?.addEventListener("pointermove", onDialMove);
  dial?.addEventListener("pointerup", onDialUp);
  dial?.addEventListener("pointercancel", onDialUp);
  dial?.addEventListener("keydown", onKey);
  render();
  wake();

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      canvas.removeEventListener("pointermove", onCanvasMove);
      canvas.removeEventListener("pointerup", onCanvasUp);
      canvas.removeEventListener("pointercancel", onCanvasUp);
      dial?.removeEventListener("pointerdown", onDialDown);
      dial?.removeEventListener("pointermove", onDialMove);
      dial?.removeEventListener("pointerup", onDialUp);
      dial?.removeEventListener("pointercancel", onDialUp);
      dial?.removeEventListener("keydown", onKey);
      gl?.destroy();
      gl = null;
    },
  };
}
