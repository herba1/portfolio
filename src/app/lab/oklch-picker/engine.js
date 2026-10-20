import {
  C_MAX,
  contrast,
  cssOf,
  edgePoints,
  grade,
  hexOf,
  inP3,
  linearRgb,
  luminance,
  luminanceOfHex,
  mapped,
  maxChroma,
  paintHue,
  paintPlane,
  pathOf,
} from "./color";
import { createLoop, prefersReducedMotion, settle, spring, step, tune } from "./motion";

const INK = "#1a1a1a";
const SURFACE = "#f1f5f9";
const Y_INK = luminanceOfHex(INK);
const Y_SURFACE = luminanceOfHex(SURFACE);
const Y_WHITE = 1;

const wrap = (h) => ((h % 360) + 360) % 360;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createEngine(root, chipEls, { onSettle, onGone }) {
  const $ = (sel) => root.querySelector(sel);
  const plane = $(".okp-plane");
  const planeCanvas = $(".okp-plane-canvas");
  const planeCtx = planeCanvas.getContext("2d");
  const hue = $(".okp-hue");
  const hueCanvas = $(".okp-hue-canvas");
  const hueCtx = hueCanvas.getContext("2d");
  const hueImage = hueCtx.createImageData(360, 1);
  const handle = $(".okp-handle");
  const crossX = $(".okp-cross--x");
  const crossY = $(".okp-cross--y");
  const thumb = $(".okp-hue-thumb");
  const edgeSrgb = $(".okp-edge-srgb");
  const edgeP3 = $(".okp-edge-p3");
  const gamut = $(".okp-gamut");
  const gamutLabel = $(".okp-gamut-label");
  const cssText = $(".okp-css-text");
  const hexText = $(".okp-hex");
  const inputs = { L: $('[data-axis="L"]'), C: $('[data-axis="C"]'), H: $('[data-axis="H"]') };
  const tinted = [...root.querySelectorAll(".okp-handle, .okp-hue-thumb, .okp-cta, .okp-link, .okp-aa")];
  const cta = $(".okp-cta");
  let lastHex = "";
  const pairs = [...root.querySelectorAll(".okp-pair")].map((el) => ({
    y: el.dataset.on === "ink" ? Y_INK : Y_SURFACE,
    ratio: el.querySelector(".okp-ratio-n"),
    grade: el.querySelector(".okp-grade"),
    last: "",
  }));

  const reduced = prefersReducedMotion();
  const L = spring(0.6, 0.42, 1);
  const C = spring(0.15, 0.42, 1);
  const H = spring(250, 0.42, 1);
  const press = spring(1, 0.22, 0.8);
  const thumbPress = spring(1, 0.22, 0.8);
  const chips = new Map();
  let planeSize = { w: 1, h: 1 };
  let hueWidth = 1;
  let planeImage = null;
  let paintedHue = NaN;
  let paintedLC = "";
  let lastGamut = "";
  let lastOn = "";
  let dragging = null;
  let dragRect = null;
  let animating = false;
  let visible = true;

  const color = () => ({ L: L.x, C: C.x, h: wrap(H.x) });

  function setDirect(next) {
    if (next.L !== undefined) settle(L, clamp(next.L, 0, 1));
    if (next.C !== undefined) settle(C, clamp(next.C, 0, C_MAX));
    if (next.h !== undefined) settle(H, next.h);
  }

  function resizePlane() {
    const w = Math.max(1, plane.clientWidth);
    const h = Math.max(1, plane.clientHeight);
    planeSize = { w, h };
    const rw = clamp(Math.round(w / 3), 48, 180);
    const rh = clamp(Math.round((rw * h) / w), 32, 180);
    if (planeCanvas.width !== rw || planeCanvas.height !== rh || !planeImage) {
      planeCanvas.width = rw;
      planeCanvas.height = rh;
      planeImage = planeCtx.createImageData(rw, rh);
    }
    paintedHue = NaN;
    hueWidth = Math.max(1, hue.clientWidth);
    render();
  }

  function paint() {
    const h = wrap(H.x);
    if (planeImage && !(Math.abs(h - paintedHue) < 0.05)) {
      paintPlane(planeImage, h);
      planeCtx.putImageData(planeImage, 0, 0);
      const edge = edgePoints(h);
      planeCanvas.style.clipPath = `polygon(0% 0%, ${edge.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(", ")}, 0% 100%)`;
      edgeSrgb.setAttribute("d", pathOf(edge));
      edgeP3.setAttribute("d", pathOf(edgePoints(h, inP3)));
      paintedHue = h;
    }
    const lc = `${L.x.toFixed(3)} ${Math.min(C.x, 0.4).toFixed(3)}`;
    if (lc !== paintedLC) {
      paintHue(hueImage, L.x, C.x);
      hueCtx.putImageData(hueImage, 0, 0);
      paintedLC = lc;
    }
  }

  function render() {
    paint();
    const h = wrap(H.x);
    const px = (C.x / C_MAX) * planeSize.w;
    const py = (1 - L.x) * planeSize.h;
    handle.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%) scale(${press.x})`;
    crossX.style.transform = `translate3d(0, ${py}px, 0)`;
    crossY.style.transform = `translate3d(${px}px, 0, 0)`;
    thumb.style.transform = `translate3d(${(h / 360) * hueWidth}px, 0, 0) translateX(-50%) scale(${thumbPress.x})`;

    const { rgb, clipped, edge } = mapped(L.x, C.x, h);
    const hex = hexOf(rgb);
    if (hex !== lastHex) {
      for (const el of tinted) el.style.setProperty("--okp-color", hex);
      lastHex = hex;
    }
    const y = luminance(rgb);
    const on = contrast(y, Y_WHITE) >= contrast(y, Y_INK) ? "light" : "dark";
    if (on !== lastOn) {
      cta.dataset.on = on;
      lastOn = on;
    }
    const state = !clipped ? "srgb" : inP3(linearRgb(L.x, C.x, h, [0, 0, 0])) ? "p3" : "out";
    if (state !== lastGamut) {
      gamut.dataset.gamut = state;
      gamutLabel.textContent = state === "srgb" ? "In sRGB" : state === "p3" ? "P3 only" : "Out of gamut";
      lastGamut = state;
    }
    plane.dataset.clipped = clipped ? "true" : "false";
    cssText.textContent = cssOf(L.x, C.x, h);
    hexText.textContent = clipped ? `${hex} · C ${edge.toFixed(3)}` : hex;
    for (const pair of pairs) {
      const r = contrast(y, pair.y);
      pair.ratio.textContent = r.toFixed(2);
      const g = grade(r);
      if (g !== pair.last) {
        pair.grade.textContent = g;
        pair.grade.dataset.grade = g === "Fail" ? "fail" : g === "AA Large" ? "large" : "pass";
        pair.last = g;
      }
    }
    const values = { L: (L.x * 100).toFixed(1), C: C.x.toFixed(3), H: h.toFixed(1) };
    for (const axis of ["L", "C", "H"]) {
      const input = inputs[axis];
      if (document.activeElement !== input && input.value !== values[axis]) input.value = values[axis];
    }
  }

  function announce() {
    plane.setAttribute("aria-valuenow", String(Math.round(L.x * 100)));
    plane.setAttribute("aria-valuetext", `Lightness ${(L.x * 100).toFixed(1)}%, chroma ${C.x.toFixed(3)}`);
    hue.setAttribute("aria-valuenow", String(Math.round(wrap(H.x))));
    onSettle(color());
  }

  function stepChips(dt) {
    let more = false;
    for (const [id, s] of chips) {
      const a = step(s.ox, dt, 0.05);
      const b = step(s.oy, dt, 0.05);
      const c = step(s.sc, dt, 0.001);
      const d = step(s.op, dt, 0.001);
      more = more || a || b || c || d;
      s.el.style.transform = `translate3d(${s.ox.x}px, ${s.oy.x}px, 0) scale(${s.sc.x})`;
      s.el.style.opacity = String(clamp(s.op.x, 0, 1));
      if (!a && !b && !c && !d && s.el.style.zIndex === "0") s.el.style.zIndex = "";
      if (s.gone && !s.reported && s.op.x < 0.02) {
        s.reported = true;
        onGone(id);
      }
    }
    return more;
  }

  const loop = createLoop((dt) => {
    const moving = [step(L, dt, 0.0002), step(C, dt, 0.00005), step(H, dt, 0.02)].some(Boolean);
    const pressing = [step(press, dt, 0.001), step(thumbPress, dt, 0.001)].some(Boolean);
    const chipping = stepChips(dt);
    render();
    if (animating && !moving) {
      animating = false;
      settle(H, wrap(H.x));
      announce();
    }
    return (moving || pressing || chipping) && visible;
  });

  function set(target, animate) {
    if (!animate || reduced) {
      setDirect(target);
      animating = false;
      render();
      announce();
      return;
    }
    const base = H.x;
    const delta = ((target.h - wrap(base) + 540) % 360) - 180;
    L.target = target.L;
    C.target = target.C;
    H.target = base + delta;
    animating = true;
    loop.kick();
  }

  function fromPlane(event) {
    const x = clamp((event.clientX - dragRect.left) / dragRect.width, 0, 1);
    const y = clamp((event.clientY - dragRect.top) / dragRect.height, 0, 1);
    setDirect({ L: 1 - y, C: x * C_MAX });
    if (!animating) render();
  }

  function fromHue(event) {
    const x = clamp((event.clientX - dragRect.left) / dragRect.width, 0, 1);
    settle(H, x * 360);
    render();
  }

  function begin(event, kind) {
    if (event.button !== undefined && event.button !== 0) return;
    const el = kind === "plane" ? plane : hue;
    el.setPointerCapture(event.pointerId);
    dragRect = el.getBoundingClientRect();
    dragging = kind;
    if (kind === "plane") {
      settle(L, L.x);
      settle(C, C.x);
      press.target = 1.2;
    } else {
      settle(H, wrap(H.x));
      thumbPress.target = 1.15;
    }
    if (animating && kind === "hue") animating = false;
    if (!reduced) loop.kick();
    else {
      settle(press, 1);
      settle(thumbPress, 1);
    }
    if (kind === "plane") fromPlane(event);
    else fromHue(event);
  }

  function move(event) {
    if (!dragging) return;
    if (dragging === "plane") fromPlane(event);
    else fromHue(event);
  }

  function end() {
    if (!dragging) return;
    dragging = null;
    press.target = 1;
    thumbPress.target = 1;
    loop.kick();
    if (!animating) announce();
  }

  const listen = (el) => {
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };
  listen(plane);
  listen(hue);

  function nudge(change) {
    animating = false;
    setDirect(change);
    render();
    announce();
  }

  function planeKey(event) {
    const big = event.shiftKey;
    const map = {
      ArrowUp: { L: L.x + (big ? 0.05 : 0.01) },
      ArrowDown: { L: L.x - (big ? 0.05 : 0.01) },
      ArrowRight: { C: C.x + (big ? 0.02 : 0.004) },
      ArrowLeft: { C: C.x - (big ? 0.02 : 0.004) },
      Home: { C: 0 },
      End: { C: maxChroma(L.x, wrap(H.x)) },
    };
    const change = map[event.key];
    if (!change) return;
    event.preventDefault();
    nudge(change);
  }

  function hueKey(event) {
    const big = event.shiftKey ? 10 : 1;
    const map = { ArrowRight: big, ArrowUp: big, ArrowLeft: -big, ArrowDown: -big };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      nudge({ h: event.key === "Home" ? 0 : 359.9 });
      return;
    }
    if (!(event.key in map)) return;
    event.preventDefault();
    nudge({ h: wrap(H.x + map[event.key]) });
  }

  function parse(axis, raw) {
    const n = parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) return null;
    if (axis === "L") return { L: clamp(n > 1 ? n / 100 : n, 0, 1) };
    if (axis === "C") return { C: clamp(n, 0, C_MAX) };
    return { h: wrap(n) };
  }

  function fieldCommit(input, axis) {
    const change = parse(axis, input.value);
    if (change) set({ ...color(), ...change }, true);
    else render();
  }

  function fieldKey(event, axis) {
    const input = event.currentTarget;
    if (event.key === "Enter") {
      event.preventDefault();
      fieldCommit(input, axis);
      input.select();
      return;
    }
    if (event.key === "Escape") {
      input.blur();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const dir = event.key === "ArrowUp" ? 1 : -1;
    const big = event.shiftKey ? 10 : 1;
    const change = axis === "L" ? { L: L.x + 0.001 * big * dir } : axis === "C" ? { C: C.x + 0.001 * big * dir } : { h: wrap(H.x + 0.1 * big * dir) };
    nudge(change);
    const values = { L: (L.x * 100).toFixed(1), C: C.x.toFixed(3), H: wrap(H.x).toFixed(1) };
    input.value = values[axis];
  }

  function layoutChips(initial = false) {
    for (const [id, s] of chips) if (!chipEls.has(id)) chips.delete(id);
    for (const [id, el] of chipEls) {
      const x = el.offsetLeft;
      const y = el.offsetTop;
      let s = chips.get(id);
      if (!s || s.el !== el) {
        const enter = !initial && !reduced && !s;
        s = {
          el,
          x,
          y,
          ox: spring(0, 0.34, 0.94),
          oy: spring(0, 0.34, 0.94),
          sc: spring(enter ? 0.9 : 1, 0.32, 0.9),
          op: spring(enter ? 0 : 1, 0.24, 1),
        };
        s.sc.target = 1;
        s.op.target = 1;
        if (enter) el.style.zIndex = "0";
        chips.set(id, s);
      } else if (!reduced) {
        s.ox.x += s.x - x;
        s.oy.x += s.y - y;
        s.x = x;
        s.y = y;
      }
      if (el.dataset.gone && !s.gone) {
        s.gone = true;
        tune(s.op, 0.18, 1);
        s.sc.target = 0.9;
        s.op.target = 0;
        if (reduced) settle(s.op, 0);
      }
    }
    if (stepChips(0)) loop.kick();
    else loop.kick();
  }

  function chipAt(id) {
    const s = chips.get(id);
    return s ? { x: s.x, y: s.y } : undefined;
  }

  const observer = new ResizeObserver(resizePlane);
  observer.observe(plane);
  observer.observe(hue);

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) loop.kick();
  });
  io.observe(root);

  resizePlane();
  layoutChips(true);

  return {
    set,
    color,
    css: () => cssOf(L.x, C.x, wrap(H.x)),
    planeDown: (e) => begin(e.nativeEvent ?? e, "plane"),
    hueDown: (e) => begin(e.nativeEvent ?? e, "hue"),
    planeKey,
    hueKey,
    fieldKey,
    fieldCommit,
    layoutChips: () => layoutChips(false),
    chipAt,
    destroy() {
      loop.stop();
      observer.disconnect();
      io.disconnect();
    },
  };
}
