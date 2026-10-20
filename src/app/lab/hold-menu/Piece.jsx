"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { pick, thunk, tick, wakeAudio } from "./foley";
import { menuFor, recordsFrom } from "./menuData";

import "./hold-menu.css";

const HOLD = 400;
const ITEM_H = 48;
const LIFT = 1.08;
const GAP = 12;
const TOP = 72;
const BOTTOM = 24;
const ROOT_W = 280;
const DWELL = 380;
const RECEDE = 220;
const PEEK = 40;
const OPEN = 200;

const itemsAt = (root, path, level) => {
  let items = root;
  for (let l = 0; l < level; l += 1) {
    const entry = path[l];
    items = items.find((x) => x.id === entry?.id)?.children ?? [];
  }
  return items;
};

const tallest = (items, depth = 0) => items.reduce((h, it) => Math.max(h, it.children ? tallest(it.children, depth + 1) : 0), items.length + (depth > 0 ? 1 : 0));

function place(rect, box, menuH, menuW) {
  const avail = box.height - TOP - BOTTOM;
  const size = Math.max(96, Math.min(rect.width * LIFT, avail - GAP - menuH, box.width - 32));
  const cy = rect.top + rect.height / 2;
  const block = size + GAP + menuH;
  const clampTop = (t) => Math.min(Math.max(t, TOP), box.height - BOTTOM - block);
  const belowTop = clampTop(cy - size / 2);
  const aboveTop = clampTop(cy - size / 2 - GAP - menuH);
  const belowShift = Math.abs(belowTop - (cy - size / 2));
  const aboveShift = Math.abs(aboveTop + GAP + menuH - (cy - size / 2));
  const below = belowShift <= aboveShift;
  const top = below ? belowTop : aboveTop + GAP + menuH;
  const anchor = below ? top + size + GAP : top - GAP;
  const cx = Math.min(Math.max(rect.left + rect.width / 2, 16 + size / 2), box.width - 16 - size / 2);
  const left = cx - size / 2;
  const alignLeft = cx < box.width / 2;
  let menuLeft = alignLeft ? left : left + size - menuW;
  menuLeft = Math.max(16, Math.min(box.width - 16 - menuW, menuLeft));
  const from = { x: rect.left + rect.width / 2 - cx, y: cy - (top + size / 2), s: rect.width / size };
  return { left, top, size, menuLeft, anchor, menuW, below, alignLeft, from };
}

