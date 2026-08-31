"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { ControlList, FeatureGrid } from "./Controls";
import Specimen from "./Specimen";
import Info from "./Info";
import {
  FEATURE_GROUPS,
  FEATURE_SELECTS,
  STYLE_CONTROLS,
  TEXT_CONTROLS,
  TRACKING_K_PRESETS,
  TYPE_STEPS,
} from "./schema";
import {
  applyOverrides,
  computedSnapshot,
  cssPath,
  curveTracking,
  elementLabel,
  linkedCompanions,
  overridesToCss,
  ownText,
  restoreOverrides,
  round,
  TRACKING_K_DEFAULT,
  TRACKING_PIVOT,
} from "./css";
import { probeFeatureEffects } from "./features";
import "./typeInspector.css";

const STORAGE_KEY = "herb:type-inspector";
const EDGE = 12;
const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const MIN_HEIGHT = 260;

const TABS = [
  { id: "info", label: "Info" },
  { id: "style", label: "Style" },
  { id: "text", label: "Text" },
  { id: "features", label: "Features" },
  { id: "specimen", label: "Specimen" },
  { id: "json", label: "JSON" },
];

const ALL_TAGS = FEATURE_GROUPS.flatMap((g) => g.tags);

const LINK_MODES = [
  { id: "free", label: "Free", hint: "Size moves alone." },
  {
    id: "lock",
    label: "Lock",
    hint: "Leading and tracking convert to em and hold their current ratio.",
  },
  {
    id: "curve",
    label: "Curve",
    hint: "Leading and tracking snap to the site's scale for the new size.",
  },
];

const readStored = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
  } catch {
    return {};
  }
};

const writeStored = (patch) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), ...patch }));
  } catch {}
};

const clampAxis = (value, size, viewport) =>
  Math.min(Math.max(EDGE, value), Math.max(EDGE, viewport - size - EDGE));

const isInsidePanel = (node) =>
  !!(node && node.closest && node.closest("[data-type-inspector]"));

