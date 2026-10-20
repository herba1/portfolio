"use client";

import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";

import { ALBUMS, ARTISTS, COVER, SONGS, clock } from "./library";
import { sleep, springFor, wake } from "./loop";
import "./directional-tabs.css";

const TABS = [
  {
    id: "albums",
    label: "Albums",
    caption: `${ALBUMS.length} albums · 2.1 GB downloaded`,
  },
  {
    id: "artists",
    label: "Artists",
    caption: `${ARTISTS.length} artists you follow`,
  },
  {
    id: "songs",
    label: "Songs",
    caption: `${SONGS.length} songs · ${Math.round(SONGS.reduce((s, x) => s + x.length, 0) / 60)} min`,
  },
];
const INITIAL = 0;
const SLIDE = springFor(0.42, 0.92);
const FADE = springFor(0.26, 1);
const SIZE = springFor(0.42, 0.94);
const SUB = 1 / 240;
const SHIFT = 0.08;

const rubber = (d, dim) => (d * dim * 0.55) / (dim + 0.55 * Math.abs(d));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function value(p) {
  return { p, v: 0, t: p };
}

function advance(s, sp, h) {
  s.v += (-sp.k * (s.p - s.t) - sp.c * s.v) * h;
  s.p += s.v * h;
}

function settle(s, eps, veps) {
  if (Math.abs(s.p - s.t) < eps && Math.abs(s.v) < veps) {
    s.p = s.t;
    s.v = 0;
    return true;
  }
  return false;
}

