import { PAPER, paintPoster } from "./reededPoster";
import { GLASS_FS, QUAD_VS } from "./reededShader";

const MAX_SPEED = 2400;
const FRICTION = 4.2;

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

function createGlass(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, GLASS_FS);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const locs = {};
  ["uPoster", "uStage", "uRes", "uPane", "uRib", "uMode", "uFade", "uPaper"].forEach((n) => {
    locs[n] = gl.getUniformLocation(prog, n);
  });
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([PAPER[0], PAPER[1], PAPER[2], 255]));
  return {
    upload(source) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(locs.uPoster, 0);
      gl.uniform2f(locs.uStage, f.stage[0], f.stage[1]);
      gl.uniform2f(locs.uRes, canvas.width, canvas.height);
      gl.uniform4f(locs.uPane, f.paneX, f.paneW, f.paneY, f.paneH);
      gl.uniform1f(locs.uRib, f.rib);
      gl.uniform1f(locs.uMode, f.mode);
      gl.uniform1f(locs.uFade, f.fade);
      gl.uniform3f(locs.uPaper, PAPER[0] / 255, PAPER[1] / 255, PAPER[2] / 255);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(tex);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

export function createReeded({ box, canvas, pane, embedded, onReady, onMode }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createGlass(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");
  const family = getComputedStyle(box).fontFamily || "system-ui, sans-serif";
  const posterCanvas = document.createElement("canvas");
  const view = { width: 1, height: 1, dpr: 1 };
  const st = { x: 0, v: 0, frac: 0.44, mode: 0, modeTarget: 0, drag: null, coasting: false };
  let fontReady = false;
  let ready = false;
  let readySent = false;
  let fade = reduced ? 1 : 0;
  let intro = reduced ? 0 : 1;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;

  function paneWidth() {
    return Math.round(view.width * (view.width < 640 ? 0.62 : 0.4));
  }

  function paneTop() {
    if (embedded) return 16;
    return view.width < 640 ? 232 : 216;
  }

  function paneBottom() {
    return view.height - (embedded ? 56 : view.width < 640 ? 96 : 88);
  }

  function bounds() {
    const w = paneWidth();
    return [-w * 0.55, view.width - w * 0.45];
  }

  function rib() {
    return view.width < 640 ? 12 : 16;
  }

  function placePane() {
    if (!pane) return;
    pane.style.transform = `translate3d(${st.x.toFixed(2)}px, 0, 0)`;
    pane.style.width = `${paneWidth()}px`;
    pane.style.top = `${paneTop()}px`;
    pane.style.height = `${Math.max(40, paneBottom() - paneTop())}px`;
  }

  function layout() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const first = view.width === 1;
    view.width = w;
    view.height = h;
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    view.dpr = Math.max(0.6, Math.min(dprCap, Math.sqrt(2600000 / (w * h))));
    gl.resize(Math.max(1, Math.round(w * view.dpr)), Math.max(1, Math.round(h * view.dpr)));
    const pw = paneWidth();
    if (first) st.x = w * (w < 640 ? 0.3 : 0.47) - pw / 2 + (reduced ? 0 : -w * 0.08);
    else st.x = st.frac * w - pw / 2;
    const [lo, hi] = bounds();
    st.x = clamp(st.x, lo, hi);
    st.frac = (st.x + pw / 2) / w;
    if (fontReady) {
      paintPoster(posterCanvas, { width: w, height: h, scale: Math.min(2, view.dpr), family });
      gl.upload(posterCanvas);
    }
    placePane();
  }

  function render() {
    gl.draw({
      stage: [view.width, view.height],
      paneX: st.x,
      paneW: paneWidth(),
      paneY: paneTop(),
      paneH: paneBottom() - paneTop(),
      rib: rib(),
      mode: st.mode,
      fade: 1 - Math.pow(1 - fade, 3),
    });
    placePane();
    if (!readySent && fade > 0) {
      readySent = true;
      onReady?.();
    }
  }

  function simulate(dt) {
    let busy = false;
    const pw = paneWidth();
    const [lo, hi] = bounds();
    const d = st.drag;
    if (d) {
      const prev = st.x;
      const k = 1 - Math.exp(-dt * 40);
      st.x += (d.targetX - st.x) * k;
      if (dt > 0.001) {
        const inst = (st.x - prev) / dt;
        st.v += (inst - st.v) * (1 - Math.exp(-dt / 0.05));
      }
      busy = true;
    } else if (st.coasting) {
      st.v = clamp(st.v, -MAX_SPEED, MAX_SPEED);
      st.x += st.v * dt;
      st.v *= Math.exp(-FRICTION * dt);
      if (st.x < lo || st.x > hi) {
        const edge = st.x < lo ? lo : hi;
        const spring = 1 - Math.exp(-dt * 12);
        st.x += (edge - st.x) * spring;
        st.v *= Math.exp(-10 * dt);
        if (Math.abs(st.x - edge) < 0.3 && Math.abs(st.v) < 8) {
          st.x = edge;
          st.v = 0;
        }
      }
      if (Math.abs(st.v) < 6 && st.x >= lo - 0.3 && st.x <= hi + 0.3) {
        st.v = 0;
        st.coasting = false;
      } else busy = true;
    }
    if (intro > 0 && ready && !d) {
      intro = Math.max(0, intro - dt / 1.6);
      const t = 1 - intro;
      const e = 1 - Math.pow(1 - t, 3);
      const startX = view.width * (view.width < 640 ? 0.3 : 0.47) - pw / 2 - view.width * 0.08;
      st.x = startX + view.width * 0.08 * e;
      busy = true;
    }
    if (st.mode !== st.modeTarget) {
      const k = 1 - Math.exp(-dt * (reduced ? 60 : 7));
      st.mode += (st.modeTarget - st.mode) * k;
      if (Math.abs(st.mode - st.modeTarget) < 0.002) st.mode = st.modeTarget;
      busy = true;
    }
    st.frac = (st.x + pw / 2) / view.width;
    return busy;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    if (!ready) return;
    let busy = simulate(dt);
    if (fade < 1) {
      fade = Math.min(1, fade + dt / 0.6);
      busy = true;
    }
    render();
    if (busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag) return;
    pane.setPointerCapture?.(e.pointerId);
    intro = 0;
    st.coasting = false;
    st.v = 0;
    st.drag = { id: e.pointerId, startX: e.clientX, originX: st.x, targetX: st.x, lastX: e.clientX };
    box.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    const [lo, hi] = bounds();
    let x = d.originX + (e.clientX - d.startX);
    if (x < lo) x = lo - (lo - x) * 0.3;
    if (x > hi) x = hi + (x - hi) * 0.3;
    d.targetX = x;
    wake();
  }

  function onUp(e) {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    st.drag = null;
    delete box.dataset.grabbing;
    st.v = e.type === "pointercancel" ? 0 : clamp(st.v, -MAX_SPEED, MAX_SPEED);
    st.coasting = true;
    wake();
  }

  function onKey(e) {
    const step = e.shiftKey ? 120 : 32;
    let dx = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "p" || e.key === "P") {
      setMode(st.modeTarget > 0.5 ? 0 : 1);
      onMode?.(st.modeTarget > 0.5 ? "painterly" : "architectural");
      e.preventDefault();
      return;
    }
    if (!dx || st.drag) return;
    e.preventDefault();
    intro = 0;
    st.v = dx * FRICTION * 1.02;
    st.coasting = true;
    wake();
  }

  function setMode(m) {
    st.modeTarget = m;
    wake();
  }

  layout();

  document.fonts
    .load(`600 200px ${family}`, "slow light")
    .catch(() => null)
    .then(() => {
      if (destroyed || !gl) return;
      fontReady = true;
      layout();
      ready = true;
      wake();
    });

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
    if (ready && gl) render();
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  pane.addEventListener("pointerdown", onDown);
  pane.addEventListener("pointermove", onMove);
  pane.addEventListener("pointerup", onUp);
  pane.addEventListener("pointercancel", onUp);
  pane.addEventListener("keydown", onKey);

  return {
    setMode,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      pane.removeEventListener("pointerdown", onDown);
      pane.removeEventListener("pointermove", onMove);
      pane.removeEventListener("pointerup", onUp);
      pane.removeEventListener("pointercancel", onUp);
      pane.removeEventListener("keydown", onKey);
      gl?.destroy();
      gl = null;
    },
  };
}
