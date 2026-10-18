"use client";

import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { LIBRARY } from "./albumData";
import "./album-open.css";

const FLY = { type: "spring", stiffness: 200, damping: 28, mass: 1 };
const EASE = [0.22, 1, 0.36, 1];
const COLLAPSE_AT = 220;

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

function Detail({ album, onBack, onPick }) {
  const scrollRef = useRef(null);
  const backRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(null);
  const { scrollY } = useScroll({ container: scrollRef });
  const k = useTransform(scrollY, [0, 180], [1, 0.62], { clamp: true });
  const fade = useTransform(scrollY, [0, 200], [1, 0], { clamp: true });
  const wash = useTransform(scrollY, [0, 320], [1, 0.35], { clamp: true });

  useMotionValueEvent(scrollY, "change", (y) => setCollapsed(y > COLLAPSE_AT));

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

  const more = LIBRARY.filter((a) => a.id !== album.id).slice(0, 8);

  return (
    <motion.section
      className="ao-detail"
      aria-label={album.title}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.28, ease: EASE } }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      <motion.div className="ao-wash" aria-hidden="true" style={{ opacity: wash }}>
        <motion.img
          key={album.id}
          src={album.cover}
          alt=""
          initial={{ opacity: 0, scale: 1.2 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
        />
      </motion.div>

      <header className="ao-bar" data-collapsed={collapsed ? "true" : "false"}>
        <button ref={backRef} type="button" className="ao-back text-ui-lg" onClick={onBack}>
          <BackIcon />
          <span>Library</span>
        </button>
        <div className="ao-bar-title">
          <span className="ao-mini">
            {collapsed && <motion.img layoutId={`cover-${album.id}`} transition={FLY} src={album.cover} alt="" draggable={false} />}
          </span>
          <span className="ao-bar-name text-heading-sm">{album.title}</span>
        </div>
        <button type="button" className="ao-bar-play" aria-label={`Play ${album.title}`} onClick={() => setPlaying(album.tracks[0].id)}>
          <PlayIcon />
        </button>
      </header>

      <div ref={scrollRef} className="ao-scroll" data-scroll-contain>
        <div className="ao-column">
          <div className="ao-hero">
            <motion.div className="ao-hero-cover" style={{ "--ao-k": k }}>
              {!collapsed && (
                <motion.img layoutId={`cover-${album.id}`} transition={FLY} src={album.cover} alt={`${album.title} cover`} draggable={false} />
              )}
            </motion.div>
            <motion.div
              className="ao-hero-text"
              style={{ opacity: fade }}
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.12 }}
            >
              <h2 className="ao-title text-title-lg">{album.title}</h2>
              <p className="ao-artist text-body">{album.artist}</p>
              <p className="ao-facts text-ui-lg">
                <span>Album</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{album.year}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {album.tracks.length} songs, {album.minutes} min
                </span>
              </p>
              <div className="ao-actions">
                <button type="button" className="ao-btn ao-btn--primary text-ui-lg" onClick={() => setPlaying(album.tracks[0].id)}>
                  <PlayIcon />
                  Play
                </button>
                <button
                  type="button"
                  className="ao-btn text-ui-lg"
                  onClick={() => setPlaying(album.tracks[(album.tracks.length * 7 + 3) % album.tracks.length].id)}
                >
                  <ShuffleIcon />
                  Shuffle
                </button>
              </div>
            </motion.div>
          </div>

          <ol className="ao-tracks">
            {album.tracks.map((t, i) => (
              <motion.li
                key={t.id}
                initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.42, ease: EASE, delay: 0.18 + i * 0.045 }}
              >
                <button
                  type="button"
                  className="ao-track"
                  data-playing={playing === t.id ? "true" : "false"}
                  aria-current={playing === t.id ? "true" : undefined}
                  onClick={() => setPlaying(t.id)}
                >
                  <span className="ao-n font-mono tabular-nums text-ui">{playing === t.id ? <Bars /> : t.n}</span>
                  <span className="ao-track-title text-ui-lg">{t.title}</span>
                  <span className="ao-len font-mono tabular-nums text-ui">{t.length}</span>
                </button>
              </motion.li>
            ))}
          </ol>

          <p className="ao-released text-ui-lg">
            Released {album.released}
          </p>

          <motion.div
            className="ao-more"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.18 + album.tracks.length * 0.045 + 0.08 }}
          >
            <h3 className="ao-more-title text-heading">More by {album.artist}</h3>
            <div className="ao-more-row">
              {more.map((a) => (
                <button key={a.id} type="button" className="ao-more-item" onClick={() => onPick(a.id)}>
                  <img src={a.cover} alt="" draggable={false} />
                  <span className="ao-more-name text-ui">{a.title}</span>
                  <span className="ao-more-year text-ui tabular-nums">{a.year}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </motion.section>
  );
}

export default function Piece({ embedded = false }) {
  const [openId, setOpenId] = useState(null);
  const lastRef = useRef(null);
  const gridRef = useRef(null);
  const album = LIBRARY.find((a) => a.id === openId) ?? null;

  const open = (id) => {
    lastRef.current = id;
    setOpenId(id);
  };

  const close = () => {
    setOpenId(null);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector(`[data-album="${lastRef.current}"]`)?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="ao" data-embedded={embedded ? "true" : "false"}>
      <LayoutGroup>
        <div className="ao-library" data-scroll-contain inert={album ? true : undefined}>
          <div className="ao-library-inner">
            <div className="ao-library-head">
              {!embedded && <h1 className="ao-heading text-title">Albums</h1>}
              <p className="ao-count text-ui-lg tabular-nums">{LIBRARY.length} albums · The Beatles</p>
            </div>
            <div ref={gridRef} className="ao-grid">
              {LIBRARY.map((a) => (
                <button key={a.id} type="button" className="ao-cell" data-album={a.id} onClick={() => open(a.id)} aria-label={`${a.title}, ${a.year}`}>
                  <span className="ao-cell-cover">
                    {openId !== a.id && (
                      <motion.img layoutId={`cover-${a.id}`} transition={FLY} src={a.cover} alt="" draggable={false} />
                    )}
                  </span>
                  <span className="ao-cell-title text-heading-sm">{a.title}</span>
                  <span className="ao-cell-year text-ui-lg tabular-nums">{a.year}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <AnimatePresence>{album && <Detail key={album.id} album={album} onBack={close} onPick={open} />}</AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