function createDeck(count, initial) {
  const deck = {
    panes: Array.from({ length: count }, (_, i) => ({
      el: null,
      x: value(0),
      o: value(i === initial ? 1 : 0),
    })),
    h: value(0),
    f: value(initial),
    heights: Array(count).fill(0),
    max: 0,
    width: 0,
    active: initial,
    card: null,
    after: null,
    pill: null,
    held: false,
    reduced: false,
    attachPane(i, el) {
      deck.panes[i].el = el;
    },
    attachCard(el) {
      deck.card = el;
    },
    attachAfter(el) {
      deck.after = el;
    },
    attachPill(el) {
      deck.pill = el;
    },
    setReduced(on) {
      deck.reduced = on;
    },
    measure() {
      if (!deck.card) return;
      deck.width = deck.card.clientWidth;
      deck.max = deck.card.offsetHeight;
      deck.panes.forEach((pane, i) => {
        if (pane.el) deck.heights[i] = pane.el.offsetHeight;
      });
      deck.h.t = deck.heights[deck.active];
      if (!deck.held && Math.abs(deck.h.v) < 1) {
        deck.h.p = deck.h.t;
        deck.h.v = 0;
      }
      deck.write();
    },
    write() {
      const W = deck.width;
      deck.panes.forEach((pane) => {
        const el = pane.el;
        if (!el) return;
        const x = pane.x.p;
        const o = clamp01(pane.o.p);
        el.style.transform =
          Math.abs(x) < 0.01 ? "" : `translate3d(${x.toFixed(2)}px, 0, 0)`;
        el.style.opacity = o > 0.999 ? "" : o.toFixed(3);
        el.style.filter =
          o > 0.995 || deck.reduced
            ? ""
            : `blur(${((1 - o) * 2).toFixed(2)}px)`;
        el.style.visibility = o < 0.002 ? "hidden" : "visible";
        if (!W) el.style.transform = "";
      });
      if (deck.card && deck.max) {
        const cut = Math.max(0, deck.max - deck.h.p);
        deck.card.style.clipPath = `inset(0 0 ${cut.toFixed(2)}px 0 round 20px)`;
        if (deck.after)
          deck.after.style.transform =
            cut < 0.01 ? "" : `translate3d(0, ${(-cut).toFixed(2)}px, 0)`;
      }
      if (deck.pill)
        deck.pill.style.transform = `translate3d(${(deck.f.p * 100).toFixed(3)}%, 0, 0)`;
    },
    activate(n) {
      const c = deck.active;
      if (n === c) return;
      const sign = n > c ? 1 : -1;
      const W = deck.width * SHIFT;
      deck.panes.forEach((pane, i) => {
        if (i === n) {
          if (pane.o.p < 0.02) {
            pane.x.p = sign * W;
            pane.x.v = 0;
          }
          pane.x.t = 0;
          pane.o.t = 1;
          return;
        }
        pane.o.t = 0;
        pane.x.t = (i < n ? -1 : 1) * W;
        if (pane.o.p < 0.02) {
          pane.x.p = pane.x.t;
          pane.x.v = 0;
        }
      });
      deck.active = n;
      deck.h.t = deck.heights[n];
      deck.f.t = n;
      wake(deck);
    },
    hold(dx) {
      const c = deck.active;
      const n = c + (dx < 0 ? 1 : -1);
      const W = deck.width;
      deck.held = true;
      sleep(deck);
      deck.panes.forEach((pane, i) => {
        if (i === c) return;
        if (i !== n) {
          pane.o.p = 0;
          pane.o.v = 0;
        }
      });
      const cur = deck.panes[c];
      if (n < 0 || n >= deck.panes.length) {
        cur.x.p = rubber(dx, W) * 0.5;
        cur.o.p = 1;
        deck.h.p = deck.heights[c];
        deck.f.p = c;
        deck.write();
        return;
      }
      const sign = n > c ? 1 : -1;
      const p = clamp01(Math.abs(dx) / (W * 0.5));
      const next = deck.panes[n];
      cur.x.p = dx;
      cur.o.p = 1 - p;
      next.x.p = sign * W * SHIFT * (1 - p);
      next.o.p = p;
      deck.h.p = deck.heights[c] + (deck.heights[n] - deck.heights[c]) * p;
      deck.f.p = c + sign * p;
      deck.write();
    },
    release(dx, v) {
      deck.held = false;
      const c = deck.active;
      const n = c + (dx < 0 ? 1 : -1);
      const W = deck.width;
      const valid = n >= 0 && n < deck.panes.length && Math.abs(dx) > 0;
      const commit =
        valid &&
        (Math.abs(dx) > W * 0.25 ||
          (Math.abs(v) > 300 && Math.sign(v) === Math.sign(dx)));
      const cur = deck.panes[c];
      cur.x.v = v;
      if (commit) {
        const sign = n > c ? 1 : -1;
        const next = deck.panes[n];
        cur.x.t = -sign * Math.max(W * 0.32, Math.abs(dx));
        cur.o.t = 0;
        next.x.t = 0;
        next.o.t = 1;
        deck.active = n;
        deck.h.t = deck.heights[n];
        deck.f.t = n;
      } else {
        cur.x.t = 0;
        cur.o.t = 1;
        if (valid) {
          const next = deck.panes[n];
          next.o.t = 0;
          next.x.t = (n > c ? 1 : -1) * W * SHIFT;
        }
        deck.h.t = deck.heights[c];
        deck.f.t = c;
      }
      wake(deck);
      return deck.active;
    },
    step(dt) {
      if (deck.held) return false;
      let t = 0;
      while (t < dt) {
        const h = Math.min(SUB, dt - t);
        t += h;
        for (const pane of deck.panes) {
          advance(pane.x, SLIDE, h);
          advance(pane.o, FADE, h);
        }
        advance(deck.h, SIZE, h);
        advance(deck.f, SLIDE, h);
      }
      let moving = false;
      for (const pane of deck.panes) {
        if (deck.reduced) {
          pane.x.p = pane.x.t;
          pane.x.v = 0;
        }
        if (!settle(pane.x, 0.05, 0.5)) moving = true;
        if (!settle(pane.o, 0.001, 0.01)) moving = true;
      }
      if (!settle(deck.h, 0.05, 0.5)) moving = true;
      if (!settle(deck.f, 0.0005, 0.005)) moving = true;
      deck.write();
      return moving;
    },
  };
  return deck;
}

function PlayIcon({ playing }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {playing ? (
        <>
          <rect x="7" y="6" width="3.5" height="12" rx="1" />
          <rect x="13.5" y="6" width="3.5" height="12" rx="1" />
        </>
      ) : (
        <path d="M8 5.8v12.4c0 .8.9 1.3 1.6.8l9.3-6.2a1 1 0 0 0 0-1.6L9.6 5c-.7-.5-1.6 0-1.6.8Z" />
      )}
    </svg>
  );
}

