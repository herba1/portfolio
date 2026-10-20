"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  Brush,
  ChevronLeft,
  Eraser,
  Highlighter,
  Minimize2,
  Pen,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";

import PillSlider from "./PillSlider";
import { createSpring, snapSpring, stepSpring } from "./spring";

export const TOOLS = [
  { id: "pen", label: "Pen", key: "p", Icon: Pen },
  { id: "marker", label: "Marker", key: "m", Icon: Brush },
  { id: "highlighter", label: "Highlighter", key: "h", Icon: Highlighter },
  { id: "eraser", label: "Eraser", key: "e", Icon: Eraser },
];

export const COLORS = [
  { id: "ink", label: "Ink", value: "#1a1a1a" },
  { id: "graphite", label: "Graphite", value: "#64748b" },
  { id: "blue", label: "Blue", value: "#3b82f6" },
  { id: "sky", label: "Sky", value: "#38bdf8" },
  { id: "violet", label: "Violet", value: "#a05ac8" },
  { id: "pink", label: "Pink", value: "#ec4899" },
  { id: "red", label: "Red", value: "#ef4444" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "amber", label: "Amber", value: "#f59e0b" },
  { id: "lime", label: "Lime", value: "#84cc16" },
  { id: "green", label: "Green", value: "#16a34a" },
  { id: "teal", label: "Teal", value: "#0d9488" },
];

