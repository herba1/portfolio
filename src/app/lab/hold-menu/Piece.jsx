"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { FEATURED } from "@/app/lab/_music/catalog";
import { pick, thunk, tick, wakeAudio } from "./foley";

import "./hold-menu.css";

const HOLD = 400;
const ITEM_H = 48;
const LIFT = 1.08;
const GAP = 12;
const TOP = 72;
const BOTTOM = 24;

const ITEMS = [
  {
    id: "next",
    label: "Play Next",
    done: (a) => `${a.title} plays next`,
    icon: <path d="M5 4.5v11l8-5.5zM15.5 4.5v11" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    id: "queue",
    label: "Add to Queue",
    done: (a) => `${a.title} added to your queue`,
    icon: <path d="M3.5 5.5h9M3.5 10h9M3.5 14.5h5M14.5 12v6M11.5 15h6" strokeLinecap="round" />,
  },
  {
    id: "share",
    label: "Share Album",
    done: (a) => `Link to ${a.title} copied`,
    icon: <path d="M10 3v9.5M6.5 6.5 10 3l3.5 3.5M5 10H4.5v6.5h11V10H15" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    id: "album",
    label: "Go to Album",
    done: (a) => `Opening ${a.title}`,
    icon: <path d="M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 11.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z" />,
  },
];

const MENU_H = ITEMS.length * ITEM_H;

