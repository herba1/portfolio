"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { LIBRARY } from "./albumData";
import { readTint } from "./tint";
import "./album-open.css";

const FLY = { type: "spring", stiffness: 320, damping: 34, mass: 1 };
const EASE = [0.22, 1, 0.36, 1];

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
      <path
        d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4.5h2.2c1.4 0 2.3.6 3 1.7l1.6 3.6c.7 1.1 1.6 1.7 3 1.7H14M12 9.5l2 2-2 2M2 11.5h2.2c.9 0 1.6-.3 2.2-.8M9.6 5.3c.6-.5 1.3-.8 2.2-.8H14M12 2.5l2 2-2 2" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

const rectIn = (root, el) => {
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  return { x: r.left - o.left, y: r.top - o.top, s: r.width };
};

const cellImg = (grid, id) => grid?.querySelector(`[data-album="${id}"] img`);

const rise = (i) => ({
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: EASE, delay: 0.12 + i * 0.03 },
  },
});

function Detail({ album, tint, heroRef, setHero, coverHidden, onBack }) {
  const present = useIsPresent();
  const scrollRef = useRef(null);
  const backRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(null);

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const onScroll = () => {
    const hero = heroRef.current;
    const box = scrollRef.current;
    if (!hero || !box) return;
    const next =
      hero.getBoundingClientRect().bottom <
      box.getBoundingClientRect().top + 72;
    setCollapsed((c) => (c === next ? c : next));
  };

  const shuffle = () => {
    const pick = album.tracks[Math.floor(Math.random() * album.tracks.length)];
    setPlaying(pick.id);
  };

  return (
    <motion.section
      className="ao-detail"
      aria-label={album.title}
      style={{ "--ao-tint": tint ?? "var(--color-ink)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.22, ease: EASE } }}
      exit={{
        opacity: 0,
        transition: { duration: 0.2, ease: EASE, delay: 0.06 },
      }}
    >
      <motion.div
        className="ao-sheet"
        exit={{ opacity: 0, transition: { duration: 0.1, ease: "easeOut" } }}
      >
        <header
          className="ao-bar"
          data-collapsed={collapsed ? "true" : "false"}
        >
          <button
            ref={backRef}
            type="button"
            className="ao-back text-ui-lg"
            onClick={onBack}
          >
            <BackIcon />
            <span>Library</span>
          </button>
          <span
            className="ao-bar-name text-heading-sm"
            aria-hidden={!collapsed}
          >
            {album.title}
          </span>
        </header>

        <div
          ref={scrollRef}
          className="ao-scroll"
          data-scroll-contain
          onScroll={onScroll}
        >
          <div className="ao-column">
            <div className="ao-hero">
              <div className="ao-hero-cover">
                <img
                  ref={setHero}
                  src={album.cover}
                  alt={`${album.title} cover`}
                  draggable={false}
                  data-hidden={coverHidden || !present ? "true" : "false"}
                />
              </div>
              <div className="ao-hero-text">
                <motion.h2 className="ao-title text-title-xl" {...rise(0)}>
                  {album.title}
                </motion.h2>
                <motion.p className="ao-artist text-title-sm" {...rise(1)}>
                  {album.artist}
                </motion.p>
                <motion.p
                  className="ao-facts text-ui-lg tabular-nums"
                  {...rise(2)}
                >
                  {album.released}
                </motion.p>
                <motion.div className="ao-actions" {...rise(3)}>
                  <button
                    type="button"
                    className="ao-btn ao-btn--primary text-ui-lg"
                    onClick={() => setPlaying(album.tracks[0].id)}
                  >
                    <PlayIcon />
                    Play
                  </button>
                  <button
                    type="button"
                    className="ao-btn text-ui-lg"
                    onClick={shuffle}
                  >
                    <ShuffleIcon />
                    Shuffle
                  </button>
                </motion.div>
              </div>
            </div>

            <ol className="ao-tracks">
              {album.tracks.map((t, i) => (
                <motion.li key={t.id} {...rise(4 + i)}>
                  <button
                    type="button"
                    className="ao-track"
                    data-playing={playing === t.id ? "true" : "false"}
                    aria-current={playing === t.id ? "true" : undefined}
                    onClick={() => setPlaying(t.id)}
                  >
                    <span className="ao-n text-ui-lg tabular-nums">
                      {playing === t.id ? <Bars /> : t.n}
                    </span>
                    <span className="ao-track-title text-body">{t.title}</span>
                    <span className="ao-len text-ui-lg tabular-nums">
                      {t.length}
                    </span>
                  </button>
                </motion.li>
              ))}
            </ol>
          </div>
        </div>
      </motion.div>
    </motion.section>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const heroRef = useRef(null);
  const runs = useRef([]);
  const seq = useRef(0);
  const [openId, setOpenId] = useState(null);
  const [flight, setFlight] = useState(null);
  const [tints, setTints] = useState({});
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const s = useMotionValue(0);
  const album = LIBRARY.find((a) => a.id === openId) ?? null;
  const flying = flight ? LIBRARY.find((a) => a.id === flight.id) : null;

  useEffect(() => {
    let alive = true;
    for (const a of LIBRARY) {
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        const tint = readTint(img);
        setTints((t) => ({ ...t, [a.id]: tint }));
      };
      img.src = a.cover;
    }
    return () => {
      alive = false;
      runs.current.forEach((r) => r.stop());
    };
  }, []);

  const setHero = (el) => {
    if (el) heroRef.current = el;
  };

  const place = (r) => {
    runs.current.forEach((a) => a.stop());
    runs.current = [];
    x.set(r.x);
    y.set(r.y);
    s.set(r.s);
  };

  const open = (id) => {
    if (!(flight && flight.id === id)) {
      const img = cellImg(gridRef.current, id);
      if (img) place(rectIn(rootRef.current, img));
    }
    setOpenId(id);
    setFlight({ id, dir: "open", n: seq.current + 1 });
  };

  const close = () => {
    if (!openId) return;
    if (!(flight && flight.id === openId) && heroRef.current)
      place(rectIn(rootRef.current, heroRef.current));
    setFlight({ id: openId, dir: "close", n: seq.current + 1 });
    setOpenId(null);
  };

  useLayoutEffect(() => {
    if (!flight || flight.n === seq.current) return;
    seq.current = flight.n;
    const token = flight.n;
    let target = null;
    if (flight.dir === "open") {
      target = heroRef.current;
    } else {
      target = cellImg(gridRef.current, flight.id);
      const cell = target?.closest("[data-album]");
      cell?.scrollIntoView({ block: "nearest" });
      cell?.focus({ preventScroll: true });
    }
    if (!target) {
      Promise.resolve().then(() => {
        if (seq.current === token) setFlight(null);
      });
      return;
    }
    const to = rectIn(rootRef.current, target);
    runs.current.forEach((a) => a.stop());
    runs.current = [
      animate(x, to.x, FLY),
      animate(y, to.y, FLY),
      animate(s, to.s, FLY),
    ];
    Promise.all(runs.current.map((r) => r.finished)).then(() => {
      if (seq.current === token) setFlight(null);
    });
  }, [flight, x, y, s]);

  return (
    <div
      ref={rootRef}
      className="ao"
      data-embedded={embedded ? "true" : "false"}
    >
      <div
        className="ao-library"
        data-scroll-contain
        inert={album ? true : undefined}
      >
        <div className="ao-library-inner">
          <div className="ao-library-head">
            {!embedded && <h1 className="ao-heading text-title-lg">Albums</h1>}
            <p className="ao-count text-ui-lg">
              The Beatles · {LIBRARY.length} studio albums
            </p>
          </div>
          <div ref={gridRef} className="ao-grid">
            {LIBRARY.map((a) => (
              <button
                key={a.id}
                type="button"
                className="ao-cell"
                data-album={a.id}
                onClick={() => open(a.id)}
                aria-label={`${a.title}, ${a.year}`}
              >
                <span className="ao-cell-cover">
                  <img
                    src={a.cover}
                    alt=""
                    draggable={false}
                    data-hidden={
                      openId === a.id || flight?.id === a.id ? "true" : "false"
                    }
                  />
                </span>
                <span className="ao-cell-title text-heading-sm">{a.title}</span>
                <span className="ao-cell-year text-ui-lg tabular-nums">
                  {a.year}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {album && (
          <Detail
            key={album.id}
            album={album}
            tint={tints[album.id]}
            heroRef={heroRef}
            setHero={setHero}
            coverHidden={flight?.id === album.id}
            onBack={close}
          />
        )}
      </AnimatePresence>

      {flying && (
        <motion.img
          className="ao-flyer"
          src={flying.cover}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-dir={flight.dir}
          style={{ x, y, width: s, height: s }}
        />
      )}
    </div>
  );
}