function Glyph({ d }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const CHEVRON_R = "M8 5l5 5-5 5";

const CHEVRON_D = "M5 8l5 5 5-5";

export default function Piece({ embedded = false }) {
  const { tracks, live } = useTopSongs(40);
  const records = useMemo(() => recordsFrom(tracks, live), [tracks, live]);
  const rootRef = useRef(null);
  const layerRef = useRef(null);
  const cloneRef = useRef(null);
  const coverEls = useRef(new Map());
  const press = useRef(null);
  const spring = useRef({ x: 0, y: 0, s: 1, vx: 0, vy: 0, vs: 0, tx: 0, ty: 0, ts: 1, raf: 0, onRest: null });
  const [pressing, setPressing] = useState(null);
  const [menu, setMenu] = useState(null);
  const [nav, setNavState] = useState({ path: [], hot: [-1], ghosts: [] });
  const [chosen, setChosen] = useState(null);
  const [pill, setPill] = useState(null);
  const navRef = useRef(nav);
  const menuRef = useRef(null);
  const menuEl = useRef(null);
  const seq = useRef(1);
  const timers = useRef(new Map());
  const quiet = useRef(null);

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

  const setNav = useCallback((next) => {
    navRef.current = next;
    setNavState(next);
  }, []);

  const clearTimer = (name) => {
    const t = timers.current.get(name);
    if (t) clearTimeout(t);
    timers.current.delete(name);
  };

  const later = (name, ms, fn) => {
    clearTimer(name);
    timers.current.set(
      name,
      setTimeout(() => {
        timers.current.delete(name);
        fn();
      }, ms),
    );
  };

  useEffect(() => {
    const all = timers.current;
    return () => {
      all.forEach((t) => clearTimeout(t));
      all.clear();
    };
  }, []);

  const paint = useCallback(() => {
    const st = spring.current;
    const el = cloneRef.current;
    if (el) el.style.transform = `translate3d(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px, 0) scale(${st.s.toFixed(4)})`;
  }, []);

  const runSpring = useCallback(() => {
    const st = spring.current;
    cancelAnimationFrame(st.raf);
    let last = 0;
    const step = (now) => {
      const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
      last = now;
      const k = 320;
      const c = 32;
      st.vx += ((st.tx - st.x) * k - st.vx * c) * dt;
      st.vy += ((st.ty - st.y) * k - st.vy * c) * dt;
      st.vs += ((st.ts - st.s) * k - st.vs * c) * dt;
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      st.s += st.vs * dt;
      const resting = Math.abs(st.tx - st.x) < 0.2 && Math.abs(st.ty - st.y) < 0.2 && Math.abs(st.ts - st.s) < 0.0008 && Math.abs(st.vs) < 0.01 && Math.abs(st.vx) + Math.abs(st.vy) < 1;
      if (resting) {
        st.x = st.tx;
        st.y = st.ty;
        st.s = st.ts;
        paint();
        st.raf = 0;
        const done = st.onRest;
        st.onRest = null;
        done?.();
        return;
      }
      paint();
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(spring.current.raf), []);

  const rootItems = useMemo(() => (menu ? menuFor(menu.record) : []), [menu]);
  const rootItemsRef = useRef(rootItems);
  useEffect(() => {
    rootItemsRef.current = rootItems;
  }, [rootItems]);

  const dropGhost = useCallback(
    (keys) => {
      if (!keys.length) return;
      later(`ghost-${keys[0]}`, 420, () => {
        const cur = navRef.current;
        setNav({ ...cur, ghosts: cur.ghosts.filter((g) => !keys.includes(g.key)) });
      });
    },
    [setNav],
  );

  const back = useCallback(
    (level) => {
      const cur = navRef.current;
      if (cur.path.length <= level) return;
      const leaving = cur.path.slice(level).map((e, i) => ({ ...e, level: level + i + 1 }));
      setNav({ path: cur.path.slice(0, level), hot: cur.hot.slice(0, level + 1), ghosts: [...cur.ghosts, ...leaving], lift: level === 0 ? 0 : cur.lift });
      dropGhost(leaving.map((g) => g.key));
    },
    [setNav, dropGhost],
  );

  const openSub = useCallback(
    (level, index, viaKey = false) => {
      const m = menuRef.current;
      const layer = layerRef.current;
      if (!m || m.closing || !layer) return;
      const cur = navRef.current;
      const items = itemsAt(rootItemsRef.current, cur.path, level);
      const item = items[index];
      if (!item?.children) return;
      if (cur.path[level]?.index === index && cur.path.length === level + 1) return;
      const box = layer.getBoundingClientRect();
      const parent = level === 0 ? { x: m.menuLeft, y: m.menuTop } : cur.path[level - 1];
      const rowTop = parent.y + (level === 0 ? 0 : ITEM_H) + index * ITEM_H;
      const h = (item.children.length + 1) * ITEM_H;
      const dx = (m.narrow ? 12 : 24) * (m.alignLeft ? 1 : -1);
      const x = Math.max(16, Math.min(box.width - 16 - m.menuW, parent.x + dx));
      const limit = box.height - BOTTOM;
      const want = Math.max(TOP, rowTop, parent.y + PEEK);
      const lift = Math.min(Math.max(0, m.top - 16), Math.max(0, want + h - limit));
      const y = Math.max(TOP - lift, Math.min(want, limit + lift - h));
      const entry = { id: item.id, index, key: seq.current++, label: item.label, items: item.children, x, y, lift, fx: parent.x - x, fy: rowTop - y };
      const swap = cur.path.length > level;
      if (swap) entry.late = true;
      const leaving = cur.path.slice(level).map((e, i) => ({ ...e, level: level + i + 1, swap }));
      const hot = cur.hot.slice(0, level + 1);
      hot[level] = index;
      hot[level + 1] = viaKey ? 0 : -1;
      setNav({ path: [...cur.path.slice(0, level), entry], hot, ghosts: [...cur.ghosts, ...leaving], lift: Math.max(cur.lift ?? 0, lift) });
      dropGhost(leaving.map((g) => g.key));
      tick();
    },
    [setNav, dropGhost],
  );

  const setHot = useCallback(
    (level, index) => {
      const cur = navRef.current;
      if (cur.hot[level] === index) return;
      const hot = [...cur.hot];
      hot[level] = index;
      setNav({ ...cur, hot });
    },
    [setNav],
  );

  const close = useCallback(() => {
    const m = menuRef.current;
    if (!m || m.closing) return;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    const st = spring.current;
    setMenu({ ...m, closing: true });
    st.tx = m.from.x;
    st.ty = m.from.y;
    st.ts = m.from.s;
    st.onRest = () => {
      setMenu((cur) => (cur && cur.closing && cur.n === m.n ? null : cur));
      setNav({ path: [], hot: [-1], ghosts: [] });
      setChosen(null);
      if (m.viaKey) requestAnimationFrame(() => coverEls.current.get(m.record.id)?.focus({ preventScroll: true }));
    };
    runSpring();
  }, [runSpring, setNav]);

  const choose = useCallback(
    (level, index) => {
      const m = menuRef.current;
      if (!m || m.closing) return;
      const item = itemsAt(rootItemsRef.current, navRef.current.path, level)[index];
      if (!item || item.children) return;
      pick();
      setChosen(`${level}-${index}`);
      if (item.copy) navigator.clipboard?.writeText(`${m.record.title} by ${m.record.artist}`).catch(() => {});
      setPill({ text: item.done, n: performance.now(), show: true });
      later("close", 160, close);
    },
    [close],
  );

  const open = useCallback(
    (record, viaKey = false) => {
      const root = rootRef.current;
      const el = coverEls.current.get(record.id);
      if (!root || !el) return;
      const box = root.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const rect = { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
      const items = menuFor(record);
      const narrow = box.width < 640;
      const menuW = Math.min(narrow ? 300 : ROOT_W, box.width - 32);
      const reserve = (narrow ? tallest(items) : items.length) * ITEM_H;
      const pos = place(rect, { width: box.width, height: box.height }, reserve, menuW);
      pos.menuTop = pos.below ? pos.anchor : pos.anchor - items.length * ITEM_H;
      const st = spring.current;
      cancelAnimationFrame(st.raf);
      st.x = pos.from.x;
      st.y = pos.from.y;
      st.s = pos.from.s * (viaKey ? 1 : 0.96);
      st.vx = 0;
      st.vy = 0;
      st.vs = 0;
      st.tx = 0;
      st.ty = 0;
      st.ts = 1;
      st.onRest = null;
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
      setChosen(null);
      quiet.current = null;
      setNav({ path: [], hot: [viaKey ? 0 : -1], ghosts: [] });
      setMenu({ record, ...pos, narrow, viaKey, closing: false, n: performance.now() });
      setPressing(null);
      thunk();
    },
    [setNav],
  );

  useLayoutEffect(() => {
    if (menu && !menu.closing && cloneRef.current) {
      paint();
      runSpring();
    }
  }, [menu, paint, runSpring]);

  useEffect(() => {
    if (menu && !menu.closing) menuEl.current?.focus({ preventScroll: true });
  }, [menu]);

  const hitAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-level]");
    if (!el) return null;
    return { level: Number(el.dataset.level), index: el.hasAttribute("data-back") ? -1 : Number(el.dataset.item), back: el.hasAttribute("data-back") };
  };

  const onRowEnter = (level, index) => {
    const m = menuRef.current;
    if (!m || m.closing || quiet.current) return;
    const cur = navRef.current;
    const items = itemsAt(rootItemsRef.current, cur.path, level);
    const item = items[index];
    clearTimer(`intent-${level}`);
    if (level < cur.path.length) {
      later(`intent-${level}`, RECEDE, () => {
        if (item?.children && navRef.current.path[level]?.index !== index) openSub(level, index);
        else back(level);
        setHot(level, index);
      });
      return;
    }
    setHot(level, index);
    if (item?.children) later(`intent-${level}`, OPEN, () => openSub(level, index));
  };

  const onPanelEnter = (level) => {
    for (let l = 0; l < level; l += 1) clearTimer(`intent-${l}`);
    const cur = navRef.current;
    const entry = cur.path[level - 1];
    if (entry && cur.hot[level - 1] !== entry.index) setHot(level - 1, entry.index);
  };

  const onRowClick = (level, index) => {
    const m = menuRef.current;
    if (!m || m.closing) return;
    const cur = navRef.current;
    const item = itemsAt(rootItemsRef.current, cur.path, level)[index];
    if (!item) return;
    clearTimer(`intent-${level}`);
    if (item.children) {
      if (cur.path[level]?.index === index) back(level);
      else openSub(level, index);
    } else if (level < cur.path.length) {
      back(level);
      setHot(level, index);
      tick();
    } else choose(level, index);
  };

  useEffect(() => {
    const root = rootRef.current;
    const onTouchMove = (event) => {
      const m = menuRef.current;
      if ((m && !m.closing) || press.current?.opened) event.preventDefault();
    };
    root?.addEventListener("touchmove", onTouchMove, { passive: false });
    const onMove = (event) => {
      const q = quiet.current;
      if (q) {
        if (q.x === null) {
          q.x = event.clientX;
          q.y = event.clientY;
        } else if (Math.hypot(event.clientX - q.x, event.clientY - q.y) > 4) {
          quiet.current = null;
          const hit = event.pointerType === "mouse" ? hitAt(event.clientX, event.clientY) : null;
          if (hit && !hit.back) onRowEnter(hit.level, hit.index);
        }
      }
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      if (!p.opened) {
        if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > 10) {
          clearTimeout(p.timer);
          press.current = null;
          setPressing(null);
        }
        return;
      }
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > 6) p.slid = true;
      const hit = hitAt(event.clientX, event.clientY);
      const key = hit ? `${hit.level}:${hit.index}` : "";
      if (key === p.over) return;
      p.over = key;
      clearTimer("dwell");
      if (!hit) return;
      if (hit.back) {
        later("dwell", DWELL, () => back(hit.level - 1));
        return;
      }
      const deep = navRef.current.path.length;
      if (hit.level < deep) {
        later("dwell", DWELL, () => back(hit.level));
        return;
      }
      if (event.pointerType !== "mouse") {
        setHot(hit.level, hit.index);
        tick();
      }
      const item = itemsAt(rootItemsRef.current, navRef.current.path, hit.level)[hit.index];
      if (item?.children && event.pointerType !== "mouse") later("dwell", DWELL, () => openSub(hit.level, hit.index));
    };
    const onUp = (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      clearTimeout(p.timer);
      clearTimer("dwell");
      press.current = null;
      setPressing(null);
      if (!p.opened) {
        if (event.type === "pointerup") setPill({ text: `Playing ${p.record.title}`, n: performance.now(), show: true });
        return;
      }
      const hit = hitAt(event.clientX, event.clientY);
      if (!hit || !p.slid) {
        if (event.pointerType !== "mouse") setHot(navRef.current.path.length, -1);
        return;
      }
      if (hit.back) {
        back(hit.level - 1);
        return;
      }
      if (hit.level < navRef.current.path.length) return;
      const item = itemsAt(rootItemsRef.current, navRef.current.path, hit.level)[hit.index];
      if (item?.children) openSub(hit.level, hit.index);
      else choose(hit.level, hit.index);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      root?.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  });

  useEffect(() => {
    if (!pill?.show) return undefined;
    const t = setTimeout(() => setPill((p) => (p ? { ...p, show: false } : p)), 2200);
    return () => clearTimeout(t);
  }, [pill]);

  const onCoverDown = (record) => (event) => {
    if (event.button > 0) return;
    const m = menuRef.current;
    if (m && !m.closing) return;
    wakeAudio();
    const p = { id: event.pointerId, x: event.clientX, y: event.clientY, record, opened: false, slid: false, over: "" };
    p.timer = setTimeout(() => {
      p.opened = true;
      open(record);
    }, HOLD);
    press.current = p;
    setPressing(record.id);
  };

  const onCoverKey = (record) => (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu") {
      event.preventDefault();
      wakeAudio();
      open(record, true);
    }
  };

  const onMenuKey = (event) => {
    const m = menuRef.current;
    if (!m || m.closing) return;
    quiet.current = quiet.current ?? { x: null, y: null };
    const cur = navRef.current;
    const level = cur.path.length;
    const items = itemsAt(rootItems, cur.path, level);
    const hot = cur.hot[level] ?? -1;
    if (event.key === "Tab" || (event.key === "Escape" && level === 0)) {
      event.preventDefault();
      close();
    } else if ((event.key === "Escape" || event.key === "ArrowLeft") && level > 0) {
      event.preventDefault();
      back(level - 1);
      tick();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const d = event.key === "ArrowDown" ? 1 : -1;
      setHot(level, hot < 0 ? (d > 0 ? 0 : items.length - 1) : (hot + d + items.length) % items.length);
      tick();
    } else if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (hot < 0) return;
      if (items[hot]?.children) openSub(level, hot, true);
      else if (event.key !== "ArrowRight") choose(level, hot);
    }
  };

  const depth = nav.path.length;
  const panels = [...nav.path.map((e, l) => ({ ...e, level: l + 1 })), ...nav.ghosts.map((g) => ({ ...g, ghost: true }))].sort((a, b) => a.key - b.key);

  const rows = (level, items, live = true) => {
    return items.map((item, i) => {
      const isOpen = nav.path[level]?.index === i;
      return (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="hm-item"
          data-level={live ? level : undefined}
          data-item={live ? i : undefined}
          data-hot={live && nav.hot[level] === i ? "" : undefined}
          data-open={live && isOpen ? "" : undefined}
          data-chosen={live && chosen === `${level}-${i}` ? "" : undefined}
          aria-haspopup={item.children ? "menu" : undefined}
          aria-expanded={item.children ? live && isOpen : undefined}
          onPointerEnter={(e) => {
            if (live && e.pointerType === "mouse") onRowEnter(level, i);
          }}
          onClick={() => live && onRowClick(level, i)}
        >
          {item.initial ? (
            <span className="hm-avatar" aria-hidden="true">
              {item.initial}
            </span>
          ) : null}
          <span className="hm-label">{item.label}</span>
          {item.meta ? <span className="hm-meta">{item.meta}</span> : null}
          {item.children ? <Glyph d={CHEVRON_R} /> : item.icon ? <Glyph d={item.icon} /> : null}
        </button>
      );
    });
  };

  const backRow = (level, label, live = true) => (
    <button
      type="button"
      tabIndex={-1}
      className="hm-item hm-back"
      aria-label={`Back from ${label}`}
      data-level={live ? level : undefined}
      data-back={live ? "" : undefined}
      onClick={() => live && back(level - 1)}
    >
      <span className="hm-label">{label}</span>
      <Glyph d={CHEVRON_D} />
    </button>
  );

  const Root = embedded ? "div" : "main";
  const record = menu?.record;
  const isOpen = menu && !menu.closing;
  return (
    <Root ref={rootRef} className="hm-root" data-embedded={embedded ? "" : undefined} data-open={isOpen ? "" : undefined}>
      <div className="hm-page">
        <div className="hm-scroll" data-scroll-contain="">
          {embedded ? null : (
            <header className="hm-head">
              <h1 className="hm-h1">Hold Menu</h1>
            </header>
          )}
          <ul className="hm-grid">
            {records.map((a) => (
              <li key={a.id} className="hm-cell">
                <button
                  type="button"
                  className="hm-cover"
                  data-pressing={pressing === a.id ? "" : undefined}
                  data-lifted={menu?.record.id === a.id ? "" : undefined}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(isOpen && menu.record.id === a.id)}
                  aria-label={`${a.title}, ${a.sub}`}
                  ref={(el) => {
                    if (el) coverEls.current.set(a.id, el);
                    else coverEls.current.delete(a.id);
                  }}
                  onPointerDown={onCoverDown(a)}
                  onKeyDown={onCoverKey(a)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    const m = menuRef.current;
                    if (m && !m.closing) return;
                    if (press.current) {
                      clearTimeout(press.current.timer);
                      press.current.opened = true;
                    }
                    open(a);
                  }}
                >
                  <img src={a.cover} alt="" draggable={false} />
                </button>
                <span className="hm-title">{a.title}</span>
                <span className="hm-year">{a.sub}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="hm-veil" aria-hidden="true" onPointerDown={close} />
      {menu ? (
        <div ref={layerRef} className="hm-layer" data-closing={menu.closing ? "" : undefined} style={{ "--lift": menu.closing ? 0 : nav.lift ?? 0 }}>
          <div
            ref={cloneRef}
            className="hm-lifted"
            data-under={!menu.closing && depth > 0 ? "" : undefined}
            data-above={menu.below ? undefined : ""}
            style={{ left: menu.left, top: menu.top, width: menu.size, height: menu.size, "--d": menu.closing ? 0 : depth, "--rx": menu.alignLeft ? "-1" : "1" }}
          >
            <img src={record.cover} alt={record.title} draggable={false} />
          </div>
          <div
            ref={menuEl}
            className="hm-menu"
            data-frame="root"
            role="menu"
            tabIndex={-1}
            aria-label={`${record.title} actions`}
            data-below={menu.below ? "" : undefined}
            data-left={menu.alignLeft ? "" : undefined}
            data-under={depth > 0 ? "" : undefined}
            style={{ left: menu.menuLeft, top: menu.menuTop, width: menu.menuW, "--d": depth, "--rx": menu.alignLeft ? "-1" : "1" }}
            onKeyDown={onMenuKey}
          >
            {rows(0, rootItems)}
          </div>
          {panels.map((e) => {
            const d = e.ghost ? 0 : depth - e.level;
            return (
              <div
                key={e.key}
                className="hm-menu hm-sub"
                data-frame={e.ghost ? undefined : e.key}
                data-leaving={e.ghost ? "" : undefined}
                data-swap={e.ghost && e.swap ? "" : undefined}
                data-late={!e.ghost && e.late ? "" : undefined}
                data-under={d > 0 ? "" : undefined}
                role="menu"
                aria-label={e.label}
                aria-hidden={e.ghost ? "true" : undefined}
                style={{
                  left: e.x,
                  top: e.y,
                  width: menu.menuW,
                  "--h": `${(e.items.length + 1) * ITEM_H}px`,
                  "--fx": `${e.fx}px`,
                  "--fy": `${e.fy}px`,
                  "--d": d,
                  "--rx": menu.alignLeft ? "-1" : "1",
                }}
                onPointerEnter={(ev) => {
                  if (!e.ghost && ev.pointerType === "mouse") onPanelEnter(e.level);
                }}
              >
                {backRow(e.level, e.label, !e.ghost)}
                {rows(e.level, e.items, !e.ghost)}
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="hm-pill" data-show={pill?.show ? "" : undefined} aria-live="polite">
        <span key={pill?.n}>{pill?.text}</span>
      </p>
    </Root>
  );
}
