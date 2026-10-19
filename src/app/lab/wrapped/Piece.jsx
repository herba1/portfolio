"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import "./wrapped.css";

const DURATION = 6400;
const HOLD = 220;

const CARDS = [
  { key: "intro", bg: "#ff4f2b", ink: "#170502", alt: "#ffd23f" },
  { key: "minutes", bg: "#2440e6", ink: "#ffffff", alt: "#c6f432" },
  { key: "song", bg: "#ffd23f", ink: "#170f02", alt: "#ff4f2b" },
  { key: "five", bg: "#0c8a52", ink: "#ffffff", alt: "#c6f432" },
  { key: "album", bg: "#8a2be2", ink: "#ffffff", alt: "#ff9bd2" },
  { key: "outro", bg: "#c6f432", ink: "#0f1402", alt: "#2440e6" },
];

const fmt = (n) => Math.round(n).toLocaleString("en-US");

function CountUp({ value, delay = 500, duration = 1500, end = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now) => {
      const u = Math.min(1, Math.max(0, (now - start) / duration));
      const e = 1 - Math.pow(1 - u, 4);
      el.textContent = fmt(value * e);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    el.textContent = fmt(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, duration]);
  return (
    <span className="wr-count" data-end={end ? "" : undefined} role="img" aria-label={fmt(value)}>
      <span className="wr-count-size" aria-hidden="true">
        {fmt(value)}
      </span>
      <span ref={ref} className="wr-count-live" aria-hidden="true">
        0
      </span>
    </span>
  );
}

function Line({ i = 0, className = "", children, as: Tag = "p" }) {
  return (
    <Tag className={`wr-line ${className}`.trim()}>
      <span className="wr-line-in" style={{ "--i": i }}>
        {children}
      </span>
    </Tag>
  );
}

function fitTitle(text, base) {
  const n = text.length;
  if (n <= 6) return `${base * 1.5}cqw`;
  if (n <= 10) return `${base * 1.2}cqw`;
  if (n <= 16) return `${base}cqw`;
  return `${base * 0.78}cqw`;
}

function topAlbum(tracks) {
  const counts = new Map();
  tracks.forEach((t) => {
    const entry = counts.get(t.album) || { album: t.album, artist: t.artist, image: t.imageLarge || t.image, n: 0 };
    entry.n += 1;
    counts.set(t.album, entry);
  });
  return [...counts.values()].sort((a, b) => b.n - a.n)[0];
}

