"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { LIGHTS } from "./exposureScenes";
import "./long-exposure.css";

const FRAME_LABEL =
  "A camera's live view of a dark club. Press and hold to open the shutter, then move to paint light trails with a glowstick; let go to close it and develop the photo into the stack of prints. Press Enter for a demonstration exposure, and 1 to 3 to change the light.";

const KEEP = 4;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function angleFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 997;
  return ((h / 997) * 2 - 1) * 4.2;
}

function computeLayout(width, height, embedded, headBottom) {
  if (embedded) {
    const fh = Math.max(120, Math.min(height - 24, (width - 24) / 0.8));
    const fw = fh * 0.8;
    const fx = (width - fw) / 2;
    const fy = (height - fh) / 2;
    const pw = Math.round(Math.max(48, Math.min(68, width * 0.15)));
    const ph = pw * 1.22;
    return { fx, fy, fw, fh, pw, ph, sx: fx + fw - pw - 14, sy: fy + fh - ph - 14, dx: -pw * 0.42, dy: 0, wide: false };
  }
  if (width >= 900) {
    const top = 96;
    const pw = Math.round(Math.max(88, Math.min(128, width * 0.08)));
    const ph = pw * 1.22;
    const side = pw * 1.4 + 64;
    const fh = Math.max(200, Math.min(height - top - 32, (width - side * 2) / 0.8));
    const fw = fh * 0.8;
    const fx = (width - fw) / 2;
    const fy = top + Math.max(0, (height - top - 32 - fh) / 2);
    return { fx, fy, fw, fh, pw, ph, sx: fx + fw + 48, sy: fy + fh - ph, dx: 0, dy: -ph * 0.58, wide: true };
  }
  const top = Math.max(96, headBottom + 16);
  const pw = Math.round(Math.max(60, Math.min(84, width * 0.17)));
  const ph = pw * 1.22;
  const below = ph + 40;
  const fh = Math.max(160, Math.min(height - top - below, (width - 32) / 0.8));
  const fw = fh * 0.8;
  const fx = (width - fw) / 2;
  const fy = top;
  return { fx, fy, fw, fh, pw, ph, sx: Math.max(fx + fw, width - 16) - pw - 4, sy: fy + fh + 20, dx: -pw * 0.46, dy: 0, wide: false };
}

function slotTransform(layout, index, id) {
  const x = layout.sx + layout.dx * index;
  const y = layout.sy + layout.dy * index;
  const lift = index >= KEEP ? 24 : 0;
  return `translate3d(${x.toFixed(1)}px, ${(y + lift).toFixed(1)}px, 0) rotate(${angleFor(id).toFixed(2)}deg)`;
}

function Print({ print, index, layout, fly, lifted, onOpen, embedded }) {
  const ref = useRef(null);
  const paperRef = useRef(null);
  const flown = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || flown.current || !fly) return;
    flown.current = true;
    const imgW = layout.pw * 0.88;
    const scale = layout.fw / imgW;
    const border = layout.pw * 0.06;
    const fromX = layout.fx - border * scale;
    const fromY = layout.fy - border * scale;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const to = slotTransform(layout, index, print.id);
    el.animate(
      [
        { transform: `translate3d(${fromX.toFixed(1)}px, ${fromY.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`, opacity: 0 },
        { opacity: 1, offset: 0.16 },
        { transform: to, opacity: 1 },
      ],
      { duration: reduced ? 1 : 880, easing: EASE },
    );
    paperRef.current?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1 }], {
      duration: reduced ? 1 : 880,
      easing: "ease-out",
    });
  }, [fly, layout, index, print.id]);

  const names = print.lights.map((l) => LIGHTS[l]?.label).filter(Boolean).join(" and ");
  return (
    <button
      ref={ref}
      type="button"
      className="long-exposure__print"
      data-gone={index >= KEEP ? "" : undefined}
      data-lifted={lifted ? "" : undefined}
      tabIndex={index >= KEEP || embedded ? -1 : 0}
      aria-label={`Photo, ${print.seconds.toFixed(1)} second exposure in ${names}. Open large.`}
      style={{ transform: slotTransform(layout, index, print.id), zIndex: 20 - index }}
      onClick={(e) => onOpen(print, e.currentTarget)}
    >
      <span ref={paperRef} className="long-exposure__paper" aria-hidden="true" />
      <span className="long-exposure__photo" style={{ backgroundImage: `url(${print.url})` }} />
      <span className="long-exposure__gloss" aria-hidden="true" />
    </button>
  );
}

