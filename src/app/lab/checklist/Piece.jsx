"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import Roll from "./Roll";
import { sleep, springFor, wake } from "./loop";
import { OPENED_WITH, SETLIST, clock } from "./setlist";
import "./checklist.css";

const slideFor = (distance) =>
  springFor(Math.min(0.92, 0.44 + distance / 1300), 0.92);
const SUB = 1 / 240;
const SETTLE_MS = 900;
const RETURN_MS = 320;
const TOTAL = SETLIST.reduce((sum, song) => sum + song.length, 0);

function createFlip(reduced) {
  const item = {
    el: null,
    pos: 0,
    vel: 0,
    spring: slideFor(0),
    lifted: false,
    shift(by) {
      item.pos += by;
      item.spring = slideFor(Math.abs(item.pos));
      if (reduced()) {
        item.pos = 0;
        item.vel = 0;
        item.write();
        return;
      }
      item.write();
      wake(item);
    },
    write() {
      const el = item.el;
      if (!el) return;
      const lift = Math.abs(item.pos);
      el.style.transform =
        lift < 0.01 ? "" : `translate3d(0, ${item.pos.toFixed(2)}px, 0)`;
      el.style.zIndex =
        lift < 0.5 ? "" : String(1 + Math.min(40, Math.round(lift / 44)));
      const lifted = lift > 48;
      if (lifted !== item.lifted) {
        item.lifted = lifted;
        el.toggleAttribute("data-lift", lifted);
      }
    },
    step(dt) {
      let t = 0;
      while (t < dt) {
        const h = Math.min(SUB, dt - t);
        t += h;
        const a = -item.spring.k * item.pos - item.spring.c * item.vel;
        item.vel += a * h;
        item.pos += item.vel * h;
      }
      const moving = Math.abs(item.pos) > 0.05 || Math.abs(item.vel) > 0.5;
      if (!moving) {
        item.pos = 0;
        item.vel = 0;
      }
      item.write();
      return moving;
    },
  };
  return item;
}

function Tick() {
  return (
    <svg
      className="checklist__tick"
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
    >
      <path
        pathLength="1"
        d="M6.5 14.6c1.7 1.4 3.3 3.2 4.9 5.6c3.1-6.1 7.2-11.3 12.6-15.6"
      />
    </svg>
  );
}

