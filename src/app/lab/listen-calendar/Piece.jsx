"use client";

import { useEffect, useRef, useState } from "react";

import { CALENDAR } from "./calendarData";
import { createLens } from "./lens";
import "./listen-calendar.css";

const { days, months, stats, year } = CALENDAR;
const LOUPE_W = 288;
const fmtInt = (n) => n.toLocaleString("en-US");
const hours = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function Loupe({ day, anchor, pinned, onClose }) {
  if (!day) return null;
  const lead = day.songs[0];
  return (
    <div
      className="lc-loupe"
      data-pinned={pinned ? "true" : "false"}
      data-fresh={anchor.fresh ? "true" : "false"}
      style={{ "--x": `${anchor.x}px`, "--y": `${anchor.y}px` }}
      role="dialog"
      aria-label={day.dateLabel}
    >
      <div key={day.i} className="lc-loupe-body">
        <div className="lc-loupe-head">
          {lead ? <img className="lc-loupe-cover" src={lead.cover} alt="" draggable={false} /> : <span className="lc-loupe-cover lc-loupe-cover--empty" />}
          <div className="lc-loupe-meta">
            <p className="lc-loupe-date text-heading-sm">{day.dateLabel}</p>
            <p className="lc-loupe-sub text-ui tabular-nums">
              {day.plays ? `${hours(day.minutes)} · ${day.plays} plays` : "No listening"}
            </p>
            {lead && <p className="lc-loupe-album text-ui">Mostly {day.album.title}</p>}
          </div>
          {pinned && (
            <button type="button" className="lc-loupe-close" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          )}
        </div>
        {day.songs.length > 0 && (
          <ol className="lc-songs">
            {day.songs.map((s, i) => (
              <li key={i} className="lc-song" style={{ "--i": i }}>
                <span className="lc-song-time font-mono text-ui tabular-nums">{s.time}</span>
                <img src={s.cover} alt="" draggable={false} />
                <span className="lc-song-title text-ui">{s.title}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [focusIndex, setFocusIndex] = useState(() => days.findIndex((d) => d.plays && d.level === 4));

  useEffect(() => {
    const lens = createLens(gridRef.current);
    return () => lens.destroy();
  }, []);

  const anchorFor = (i, fresh) => {
    const root = rootRef.current;
    const el = gridRef.current?.querySelector(`[data-day="${i}"]`);
    if (!root || !el) return { x: 0, y: 0, fresh: true };
    const rr = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const w = rr.width;
    if (w < 640) return { x: 16, y: rr.height - 16, fresh, sheet: true };
    let x = r.right - rr.left + 20;
    if (x + LOUPE_W > w - 16) x = r.left - rr.left - 20 - LOUPE_W;
    const y = Math.min(Math.max(r.top - rr.top - 24, 16), rr.height - 300);
    return { x: Math.round(x), y: Math.round(y), fresh };
  };

  const showHover = (i) => {
    if (hover?.i === i) return;
    setHover({ i, anchor: anchorFor(i, !hover && !pinned) });
  };

  const onOver = (e) => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest("[data-day]");
    if (el) showHover(Number(el.dataset.day));
  };

  const pin = (i) => {
    setPinned(pinned?.i === i ? null : { i, anchor: anchorFor(i, !pinned && !hover) });
    setFocusIndex(i);
  };

  const onKey = (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 }[e.key];
    if (step) {
      e.preventDefault();
      const next = Math.min(days.length - 1, Math.max(0, focusIndex + step));
      setFocusIndex(next);
      gridRef.current?.querySelector(`[data-day="${next}"]`)?.focus();
      setHover({ i: next, anchor: anchorFor(next, false) });
    } else if (e.key === "Escape") {
      setPinned(null);
      setHover(null);
    }
  };

  const active = hover ?? pinned;
  const day = active ? days[active.i] : null;

  return (
    <div ref={rootRef} className="lc" data-embedded={embedded ? "true" : "false"}>
      <div className="lc-scroll" data-scroll-contain>
        <div className="lc-column">
          <header className="lc-head">
            {!embedded && <h1 className="lc-heading text-title">{year} in listening</h1>}
            <dl className="lc-stats">
              <div>
                <dt className="text-ui-lg">Minutes</dt>
                <dd className="text-title-sm tabular-nums">{fmtInt(stats.minutes)}</dd>
              </div>
              <div>
                <dt className="text-ui-lg">Days listened</dt>
                <dd className="text-title-sm tabular-nums">{stats.active}</dd>
              </div>
              <div>
                <dt className="text-ui-lg">Longest streak</dt>
                <dd className="text-title-sm tabular-nums">{stats.longest} days</dd>
              </div>
              <div>
                <dt className="text-ui-lg">Most played</dt>
                <dd className="lc-top text-title-sm">
                  <img src={stats.top.cover} alt="" draggable={false} />
                  <span>{stats.top.title}</span>
                </dd>
              </div>
            </dl>
          </header>

          <div className="lc-calendar">
            <div className="lc-months" aria-hidden="true">
              {months.map((m) => (
                <span key={m.name} className="lc-month text-ui" style={{ "--w": m.week }}>
                  {m.name}
                </span>
              ))}
            </div>
            <div className="lc-weekdays" aria-hidden="true">
              <span className="text-ui" style={{ "--d": 1 }}>
                Mon
              </span>
              <span className="text-ui" style={{ "--d": 3 }}>
                Wed
              </span>
              <span className="text-ui" style={{ "--d": 5 }}>
                Fri
              </span>
            </div>
            <div
              ref={gridRef}
              className="lc-grid"
              role="grid"
              aria-label={`Listening in ${year}`}
              onPointerOver={onOver}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKey}
            >
              {days.map((d) => (
                <button
                  key={d.i}
                  type="button"
                  data-day={d.i}
                  data-level={d.level}
                  data-on={active?.i === d.i ? "true" : "false"}
                  className="lc-day"
                  tabIndex={d.i === focusIndex ? 0 : -1}
                  aria-label={`${d.shortLabel}, ${d.plays ? `${d.plays} plays, mostly ${d.album.title}` : "no listening"}`}
                  style={{ "--w": d.week, "--d": d.weekday, "--s": `url(${d.album?.cover ?? ""})`, "--delay": `${d.week * 9}ms` }}
                  onClick={() => pin(d.i)}
                  onFocus={() => setFocusIndex(d.i)}
                >
                  {d.album ? <span className="lc-art" /> : <span className="lc-dot" />}
                </button>
              ))}
            </div>
          </div>

          <div className="lc-legend text-ui" aria-hidden="true">
            <span>Less</span>
            {[1, 2, 3, 4].map((l) => (
              <span key={l} className="lc-day lc-day--legend" data-level={l} style={{ "--s": `url(${stats.top.cover})` }}>
                <span className="lc-art" />
              </span>
            ))}
            <span>More</span>
          </div>
        </div>
      </div>

      <Loupe day={day} anchor={active?.anchor ?? { x: 0, y: 0 }} pinned={Boolean(pinned) && active === pinned} onClose={() => setPinned(null)} />
    </div>
  );
}