function Viewer({ view, box, onClosed, embedded }) {
  const ref = useRef(null);
  const backRef = useRef(null);
  const closing = useRef(false);
  const maxH = box.height - (embedded ? 32 : 220);
  const maxW = box.width - 32;
  const pw = Math.min(maxW, maxH / 1.22);
  const ph = pw * 1.22;
  const x = (box.width - pw) / 2;
  const y = (box.height - ph) / 2 + (embedded ? 0 : 12);

  const fromTransform = useCallback(() => {
    const r = view.rect;
    const s = r.width / pw;
    return `translate3d(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px, 0) rotate(${angleFor(view.print.id).toFixed(2)}deg) scale(${s.toFixed(4)})`;
  }, [view, pw]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.animate([{ transform: fromTransform() }, { transform: `translate3d(${x}px, ${y}px, 0)` }], {
      duration: reduced ? 1 : 560,
      easing: EASE,
    });
    backRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 1 : 360, easing: "ease-out" });
    el.focus({ preventScroll: true });
  }, [fromTransform, x, y]);

  const close = useCallback(() => {
    const el = ref.current;
    if (!el || closing.current) return;
    closing.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    backRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 1 : 360, easing: "ease-out", fill: "forwards" });
    const duration = reduced ? 1 : 460;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClosed();
    };
    el.animate([{ transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: fromTransform() }], {
      duration,
      easing: EASE,
      fill: "forwards",
    }).finished.then(finish, finish);
    window.setTimeout(finish, duration + 120);
  }, [fromTransform, onClosed, x, y]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const p = view.print;
  return (
    <div className="long-exposure__viewer" onClick={close}>
      <div ref={backRef} className="long-exposure__veil" />
      <button
        ref={ref}
        type="button"
        className="long-exposure__print long-exposure__print--large"
        style={{ width: pw, height: ph, transform: `translate3d(${x}px, ${y}px, 0)` }}
        aria-label="Close photo"
        onClick={close}
      >
        <span className="long-exposure__paper" aria-hidden="true" />
        <span className="long-exposure__photo" style={{ backgroundImage: `url(${p.url})` }} />
        <span className="long-exposure__gloss" aria-hidden="true" />
      </button>
      {!embedded && (
        <p className="long-exposure__caption" style={{ top: y + ph + 12 }}>
          <span className="long-exposure__caption-time">{p.seconds.toFixed(1)}s</span>
          {p.lights.map((l) => (
            <span key={l} className="long-exposure__caption-light">
              <span className="long-exposure__dot" style={{ "--long-exposure-light": LIGHTS[l]?.swatch }} />
              {LIGHTS[l]?.label}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const blinkRef = useRef(null);
  const timeRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const lightRef = useRef(0);
  const near = useNearViewport(rootRef);
  const [layout, setLayout] = useState(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [prints, setPrints] = useState([]);
  const [fresh, setFresh] = useState(() => new Set());
  const [light, setLight] = useState(0);
  const [view, setView] = useState(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const headBottom = head ? head.bottom - rect.top : 72;
      setBox({ width: rect.width, height: rect.height });
      setLayout(computeLayout(rect.width, rect.height, embedded, headBottom));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [embedded]);

  const hasLayout = Boolean(layout);

  useEffect(() => {
    if (!near || !hasLayout) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    import("./exposureEngine").then(({ default: ExposureEngine }) => {
      if (cancelled) return;
      const real = new ExposureEngine({
        frame: frameRef.current,
        canvas: canvasRef.current,
        cursor: cursorRef.current,
        blink: blinkRef.current,
        time: timeRef.current,
        onState: (mode) => root.setAttribute("data-mode", mode),
        onReady: () => root.setAttribute("data-ready", ""),
        onFail: () => root.setAttribute("data-failed", ""),
        onSeed: (list) => {
          if (cancelled) return;
          setPrints([...list].reverse());
        },
        onDeveloped: (print) => {
          if (cancelled) return;
          setFresh((prev) => new Set(prev).add(print.id));
          setPrints((prev) => {
            const next = [print, ...prev];
            next.slice(KEEP + 1).forEach((old) => real.release(old.url));
            return next.slice(0, KEEP + 1);
          });
        },
      });
      real.setLight(lightRef.current);
      engine = real;
      engineRef.current = real;
      real.start();
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, hasLayout]);

  const chooseLight = (index) => {
    lightRef.current = index;
    setLight(index);
    engineRef.current?.setLight(index);
  };

  const onFrameKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.autoExpose();
      return;
    }
    const index = Number(e.key) - 1;
    if (index >= 0 && index < LIGHTS.length) {
      e.preventDefault();
      chooseLight(index);
    }
  };

  const openPrint = (print, el) => {
    const rootRect = rootRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const cx = r.left + r.width / 2 - rootRect.left;
    const cy = r.top + r.height / 2 - rootRect.top;
    setView({ print, rect: { x: cx - w / 2, y: cy - h / 2, width: w, height: h } });
  };

  const closeView = useCallback(() => setView(null), []);

  const Root = embedded ? "div" : "main";
  const style = layout
    ? {
        "--long-exposure-fx": `${layout.fx}px`,
        "--long-exposure-fy": `${layout.fy}px`,
        "--long-exposure-fw": `${layout.fw}px`,
        "--long-exposure-fh": `${layout.fh}px`,
        "--long-exposure-pw": `${layout.pw}px`,
        "--long-exposure-ph": `${layout.ph}px`,
      }
    : undefined;

  return (
    <Root ref={rootRef} className="long-exposure" data-embedded={embedded ? "" : undefined} data-wide={layout?.wide ? "" : undefined} data-compact={layout && layout.fw < 320 ? "" : undefined} style={style}>
      {!embedded && (
        <header ref={headRef} className="long-exposure__head">
          <h1 className="long-exposure__title">Long Exposure</h1>
          <p className="long-exposure__lede">
            Hold to open the shutter and <em>paint with light</em>. Let go to develop the shot.
          </p>
        </header>
      )}

      <div
        ref={frameRef}
        className="long-exposure__frame"
        tabIndex={0}
        role="application"
        aria-label={FRAME_LABEL}
        onKeyDown={onFrameKey}
        data-shown={layout ? "" : undefined}
      >
        <canvas ref={canvasRef} className="long-exposure__canvas" />
        <div className="long-exposure__finder" aria-hidden="true">
          <span className="long-exposure__corner" data-at="tl" />
          <span className="long-exposure__corner" data-at="tr" />
          <span className="long-exposure__corner" data-at="bl" />
          <span className="long-exposure__corner" data-at="br" />
          <span className="long-exposure__focus" />
          <div className="long-exposure__readout">
            <span className="long-exposure__status">
              <span className="long-exposure__rec" />
              <span className="long-exposure__state" data-for="live">
                Bulb
              </span>
              <span className="long-exposure__state" data-for="exposing">
                Open
              </span>
              <span className="long-exposure__state" data-for="review">
                Review
              </span>
            </span>
            <span className="long-exposure__settings">f/8 &nbsp;ISO 200</span>
            <span ref={timeRef} className="long-exposure__time">
              0.0s
            </span>
          </div>
        </div>
        <span ref={blinkRef} className="long-exposure__blink" aria-hidden="true" />
        <span ref={cursorRef} className="long-exposure__cursor" aria-hidden="true" style={{ "--long-exposure-light": LIGHTS[light].swatch }} />
      </div>

      {!embedded && layout && (
        <div
          className="long-exposure__lights"
          role="radiogroup"
          aria-label="Light"
          style={
            layout.wide
              ? { right: `calc(100% - ${layout.fx - 40}px)`, top: layout.fy + layout.fh - 104 }
              : { left: Math.min(layout.fx, 16), top: layout.fy + layout.fh + 20 }
          }
        >
          {LIGHTS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={light === i}
              className="long-exposure__light"
              onClick={() => chooseLight(i)}
            >
              <span className="long-exposure__dot" style={{ "--long-exposure-light": l.swatch }} />
              <span className="long-exposure__light-name">{l.label}</span>
            </button>
          ))}
        </div>
      )}

      {layout && (
        <div className="long-exposure__stack">
          {prints.map((print, i) => (
            <Print
              key={print.id}
              print={print}
              index={i}
              layout={layout}
              fly={fresh.has(print.id)}
              lifted={view?.print.id === print.id}
              embedded={embedded}
              onOpen={openPrint}
            />
          ))}
        </div>
      )}

      {view && <Viewer key={view.print.id} view={view} box={box} embedded={embedded} onClosed={closeView} />}

      <p className="long-exposure__fallback">This piece needs WebGL 2.</p>
    </Root>
  );
}
