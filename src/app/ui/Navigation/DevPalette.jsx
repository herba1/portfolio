"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LINKS, DEV_LINKS } from "./LINKS";
import { useIsDev } from "./useIsDev";

const STORAGE_KEY = "herb:dev-palette";
const EDGE = 12;

const ROUTES = [
  ...DEV_LINKS.map(({ name, link }) => ({ name, link, dev: true })),
  ...LINKS.filter((l) => l.link.startsWith("/")).map(({ name, link }) => ({
    name,
    link,
    dev: false,
  })),
];

const clampAxis = (value, size, viewport) =>
  Math.min(Math.max(EDGE, value), Math.max(EDGE, viewport - size - EDGE));

const readStored = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
  } catch {
    return {};
  }
};

const writeStored = (patch) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readStored(), ...patch }),
    );
  } catch {}
};

export default function DevPalette() {
  const isDev = useIsDev();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !isDev) return null;
  return <Palette />;
}

function Palette() {
  const router = useRouter();
  const pathname = usePathname();

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const position = useRef({ x: EDGE, y: EDGE });
  const drag = useRef(null);
  const frame = useRef(0);

  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ROUTES;
    return ROUTES.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.link.toLowerCase().includes(q),
    );
  }, [query]);

  const applyPosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty("--dp-x", `${position.current.x}px`);
    el.style.setProperty("--dp-y", `${position.current.y}px`);
  }, []);

  const clampToViewport = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    position.current = {
      x: clampAxis(position.current.x, el.offsetWidth, window.innerWidth),
      y: clampAxis(position.current.y, el.offsetHeight, window.innerHeight),
    };
    applyPosition();
  }, [applyPosition]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const stored = readStored();
    if (typeof stored.collapsed === "boolean") setCollapsed(stored.collapsed);
    if (typeof stored.hidden === "boolean") setHidden(stored.hidden);
    position.current = {
      x: clampAxis(stored.x ?? EDGE, el.offsetWidth, window.innerWidth),
      y: clampAxis(
        stored.y ?? window.innerHeight - el.offsetHeight - EDGE,
        el.offsetHeight,
        window.innerHeight,
      ),
    };
    applyPosition();
  }, [applyPosition]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onResize = () => {
      if (!drag.current) clampToViewport();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [clampToViewport]);

  useEffect(() => {
    if (!ready) return;
    writeStored({ collapsed, hidden });
  }, [collapsed, hidden, ready]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.code !== "KeyD") return;
      e.preventDefault();
      setHidden((wasHidden) => {
        if (wasHidden) {
          setCollapsed(false);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
        return !wasHidden;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector("[data-cursor]")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, query]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button, input, a")) return;
    const el = wrapRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: position.current.x,
      originY: position.current.y,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
    el.dataset.dragging = "true";
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    position.current = {
      x: clampAxis(d.originX + e.clientX - d.pointerX, d.width, window.innerWidth),
      y: clampAxis(
        d.originY + e.clientY - d.pointerY,
        d.height,
        window.innerHeight,
      ),
    };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      applyPosition();
    });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    delete wrapRef.current?.dataset.dragging;
    writeStored({ x: position.current.x, y: position.current.y });
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) =>
        results.length ? (c - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === "Enter") {
      const target = results[cursor];
      if (!target) return;
      e.preventDefault();
      setQuery("");
      setCursor(0);
      router.push(target.link);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        setQuery("");
        setCursor(0);
      } else {
        setCollapsed(true);
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div
      ref={wrapRef}
      className="dev-palette"
      data-ready={ready ? "" : undefined}
      data-hidden={hidden ? "" : undefined}
      data-collapsed={collapsed ? "" : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="dev-palette__panel">
        <div className="dev-palette__bar" onPointerDown={onPointerDown}>
          <span className="dev-palette__grip" aria-hidden="true" />
          <span className="dev-palette__title">Routes</span>
          <button
            type="button"
            className="dev-palette__icon"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand routes" : "Collapse routes"}
          >
            <svg
              className="dev-palette__chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 4.5 6 7.5 9 4.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="dev-palette__icon"
            onClick={() => setHidden(true)}
            aria-label="Dismiss routes"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="dev-palette__body">
          <div className="dev-palette__body-inner">
            <div className="dev-palette__search">
              <input
                ref={inputRef}
                className="dev-palette__input"
                type="text"
                value={query}
                placeholder="Search routes"
                spellCheck={false}
                autoComplete="off"
                tabIndex={collapsed || hidden ? -1 : 0}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onSearchKeyDown}
              />
            </div>

            <div ref={listRef} className="dev-palette__list" data-lenis-prevent>
              {results.map((route, i) => (
                <Link
                  key={route.link}
                  href={route.link}
                  prefetch={false}
                  tabIndex={collapsed || hidden ? -1 : 0}
                  className="dev-palette__item"
                  data-dev={route.dev ? "" : undefined}
                  data-cursor={i === cursor ? "" : undefined}
                  data-active={pathname === route.link ? "" : undefined}
                  onPointerEnter={() => setCursor(i)}
                  onClick={() => {
                    setQuery("");
                    setCursor(0);
                  }}
                >
                  <span className="dev-palette__name">{route.name}</span>
                  <span className="dev-palette__path">{route.link}</span>
                </Link>
              ))}
              {results.length === 0 && (
                <p className="dev-palette__empty">Nothing matches {query}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
