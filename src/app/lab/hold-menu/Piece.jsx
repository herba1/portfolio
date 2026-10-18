"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { FEATURED } from "@/app/lab/_music/catalog";
import { pick, thunk, tick, wakeAudio } from "./foley";

import "./hold-menu.css";

const HOLD = 420;
const MENU_W = 248;
const ITEM_H = 44;
const HEAD_H = 56;
const LIFT = 1.06;

const ITEMS = [
  {
    id: "next",
    label: "Play Next",
    done: (a) => `Playing next: ${a.title}`,
    icon: <path d="M5 4.5v11l8-5.5zM15.5 4.5v11" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    id: "queue",
    label: "Add to Queue",
    done: (a) => `Added ${a.title} to your queue`,
    icon: <path d="M3.5 5.5h9M3.5 10h9M3.5 14.5h5M14.5 12v6M11.5 15h6" strokeLinecap="round" />,
  },
  {
    id: "share",
    label: "Share",
    done: (a) => `Copied a link to ${a.title}`,
    icon: <path d="M10 3v9.5M6.5 6.5 10 3l3.5 3.5M5 10H4.5v6.5h11V10H15" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    id: "album",
    label: "Go to Album",
    done: (a) => `Opening ${a.title}`,
    icon: <path d="M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 11.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z" />,
  },
];

function menuHeight() {
  return HEAD_H + ITEMS.length * ITEM_H + 8;
}