const MODES = ["tools", "palette", "sliders", "disc"];
const RADIUS = 28;
const GRID_COLS = 4;
const SHAPE = { response: 0.36, damping: 0.9 };

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const MorphToolbar = forwardRef(function MorphToolbar(
  {
    mode,
    onMode,
    tool,
    onTool,
    color,
    onColor,
    settings,
    onSetting,
    canUndo,
    onUndo,
  },
  ref,
) {
  const dockRef = useRef(null);
  const shellRef = useRef(null);
  const layerRefs = useRef({});
  const pillRef = useRef(null);
  const toolRefs = useRef({});
  const previewRef = useRef(null);
  const sim = useRef(null);
  const loop = useRef({ raf: 0, last: 0, max: [0, 0] });
  const lastMode = useRef(mode);
  const returnFocus = useRef(null);

  useImperativeHandle(ref, () => ({
    rect: () => shellRef.current?.getBoundingClientRect(),
    size: () => (sim.current ? [sim.current.w.x, sim.current.h.x] : [0, 0]),
  }));

  const paint = () => {
    const shell = shellRef.current;
    const s = sim.current;
    if (!shell || !s) return;
    const [mw, mh] = loop.current.max;
    const side = Math.max(0, (mw - s.w.x) / 2);
    const top = Math.max(0, mh - s.h.x);
    shell.style.clipPath = `inset(${top.toFixed(2)}px ${side.toFixed(2)}px 0px ${side.toFixed(2)}px round ${RADIUS}px)`;
  };

  const tick = (t) => {
    const l = loop.current;
    const dt = l.last ? (t - l.last) / 1000 : 1 / 60;
    l.last = t;
    const a = stepSpring(sim.current.w, dt);
    const b = stepSpring(sim.current.h, dt);
    paint();
    if (a && b) {
      l.raf = 0;
      l.last = 0;
      return;
    }
    l.raf = requestAnimationFrame(tick);
  };

  const measure = () => {
    const sizes = {};
    for (const m of MODES) {
      const el = layerRefs.current[m];
      if (el) sizes[m] = [el.offsetWidth, el.offsetHeight];
    }
    const mw = Math.max(...MODES.map((m) => sizes[m]?.[0] || 0));
    const mh = Math.max(...MODES.map((m) => sizes[m]?.[1] || 0));
    loop.current.max = [mw, mh];
    loop.current.sizes = sizes;
    if (dockRef.current) {
      dockRef.current.style.width = `${mw}px`;
      dockRef.current.style.height = `${mh}px`;
    }
    return sizes;
  };

  const retarget = (m, animate) => {
    const sizes = loop.current.sizes;
    if (!sizes?.[m]) return;
    const [w, h] = sizes[m];
    if (!sim.current) {
      sim.current = { w: createSpring(w, SHAPE), h: createSpring(h, SHAPE) };
    }
    sim.current.w.target = w;
    sim.current.h.target = h;
    if (!animate || reducedMotion()) {
      snapSpring(sim.current.w, w);
      snapSpring(sim.current.h, h);
      paint();
      return;
    }
    if (!loop.current.raf) loop.current.raf = requestAnimationFrame(tick);
  };

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  });

  useLayoutEffect(() => {
    measure();
    retarget(modeRef.current, false);
    const ro = new ResizeObserver(() => {
      measure();
      retarget(modeRef.current, true);
    });
    for (const m of MODES)
      if (layerRefs.current[m]) ro.observe(layerRefs.current[m]);
    const l = loop.current;
    return () => {
      ro.disconnect();
      cancelAnimationFrame(l.raf);
      l.raf = 0;
    };
  }, []);

  useEffect(() => {
    if (lastMode.current === mode) return;
    const prev = lastMode.current;
    lastMode.current = mode;
    retarget(mode, true);
    const shell = shellRef.current;
    const hadFocus = shell && shell.contains(document.activeElement);
    if (!hadFocus) return;
    const layer = layerRefs.current[mode];
    if (!layer) return;
    let next = null;
    if (mode === "tools" && returnFocus.current && (prev === "palette" || prev === "sliders")) {
      next = returnFocus.current;
      returnFocus.current = null;
    } else if (mode === "palette") next = layer.querySelector("[aria-checked='true']");
    else next = layer.querySelector("button:not([disabled]), [role='slider']");
    next?.focus({ preventScroll: true });
  }, [mode]);

  useLayoutEffect(() => {
    const btn = toolRefs.current[tool];
    const pill = pillRef.current;
    if (!btn || !pill) return;
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
  }, [tool]);

  const open = (m, from) => {
    returnFocus.current = from || null;
    onMode(m);
  };

  const current = settings[tool];
  const sizeFormat = (v) => `${v} px`;
  const opacityFormat = (v) => `${v}%`;

  const updatePreview = (key, v) => {
    const el = previewRef.current;
    if (!el) return;
    if (key === "size")
      el.style.setProperty(
        "--mt-brush",
        String(Math.min(1, Math.max(0.06, v / 40))),
      );
    if (key === "opacity") el.style.setProperty("--mt-alpha", String(v / 100));
  };

  const onLayerKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (mode === "palette" || mode === "sliders") onMode("tools");
      else if (mode === "tools") onMode("disc");
      return;
    }
    const move = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: GRID_COLS,
      ArrowUp: -GRID_COLS,
    }[e.key];
    if (
      mode === "palette" &&
      move &&
      e.target.getAttribute("role") === "radio"
    ) {
      const idx = COLORS.findIndex((c) => c.value === color);
      const next = (idx + move + COLORS.length) % COLORS.length;
      e.preventDefault();
      onColor(COLORS[next].value, false);
      layerRefs.current.palette
        ?.querySelectorAll("[role='radio']")
        [next]?.focus({ preventScroll: true });
    }
  };

  const toolDef = TOOLS.find((t) => t.id === tool);

  return (
    <div ref={dockRef} className="mt-dock">
      <div
        ref={shellRef}
        className="mt-shell"
        data-mode={mode}
        onKeyDown={onLayerKey}
      >
        <div
          ref={(el) => (layerRefs.current.tools = el)}
          className="mt-layer mt-tools"
          data-active={mode === "tools" || undefined}
          inert={mode !== "tools"}
          role="toolbar"
          aria-label="Drawing tools"
        >
          <div className="mt-tools__group">
            <span ref={pillRef} className="mt-tools__pill" aria-hidden />
            {TOOLS.map(({ id, label, key, Icon }) => (
              <button
                key={id}
                ref={(el) => (toolRefs.current[id] = el)}
                type="button"
                className="mt-btn"
                aria-pressed={tool === id}
                aria-label={label}
                aria-keyshortcuts={key.toUpperCase()}
                title={`${label}  ${key.toUpperCase()}`}
                onClick={() => onTool(id)}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden />
              </button>
            ))}
          </div>
          <span className="mt-divider" aria-hidden />
          <button
            type="button"
            className="mt-btn"
            aria-label={`Colour, ${COLORS.find((c) => c.value === color)?.label}`}
            onClick={(e) => open("palette", e.currentTarget)}
          >
            <span className="mt-swatch-dot" style={{ "--mt-color": color }} />
          </button>
          <button
            type="button"
            className="mt-btn"
            aria-label="Brush size and opacity"
            onClick={(e) => open("sliders", e.currentTarget)}
          >
            <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className="mt-btn"
            aria-label="Undo"
            aria-keyshortcuts="Control+Z Meta+Z"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className="mt-btn"
            aria-label="Tuck toolbar away"
            onClick={() => onMode("disc")}
          >
            <Minimize2 size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <div
          ref={(el) => (layerRefs.current.palette = el)}
          className="mt-layer mt-palette"
          data-active={mode === "palette" || undefined}
          inert={mode !== "palette"}
          role="radiogroup"
          aria-label="Colour"
        >
          <button
            type="button"
            className="mt-btn"
            aria-label="Back to tools"
            onClick={() => onMode("tools")}
          >
            <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="mt-palette__grid">
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.value === color}
                tabIndex={c.value === color ? 0 : -1}
                aria-label={c.label}
                className="mt-swatch"
                style={{ "--mt-color": c.value }}
                onClick={() => onColor(c.value, true)}
              >
                <span className="mt-swatch__chip" />
              </button>
            ))}
          </div>
        </div>

        <div
          ref={(el) => (layerRefs.current.sliders = el)}
          className="mt-layer mt-sliders"
          data-active={mode === "sliders" || undefined}
          inert={mode !== "sliders"}
          role="group"
          aria-label={`${toolDef.label} settings`}
        >
          <div className="mt-sliders__aside">
            <button
              type="button"
              className="mt-btn"
              aria-label="Back to tools"
              onClick={() => onMode("tools")}
            >
              <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
            </button>
            <span
              ref={previewRef}
              className="mt-preview"
              data-tool={tool}
              style={{
                "--mt-color": color,
                "--mt-brush": Math.min(1, Math.max(0.06, current.size / 40)),
                "--mt-alpha": tool === "eraser" ? 1 : current.opacity / 100,
              }}
              aria-hidden
            >
              <span className="mt-preview__dot" />
            </span>
          </div>
          <div className="mt-sliders__stack">
            <PillSlider
              label="Size"
              min={1}
              max={40}
              value={current.size}
              format={sizeFormat}
              onInput={(v) => updatePreview("size", v)}
              onCommit={(v) => onSetting(tool, "size", v)}
            />
            <PillSlider
              label="Opacity"
              min={5}
              max={100}
              step={5}
              value={current.opacity}
              format={opacityFormat}
              disabled={tool === "eraser"}
              onInput={(v) => updatePreview("opacity", v)}
              onCommit={(v) => onSetting(tool, "opacity", v)}
            />
          </div>
        </div>

        <div
          ref={(el) => (layerRefs.current.disc = el)}
          className="mt-layer mt-disc"
          data-active={mode === "disc" || undefined}
          inert={mode !== "disc"}
        >
          <button
            type="button"
            className="mt-disc__btn"
            aria-label="Open toolbar"
            onClick={() => onMode("tools")}
          >
            <span
              className="mt-swatch-dot mt-swatch-dot--disc"
              style={{ "--mt-color": tool === "eraser" ? "#ffffff" : color }}
            />
          </button>
        </div>
      </div>
    </div>
  );
});

export default MorphToolbar;
