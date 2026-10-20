"use client";

import { animate, useMotionValue } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { recordsFrom } from "./albumData";
import { readTint } from "./tint";
import "./album-open.css";

const SPRING = { type: "spring", stiffness: 84, damping: 18.4, mass: 1, restDelta: 0.002, restSpeed: 0.04 };
const FLIGHT = 0.66;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (p, a, b) => clamp01((p - a) / (b - a));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t, k = 3) => 1 - Math.pow(1 - t, k);
const lerp = (a, b, t) => a + (b - a) * t;

function Bars() {
  return (
    <span className="ao-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4.5h2.2c1.4 0 2.3.6 3 1.7l1.6 3.6c.7 1.1 1.6 1.7 3 1.7H14M12 9.5l2 2-2 2M2 11.5h2.2c.9 0 1.6-.3 2.2-.8M9.6 5.3c.6-.5 1.3-.8 2.2-.8H14M12 2.5l2 2-2 2" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

function Reveal({ className = "", children }) {
  return (
    <div className={`ao-reveal ${className}`.trim()} data-reveal>
      <div className="ao-reveal-in">{children}</div>
    </div>
  );
}

function Detail({ record, tint, detailRef, heroRef, textRef, backRef, scrollRef, onBack }) {
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(null);

  const onScroll = () => {
    const hero = heroRef.current;
    const box = scrollRef.current;
    if (!hero || !box) return;
    const next = hero.getBoundingClientRect().bottom < box.getBoundingClientRect().top + 72;
    setCollapsed((c) => (c === next ? c : next));
  };

  const shuffle = () => {
    const pick = record.tracks[Math.floor(Math.random() * record.tracks.length)];
    setPlaying(pick.id);
  };

  return (
    <section ref={detailRef} className="ao-detail" aria-label={record.title} style={{ "--ao-tint": tint ?? "var(--color-ink)" }}>
      <header className="ao-bar" data-collapsed={collapsed ? "true" : "false"}>
        <button ref={backRef} type="button" className="ao-back text-ui-lg" onClick={onBack}>
          <BackIcon />
          <span>Library</span>
        </button>
        <span className="ao-bar-name text-heading-sm" aria-hidden={!collapsed}>
          {record.title}
        </span>
      </header>

      <div ref={scrollRef} className="ao-scroll" data-scroll-contain onScroll={onScroll}>
        <div className="ao-column">
          <div className="ao-hero">
            <div className="ao-hero-cover">
              <img ref={heroRef} src={record.cover} alt={`${record.title} cover`} draggable={false} />
            </div>
            <div ref={textRef} className="ao-hero-text">
              <Reveal>
                <h2 className="ao-title text-title-xl">{record.title}</h2>
              </Reveal>
              <Reveal>
                <p className="ao-artist text-title-sm">{record.artist}</p>
              </Reveal>
              <Reveal>
                <p className="ao-facts text-ui-lg tabular-nums">{record.facts}</p>
              </Reveal>
              <Reveal className="ao-actions-mask">
                <div className="ao-actions">
                  <button type="button" className="ao-btn ao-btn--primary text-ui-lg" onClick={() => setPlaying(record.tracks[0]?.id ?? null)}>
                    <PlayIcon />
                    Play
                  </button>
                  <button type="button" className="ao-btn text-ui-lg" onClick={shuffle} disabled={record.tracks.length < 2}>
                    <ShuffleIcon />
                    Shuffle
                  </button>
                </div>
              </Reveal>
            </div>
          </div>

          <ol className="ao-tracks">
            {record.tracks.map((t) => (
              <li key={t.id} data-row>
                <button type="button" className="ao-track" data-playing={playing === t.id ? "true" : "false"} aria-current={playing === t.id ? "true" : undefined} onClick={() => setPlaying(t.id)}>
                  <span className="ao-n text-ui-lg tabular-nums">{playing === t.id ? <Bars /> : t.n}</span>
                  <span className="ao-track-title text-body">{t.title}</span>
                  <span className="ao-len text-ui-lg tabular-nums">{t.length}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const relTo = (o) => (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
};

const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const flyerAt = (g, p) => {
  const t = clamp01(p / FLIGHT);
  const ex = out(t, 3);
  const ey = out(t, 2.2);
  const s = lerp(g.from.w, g.to.w, ex);
  return { x: lerp(g.from.x, g.to.x, ex), y: lerp(g.from.y, g.to.y, ey), w: s, h: s, t };
};

export default function Piece({ embedded = false }) {
  const { tracks, live } = useTopSongs(50);
  const records = useMemo(() => recordsFrom(tracks, live), [tracks, live]);
  const rootRef = useRef(null);
  const libraryRef = useRef(null);
  const headRef = useRef(null);
  const gridRef = useRef(null);
  const flyerRef = useRef(null);
  const detailRef = useRef(null);
  const heroRef = useRef(null);
  const textRef = useRef(null);
  const backRef = useRef(null);
  const scrollRef = useRef(null);
  const geoRef = useRef(null);
  const phaseRef = useRef("idle");
  const runRef = useRef(null);
  const pendingRef = useRef(null);
  const keyedRef = useRef(false);
  const [record, setRecord] = useState(null);
  const [tints, setTints] = useState({});
  const p = useMotionValue(0);

  useEffect(() => {
    let alive = true;
    for (const r of records) {
      const img = new Image();
      if (r.remote) img.crossOrigin = "anonymous";
      img.onload = () => {
        if (!alive) return;
        let tint = null;
        try {
          tint = readTint(img);
        } catch {
          tint = null;
        }
        setTints((t) => (t[r.id] === tint ? t : { ...t, [r.id]: tint }));
      };
      img.src = r.cover;
    }
    return () => {
      alive = false;
    };
  }, [records]);

  const setPhase = useCallback((phase) => {
    phaseRef.current = phase;
    const root = rootRef.current;
    if (root) root.dataset.phase = phase;
    const lib = libraryRef.current;
    if (lib) {
      if (phase === "opening" || phase === "open") lib.setAttribute("inert", "");
      else lib.removeAttribute("inert");
    }
  }, []);

  const paint = useCallback((v) => {
    const g = geoRef.current;
    if (!g) return;
    const k = clamp01(v);
    const f = flyerAt(g, k);
    const flyer = flyerRef.current;
    if (flyer) {
      flyer.style.transform = `translate3d(${f.x}px, ${f.y}px, 0)`;
      flyer.style.width = `${f.w}px`;
      flyer.style.height = `${f.h}px`;
      const lift = Math.sin(Math.PI * f.t);
      flyer.style.boxShadow = `0 ${12 + lift * 20}px ${32 + lift * 32}px -12px rgb(0 0 0 / ${0.28 + lift * 0.1})`;
    }
    for (const c of g.cells) {
      const e = inOut(span(k, c.a, c.a + 0.44));
      c.el.style.transform = e ? `translate3d(${c.dx * e}px, ${c.dy * e}px, 0)` : "";
    }
    if (g.head) {
      const e = inOut(span(k, 0, 0.44));
      g.head.el.style.transform = e ? `translate3d(0, ${g.head.dy * e}px, 0)` : "";
    }
    if (g.meta) {
      const e = inOut(span(k, 0, 0.44));
      g.meta.el.style.transform = e ? `translate3d(0, ${g.meta.dy * e}px, 0)` : "";
    }
    if (g.back) {
      const e = out(span(k, g.start, Math.min(1, g.start + 0.4)));
      g.back.el.style.transform = `translate3d(${g.back.dx * (1 - e)}px, 0, 0)`;
    }
    g.reveals.forEach((el, i) => {
      const a = g.start + i * 0.05;
      const e = out(span(k, a, Math.min(1, a + 0.36)));
      el.style.transform = e === 1 ? "" : `translate3d(0, calc(${(1 - e) * 100}% + ${(1 - e) * 12}px), 0)`;
    });
    g.rows.forEach((r, i) => {
      const a = g.rowStart + Math.min(i, 9) * 0.03;
      const e = out(span(k, a, Math.min(1, a + 0.36)));
      r.el.style.transform = e === 1 ? "" : `translate3d(0, ${r.dy * (1 - e)}px, 0)`;
    });
  }, []);

  const measure = useCallback(
    (rec) => {
      const root = rootRef.current;
      const grid = gridRef.current;
      const hero = heroRef.current;
      const detail = detailRef.current;
      if (!root || !grid || !hero || !detail) return false;
      const managed = root.querySelectorAll("[data-album], [data-meta], .ao-library-head, .ao-back, .ao-reveal-in, [data-row]");
      managed.forEach((el) => (el.style.transform = ""));
      const o = root.getBoundingClientRect();
      const rel = relTo(o);
      const W = o.width;
      const H = o.height;
      const to = rel(hero);
      const cellsAll = [...grid.querySelectorAll("[data-album]")];
      const chosen = cellsAll.find((el) => el.dataset.album === rec.id) ?? null;
      const cover = chosen?.querySelector("img");
      const from = cover ? rel(cover) : { x: to.x, y: H + 24, w: to.w, h: to.h };
      const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
      const ci = chosen ? cellsAll.indexOf(chosen) : -1;
      const r0 = ci >= 0 ? Math.floor(ci / cols) : -1;
      const c0 = ci >= 0 ? ci % cols : -1;
      const gap = 24;
      const headEl = headRef.current;
      const headBox = headEl ? rel(headEl) : null;
      const metaEl = chosen?.querySelector("[data-meta]");
      const metaBox = metaEl ? rel(metaEl) : null;
      const moving = cellsAll
        .filter((el) => el !== chosen)
        .map((el) => {
          const i = cellsAll.indexOf(el);
          const r = Math.floor(i / cols);
          const c = i % cols;
          return { el, box: rel(el), sx: ci < 0 ? 0 : Math.sign(c - c0), sy: ci < 0 ? 1 : Math.sign(r - r0) };
        });
      const reach = { left: 0, right: 0, up: headBox ? headBox.y + headBox.h + gap : 0, down: metaBox ? H - metaBox.y + gap : 0 };
      for (const m of moving) {
        if (m.sx < 0) reach.left = Math.max(reach.left, m.box.x + m.box.w + gap);
        if (m.sx > 0) reach.right = Math.max(reach.right, W - m.box.x + gap);
        if (m.sy < 0) reach.up = Math.max(reach.up, m.box.y + m.box.h + gap);
        if (m.sy > 0) reach.down = Math.max(reach.down, H - m.box.y + gap);
      }
      const cells = moving.map((m) => ({
        el: m.el,
        dx: m.sx > 0 ? reach.right : m.sx < 0 ? -reach.left : 0,
        dy: m.sy > 0 ? reach.down : m.sy < 0 ? -reach.up : 0,
        a: 0,
      }));
      const backEl = backRef.current;
      const backBox = backEl ? rel(backEl) : null;
      const textBox = textRef.current ? rel(textRef.current) : null;
      const base = { from, to };
      let start = 0.42;
      if (textBox) {
        for (let q = 0; q <= FLIGHT; q += 0.01) if (hits(flyerAt(base, q), textBox)) start = Math.max(start, q + 0.04);
      }
      start = Math.min(start, 0.6);
      const rows = [...detail.querySelectorAll("[data-row]")].map((el) => {
        const box = rel(el);
        return { el, dy: box.y + box.h < 0 ? 0 : Math.max(H - box.y, 0) + 40 };
      });
      geoRef.current = {
        from,
        to,
        cover,
        cells,
        head: headEl ? { el: headEl, dy: -reach.up } : null,
        meta: metaEl ? { el: metaEl, dy: reach.down } : null,
        back: backEl && backBox ? { el: backEl, dx: -(backBox.x + backBox.w + gap) } : null,
        reveals: [...detail.querySelectorAll(".ao-reveal-in")],
        rows,
        start,
        rowStart: Math.min(start + 0.06, 0.62),
      };
      return true;
    },
    [],
  );

  const showFlyer = (on) => {
    const flyer = flyerRef.current;
    if (flyer) flyer.dataset.on = on ? "true" : "false";
  };

  const showHero = (on) => {
    const root = rootRef.current;
    if (root) root.dataset.hero = on ? "true" : "false";
  };

  const liftCell = (id, on) => {
    const cell = gridRef.current?.querySelector(`[data-album="${id}"]`);
    if (cell) cell.dataset.lifted = on ? "true" : "false";
    return cell;
  };

  const drive = useCallback(
    (target, done) => {
      runRef.current?.stop();
      runRef.current = animate(p, target, { ...SPRING, onComplete: done });
    },
    [p],
  );

  const settleClose = useCallback(
    (rec) => {
      const cell = liftCell(rec.id, false);
      requestAnimationFrame(() => {
        if (phaseRef.current !== "closing") return;
        showFlyer(false);
        const root = rootRef.current;
        root?.querySelectorAll("[data-album], [data-meta], .ao-library-head").forEach((el) => (el.style.transform = ""));
        geoRef.current = null;
        setPhase("idle");
        setRecord(null);
        if (keyedRef.current) cell?.focus({ preventScroll: true });
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) setRecord(next);
      });
    },
    [setPhase],
  );

  const settleOpen = useCallback(() => {
    showHero(true);
    requestAnimationFrame(() => {
      if (phaseRef.current !== "opening") return;
      showFlyer(false);
      setPhase("open");
    });
  }, [setPhase]);

  useLayoutEffect(() => {
    if (!record || phaseRef.current !== "idle") return;
    if (!measure(record)) return;
    p.set(0);
    paint(0);
    showHero(false);
    setPhase("opening");
    scrollRef.current?.scrollTo(0, 0);
    backRef.current?.focus({ preventScroll: true });
    const flyer = flyerRef.current;
    const go = () => {
      if (phaseRef.current !== "opening") return;
      showFlyer(true);
      liftCell(record.id, true);
      drive(1, settleOpen);
    };
    const ready = flyer?.decode ? flyer.decode() : Promise.resolve();
    ready.then(go, go);
  }, [record, measure, paint, drive, setPhase, settleOpen, p]);

  useEffect(() => {
    const unsub = p.on("change", paint);
    return () => {
      unsub();
      runRef.current?.stop();
    };
  }, [p, paint]);

  useEffect(() => {
    const onResize = () => {
      if (phaseRef.current === "open" && record) measure(record);
      if (phaseRef.current === "open") paint(1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [record, measure, paint]);

  const close = useCallback(() => {
    if (!record) return;
    const phase = phaseRef.current;
    if (phase === "closing" || phase === "idle") return;
    pendingRef.current = null;
    if (phase === "open") {
      measure(record);
      paint(p.get());
      showFlyer(true);
      showHero(false);
    }
    setPhase("closing");
    drive(0, () => settleClose(record));
  }, [record, measure, paint, p, setPhase, drive, settleClose]);

  const open = (rec) => {
    const phase = phaseRef.current;
    if (record && record.id === rec.id) {
      if (phase === "closing") {
        pendingRef.current = null;
        setPhase("opening");
        drive(1, settleOpen);
      }
      return;
    }
    if (record) {
      if (phase === "closing") pendingRef.current = rec;
      return;
    }
    setRecord(rec);
  };

  useEffect(() => {
    if (!record) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        keyedRef.current = true;
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [record, close]);

  const onAux = (e) => {
    if (e.button === 3 && record) {
      e.preventDefault();
      keyedRef.current = false;
      close();
    }
  };

  const onBack = (e) => {
    keyedRef.current = e.detail === 0;
    close();
  };

  return (
    <div ref={rootRef} className="ao" data-embedded={embedded ? "true" : "false"} data-phase="idle" onMouseUp={onAux}>
      <div ref={libraryRef} className="ao-library" data-scroll-contain>
        <div className="ao-library-inner">
          <div ref={headRef} className="ao-library-head">
            {!embedded && <h1 className="ao-heading text-title-lg">Albums</h1>}
            <p className="ao-count text-ui-lg">{live ? `${records.length} records from the top songs` : `${records.length} records`}</p>
          </div>
          <div ref={gridRef} className="ao-grid">
            {records.map((a) => (
              <button
                key={a.id}
                type="button"
                className="ao-cell"
                data-album={a.id}
                onPointerDown={(e) => {
                  if (e.button === 0 && phaseRef.current === "closing") {
                    keyedRef.current = false;
                    open(a);
                  }
                }}
                onClick={(e) => {
                  keyedRef.current = e.detail === 0;
                  open(a);
                }}
                aria-label={a.year ? `${a.title}, ${a.artist}, ${a.year}` : `${a.title}, ${a.artist}`}
              >
                <span className="ao-cell-cover">
                  <img src={a.cover} alt="" draggable={false} />
                </span>
                <span className="ao-cell-meta" data-meta>
                  <span className="ao-cell-title text-heading-sm">{a.title}</span>
                  <span className="ao-cell-sub text-ui-lg tabular-nums">{a.year ? `${a.artist} · ${a.year}` : a.artist}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {record && <Detail key={record.id} record={record} tint={tints[record.id]} detailRef={detailRef} heroRef={heroRef} textRef={textRef} backRef={backRef} scrollRef={scrollRef} onBack={onBack} />}

      <img ref={flyerRef} className="ao-flyer" src={record?.cover ?? records[0]?.cover} alt="" aria-hidden="true" draggable={false} data-on="false" />
    </div>
  );
}
