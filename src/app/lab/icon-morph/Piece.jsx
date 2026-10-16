"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import MorphIcon from "./MorphIcon";
import { TRACKS, clock } from "./tracks";
import "./icon-morph.css";

const SWAP = { duration: 0.34, ease: [0.22, 1, 0.36, 1] };

const titleMotion = {
  enter: (dir) => ({ y: dir * 10, opacity: 0, filter: "blur(2px)" }),
  center: { y: 0, opacity: 1, filter: "blur(0px)" },
  exit: (dir) => ({ y: dir * -10, opacity: 0, filter: "blur(2px)" }),
};

function useOnscreen(rootRef) {
  const [onscreen, setOnscreen] = useState(true);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    const io = new IntersectionObserver(([entry]) => setOnscreen(entry.isIntersecting));
    io.observe(root);
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rootRef]);
  return onscreen && !hidden;
}

function QueueRow({ track, current, playing, live, onPick }) {
  const [hover, setHover] = useState(false);
  const [sticky, setSticky] = useState("eq");
  const [wasCurrent, setWasCurrent] = useState(current);
  const [entering, setEntering] = useState(false);
  if (wasCurrent !== current) {
    setWasCurrent(current);
    setEntering(current && !hover);
  }
  const shape = current ? (hover ? (playing ? "pause" : "play") : "eq") : hover ? "play" : sticky;
  if (shape !== sticky) setSticky(shape);
  const enter = (value) => {
    setHover(value);
    setEntering(false);
  };
  return (
    <li className="icon-morph__item">
      <button
        type="button"
        className="icon-morph__row"
        data-current={current || undefined}
        aria-current={current ? "true" : undefined}
        aria-label={current ? `${playing ? "Pause" : "Play"} ${track.title}` : `Play ${track.title}`}
        onClick={onPick}
        onPointerEnter={(e) => e.pointerType === "mouse" && enter(true)}
        onPointerLeave={() => enter(false)}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && enter(true)}
        onBlur={() => enter(false)}
      >
        <span className="icon-morph__lead">
          <span className="icon-morph__num">{track.number}</span>
          <MorphIcon className="icon-morph__lead-icon" shape={shape} live={current && live && !hover} snap={!current || entering} size={20} stroke={2.2} />
        </span>
        <span className="icon-morph__row-title">{track.title}</span>
        <span className="icon-morph__row-time">{clock(track.length)}</span>
      </button>
    </li>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const timeRef = useRef(null);
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const scrolled = useRef(false);
  const clockRef = useRef({ base: 38, since: 0, running: false });
  const [index, setIndex] = useState(6);
  const [run, setRun] = useState({ key: 0, offset: 38 });
  const [dir, setDir] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [saved, setSaved] = useState(() => new Set(["ppm-7"]));
  const [open, setOpen] = useState(true);
  const visible = useOnscreen(rootRef);
  const track = TRACKS[index];
  const live = playing && visible;

  const elapsedNow = useCallback(() => {
    const c = clockRef.current;
    return c.base + (c.running ? (performance.now() - c.since) / 1000 : 0);
  }, []);

  const go = useCallback((to, direction) => {
    const target = (to + TRACKS.length) % TRACKS.length;
    setDir(direction);
    setIndex(target);
    setRun((r) => ({ key: r.key + 1, offset: 0 }));
    setPlaying(true);
  }, []);

  const next = useCallback(() => {
    nextRef.current?.kick(70);
    go(index + 1, 1);
  }, [go, index]);

  const prev = useCallback(() => {
    prevRef.current?.kick(-70);
    if (elapsedNow() > 3) {
      setRun((r) => ({ key: r.key + 1, offset: 0 }));
      return;
    }
    go(index - 1, -1);
  }, [go, index, elapsedNow]);

  const toggleSave = useCallback(() => {
    setSaved((was) => {
      const nextSet = new Set(was);
      if (nextSet.has(track.id)) nextSet.delete(track.id);
      else nextSet.add(track.id);
      return nextSet;
    });
  }, [track.id]);

  useEffect(() => {
    const c = clockRef.current;
    c.base = run.offset;
    c.since = performance.now();
    if (timeRef.current) timeRef.current.textContent = clock(run.offset);
  }, [run]);

  useEffect(() => {
    if (!live) return undefined;
    const c = clockRef.current;
    c.running = true;
    c.since = performance.now();
    const write = () => {
      if (timeRef.current) timeRef.current.textContent = clock(elapsedNow());
    };
    const timer = window.setInterval(write, 250);
    return () => {
      c.base = elapsedNow();
      c.running = false;
      window.clearInterval(timer);
    };
  }, [live, run, elapsedNow]);

  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[index];
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    const behavior = scrolled.current ? "smooth" : "instant";
    scrolled.current = true;
    if (top < list.scrollTop + 4) list.scrollTo({ top: top - 4, behavior });
    else if (bottom > list.scrollTop + list.clientHeight - 4) list.scrollTo({ top: bottom - list.clientHeight + 4, behavior });
  }, [index]);

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const inRows = listRef.current?.contains(e.target);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!inRows) return;
      e.preventDefault();
      const rows = Array.from(listRef.current.querySelectorAll(".icon-morph__row"));
      const at = rows.indexOf(e.target);
      const to = rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
      to?.focus();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "k") {
      setPlaying((p) => !p);
    } else if (e.key === "l") {
      toggleSave();
    } else if (e.key === "q") {
      setOpen((o) => !o);
    }
  };

  const isSaved = saved.has(track.id);

  return (
    <div className="icon-morph" data-embedded={embedded || undefined} ref={rootRef} onKeyDown={onKeyDown}>
      {!embedded && <h1 className="icon-morph__title">Transport</h1>}
      <div className="icon-morph__player">
        <section className="icon-morph__queue" id="icon-morph-queue" data-open={open} aria-label="Up next" inert={!open}>
          <header className="icon-morph__queue-head">
            <span className="icon-morph__queue-name">Please Please Me</span>
            <span className="icon-morph__queue-meta">The Beatles · 1963</span>
          </header>
          <ol className="icon-morph__rows" ref={listRef} data-scroll-contain>
            {TRACKS.map((t, i) => (
              <QueueRow
                key={t.id}
                track={t}
                current={i === index}
                playing={playing}
                live={live}
                onPick={() => (i === index ? setPlaying((p) => !p) : go(i, i > index ? 1 : -1))}
              />
            ))}
          </ol>
        </section>

        <div className="icon-morph__bar">
          <div className="icon-morph__now">
            <span className="icon-morph__cover">
              <AnimatePresence initial={false}>
                <motion.img
                  key={track.cover}
                  src={track.cover}
                  alt=""
                  draggable={false}
                  initial={{ opacity: 0, scale: 1.06 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.2, delay: 0.14 } }}
                  transition={SWAP}
                />
              </AnimatePresence>
            </span>
            <span className="icon-morph__text">
              <span className="icon-morph__slot">
                <AnimatePresence initial={false} custom={dir}>
                  <motion.span
                    key={track.id}
                    className="icon-morph__track"
                    custom={dir}
                    variants={titleMotion}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={SWAP}
                  >
                    {track.title}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="icon-morph__artist">The Beatles</span>
            </span>
          </div>

          <div className="icon-morph__controls">
            <button type="button" className="icon-morph__btn icon-morph__btn--prev" aria-label="Previous" onClick={prev}>
              <MorphIcon ref={prevRef} shape="prev" size={22} />
            </button>
            <button
              type="button"
              className="icon-morph__btn icon-morph__btn--play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => setPlaying((p) => !p)}
            >
              <MorphIcon shape={playing ? "pause" : "play"} size={24} stroke={2.4} />
            </button>
            <button type="button" className="icon-morph__btn" aria-label="Next" onClick={next}>
              <MorphIcon ref={nextRef} shape="next" size={22} />
            </button>
          </div>

          <div className="icon-morph__tools">
            <span className="icon-morph__time">
              <span ref={timeRef}>{clock(run.offset)}</span>
              <span className="icon-morph__time-total"> / {clock(track.length)}</span>
            </span>
            <button
              type="button"
              className="icon-morph__btn icon-morph__btn--save"
              data-on={isSaved || undefined}
              aria-pressed={isSaved}
              aria-label={isSaved ? "Remove from Liked Songs" : "Save to Liked Songs"}
              onClick={toggleSave}
            >
              <MorphIcon shape={isSaved ? "check" : "plus"} size={22} />
            </button>
            <button
              type="button"
              className="icon-morph__btn"
              data-on={open || undefined}
              aria-expanded={open}
              aria-controls="icon-morph-queue"
              aria-label={open ? "Close queue" : "Open queue"}
              onClick={() => setOpen((o) => !o)}
            >
              <MorphIcon shape={open ? "close" : "list"} size={22} />
            </button>
          </div>

          <span className="icon-morph__progress" aria-hidden="true">
            <span
              key={run.key}
              className="icon-morph__fill"
              style={{
                animationDuration: `${track.length}s`,
                animationDelay: `${-run.offset}s`,
                animationPlayState: live ? "running" : "paused",
              }}
              onAnimationEnd={() => go(index + 1, 1)}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