function Card({ card, tracks, onReplay }) {
  const lead = tracks[0];
  if (!lead) return null;
  if (card.key === "intro") {
    return (
      <div className="wr-body wr-intro">
        <span className="wr-sun" aria-hidden="true" />
        <Line i={0} className="wr-kicker">
          Your year in music
        </Line>
        <p className="wr-year" aria-label="2026">
          <span className="wr-line">
            <span className="wr-line-in" style={{ "--i": 1 }}>
              20
            </span>
          </span>
          <span className="wr-line">
            <span className="wr-line-in" style={{ "--i": 2 }}>
              26
            </span>
          </span>
        </p>
        <Line i={4} className="wr-foot">
          The songs you played most, January to now.
        </Line>
      </div>
    );
  }
  if (card.key === "minutes") {
    return (
      <div className="wr-body wr-minutes">
        <div className="wr-marquee" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="wr-marquee-row" style={{ "--row": row }}>
              <span>minutes minutes minutes minutes minutes minutes </span>
              <span>minutes minutes minutes minutes minutes minutes </span>
            </div>
          ))}
        </div>
        <Line i={0} className="wr-kicker">
          You listened for
        </Line>
        <div className="wr-big">
          <Line i={1} className="wr-number" as="div">
            <CountUp value={48213} delay={420} duration={1600} />
          </Line>
          <Line i={2} className="wr-unit">
            minutes
          </Line>
        </div>
        <Line i={4} className="wr-foot">
          That is 33 days with the volume up, most of it on {lead.artist}.
        </Line>
      </div>
    );
  }
  if (card.key === "song") {
    return (
      <div className="wr-body wr-song">
        <Line i={0} className="wr-kicker">
          Your top song
        </Line>
        <div className="wr-hero">
          <img className="wr-hero-cover" src={lead.imageLarge || lead.image} alt={`${lead.album} cover`} crossOrigin="anonymous" />
        </div>
        <div className="wr-song-meta">
          <Line i={3} className="wr-title">
            <span style={{ fontSize: fitTitle(lead.title, 13) }}>{lead.title}</span>
          </Line>
          <Line i={4} className="wr-plays">
            <CountUp value={412} delay={760} duration={1200} end /> plays
          </Line>
        </div>
      </div>
    );
  }
  if (card.key === "five") {
    return (
      <div className="wr-body wr-five">
        <Line i={0} className="wr-kicker">
          Your top songs
        </Line>
        <ol className="wr-list">
          {tracks.slice(0, 5).map((t, i) => (
            <li key={t.id} className="wr-row" style={{ "--i": i + 1 }}>
              <span className="wr-rank">{i + 1}</span>
              <img src={t.image} alt="" crossOrigin="anonymous" />
              <span className="wr-row-text">
                <span className="wr-row-title">{t.title}</span>
                <span className="wr-row-sub">{t.album}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (card.key === "album") {
    const album = topAlbum(tracks);
    return (
      <div className="wr-body wr-album">
        <span className="wr-rings" aria-hidden="true" />
        <Line i={0} className="wr-kicker">
          Your album of the year
        </Line>
        <div className="wr-album-art">
          <img src={album.image} alt={`${album.album} cover`} crossOrigin="anonymous" />
        </div>
        <div className="wr-song-meta">
          <Line i={3} className="wr-title">
            <span style={{ fontSize: fitTitle(album.album, 11) }}>{album.album}</span>
          </Line>
          <Line i={4} className="wr-foot">
            {album.n} of your top {tracks.length} songs are on it.
          </Line>
        </div>
      </div>
    );
  }
  return (
    <div className="wr-body wr-outro">
      <Line i={0} className="wr-wrap-line">
        That&rsquo;s
      </Line>
      <Line i={1} className="wr-wrap-line">
        a wrap.
      </Line>
      <div className="wr-mosaic" aria-hidden="true">
        {[...new Map(tracks.map((t) => [t.image, t])).values()].slice(0, 8).map((t, i) => (
          <span key={t.image} className="wr-tile" style={{ "--i": (i % 4) + Math.floor(i / 4) }}>
            <img src={t.image} alt="" crossOrigin="anonymous" />
          </span>
        ))}
      </div>
      <button
        type="button"
        className="wr-replay"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={onReplay}
      >
        Watch again
      </button>
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(16);
  const frameRef = useRef(null);
  const fillRefs = useRef([]);
  const clock = useRef({ start: 0, elapsed: 0, paused: false, raf: 0 });
  const press = useRef(null);
  const seq = useRef(1);
  const [stack, setStack] = useState([{ id: 0, index: 0, x: 50, y: 50, first: true }]);
  const [paused, setPaused] = useState(false);
  const top = stack[stack.length - 1];
  const index = top.index;

  const show = useCallback((target, x, y) => {
    setStack((list) => {
      const last = list[list.length - 1];
      const next = Math.max(0, Math.min(CARDS.length - 1, target));
      if (next === last.index) return list;
      const id = seq.current;
      seq.current += 1;
      return [...list.slice(-2), { id, index: next, x, y }];
    });
  }, []);

  const go = useCallback(
    (dir, x, y) => {
      const cur = stack[stack.length - 1].index;
      const next = cur + dir;
      if (next < 0 || next >= CARDS.length) {
        if (next < 0) clock.current.start = performance.now();
        return;
      }
      show(next, x, y);
    },
    [stack, show],
  );

  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  }, [go]);

  const settle = (id) => {
    setStack((list) => (list[list.length - 1].id === id && list.length > 1 ? list.slice(-1) : list));
  };

  useEffect(() => {
    const c = clock.current;
    c.elapsed = 0;
    c.start = performance.now();
    fillRefs.current.forEach((el, i) => {
      if (el) el.style.transform = `scaleX(${i < index ? 1 : 0})`;
    });
  }, [index, top.id]);

  useEffect(() => {
    clock.current.paused = paused;
  }, [paused]);

  useEffect(() => {
    const c = clock.current;
    let fired = false;
    const step = (now) => {
      c.raf = requestAnimationFrame(step);
      if (c.paused || document.hidden) {
        c.start = now - c.elapsed;
        return;
      }
      c.elapsed = now - c.start;
      const p = Math.min(1, c.elapsed / DURATION);
      const fill = fillRefs.current[index];
      if (fill) fill.style.transform = `scaleX(${p.toFixed(4)})`;
      if (p >= 1 && !fired && index < CARDS.length - 1) {
        fired = true;
        goRef.current(1, 86, 50);
      }
    };
    c.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(c.raf);
  }, [index, top.id]);

  const where = (event) => {
    const rect = frameRef.current.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100];
  };

  const onPointerDown = (event) => {
    if (event.button > 0) return;
    const [x, y] = where(event);
    if (press.current) clearTimeout(press.current.timer);
    press.current = {
      id: event.pointerId,
      x,
      y,
      held: false,
      timer: setTimeout(() => {
        if (press.current) press.current.held = true;
        setPaused(true);
      }, HOLD),
    };
  };

  const onPointerUp = (event) => {
    const p = press.current;
    if (!p || p.id !== event.pointerId) return;
    clearTimeout(p.timer);
    press.current = null;
    if (p.held) {
      setPaused(false);
      return;
    }
    go(p.x < 30 ? -1 : 1, p.x, p.y);
  };

  const onPointerCancel = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    press.current = null;
    if (p.held) setPaused(false);
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1, 86, 50);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1, 14, 50);
    } else if (event.key === " ") {
      event.preventDefault();
      setPaused((p) => !p);
    }
  };

  const current = CARDS[index];
  const Root = embedded ? "div" : "main";

  return (
    <Root className="wr-root" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="wr-head">
          <h1 className="text-title-sm">Wrapped</h1>
        </header>
      )}
      <div
        ref={frameRef}
        className="wr-frame"
        tabIndex={0}
        role="region"
        aria-roledescription="story"
        aria-label={`Wrapped, card ${index + 1} of ${CARDS.length}. Arrow keys move, Space pauses.`}
        data-paused={paused ? "" : undefined}
        style={{ "--ink": current.ink }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {stack.map((s, si) => {
          const card = CARDS[s.index];
          const isTop = si === stack.length - 1;
          return (
            <section
              key={s.id}
              className="wr-card"
              data-enter={s.first ? undefined : ""}
              aria-hidden={isTop ? undefined : "true"}
              style={{ "--bg": card.bg, "--ink": card.ink, "--alt": card.alt, "--ox": `${s.x}%`, "--oy": `${s.y}%` }}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) settle(s.id);
              }}
            >
              <Card card={card} tracks={tracks} onReplay={() => show(0, 50, 90)} />
            </section>
          );
        })}
        <div className="wr-bars" aria-hidden="true">
          {CARDS.map((c, i) => (
            <span key={c.key} className="wr-bar">
              <span
                className="wr-fill"
                ref={(el) => {
                  fillRefs.current[i] = el;
                }}
              />
            </span>
          ))}
        </div>
        <button
          type="button"
          className="wr-pause"
          aria-label={paused ? "Play" : "Pause"}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
    </Root>
  );
}