function place(rect, box) {
  const w = rect.width * LIFT;
  const h = rect.height * LIFT;
  const mh = menuHeight();
  let top = rect.top - (h - rect.height) / 2;
  const bottomRoom = box.height - 24 - (top + h + 12 + mh);
  const below = bottomRoom >= 0 || rect.top + rect.height / 2 < box.height / 2;
  let menuTop;
  if (below) {
    if (bottomRoom < 0) top += bottomRoom;
    top = Math.max(72, top);
    menuTop = top + h + 12;
  } else {
    top = Math.min(top, box.height - 24 - h);
    menuTop = top - 12 - mh;
    if (menuTop < 72) {
      top += 72 - menuTop;
      menuTop = 72;
    }
  }
  const cx = rect.left + rect.width / 2;
  const left = cx - w / 2;
  let menuLeft = cx < box.width / 2 ? left : left + w - MENU_W;
  menuLeft = Math.max(16, Math.min(box.width - 16 - MENU_W, menuLeft));
  const dx = left + w / 2 - cx;
  const dy = top + h / 2 - (rect.top + rect.height / 2);
  return { dx, dy, menuLeft, menuTop, below };
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

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);

  const runSpring = useCallback(() => {
    const st = spring.current;
    cancelAnimationFrame(st.raf);
    let last = 0;
    const step = (now) => {
      const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
      last = now;
      const k = 260;
      const c = 26;
      st.vx += ((st.tx - st.x) * k - st.vx * c) * dt;
      st.vy += ((st.ty - st.y) * k - st.vy * c) * dt;
      st.vs += ((st.ts - st.s) * k - st.vs * c) * dt;
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      st.s += st.vs * dt;
      const el = cloneRef.current;
      if (el) el.style.transform = `translate3d(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px, 0) scale(${st.s.toFixed(4)})`;
      const resting = Math.abs(st.tx - st.x) < 0.3 && Math.abs(st.ty - st.y) < 0.3 && Math.abs(st.ts - st.s) < 0.001 && Math.abs(st.vs) < 0.01 && Math.abs(st.vx) + Math.abs(st.vy) < 1;
      if (resting) {
        st.raf = 0;
        const done = st.onRest;
        st.onRest = null;
        done?.();
        return;
      }
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(spring.current.raf), []);

  const close = useCallback(() => {
    const st = spring.current;
    setMenu((m) => (m ? { ...m, closing: true } : m));
    setHot(-1);
    hotRef.current = -1;
    st.tx = 0;
    st.ty = 0;
    st.ts = 1;
    st.onRest = () => {
      setMenu(null);
      setChosen(null);
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
      setPill({ text: item.done(m.album), n: Date.now() });
      setTimeout(close, 180);
    },
    [close],
  );

  const open = useCallback(
    (album) => {
      const root = rootRef.current;
      const el = coverEls.current.get(album.id);
      if (!root || !el) return;
      const box = root.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const rect = { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
      const pos = place(rect, box);
      const st = spring.current;
      st.x = 0;
      st.y = 0;
      st.s = 0.95;
      st.vs = 0.8;
      st.tx = pos.dx;
      st.ty = pos.dy;
      st.ts = LIFT;
      st.onRest = null;
      setMenu({ album, rect, ...pos, closing: false, n: Date.now() });
      setPressing(null);
      setHot(-1);
      hotRef.current = -1;
      thunk();
    },
    [],
  );

  useLayoutEffect(() => {
    if (menu && !menu.closing && cloneRef.current) {
      const st = spring.current;
      cloneRef.current.style.transform = `translate3d(${st.x}px, ${st.y}px, 0) scale(${st.s})`;
      runSpring();
    }
  }, [menu, runSpring]);

  const itemAt = (x, y) => {
    const target = document.elementFromPoint(x, y)?.closest("[data-item]");
    return target ? Number(target.getAttribute("data-item")) : -1;
  };

  useEffect(() => {
    const onMove = (event) => {
      const p = press.current;
      if (!p || p.id !== event.pointerId) return;
      if (!menuRef.current) {
        if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > 10) {
          clearTimeout(p.timer);
          press.current = null;
          setPressing(null);
        }
        return;
      }
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
      if (!menuRef.current) {
        if (event.type === "pointerup") setPill({ text: `Playing ${p.album.title}`, n: Date.now() });
        return;
      }
      const i = itemAt(event.clientX, event.clientY);
      if (i >= 0 && p.moved) choose(i);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [choose]);

  useEffect(() => {
    if (!pill) return undefined;
    const t = setTimeout(() => setPill(null), 2400);
    return () => clearTimeout(t);
  }, [pill]);

  const onCoverDown = (album) => (event) => {
    if (event.button > 0 || menuRef.current) return;
    wakeAudio();
    const p = { id: event.pointerId, x: event.clientX, y: event.clientY, album, moved: false };
    p.timer = setTimeout(() => {
      p.moved = true;
      open(album);
    }, HOLD);
    press.current = p;
    setPressing(album.id);
  };

  const onCoverKey = (album) => (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu") {
      event.preventDefault();
      wakeAudio();
      open(album);
      hotRef.current = 0;
      setHot(0);
    }
  };

  const onMenuKey = (event) => {
    if (!menu) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const d = event.key === "ArrowDown" ? 1 : -1;
      const i = (Math.max(0, hotRef.current) + d + ITEMS.length) % ITEMS.length;
      hotRef.current = i;
      setHot(i);
      tick();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (hotRef.current >= 0) choose(hotRef.current);
    }
  };

  const menuEl = useRef(null);
  useEffect(() => {
    if (menu && !menu.closing) menuEl.current?.focus({ preventScroll: true });
  }, [menu]);

  const Root = embedded ? "div" : "main";
  const album = menu?.album;

  return (
    <Root ref={rootRef} className="hm-root" data-embedded={embedded ? "" : undefined}>
      <div className="hm-page" data-blurred={menu && !menu.closing ? "" : undefined}>
        <div className="hm-scroll" data-scroll-contain="">
          {embedded ? null : (
            <header className="hm-head">
              <h1 className="text-title-sm">Hold Menu</h1>
              <p className="hm-hint text-ui-lg">Press and hold a record. Keep holding, slide onto an action and let go to choose it.</p>
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
                  aria-label={`${a.title}. Hold for actions`}
                  ref={(el) => {
                    if (el) coverEls.current.set(a.id, el);
                    else coverEls.current.delete(a.id);
                  }}
                  onPointerDown={onCoverDown(a)}
                  onKeyDown={onCoverKey(a)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!menuRef.current) {
                      if (press.current) clearTimeout(press.current.timer);
                      press.current = null;
                      open(a);
                    }
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
      {menu ? (
        <div className="hm-layer" data-closing={menu.closing ? "" : undefined}>
          <div className="hm-veil" onPointerDown={close} />
          <div
            ref={cloneRef}
            className="hm-lifted"
            style={{ left: menu.rect.left, top: menu.rect.top, width: menu.rect.width, height: menu.rect.height }}
          >
            <img className="hm-glow" src={album.cover} alt="" draggable={false} />
            <img className="hm-lifted-img" src={album.cover} alt={album.title} draggable={false} />
          </div>
          <div
            ref={menuEl}
            className="hm-menu"
            role="menu"
            tabIndex={-1}
            aria-label={`${album.title} actions`}
            data-below={menu.below ? "" : undefined}
            style={{ left: menu.menuLeft, top: menu.menuTop, width: MENU_W }}
            onKeyDown={onMenuKey}
          >
            <div className="hm-menu-head">
              <span className="hm-menu-title">{album.title}</span>
              <span className="hm-menu-sub">
                {album.artist} · {album.year}
              </span>
            </div>
            {ITEMS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="hm-item"
                data-item={i}
                data-hot={hot === i ? "" : undefined}
                data-chosen={chosen === i ? "" : undefined}
                style={{ "--i": i }}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "mouse") return;
                  hotRef.current = i;
                  setHot(i);
                }}
                onClick={() => choose(i)}
              >
                <span>{item.label}</span>
                <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
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