function place(rect, box) {
  const menuW = Math.min(280, box.width - 32);
  const avail = box.height - TOP - BOTTOM;
  const size = Math.max(96, Math.min(rect.width * LIFT, avail - GAP - MENU_H, box.width - 32));
  const cy = rect.top + rect.height / 2;
  const block = size + GAP + MENU_H;
  const clampTop = (t) => Math.min(Math.max(t, TOP), box.height - BOTTOM - block);
  const belowTop = clampTop(cy - size / 2);
  const aboveTop = clampTop(cy - size / 2 - GAP - MENU_H);
  const belowShift = Math.abs(belowTop - (cy - size / 2));
  const aboveShift = Math.abs(aboveTop + GAP + MENU_H - (cy - size / 2));
  const below = belowShift <= aboveShift;
  const top = below ? belowTop : aboveTop + GAP + MENU_H;
  const menuTop = below ? top + size + GAP : top - GAP - MENU_H;
  const cx = Math.min(Math.max(rect.left + rect.width / 2, 16 + size / 2), box.width - 16 - size / 2);
  const left = cx - size / 2;
  const alignLeft = cx < box.width / 2;
  let menuLeft = alignLeft ? left : left + size - menuW;
  menuLeft = Math.max(16, Math.min(box.width - 16 - menuW, menuLeft));
  const from = {
    x: rect.left + rect.width / 2 - cx,
    y: cy - (top + size / 2),
    s: rect.width / size,
  };
  return { left, top, size, menuLeft, menuTop, menuW, below, alignLeft, from };
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const cloneRef = useRef(null);
  const coverEls = useRef(new Map());
  const press = useRef(null);
  const spring = useRef({ x: 0, y: 0, s: 1, vx: 0, vy: 0, vs: 0, tx: 0, ty: 0, ts: 1, raf: 0, onRest: null });
  const [pressing, setPressing] = useState(null);
  const [menu, setMenu] = useState(null);
  const [hot, setHot] = useState(-1);
  const [chosen, setChosen] = useState(null);
  const [pill, setPill] = useState(null);
  const hotRef = useRef(-1);
  const menuRef = useRef(null);
  const menuEl = useRef(null);

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

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

  const close = useCallback(() => {
    const m = menuRef.current;
    if (!m || m.closing) return;
    const st = spring.current;
    setMenu({ ...m, closing: true });
    setHot(-1);
    hotRef.current = -1;
    st.tx = m.from.x;
    st.ty = m.from.y;
    st.ts = m.from.s;
    st.onRest = () => {
      setMenu((cur) => (cur && cur.closing && cur.n === m.n ? null : cur));
      setChosen(null);
      if (m.viaKey) requestAnimationFrame(() => coverEls.current.get(m.album.id)?.focus({ preventScroll: true }));
    };
    runSpring();
  }, [runSpring]);

  const choose = useCallback(
    (index) => {
      const m = menuRef.current;
      if (!m || m.closing) return;
      const item = ITEMS[index];
      pick();
      setChosen(index);
      if (item.id === "share") navigator.clipboard?.writeText(`${m.album.title} by ${m.album.artist} (${m.album.year})`).catch(() => {});
      setPill({ text: item.done(m.album), n: performance.now() });
      setTimeout(close, 140);
    },
    [close],
  );

  const open = useCallback((album, viaKey = false) => {
    const root = rootRef.current;
    const el = coverEls.current.get(album.id);
    if (!root || !el) return;
    const box = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const rect = { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
    const pos = place(rect, { width: box.width, height: box.height });
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
    setChosen(null);
    setMenu({ album, ...pos, viaKey, closing: false, n: performance.now() });
    setPressing(null);
    hotRef.current = viaKey ? 0 : -1;
    setHot(hotRef.current);
    thunk();
  }, []);

  useLayoutEffect(() => {
    if (menu && !menu.closing && cloneRef.current) {
      paint();
      runSpring();
    }
  }, [menu, paint, runSpring]);

  useEffect(() => {
    if (menu && !menu.closing) menuEl.current?.focus({ preventScroll: true });
  }, [menu]);

  const itemAt = (x, y) => {
    const target = document.elementFromPoint(x, y)?.closest("[data-item]");
    return target ? Number(target.getAttribute("data-item")) : -1;
  };

  useEffect(() => {
    const root = rootRef.current;
    const onTouchMove = (event) => {
      const m = menuRef.current;
      if ((m && !m.closing) || press.current?.opened) event.preventDefault();
    };
    root?.addEventListener("touchmove", onTouchMove, { passive: false });
    const onMove = (event) => {
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
      const i = itemAt(event.clientX, event.clientY);
      if (i !== hotRef.current) {
        hotRef.current = i;
        setHot(i);
        if (i >= 0) tick();
      }
    };
    const onUp = (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      clearTimeout(p.timer);
      press.current = null;
      setPressing(null);
      if (!p.opened) {
        if (event.type === "pointerup") setPill({ text: `Playing ${p.album.title}`, n: performance.now() });
        return;
      }
      const i = itemAt(event.clientX, event.clientY);
      if (i >= 0 && p.slid) choose(i);
      else if (event.pointerType !== "mouse") {
        hotRef.current = -1;
        setHot(-1);
      }
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
  }, [choose]);

  useEffect(() => {
    if (!pill) return undefined;
    const t = setTimeout(() => setPill(null), 2200);
    return () => clearTimeout(t);
  }, [pill]);

  const onCoverDown = (album) => (event) => {
    if (event.button > 0) return;
    const m = menuRef.current;
    if (m && !m.closing) return;
    wakeAudio();
    const p = { id: event.pointerId, x: event.clientX, y: event.clientY, album, opened: false, slid: false };
    p.timer = setTimeout(() => {
      p.opened = true;
      open(album);
    }, HOLD);
    press.current = p;
    setPressing(album.id);
  };

  const onCoverKey = (album) => (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu") {
      event.preventDefault();
      wakeAudio();
      open(album, true);
    }
  };

  const onMenuKey = (event) => {
    if (!menu) return;
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const d = event.key === "ArrowDown" ? 1 : -1;
      const i = hotRef.current < 0 ? (d > 0 ? 0 : ITEMS.length - 1) : (hotRef.current + d + ITEMS.length) % ITEMS.length;
      hotRef.current = i;
      setHot(i);
      tick();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (hotRef.current >= 0) choose(hotRef.current);
    }
  };

  const Root = embedded ? "div" : "main";
  const album = menu?.album;
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
            {FEATURED.map((a) => (
              <li key={a.id} className="hm-cell">
                <button
                  type="button"
                  className="hm-cover"
                  data-pressing={pressing === a.id ? "" : undefined}
                  data-lifted={menu?.album.id === a.id ? "" : undefined}
                  aria-haspopup="menu"
                  aria-expanded={isOpen && menu.album.id === a.id}
                  aria-label={`${a.title}, ${a.year}`}
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
                <span className="hm-year">
                  {a.year} · {a.tracks.length} songs
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="hm-veil" aria-hidden="true" onPointerDown={close} />
      {menu ? (
        <div className="hm-layer" data-closing={menu.closing ? "" : undefined}>
          <div ref={cloneRef} className="hm-lifted" style={{ left: menu.left, top: menu.top, width: menu.size, height: menu.size }}>
            <img src={album.cover} alt={album.title} draggable={false} />
          </div>
          <div
            ref={menuEl}
            className="hm-menu"
            role="menu"
            tabIndex={-1}
            aria-label={`${album.title} actions`}
            data-below={menu.below ? "" : undefined}
            data-left={menu.alignLeft ? "" : undefined}
            style={{ left: menu.menuLeft, top: menu.menuTop, width: menu.menuW }}
            onKeyDown={onMenuKey}
          >
            {ITEMS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="hm-item"
                data-item={i}
                data-hot={hot === i ? "" : undefined}
                data-chosen={chosen === i ? "" : undefined}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "mouse") return;
                  hotRef.current = i;
                  setHot(i);
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType !== "mouse" || hotRef.current !== i) return;
                  hotRef.current = -1;
                  setHot(-1);
                }}
                onClick={() => choose(i)}
              >
                <span>{item.label}</span>
                <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                  {item.icon}
                </svg>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="hm-pill" data-show={pill ? "" : undefined} aria-live="polite">
        <span key={pill?.n}>{pill?.text}</span>
      </p>
    </Root>
  );
}