const Albums = memo(function Albums({ onPlay }) {
  return (
    <>
      {ALBUMS.map((album) => (
        <button
          key={album.id}
          type="button"
          className="directional-tabs__album"
          onClick={() =>
            onPlay({
              key: album.id,
              title: album.first,
              artist: album.artist,
              cover: album.cover,
            })
          }
        >
          <img
            className="directional-tabs__cover"
            src={album.cover}
            alt=""
            draggable={false}
            decoding="async"
          />
          <span className="directional-tabs__album-title">{album.title}</span>
          <span className="directional-tabs__album-meta">
            {album.artist} ·{" "}
            <span className="directional-tabs__num">{album.year}</span>
          </span>
        </button>
      ))}
    </>
  );
});

const Artists = memo(function Artists({ onPlay }) {
  return (
    <>
      {ARTISTS.map((artist) => (
        <button
          key={artist.id}
          type="button"
          className="directional-tabs__row directional-tabs__row--artist"
          onClick={() =>
            onPlay({
              key: artist.id,
              title: artist.first,
              artist: artist.name,
              cover: artist.photo,
            })
          }
        >
          <img
            className="directional-tabs__avatar"
            src={artist.photo}
            alt=""
            draggable={false}
            decoding="async"
          />
          <span className="directional-tabs__row-text">
            <span className="directional-tabs__row-title">{artist.name}</span>
            <span className="directional-tabs__row-meta">
              <span className="directional-tabs__num">{artist.songs}</span>{" "}
              songs
            </span>
          </span>
        </button>
      ))}
    </>
  );
});

const Songs = memo(function Songs({ onPlay }) {
  return (
    <>
      {SONGS.map((song) => (
        <button
          key={song.id}
          type="button"
          className="directional-tabs__row"
          onClick={() =>
            onPlay({
              key: song.id,
              title: song.title,
              artist: song.artist,
              cover: COVER[song.album],
            })
          }
        >
          <img
            className="directional-tabs__thumb"
            src={COVER[song.album]}
            alt=""
            draggable={false}
            decoding="async"
          />
          <span className="directional-tabs__row-text">
            <span className="directional-tabs__row-title">{song.title}</span>
            <span className="directional-tabs__row-meta">{song.artist}</span>
          </span>
          <span className="directional-tabs__length">{clock(song.length)}</span>
        </button>
      ))}
    </>
  );
});