export default function TypeInspector() {
  const pathname = usePathname();

  const [armed, setArmed] = useState(false);
  const [picking, setPicking] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState("info");
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [editing, setEditing] = useState(false);
  const [guides, setGuides] = useState(false);
  const [linkMode, setLinkMode] = useState("free");
  const [trackingK, setTrackingK] = useState(TRACKING_K_DEFAULT);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  const panelRef = useRef(null);
  const hoverBoxRef = useRef(null);
  const pinBoxRef = useRef(null);
  const guideBoxRef = useRef(null);
  const position = useRef({ x: EDGE, y: EDGE });
  const size = useRef({ w: 360, h: 520 });
  const drag = useRef(null);
  const hoveredRef = useRef(null);
  const pinnedRef = useRef(null);
  const styleMemory = useRef(new Map());
  const editsRef = useRef(new Map());
  const guidesRef = useRef(false);
  const linkModeRef = useRef("free");
  const trackingKRef = useRef(TRACKING_K_DEFAULT);

  hoveredRef.current = hovered;
  pinnedRef.current = pinned;
  guidesRef.current = guides;
  linkModeRef.current = linkMode;
  trackingKRef.current = trackingK;

  const target = pinned || hovered;
  const computed = useMemo(
    () => (target ? getComputedStyle(target) : null),
    [target, tick],
  );

  const fontSignature = computed
    ? `${computed.fontFamily}|${computed.fontWeight}|${computed.fontStyle}|${computed.fontVariationSettings}`
    : "";

  const effectiveTags = useMemo(
    () => (tab === "features" && target ? probeFeatureEffects(target, ALL_TAGS) : null),
    [tab, target, fontSignature],
  );

  const toastTimer = useRef(0);
  const flash = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1600);
  }, []);

  const applyPanelStyle = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    el.style.setProperty("--ti-x", `${position.current.x}px`);
    el.style.setProperty("--ti-y", `${position.current.y}px`);
    el.style.setProperty("--ti-w", `${size.current.w}px`);
    el.style.setProperty("--ti-h", `${size.current.h}px`);
  }, []);

  const clampToViewport = useCallback(() => {
    size.current.w = Math.min(size.current.w, window.innerWidth - 2 * EDGE);
    size.current.h = Math.min(size.current.h, window.innerHeight - 2 * EDGE);
    position.current = {
      x: clampAxis(position.current.x, size.current.w, window.innerWidth),
      y: clampAxis(position.current.y, size.current.h, window.innerHeight),
    };
    applyPanelStyle();
  }, [applyPanelStyle]);

  useLayoutEffect(() => {
    const stored = readStored();
    if (typeof stored.collapsed === "boolean") setCollapsed(stored.collapsed);
    if (typeof stored.tab === "string") setTab(stored.tab);
    if (typeof stored.linkMode === "string") setLinkMode(stored.linkMode);
    if (Number.isFinite(stored.trackingK)) setTrackingK(stored.trackingK);
    size.current = {
      w: stored.w ?? 360,
      h: stored.h ?? Math.min(560, window.innerHeight - 2 * EDGE),
    };
    position.current = {
      x: stored.x ?? window.innerWidth - size.current.w - EDGE,
      y: stored.y ?? EDGE,
    };
    setSavedCount(Object.keys(stored.saved || {}).length);
    clampToViewport();
  }, [clampToViewport]);

  useEffect(() => {
    const onResize = () => clampToViewport();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampToViewport]);

  useEffect(() => {
    if (armed) applyPanelStyle();
  }, [armed, applyPanelStyle]);

  useEffect(() => {
    const root = document.documentElement;
    if (armed && picking && !editing) root.dataset.tiPick = "1";
    else delete root.dataset.tiPick;
    return () => delete root.dataset.tiPick;
  }, [armed, picking, editing]);

  const memoryFor = useCallback((el) => {
    if (!styleMemory.current.has(el)) styleMemory.current.set(el, {});
    return styleMemory.current.get(el);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    editsRef.current.set(pinned, overrides);
    applyOverrides(pinned, overrides, memoryFor(pinned));
    setTick((t) => t + 1);
  }, [pinned, overrides, memoryFor]);

  const selectElement = useCallback((el) => {
    if (!el || el === document.body || el === document.documentElement) return;
    setPinned(el);
    setOverrides(editsRef.current.get(el) || {});
  }, []);

  const setOverride = useCallback((prop, value) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === undefined || value === "") delete next[prop];
      else next[prop] = value;

      if (prop === "font-size" && value) {
        const companions = linkedCompanions(
          pinnedRef.current,
          value,
          linkModeRef.current,
          trackingKRef.current,
        );
        if (companions) {
          for (const [key, companion] of Object.entries(companions)) {
            if (companion !== undefined) next[key] = companion;
          }
        }
      }

      return next;
    });
  }, []);

  const stopEditing = useCallback(() => {
    const el = pinnedRef.current;
    if (el) {
      el.removeAttribute("contenteditable");
      delete el.dataset.tiEditing;
    }
    setEditing(false);
  }, []);

  const startEditing = useCallback((el) => {
    if (!el) return;
    el.setAttribute("contenteditable", "plaintext-only");
    el.dataset.tiEditing = "1";
    el.focus();
    setEditing(true);
  }, []);

  useEffect(() => {
    if (!armed || !picking || editing) return;

    let frame = 0;
    let next = null;

    const flush = () => {
      frame = 0;
      if (next && next !== hoveredRef.current) setHovered(next);
    };

    const onMove = (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1 || isInsidePanel(el)) return;
      next = el;
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const swallow = (e) => {
      if (isInsidePanel(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const onClick = (e) => {
      if (isInsidePanel(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      selectElement(e.target);
    };

    const onDouble = (e) => {
      if (isInsidePanel(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      selectElement(e.target);
      startEditing(e.target);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mousedown", swallow, true);
    document.addEventListener("mouseup", swallow, true);
    document.addEventListener("pointerdown", swallow, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDouble, true);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mousedown", swallow, true);
      document.removeEventListener("mouseup", swallow, true);
      document.removeEventListener("pointerdown", swallow, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dblclick", onDouble, true);
    };
  }, [armed, picking, editing, selectElement, startEditing]);

  useEffect(() => {
    if (!armed) return;
    let raf = 0;
    const probe = document.createElement("canvas").getContext("2d");

    const paint = (box, el, showLabel) => {
      if (!box) return;
      if (!el || !el.isConnected) {
        box.style.opacity = "0";
        return;
      }
      const rect = el.getBoundingClientRect();
      box.style.opacity = "1";
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      if (showLabel) {
        const cs = getComputedStyle(el);
        const fs = Number.parseFloat(cs.fontSize) || 0;
        const lh = Number.parseFloat(cs.lineHeight);
        const ls = Number.parseFloat(cs.letterSpacing) || 0;
        box.dataset.label = `${elementLabel(el)} · ${round(fs, 1)}/${
          Number.isFinite(lh) ? round(lh, 1) : "auto"
        } · ${round(ls / (fs || 1), 3)}em · ${cs.fontWeight}`;
        box.dataset.flip = rect.top < 26 ? "1" : "";
      }
    };

    const paintGuides = () => {
      const host = guideBoxRef.current;
      if (!host) return;
      const el = pinnedRef.current;
      if (!guidesRef.current || !el || !el.isConnected) {
        host.replaceChildren();
        return;
      }
      let rects = [];
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        rects = Array.from(range.getClientRects());
      } catch {}
      const cs = getComputedStyle(el);
      const fs = Number.parseFloat(cs.fontSize) || 16;
      let cap = 0.7;
      let ex = 0.5;
      let asc = 0.9;
      if (probe) {
        probe.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
        cap = probe.measureText("H").actualBoundingBoxAscent / 100;
        ex = probe.measureText("x").actualBoundingBoxAscent / 100;
        asc = probe.measureText("Hxdgpq").fontBoundingBoxAscent / 100;
      }
      const frag = document.createDocumentFragment();
      for (const rect of rects) {
        const half = (rect.height - fs * asc - fs * 0.25) / 2;
        const baseline = rect.top + half + fs * asc;
        const line = (top, kind) => {
          const div = document.createElement("div");
          div.className = "ti-guide";
          div.dataset.kind = kind;
          div.style.transform = `translate3d(${rect.left}px, ${top}px, 0)`;
          div.style.width = `${rect.width}px`;
          frag.appendChild(div);
        };
        line(baseline, "baseline");
        line(baseline - fs * cap, "cap");
        line(baseline - fs * ex, "x");
      }
      host.replaceChildren(frag);
    };

    const loop = () => {
      paint(hoverBoxRef.current, hoveredRef.current === pinnedRef.current ? null : hoveredRef.current, false);
      paint(pinBoxRef.current, pinnedRef.current, true);
      paintGuides();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [armed]);

  const revertAll = useCallback(() => {
    for (const [el, memory] of styleMemory.current) restoreOverrides(el, memory);
    styleMemory.current.clear();
    editsRef.current.clear();
    setOverrides({});
    setTick((t) => t + 1);
    flash("Reverted every edit");
  }, [flash]);

  const payload = useMemo(() => {
    if (!pinned) return null;
    return {
      route: pathname,
      selector: cssPath(pinned),
      element: elementLabel(pinned),
      text: ownText(pinned).slice(0, 240),
      overrides,
      css: overridesToCss(cssPath(pinned), overrides),
      computed: computedSnapshot(pinned),
    };
  }, [pinned, overrides, pathname, tick]);

  const copy = useCallback(
    (text, label) => {
      navigator.clipboard
        .writeText(text)
        .then(() => flash(`${label} copied`))
        .catch(() => flash("Clipboard blocked"));
    },
    [flash],
  );

  const saveCurrent = useCallback(() => {
    if (!payload) return;
    const stored = readStored();
    const saved = { ...(stored.saved || {}) };
    saved[`${payload.route} ${payload.selector}`] = {
      route: payload.route,
      selector: payload.selector,
      overrides: payload.overrides,
      text: payload.text,
    };
    writeStored({ saved });
    setSavedCount(Object.keys(saved).length);
    flash("Saved to this browser");
  }, [payload, flash]);

  const reapplySaved = useCallback(() => {
    const saved = readStored().saved || {};
    let hits = 0;
    for (const entry of Object.values(saved)) {
      if (entry.route && entry.route !== pathname) continue;
      let el = null;
      try {
        el = document.querySelector(entry.selector);
      } catch {}
      if (!el) continue;
      editsRef.current.set(el, entry.overrides);
      applyOverrides(el, entry.overrides, memoryFor(el));
      hits += 1;
    }
    setTick((t) => t + 1);
    flash(hits ? `Re-applied ${hits} saved set${hits > 1 ? "s" : ""}` : "Nothing matched");
  }, [pathname, memoryFor, flash]);

  const clearSaved = useCallback(() => {
    writeStored({ saved: {} });
    setSavedCount(0);
    flash("Saved sets cleared");
  }, [flash]);

  useEffect(() => {
    const onKey = (e) => {
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (e.code === "KeyT" && (mod || e.altKey)) {
        e.preventDefault();
        setArmed((v) => {
          if (v) {
            stopEditing();
            setHovered(null);
          } else {
            setPicking(true);
          }
          return !v;
        });
        return;
      }

      if (!armed) return;

      if (key === "escape") {
        e.preventDefault();
        if (editing) stopEditing();
        else if (pinnedRef.current) setPinned(null);
        else setArmed(false);
        return;
      }

      const typing =
        editing ||
        ["input", "textarea", "select"].includes(
          (e.target?.tagName || "").toLowerCase(),
        );
      if (typing) return;

      if (mod && e.shiftKey && key === "c" && payload) {
        e.preventDefault();
        copy(JSON.stringify(payload, null, 2), "JSON");
        return;
      }

      if (key === " ") {
        e.preventDefault();
        setPicking((v) => !v);
        return;
      }

      if (!pinnedRef.current) return;

      if (key === "arrowup") {
        e.preventDefault();
        selectElement(pinnedRef.current.parentElement);
      }
      if (key === "arrowdown") {
        e.preventDefault();
        selectElement(pinnedRef.current.firstElementChild);
      }
      if (key === "arrowleft") {
        e.preventDefault();
        selectElement(pinnedRef.current.previousElementSibling);
      }
      if (key === "arrowright") {
        e.preventDefault();
        selectElement(pinnedRef.current.nextElementSibling);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, editing, payload, copy, selectElement, stopEditing]);

  useEffect(() => {
    if (!editing) return;
    const el = pinnedRef.current;
    if (!el) return;
    const onBlur = () => stopEditing();
    el.addEventListener("blur", onBlur);
    return () => el.removeEventListener("blur", onBlur);
  }, [editing, stopEditing]);

  const onHeaderPointerDown = (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      mode: "move",
      x: e.clientX - position.current.x,
      y: e.clientY - position.current.y,
    };
  };

  const onResizePointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      mode: "resize",
      x: e.clientX - size.current.w,
      y: e.clientY - size.current.h,
    };
  };

  const onPointerMove = (e) => {
    const state = drag.current;
    if (!state) return;
    if (state.mode === "move") {
      position.current = {
        x: clampAxis(e.clientX - state.x, size.current.w, window.innerWidth),
        y: clampAxis(e.clientY - state.y, size.current.h, window.innerHeight),
      };
    } else {
      size.current = {
        w: Math.min(
          Math.max(MIN_WIDTH, e.clientX - state.x),
          Math.min(MAX_WIDTH, window.innerWidth - position.current.x - EDGE),
        ),
        h: Math.max(
          MIN_HEIGHT,
          Math.min(e.clientY - state.y, window.innerHeight - position.current.y - EDGE),
        ),
      };
    }
    applyPanelStyle();
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    writeStored({
      x: position.current.x,
      y: position.current.y,
      w: size.current.w,
      h: size.current.h,
    });
  };

  if (!armed) return null;

  const overrideCount = Object.keys(overrides).length;

  return (
    <>
      <div className="ti-overlay" data-chrome-hide aria-hidden="true">
        <div ref={hoverBoxRef} className="ti-box ti-box--hover" />
        <div ref={pinBoxRef} className="ti-box ti-box--pin" />
        <div ref={guideBoxRef} className="ti-guides" />
      </div>

      <section
        ref={panelRef}
        className="ti"
        data-type-inspector=""
        data-chrome-hide
        data-collapsed={collapsed || undefined}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <header className="ti__bar" onPointerDown={onHeaderPointerDown}>
          <span className="ti__grip" />
          <h2 className="ti__title">Type</h2>
          <span className="ti__crumb">{target ? elementLabel(target) : "nothing picked"}</span>
          <button
            type="button"
            className="ti__icon"
            data-active={picking || undefined}
            title="Pick mode (space)"
            onClick={() => setPicking((v) => !v)}
          >
            ⌖
          </button>
          <button
            type="button"
            className="ti__icon"
            data-active={guides || undefined}
            title="Baseline guides"
            onClick={() => setGuides((v) => !v)}
          >
            ≡
          </button>
          <button
            type="button"
            className="ti__icon"
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() =>
              setCollapsed((v) => {
                writeStored({ collapsed: !v });
                return !v;
              })
            }
          >
            {collapsed ? "+" : "–"}
          </button>
          <button
            type="button"
            className="ti__icon"
            title="Close (esc)"
            onClick={() => {
              stopEditing();
              setArmed(false);
            }}
          >
            ×
          </button>
        </header>

        <nav className="ti__tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="ti__tab"
              data-active={tab === t.id || undefined}
              onClick={() => {
                setTab(t.id);
                writeStored({ tab: t.id });
              }}
            >
              {t.label}
              {t.id === "style" && overrideCount ? (
                <em className="ti__badge">{overrideCount}</em>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="ti__body">
          {tab === "info" ? (
            <Info
              element={target}
              computed={computed}
              overrides={target === pinned ? overrides : null}
              onSelect={selectElement}
            />
          ) : null}

          {tab === "style" ? (
            <>
              <div className="ti-link">
                <div className="ti-segmented">
                  {LINK_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className="ti-segmented__btn"
                      data-active={linkMode === mode.id || undefined}
                      title={mode.hint}
                      onClick={() => {
                        setLinkMode(mode.id);
                        writeStored({ linkMode: mode.id });
                      }}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <p className="ti-link__hint">
                  {LINK_MODES.find((m) => m.id === linkMode)?.hint}
                </p>
              </div>

              <div className="ti-law">
                <div className="ti-law__head">
                  <label className="ti-content__label">Tracking law</label>
                  <span className="ti-law__formula">
                    {`${round(trackingK, 4)} × (${TRACKING_PIVOT} − size)`}
                  </span>
                </div>

                <div className="ti-segmented">
                  {TRACKING_K_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="ti-segmented__btn"
                      data-active={
                        Math.abs(trackingK - preset.value) < 0.0005 || undefined
                      }
                      title={preset.note}
                      onClick={() => {
                        setTrackingK(preset.value);
                        writeStored({ trackingK: preset.value });
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <input
                  className="ti-law__range"
                  type="range"
                  min={0}
                  max={0.12}
                  step={0.001}
                  value={trackingK}
                  aria-label="Tracking constant k"
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setTrackingK(next);
                    writeStored({ trackingK: next });
                  }}
                />

                <button
                  type="button"
                  className="ti-btn"
                  disabled={!pinned}
                  onClick={() => {
                    const size = Number.parseFloat(computed?.["font-size"]);
                    if (!Number.isFinite(size)) return;
                    const t = curveTracking(size, trackingK);
                    setOverride("letter-spacing", `${t.value}${t.unit}`);
                  }}
                >
                  {pinned && computed
                    ? (() => {
                        const size = Number.parseFloat(computed["font-size"]);
                        if (!Number.isFinite(size)) return "Apply to selection";
                        const t = curveTracking(size, trackingK);
                        return `Apply ${t.value}${t.unit} at ${round(size, 1)}px`;
                      })()
                    : "Apply to selection"}
                </button>

                <div className="ti-law__steps">
                  {TYPE_STEPS.map((step) => (
                    <button
                      key={step.label}
                      type="button"
                      className="ti-law__step"
                      disabled={!pinned}
                      title={`${step.size}px · ${step.weight} · ${step.tracking}px`}
                      onClick={() => {
                        setOverride("font-size", `${step.size}px`);
                        setOverride("font-weight", `${step.weight}`);
                        setOverride(
                          "line-height",
                          step.leading ? `${step.leading}px` : "normal",
                        );
                        const t = curveTracking(step.size, trackingK);
                        setOverride("letter-spacing", `${t.value}${t.unit}`);
                      }}
                    >
                      <span className="ti-law__step-name">{step.label}</span>
                      <span className="ti-law__step-spec">
                        {step.size}/{step.weight}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <ControlList
                controls={STYLE_CONTROLS}
                element={pinned}
                computed={pinned ? computed : null}
                overrides={overrides}
                setOverride={setOverride}
              />
            </>
          ) : null}

          {tab === "text" ? (
            <>
              {pinned ? (
                <div className="ti-content">
                  <label className="ti-content__label">Content</label>
                  <textarea
                    className="ti-textarea"
                    rows={3}
                    value={pinned.textContent || ""}
                    spellCheck={false}
                    onChange={(e) => {
                      pinned.textContent = e.target.value;
                      setTick((t) => t + 1);
                    }}
                  />
                  <button
                    type="button"
                    className="ti-btn"
                    onClick={() => startEditing(pinned)}
                  >
                    Edit in place
                  </button>
                </div>
              ) : null}
              <ControlList
                controls={TEXT_CONTROLS}
                element={pinned}
                computed={pinned ? computed : null}
                overrides={overrides}
                setOverride={setOverride}
              />
            </>
          ) : null}

          {tab === "features" ? (
            pinned && computed ? (
              <>
                <ControlList
                  controls={FEATURE_SELECTS}
                  element={pinned}
                  computed={computed}
                  overrides={overrides}
                  setOverride={setOverride}
                />
                <FeatureGrid
                  computed={computed}
                  overrides={overrides}
                  setOverride={setOverride}
                  available={effectiveTags}
                />
              </>
            ) : (
              <p className="ti-empty">Pick some text first.</p>
            )
          ) : null}

          {tab === "specimen" ? <Specimen element={target} computed={computed} /> : null}

          {tab === "json" ? (
            payload ? (
              <div className="ti-json">
                <div className="ti-json__actions">
                  <button
                    type="button"
                    className="ti-btn ti-btn--primary"
                    onClick={() => copy(JSON.stringify(payload, null, 2), "JSON")}
                  >
                    Copy JSON
                  </button>
                  <button
                    type="button"
                    className="ti-btn"
                    onClick={() => copy(payload.css, "CSS")}
                  >
                    Copy CSS
                  </button>
                  <button type="button" className="ti-btn" onClick={saveCurrent}>
                    Save
                  </button>
                </div>
                <pre className="ti-json__pre">{JSON.stringify(payload, null, 2)}</pre>
                <div className="ti-json__actions">
                  <button type="button" className="ti-btn" onClick={reapplySaved}>
                    Re-apply saved ({savedCount})
                  </button>
                  <button
                    type="button"
                    className="ti-btn"
                    onClick={() =>
                      copy(JSON.stringify(readStored().saved || {}, null, 2), "All saved")
                    }
                  >
                    Copy all saved
                  </button>
                  <button type="button" className="ti-btn" onClick={clearSaved}>
                    Clear saved
                  </button>
                </div>
              </div>
            ) : (
              <p className="ti-empty">Pin an element to get its JSON.</p>
            )
          ) : null}
        </div>

        <footer className="ti__foot">
          <span className="ti__hint">
            {toast ||
              (pinned
                ? "space pauses picking · arrows walk the tree · esc unpins"
                : "click to pin · double-click to rewrite · ⌥T closes")}
          </span>
          <button
            type="button"
            className="ti-btn"
            disabled={!styleMemory.current.size}
            onClick={revertAll}
          >
            Revert
          </button>
        </footer>

        <span className="ti__resize" onPointerDown={onResizePointerDown} />
      </section>
    </>
  );
}
