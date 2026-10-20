"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import "./wrapped.css";

const DURATION = 6200;
const HOLD = 200;
const REEL = Array.from({ length: 40 }, (_, i) => i % 10);

const CARDS = [
  { key: "intro", bg: "#ff5a36", ink: "#1f0904" },
  { key: "minutes", bg: "#2f4bd8", ink: "#ffffff" },
  { key: "song", bg: "#f7d13b", ink: "#161204" },
  { key: "five", bg: "#0f8f57", ink: "#ffffff" },
  { key: "album", bg: "#8f2fd1", ink: "#ffffff" },
  { key: "outro", bg: "#141414", ink: "#ffffff" },
];

function Slot({ value }) {
  const text = value.toLocaleString("en-US");
  let k = 0;
  return (
    <span className="wr-slot" role="img" aria-label={text}>
      {Array.from(text).map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} className="wr-sep" aria-hidden="true">
              {ch}
            </span>
          );
        }
        const style = { "--d": Number(ch), "--k": k };
        k += 1;
        return (
          <span key={i} className="wr-digit" aria-hidden="true" style={style}>
            <span className="wr-reel">
              {REEL.map((n, j) => (
                <span key={j}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function titleSize(text) {
  const n = text.length;
  if (n <= 8) return "17cqw";
  if (n <= 14) return "13cqw";
  if (n <= 22) return "10.5cqw";
  return "8.5cqw";
}

function topAlbum(tracks) {
  const counts = new Map();
  tracks.forEach((t) => {
    const entry = counts.get(t.album) || { album: t.album, artist: t.artist, image: t.imageLarge || t.image, year: t.year, n: 0 };
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
      <div className="wr-card-body wr-intro">
        <p className="wr-kicker wr-in" style={{ "--i": 0 }}>
          Your year in music
        </p>
        <p className="wr-huge wr-year" aria-label="2026">
          {Array.from("2026").map((c, i) => (
            <span key={i} className="wr-rise" style={{ "--i": i }} aria-hidden="true">
              {c}
            </span>
          ))}
        </p>
        <p className="wr-foot wr-in" style={{ "--i": 6 }}>
          {tracks.length} songs, one artist you could not stop playing, and a lot of minutes. Tap to begin.
        </p>
      </div>
    );
  }
  if (card.key === "minutes") {
    return (
      <div className="wr-card-body wr-minutes">
        <p className="wr-kicker wr-in" style={{ "--i": 0 }}>
          This year you listened for
        </p>
        <div className="wr-big-number">
          <Slot value={48213} />
          <p className="wr-unit wr-in" style={{ "--i": 4 }}>
            minutes
          </p>
        </div>
        <p className="wr-foot wr-in" style={{ "--i": 8 }}>
          That is 33 days and 12 hours with the volume up, most of it on {lead.artist}.
        </p>
      </div>
    );
  }
  if (card.key === "song") {
    return (
      <div className="wr-card-body wr-song">
        <p className="wr-kicker wr-in" style={{ "--i": 0 }}>
          Your number one song
        </p>
        <img className="wr-hero-cover" src={lead.imageLarge || lead.image} alt={`${lead.album} cover`} crossOrigin="anonymous" />
        <div className="wr-song-meta">
          <p className="wr-song-title wr-in" style={{ "--i": 3, fontSize: titleSize(lead.title) }}>
            {lead.title}
          </p>
          <p className="wr-sub wr-in" style={{ "--i": 4 }}>
            {lead.artist}
          </p>
          <p className="wr-plays wr-in" style={{ "--i": 5 }}>
            <Slot value={412} /> <span>plays</span>
          </p>
        </div>
      </div>
    );
  }
  if (card.key === "five") {
    return (
      <div className="wr-card-body wr-five">
        <p className="wr-kicker wr-in" style={{ "--i": 0 }}>
          Your top songs
        </p>
        <ol className="wr-list">
          {tracks.slice(0, 5).map((t, i) => (
            <li key={t.id} className="wr-row" style={{ "--i": i + 1 }}>
              <span className="wr-rank">{i + 1}</span>
              <img src={t.image} alt="" crossOrigin="anonymous" />
              <span className="wr-row-text">
                <span className="wr-row-title">{t.title}</span>
                <span className="wr-row-artist">{t.album}</span>
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
      <div className="wr-card-body wr-album">
        <p className="wr-kicker wr-in" style={{ "--i": 0 }}>
          Your album of the year
        </p>
        <div className="wr-disc-wrap">
          <span className="wr-disc" aria-hidden="true" />
          <img className="wr-album-cover" src={album.image} alt={`${album.album} cover`} crossOrigin="anonymous" />
        </div>
        <p className="wr-song-title wr-in" style={{ "--i": 4, fontSize: titleSize(album.album) }}>
          {album.album}
        </p>
        <p className="wr-sub wr-in" style={{ "--i": 5 }}>
          {album.n} of your top {tracks.length} songs live on it.
        </p>
      </div>
    );
  }
  return (
    <div className="wr-card-body wr-outro">
      <p className="wr-huge wr-wrap-line wr-in" style={{ "--i": 0 }}>
        That&rsquo;s a wrap.
      </p>
      <div className="wr-mosaic" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => tracks[i % tracks.length]).map((t, i) => (
          <img key={i} src={t.image} alt="" crossOrigin="anonymous" style={{ "--i": (i % 4) + Math.floor(i / 4) }} />
        ))}
      </div>
      <button
        type="button"
        className="wr-replay wr-in"
        style={{ "--i": 10 }}
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
  const [view, setView] = useState({ index: 0, prev: null, x: 50, y: 50, n: 0 });
  const [paused, setPaused] = useState(false);

  const go = useCallback((dir, x = 50, y = 50) => {
    setView((v) => {
      const index = Math.max(0, Math.min(CARDS.length - 1, v.index + dir));
      if (index === v.index) return v;
      return { index, prev: v.index, x, y, n: v.n + 1 };
    });
  }, []);

  const restart = useCallback(() => {
    setView((v) => ({ index: 0, prev: v.index, x: 50, y: 88, n: v.n + 1 }));
  }, []);

  useEffect(() => {
    const c = clock.current;
    c.elapsed = 0;
    c.start = performance.now();
    fillRefs.current.forEach((el, i) => {
      if (el) el.style.transform = `scaleX(${i < view.index ? 1 : 0})`;
    });
  }, [view.index, view.n]);

  useEffect(() => {
    clock.current.paused = paused;
    clock.current.start = performance.now() - clock.current.elapsed;
  }, [paused]);

  useEffect(() => {
    const c = clock.current;
    const step = (now) => {
      c.raf = requestAnimationFrame(step);
      if (c.paused || document.hidden) {
        c.start = now - c.elapsed;
        return;
      }
      c.elapsed = now - c.start;
      const p = Math.min(1, c.elapsed / DURATION);
      const fill = fillRefs.current[view.index];
      if (fill) fill.style.transform = `scaleX(${p.toFixed(4)})`;
      if (p >= 1 && view.index < CARDS.length - 1) go(1, 92, 50);
    };
    c.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(c.raf);
  }, [view.index, go]);

  const onPointerDown = (event) => {
    if (event.button > 0) return;
    const rect = frameRef.current.getBoundingClientRect();
    press.current = {
      id: event.pointerId,
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
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
    go(p.x < 33 ? -1 : 1, p.x, p.y);
  };

  const onPointerCancel = () => {
    if (!press.current) return;
    clearTimeout(press.current.timer);
    press.current = null;
    setPaused(false);
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1, 92, 50);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1, 8, 50);
    } else if (event.key === " ") {
      event.preventDefault();
      setPaused((p) => !p);
    }
  };

  const current = CARDS[view.index];
  const previous = view.prev == null ? null : CARDS[view.prev];
  const Root = embedded ? "div" : "main";

  return (
    <Root className="wr-root" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="wr-head">
          <h1 className="text-title-sm">Wrapped</h1>
          <p className="wr-hint text-ui-lg">A year of listening as a story. Tap the right side to go on, the left to go back, and hold anywhere to pause.</p>
        </header>
      )}
      <div
        ref={frameRef}
        className="wr-frame"
        tabIndex={0}
        role="region"
        aria-roledescription="story"
        aria-label={`Wrapped, card ${view.index + 1} of ${CARDS.length}. Arrow keys move, Space pauses.`}
        data-paused={paused ? "" : undefined}
        style={{ "--ink": current.ink }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {previous ? (
          <section key={`p-${view.n}`} className="wr-card" data-static="" style={{ "--bg": previous.bg, "--ink": previous.ink }} aria-hidden="true">
            <Card card={previous} tracks={tracks} onReplay={restart} />
          </section>
        ) : null}
        <section
          key={`c-${view.n}`}
          className="wr-card"
          data-enter={previous ? "" : undefined}
          style={{ "--bg": current.bg, "--ink": current.ink, "--ox": `${view.x}%`, "--oy": `${view.y}%` }}
        >
          <Card card={current} tracks={tracks} onReplay={restart} />
        </section>
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
