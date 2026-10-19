"use client";

import { useRef, useState } from "react";

import { CALENDAR } from "./calendarData";
import "./listen-calendar.css";

const { days, stats, year } = CALENDAR;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtInt = (n) => n.toLocaleString("en-US");
const duration = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const column = (d) => (d.weekday + 6) % 7;

const MONTHS = MONTH_NAMES.map((name, m) => {
  const list = days.filter((d) => d.month === m);
  const minutes = list.reduce((s, d) => s + d.minutes, 0);
  const top = list.reduce((best, d) => (d.minutes > best.minutes ? d : best), list[0]);
  return { name, short: name.slice(0, 3), days: list, lead: column(list[0]), minutes, top };
});
const MAX_MONTH = Math.max(...MONTHS.map((m) => m.minutes));
const START_MONTH = MONTHS.reduce((best, m, i) => (m.minutes > MONTHS[best].minutes ? i : best), 0);

function Detail({ day }) {
  const lead = day.songs[0];
  return (
    <div className="lc-detail" aria-live="polite">
      <div className="lc-detail-cover">
        {lead ? <img key={day.i} src={lead.cover} alt={`${day.album.title} cover`} draggable={false} /> : <span key={day.i} className="lc-detail-rest text-title-lg tabular-nums">{day.date}</span>}
      </div>
      <p className="lc-detail-date text-title-sm">{day.dateLabel}</p>
      <p className="lc-detail-meta text-ui-lg tabular-nums">
        {day.plays ? (
          <>
            {duration(day.minutes)} · {day.plays} plays · mostly <span className="lc-detail-album">{day.album.title}</span>
          </>
        ) : (
          "A quiet day, nothing played"
        )}
      </p>
      {day.songs.length > 0 && (
        <ol className="lc-songs">
          {day.songs.map((s, i) => (
            <li key={i} className="lc-song">
              <span className="lc-song-time text-ui-lg tabular-nums">{s.time}</span>
              <span className="lc-song-title text-ui-lg">{s.title}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const gridRef = useRef(null);
  const swipeRef = useRef(null);
  const [month, setMonth] = useState(START_MONTH);
  const [dir, setDir] = useState(0);
  const [selected, setSelected] = useState(MONTHS[START_MONTH].top.i);
  const [hover, setHover] = useState(null);

  const goMonth = (m, pick) => {
    const next = Math.max(0, Math.min(11, m));
    if (next === month) return;
    setDir(next > month ? 1 : -1);
    setMonth(next);
    setHover(null);
    setSelected(pick ?? MONTHS[next].top.i);
  };

  const select = (i, focus) => {
    const d = days[Math.max(0, Math.min(days.length - 1, i))];
    if (d.month !== month) {
      setDir(d.month > month ? 1 : -1);
      setMonth(d.month);
      setHover(null);
    }
    setSelected(d.i);
    if (focus) requestAnimationFrame(() => gridRef.current?.querySelector(`[data-day="${d.i}"]`)?.focus());
  };

  const onKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
    if (step) {
      e.preventDefault();
      setHover(null);
      select(selected + step, true);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const target = month + (e.key === "PageDown" ? 1 : -1);
      if (target >= 0 && target <= 11) select(MONTHS[target].top.i, true);
    }
  };

  const current = MONTHS[month];
  const shown = days[hover ?? selected];

  return (
    <div className="lc" data-embedded={embedded ? "true" : "false"}>
      <div className="lc-scroll" data-scroll-contain>
        <div className="lc-layout">
          <section className="lc-main">
            <header className="lc-head">
              <h1 className="lc-heading text-title">{year} in listening</h1>
              <p className="lc-stats text-ui-lg tabular-nums">
                {fmtInt(stats.minutes)} minutes · {stats.active} days · longest streak {stats.longest} days
              </p>
            </header>

            <div className="lc-months" role="tablist" aria-label="Months">
              {MONTHS.map((m, i) => (
                <button
                  key={m.name}
                  type="button"
                  role="tab"
                  aria-selected={i === month}
                  aria-label={`${m.name}, ${fmtInt(m.minutes)} minutes`}
                  className="lc-month"
                  onClick={() => goMonth(i)}
                >
                  <span className="lc-month-bar">
                    <span style={{ height: `${Math.max(8, (m.minutes / MAX_MONTH) * 100)}%` }} />
                  </span>
                  <span className="lc-month-label text-ui-lg">{m.short}</span>
                </button>
              ))}
            </div>

            <div className="lc-cal">
              <div className="lc-cal-head">
                <h2 className="lc-cal-title text-title-sm">{current.name}</h2>
                <p className="lc-cal-total text-ui-lg tabular-nums">{fmtInt(current.minutes)} min</p>
                <div className="lc-nav">
                  <button type="button" className="lc-arrow" aria-label="Previous month" disabled={month === 0} onClick={() => goMonth(month - 1)}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 3.5 5.5 8l4.5 4.5" />
                    </svg>
                  </button>
                  <button type="button" className="lc-arrow" aria-label="Next month" disabled={month === 11} onClick={() => goMonth(month + 1)}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 3.5 10.5 8 6 12.5" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="lc-weekdays" aria-hidden="true">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="text-ui-lg">
                    {w}
                  </span>
                ))}
              </div>
              <div
                key={month}
                ref={gridRef}
                className="lc-grid"
                data-dir={dir}
                role="grid"
                aria-label={`${current.name} ${year}`}
                onPointerLeave={() => setHover(null)}
                onPointerDown={(e) => {
                  swipeRef.current = e.pointerType === "mouse" ? null : [e.clientX, e.clientY];
                }}
                onPointerUp={(e) => {
                  const start = swipeRef.current;
                  swipeRef.current = null;
                  if (!start) return;
                  const dx = e.clientX - start[0];
                  if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(e.clientY - start[1]) * 1.5) goMonth(month + (dx < 0 ? 1 : -1));
                }}
                onKeyDown={onKey}
              >
                {current.days.map((d, k) => (
                  <button
                    key={d.i}
                    type="button"
                    data-day={d.i}
                    data-level={d.level}
                    data-selected={d.i === selected ? "true" : "false"}
                    className="lc-day"
                    style={k === 0 ? { gridColumnStart: current.lead + 1 } : undefined}
                    tabIndex={d.i === selected ? 0 : -1}
                    aria-label={`${d.dateLabel}, ${d.plays ? `${duration(d.minutes)}, mostly ${d.album.title}` : "nothing played"}`}
                    aria-pressed={d.i === selected}
                    onPointerMove={(e) => e.pointerType === "mouse" && hover !== d.i && setHover(d.i)}
                    onClick={() => {
                      setHover(null);
                      setSelected(d.i);
                    }}
                  >
                    {d.album ? <img src={d.album.cover} alt="" draggable={false} /> : <span className="lc-num text-ui-lg tabular-nums">{d.date}</span>}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="lc-side">
            <Detail day={shown} />
          </aside>
        </div>
      </div>
    </div>
  );
}
