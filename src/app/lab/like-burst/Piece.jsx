"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ALBUMS, albumById } from "@/app/lab/_music/catalog";

import Roll from "./Roll";
import { createBurstLayer } from "./burst";
import { createLikeAudio } from "./likeAudio";
import "./like-burst.css";

const ALBUM = albumById("abbey-road");
const COUNTS = [2917446, 1862305, 4109999, 612840, 788019, 941377];
const TRACKS = ALBUM.tracks.map((title, i) => ({ id: `t${i}`, title, n: i + 1, count: COUNTS[i] }));
const COVERS = ["abbey-road", "revolver", "rubber-soul", "sgt-pepper", "let-it-be", "magical-mystery-tour", "help", "a-hard-days-night", "white-album", "please-please-me", "with-the-beatles", "beatles-for-sale"].map(
  (id) => ALBUMS.find((a) => a.id === id).cover,
);
const HEART = "M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.1 1.7-1.9 3.2-3.1 5.4-3.1 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z";
const WAVE = "M-24 3q6-3 12 0t12 0t12 0t12 0t12 0t12 0V26H-24Z";
const fmt = (n) => n.toLocaleString("en-US");
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`);

function HeartButton({ liked, onToggle, size = "big", label }) {
  const raw = useId();
  const clip = `like-burst-clip-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <button
      type="button"
      className="like-burst-heart"
      data-size={size}
      data-liked={liked ? "" : undefined}
      aria-pressed={liked}
      aria-label={label}
      onClick={(e) => onToggle(e.currentTarget)}
    >
      <span className="like-burst-ring" aria-hidden="true" />
      <svg className="like-burst-ghost" viewBox="0 0 24 24" aria-hidden="true">
        <path d={HEART} />
      </svg>
      <svg className="like-burst-icon" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <path d={HEART} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <g className="like-burst-fill">
            <path className="like-burst-wave" d={WAVE} />
          </g>
        </g>
        <path className="like-burst-outline" d={HEART} />
      </svg>
    </button>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const layerRef = useRef(null);
  const bigHeartRef = useRef(null);
  const burstRef = useRef(null);
  const audioRef = useRef(null);
  const tapRef = useRef({ at: 0, x: 0, y: 0 });
  const [current, setCurrent] = useState(2);
  const [liked, setLiked] = useState(() => new Set(["t1"]));

  useEffect(() => {
    const burst = createBurstLayer(layerRef.current, COVERS);
    const audio = createLikeAudio();
    burstRef.current = burst;
    audioRef.current = audio;
    return () => {
      burst.destroy();
      audio.destroy();
    };
  }, []);

  const originOf = (el, clientX, clientY) => {
    const root = rootRef.current.getBoundingClientRect();
    if (clientX != null) return [clientX - root.left, clientY - root.top];
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 - root.left, r.top + r.height / 2 - root.top];
  };

  const animateLike = (button, big) => {
    const icon = button.querySelector(".like-burst-icon");
    const ring = button.querySelector(".like-burst-ring");
    icon.animate(
      [
        { transform: "scale(0.78)", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        { transform: "scale(1.24)", offset: 0.34, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
        { transform: "scale(0.96)", offset: 0.68, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: big ? 560 : 460, easing: "linear" },
    );
    ring.animate(
      [
        { transform: "scale(0.4)", opacity: 1, borderWidth: big ? "8px" : "5px" },
        { transform: "scale(1.5)", opacity: 0, borderWidth: "0px" },
      ],
      { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  };

  const animateUnlike = (button) => {
    const icon = button.querySelector(".like-burst-icon");
    const ghost = button.querySelector(".like-burst-ghost");
    icon.animate(
      [
        { transform: "scale(1)", easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
        { transform: "scale(0.86)", offset: 0.35, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: 620, easing: "linear" },
    );
    ghost.animate(
      [
        { transform: "translateY(0) scale(1)", opacity: 0.5 },
        { transform: "translateY(-28px) scale(0.7) rotate(-8deg)", opacity: 0 },
      ],
      { duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  };

  const toggle = (id, button, big) => {
    audioRef.current?.wake();
    const was = liked.has(id);
    const next = new Set(liked);
    if (was) next.delete(id);
    else next.add(id);
    setLiked(next);
    if (was) {
      animateUnlike(button);
      audioRef.current?.unlike();
      return;
    }
    animateLike(button, big);
    audioRef.current?.like(big);
    const [x, y] = originOf(button);
    burstRef.current?.burst(x, y, { big });
  };

  const likeFromCover = (e) => {
    const id = TRACKS[current].id;
    audioRef.current?.wake();
    const heart = bigHeartRef.current;
    const [hx, hy] = originOf(null, e.clientX, e.clientY);
    heart.style.left = `${hx}px`;
    heart.style.top = `${hy}px`;
    heart.animate(
      [
        { transform: "translate(-50%, -50%) scale(0) rotate(-12deg)", opacity: 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        { transform: "translate(-50%, -50%) scale(1.18) rotate(4deg)", opacity: 1, offset: 0.2, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
        { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1, offset: 0.36 },
        { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1, offset: 0.68, easing: "cubic-bezier(0.55, 0, 0.75, 0.4)" },
        { transform: "translate(-50%, -90%) scale(1.25) rotate(0deg)", opacity: 0 },
      ],
      { duration: 1200, easing: "linear" },
    );
    burstRef.current?.burst(hx, hy, { big: true });
    audioRef.current?.like(true);
    if (!liked.has(id)) {
      const next = new Set(liked);
      next.add(id);
      setLiked(next);
      const main = rootRef.current.querySelector(".like-burst-main .like-burst-heart");
      if (main) animateLike(main, true);
    }
  };

  const onCoverPointerUp = (e) => {
    const tap = tapRef.current;
    const now = e.timeStamp;
    if (now - tap.at < 320 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 32) {
      tapRef.current = { at: 0, x: 0, y: 0 };
      likeFromCover(e);
      return;
    }
    tapRef.current = { at: now, x: e.clientX, y: e.clientY };
  };

  const track = TRACKS[current];
  const isLiked = liked.has(track.id);
  const count = track.count + (isLiked ? 1 : 0);
  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="like-burst" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="like-burst-head">
          <h1 className="like-burst-title">Like Burst</h1>
          <p className="like-burst-hint">Tap the heart, or double-tap the cover. Unlike to watch it drain.</p>
        </header>
      )}

      <section className="like-burst-card">
        <div className="like-burst-cover" onPointerUp={onCoverPointerUp}>
          <img src={ALBUM.cover} alt={`${ALBUM.title} by ${ALBUM.artist}`} draggable={false} />
        </div>

        <div className="like-burst-info">
          <div className="like-burst-main">
            <div className="like-burst-now">
              <p className="like-burst-song">{track.title}</p>
              <p className="like-burst-meta">
                {ALBUM.artist} · {ALBUM.title} · {ALBUM.year}
              </p>
            </div>
            <div className="like-burst-action">
              <HeartButton liked={isLiked} label={isLiked ? `Unlike ${track.title}` : `Like ${track.title}`} onToggle={(el) => toggle(track.id, el, true)} />
              <p className="like-burst-count">
                <Roll text={fmt(count)} className="like-burst-count-num" />
                <span className="like-burst-count-unit">likes</span>
              </p>
            </div>
          </div>

          <ol className="like-burst-list">
            {TRACKS.map((t, i) => {
              const on = liked.has(t.id);
              return (
                <li key={t.id} className="like-burst-row" data-current={i === current ? "" : undefined}>
                  <button type="button" className="like-burst-pick" onClick={() => setCurrent(i)} aria-current={i === current ? "true" : undefined}>
                    <span className="like-burst-n">{t.n}</span>
                    <span className="like-burst-row-title">{t.title}</span>
                    <Roll text={short(t.count + (on ? 1 : 0))} className="like-burst-row-count" />
                  </button>
                  <HeartButton size="small" liked={on} label={on ? `Unlike ${t.title}` : `Like ${t.title}`} onToggle={(el) => toggle(t.id, el, false)} />
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div ref={layerRef} className="like-burst-layer" aria-hidden="true" />
      <div ref={bigHeartRef} className="like-burst-bigheart" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d={HEART} />
        </svg>
      </div>
    </Root>
  );
}