function Strike() {
  return (
    <svg
      className="checklist__strike"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 4.9C18 3.7 33 5.3 51 4.1S84 4.6 99 3.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const Row = memo(function Row({ song, isDone, isSettled, onToggle }) {
  return (
    <li
      data-id={song.id}
      className="checklist__item"
      data-settled={isSettled || undefined}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        className="checklist__row"
        data-done={isDone || undefined}
        onClick={() => onToggle(song.id, isDone, isSettled)}
      >
        <span className="checklist__box">
          <Tick />
        </span>
        <span className="checklist__num">{song.number}</span>
        <span className="checklist__name">
          <span className="checklist__name-text">{song.title}</span>
          <Strike />
        </span>
        <span className="checklist__key">{song.key}</span>
        <span className="checklist__time">{clock(song.length)}</span>
      </button>
    </li>
  );
});

export default function Piece({ embedded = false }) {
  const listRef = useRef(null);
  const timers = useRef(new Map());
  const flips = useRef(new Map());
  const tops = useRef(new Map());
  const reducedRef = useRef(false);
  const [done, setDone] = useState(() => new Set(OPENED_WITH));
  const [settled, setSettled] = useState(() => new Set(OPENED_WITH));

  const upcoming = SETLIST.filter((s) => !settled.has(s.id));
  const played = SETLIST.filter((s) => settled.has(s.id));
  const order = [
    ...upcoming.map((s) => s.id),
    ...(played.length ? ["divider"] : []),
    ...played.map((s) => s.id),
  ];
  const orderKey = order.join("|");

  const left = SETLIST.length - done.size;
  const secondsLeft = SETLIST.reduce(
    (sum, s) => sum + (done.has(s.id) ? 0 : s.length),
    0,
  );
  const minutes = Math.floor(secondsLeft / 60);
  const timeText = `${String(minutes).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const countText = String(left).padStart(2, "0");

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = query.matches;
    const onChange = () => {
      reducedRef.current = query.matches;
    };
    query.addEventListener("change", onChange);
    const pending = timers.current;
    const moving = flips.current;
    return () => {
      query.removeEventListener("change", onChange);
      pending.forEach((id) => window.clearTimeout(id));
      moving.forEach((item) => sleep(item));
    };
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const moves = [];
    for (const el of list.children) {
      const id = el.dataset.id;
      const top = el.offsetTop;
      const prev = tops.current.get(id);
      tops.current.set(id, top);
      if (prev !== undefined && prev !== top) moves.push([id, el, prev - top]);
    }
    for (const [id, el, by] of moves) {
      let item = flips.current.get(id);
      if (!item) {
        item = createFlip(() => reducedRef.current);
        flips.current.set(id, item);
      }
      item.el = el;
      item.shift(by);
    }
    if (!order.includes("divider")) tops.current.delete("divider");
  }, [orderKey]);

  const later = useCallback((id, ms, fn) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        fn();
      }, ms),
    );
  }, []);

  const handOffFocus = useCallback((id) => {
    const list = listRef.current;
    const row = list?.querySelector(`[data-id="${id}"] .checklist__row`);
    if (!row || document.activeElement !== row) return;
    const rows = Array.from(list.querySelectorAll(".checklist__row"));
    const at = rows.indexOf(row);
    const next =
      rows[at + 1] && !rows[at + 1].closest("[data-settled]")
        ? rows[at + 1]
        : rows[at - 1];
    next?.focus({ preventScroll: true });
  }, []);

  const toggle = useCallback(
    (id, isDone, isSettled) => {
      if (isDone) {
        setDone((was) => {
          const next = new Set(was);
          next.delete(id);
          return next;
        });
        if (isSettled) {
          later(id, RETURN_MS, () =>
            setSettled((was) => {
              const next = new Set(was);
              next.delete(id);
              return next;
            }),
          );
        } else {
          window.clearTimeout(timers.current.get(id));
          timers.current.delete(id);
        }
        return;
      }
      setDone((was) => new Set(was).add(id));
      if (isSettled) {
        window.clearTimeout(timers.current.get(id));
        timers.current.delete(id);
        return;
      }
      later(id, SETTLE_MS, () => {
        handOffFocus(id);
        setSettled((was) => new Set(was).add(id));
      });
    },
    [later, handOffFocus],
  );

  const startOver = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current.clear();
    setDone(new Set());
    later("all", RETURN_MS, () => setSettled(new Set()));
  };

  const onKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(
      listRef.current?.querySelectorAll(".checklist__row") ?? [],
    );
    const at = rows.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next =
      rows[
        Math.min(
          rows.length - 1,
          Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)),
        )
      ];
    next?.focus();
  };

  return (
    <div className="checklist" data-embedded={embedded || undefined}>
      {!embedded && <h1 className="checklist__title">Setlist</h1>}
      <article className="checklist__sheet" aria-label="Tonight's setlist">
        <span
          className="checklist__tape checklist__tape--left"
          aria-hidden="true"
        />
        <span
          className="checklist__tape checklist__tape--right"
          aria-hidden="true"
        />
        <header className="checklist__head">
          <div className="checklist__venue">
            <h2 className="checklist__venue-name">Cavern Club</h2>
            <p className="checklist__venue-meta">
              Liverpool · Saturday, <em>16 February</em> 1963
            </p>
          </div>
          <div className="checklist__tally">
            <span className="checklist__count">
              <Roll
                text={countText}
                blank={left < 10 ? [0] : []}
                label={`${left} songs to go`}
              />
              <span className="checklist__count-label" aria-hidden="true">
                to go
              </span>
            </span>
            <span className="checklist__left">
              <Roll
                text={timeText}
                blank={minutes < 10 ? [0] : []}
                label={`${clock(secondsLeft)} left`}
              />
              <span aria-hidden="true"> left</span>
            </span>
          </div>
        </header>

        <ol
          className="checklist__list"
          ref={listRef}
          onKeyDown={onKeyDown}
          data-scroll-contain
        >
          {order.map((id) => {
            if (id === "divider") {
              return (
                <li
                  key="divider"
                  data-id="divider"
                  className="checklist__divider"
                  aria-hidden="true"
                >
                  <span>Played</span>
                </li>
              );
            }
            const song = SETLIST[Number(id.slice(5)) - 1];
            return (
              <Row
                key={id}
                song={song}
                isDone={done.has(id)}
                isSettled={settled.has(id)}
                onToggle={toggle}
              />
            );
          })}
        </ol>

        <footer className="checklist__foot">
          <span className="checklist__total">
            {SETLIST.length} songs · {clock(TOTAL)}
          </span>
          <button
            type="button"
            className="checklist__reset"
            onClick={startOver}
            disabled={done.size === 0}
          >
            Start over
          </button>
        </footer>
      </article>
    </div>
  );
}
