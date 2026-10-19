"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import { createBurstLayer } from "./burst";
import { createLikeAudio } from "./likeAudio";
import "./like-burst.css";

const ALBUM = albumById("abbey-road");
const TRACK = "Here Comes the Sun";
const BASE = 4109999;
const HEART = "M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.1 1.7-1.9 3.2-3.1 5.4-3.1 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z";
const fmt = (n) => n.toLocaleString("en-US");
const SNAP = "cubic-bezier(.22, 1, .36, 1)";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const layerRef = useRef(null);
  const heartRef = useRef(null);
  const coverRef = useRef(null);
  const bigHeartRef = useRef(null);
  const countRef = useRef(null);
  const burstRef = useRef(null);
  const audioRef = useRef(null);
  const tapRef = useRef({ at: 0, x: 0, y: 0 });
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    const burst = createBurstLayer(layerRef.current);
    const audio = createLikeAudio();
    burstRef.current = burst;
    audioRef.current = audio;
    return () => {
      burst.destroy();
      audio.destroy();
    };
  }, []);

  const centerOf = (el) => {
    const root = rootRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 - root.left, r.top + r.height / 2 - root.top];
  };

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const popHeart = () => {
    if (reduced()) return;
    const button = heartRef.current;
    button.querySelector(".like-burst-icon").animate(
      [
        { transform: "scale(0.6)", easing: SNAP },
        { transform: "scale(1.22)", offset: 0.4, easing: "cubic-bezier(.45, 0, .55, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: 480 },
    );
    button.querySelector(".like-burst-ring").animate(
      [
        { transform: "scale(0.7)", opacity: 1, borderWidth: "6px" },
        { transform: "scale(1.7)", opacity: 0, borderWidth: "1px" },
      ],
      { duration: 560, easing: SNAP },
    );
    countRef.current.animate([{ color: "#e0123f", transform: "translateY(-4px)" }, { color: "var(--color-ink)", transform: "none" }], { duration: 520, easing: SNAP });
  };

  const like = (big) => {
    setLiked(true);
    popHeart();
    audioRef.current?.like(big);
    if (!big) burstRef.current?.burst(...centerOf(heartRef.current), { big: false });
  };

  const onHeart = () => {
    audioRef.current?.wake();
    if (!liked) {
      like(false);
      return;
    }
    setLiked(false);
    audioRef.current?.unlike();
    if (!reduced()) {
      heartRef.current.querySelector(".like-burst-icon").animate([{ transform: "scale(0.82)" }, { transform: "scale(1)" }], { duration: 320, easing: SNAP });
    }
  };

  const bigLike = () => {
    audioRef.current?.wake();
    const heart = bigHeartRef.current;
    if (!reduced()) {
      heart.getAnimations().forEach((a) => a.cancel());
      heart.animate(
        [
          { transform: "translate(-50%, -50%) scale(0)", opacity: 1, easing: SNAP },
          { transform: "translate(-50%, -50%) scale(1.12)", opacity: 1, offset: 0.18, easing: "cubic-bezier(.45, 0, .55, 1)" },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.3 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.7, easing: "cubic-bezier(.55, 0, .75, .4)" },
          { transform: "translate(-50%, -50%) scale(1.3)", opacity: 0 },
        ],
        { duration: 1000 },
      );
      coverRef.current.animate([{ transform: "scale(1)" }, { transform: "scale(0.97)", offset: 0.25 }, { transform: "scale(1)" }], { duration: 420, easing: SNAP });
    }
    burstRef.current?.burst(...centerOf(coverRef.current), { big: true });
    if (liked) audioRef.current?.like(true);
    else like(true);
  };

  const onCoverPointerUp = (e) => {
    const tap = tapRef.current;
    if (e.timeStamp - tap.at < 340 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 32) {
      tapRef.current = { at: 0, x: 0, y: 0 };
      bigLike();
      return;
    }
    tapRef.current = { at: e.timeStamp, x: e.clientX, y: e.clientY };
  };

  const onCoverKey = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    bigLike();
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="like-burst" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="like-burst-head">
          <h1 className="like-burst-title">Like Burst</h1>
        </header>
      )}

      <section className="like-burst-card">
        <div
          ref={coverRef}
          className="like-burst-cover"
          role="button"
          tabIndex={0}
          aria-label={`Love ${TRACK}`}
          onPointerUp={onCoverPointerUp}
          onKeyDown={onCoverKey}
        >
          <img src={ALBUM.cover} alt={`${ALBUM.title} by ${ALBUM.artist}`} draggable={false} />
          <svg ref={bigHeartRef} className="like-burst-bigheart" viewBox="0 0 24 24" aria-hidden="true">
            <path d={HEART} />
          </svg>
        </div>

        <div className="like-burst-row">
          <div className="like-burst-now">
            <p className="like-burst-song">{TRACK}</p>
            <p className="like-burst-meta">
              {ALBUM.artist} · {ALBUM.title}
            </p>
          </div>
          <button
            ref={heartRef}
            type="button"
            className="like-burst-heart"
            data-liked={liked ? "" : undefined}
            aria-pressed={liked}
            aria-label={liked ? `Unlike ${TRACK}` : `Like ${TRACK}`}
            onClick={onHeart}
          >
            <span className="like-burst-ring" aria-hidden="true" />
            <svg className="like-burst-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d={HEART} />
            </svg>
          </button>
        </div>

        <p className="like-burst-count">
          <span ref={countRef} className="like-burst-count-num">
            {fmt(BASE + (liked ? 1 : 0))}
          </span>
          <span className="like-burst-count-unit">{liked ? "likes, including yours" : "likes"}</span>
        </p>
      </section>

      <div ref={layerRef} className="like-burst-layer" aria-hidden="true" />
    </Root>
  );
}