export default function Piece({ embedded = false }) {
  const [deck] = useState(() => createDeck(TABS.length, INITIAL));
  const [active, setActive] = useState(INITIAL);
  const [now, setNow] = useState({
    key: "second-light",
    title: "Second Light",
    artist: "Low Hours",
    cover: COVER.meadow,
  });
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef(null);
  const cardRef = useRef(null);
  const tabRefs = useRef([]);
  const swipe = useRef(null);
  const swallow = useRef(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    if (!root || !card) return;
    root.dataset.ready = "";
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    deck.setReduced(query.matches);
    const onMotion = () => deck.setReduced(query.matches);
    query.addEventListener("change", onMotion);
    deck.measure();
    const observer = new ResizeObserver(() => deck.measure());
    observer.observe(card);
    for (const pane of card.children) observer.observe(pane);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", onMotion);
      sleep(deck);
    };
  }, [deck]);

  const go = (i, focus) => {
    const n = Math.max(0, Math.min(TABS.length - 1, i));
    deck.activate(n);
    setActive(n);
    if (focus) tabRefs.current[n]?.focus();
  };

  const onTabKey = (e) => {
    const map = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: TABS.length - 1,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    go(map[e.key], true);
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipe.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      locked: false,
      dx: 0,
      v: 0,
      lastX: e.clientX,
      lastT: e.timeStamp,
    };
  };

  const onPointerMove = (e) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      s.locked = true;
      s.x += Math.sign(dx) * 8;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.dataset.swiping = "";
    }
    const dt = Math.max(1, e.timeStamp - s.lastT);
    s.v = s.v * 0.3 + ((e.clientX - s.lastX) / dt) * 1000 * 0.7;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;
    s.dx = e.clientX - s.x;
    deck.hold(s.dx);
  };

  const onPointerEnd = (e) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    swipe.current = null;
    if (!s.locked) return;
    delete e.currentTarget.dataset.swiping;
    swallow.current = performance.now() + 400;
    const v = e.timeStamp - s.lastT < 80 ? s.v : 0;
    const next = deck.release(s.dx, v);
    if (next !== active) setActive(next);
  };

  const play = useCallback((item) => {
    if (performance.now() < swallow.current) return;
    setNow(item);
    setPlaying(true);
  }, []);

  return (
    <div
      className="directional-tabs"
      data-embedded={embedded || undefined}
      ref={rootRef}
    >
      <div className="directional-tabs__phone">
        <div className="directional-tabs__screen" data-scroll-contain>
          <div className="directional-tabs__status" aria-hidden="true">
            <span>9:41</span>
            <span className="directional-tabs__battery" />
          </div>
          <h2 className="directional-tabs__title">Library</h2>

          <div
            className="directional-tabs__tabs"
            role="tablist"
            aria-label="Library"
            onKeyDown={onTabKey}
          >
            <span
              className="directional-tabs__pill"
              ref={(el) => deck.attachPill(el)}
              aria-hidden="true"
            />
            {TABS.map((tab, i) => (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`directional-tabs-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-controls={`directional-tabs-panel-${tab.id}`}
                tabIndex={i === active ? 0 : -1}
                className="directional-tabs__tab"
                onClick={() => go(i, false)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            className="directional-tabs__card"
            ref={(el) => {
              cardRef.current = el;
              deck.attachCard(el);
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <section
              ref={(el) => deck.attachPane(0, el)}
              id="directional-tabs-panel-albums"
              role="tabpanel"
              aria-labelledby="directional-tabs-tab-albums"
              className="directional-tabs__pane directional-tabs__albums"
              data-initial={INITIAL === 0 || undefined}
              inert={active !== 0}
              style={
                INITIAL === 0 ? undefined : { opacity: 0, visibility: "hidden" }
              }
            >
              <Albums onPlay={play} />
            </section>

            <section
              ref={(el) => deck.attachPane(1, el)}
              id="directional-tabs-panel-artists"
              role="tabpanel"
              aria-labelledby="directional-tabs-tab-artists"
              className="directional-tabs__pane directional-tabs__list"
              data-initial={INITIAL === 1 || undefined}
              inert={active !== 1}
              style={
                INITIAL === 1 ? undefined : { opacity: 0, visibility: "hidden" }
              }
            >
              <Artists onPlay={play} />
            </section>

            <section
              ref={(el) => deck.attachPane(2, el)}
              id="directional-tabs-panel-songs"
              role="tabpanel"
              aria-labelledby="directional-tabs-tab-songs"
              className="directional-tabs__pane directional-tabs__list"
              data-initial={INITIAL === 2 || undefined}
              inert={active !== 2}
              style={
                INITIAL === 2 ? undefined : { opacity: 0, visibility: "hidden" }
              }
            >
              <Songs onPlay={play} />
            </section>
          </div>

          <div
            className="directional-tabs__after"
            ref={(el) => deck.attachAfter(el)}
          >
            <p className="directional-tabs__captions">
              {TABS.map((tab, i) => (
                <span
                  key={tab.id}
                  className="directional-tabs__caption"
                  data-on={i === active || undefined}
                  aria-hidden={i !== active}
                >
                  {tab.caption}
                </span>
              ))}
            </p>
          </div>
        </div>

        <div className="directional-tabs__player">
          <img
            key={now.cover}
            className="directional-tabs__player-cover"
            src={now.cover}
            alt=""
            draggable={false}
            decoding="async"
          />
          <span className="directional-tabs__player-text" key={now.key}>
            <span className="directional-tabs__player-title">{now.title}</span>
            <span className="directional-tabs__player-meta">{now.artist}</span>
          </span>
          <button
            type="button"
            className="directional-tabs__play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((p) => !p)}
          >
            <PlayIcon playing={playing} />
          </button>
        </div>
      </div>
    </div>
  );
}
