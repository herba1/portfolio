"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { createVinylAudio } from "./vinylAudio";
import "./pull-vinyl.css";

const FIRST = 9;
const BATCH = 1;
const THRESHOLD = 128;
const HOLD = 156;
const MAX = 236;
const DISC_R = 54;
const ARRIVE = 780;
const LIVE_WAIT = 2500;
const DECODE_WAIT = 2500;

const HARD_DAY = albumById("a-hard-days-night");
const INCOMING = [
  "I'll Be Back",
  "Things We Said Today",
  "If I Fell",
  "And I Love Her",
  "Can't Buy Me Love",
  "A Hard Day's Night",
  "Tell Me Why",
  "Any Time at All",
  "I Should Have Known Better",
  "I'll Cry Instead",
  "When I Get Home",
  "You Can't Do That",
  "I'm Happy Just to Dance with You",
].map((title) => ({
  title,
  album: HARD_DAY.title,
  artist: HARD_DAY.artist,
  image: HARD_DAY.cover,
  imageLarge: HARD_DAY.cover,
}));

const decoded = new Map();

function decode(src) {
  if (!src) return Promise.resolve();
  if (decoded.has(src)) return decoded.get(src).ready;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  const ready = Promise.race([
    img.decode().catch(() => {}),
    new Promise((res) => window.setTimeout(res, DECODE_WAIT)),
  ]);
  decoded.set(src, { img, ready });
  return ready;
}

const easeOut = (u) => 1 - Math.pow(1 - u, 4);
const settle = (t, w) => 1 - (1 + w * t) * Math.exp(-w * t);
const span = (u, a, b) => Math.min(1, Math.max(0, (u - a) / (b - a)));
const lerp = (a, b, t) => a + (b - a) * t;

function toSong(track, n) {
  return {
    key: `s${n}`,
    title: track.title,
    meta: [track.album, track.artist].filter(Boolean).join(" · "),
    image: track.image || track.imageLarge,
    fresh: false,
  };
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(50);
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const zoneRef = useRef(null);
  const groupRef = useRef(null);
  const discRef = useRef(null);
  const sleeveRef = useRef(null);
  const spinRef = useRef(null);
  const engineRef = useRef(null);
  const poolRef = useRef(null);
  const nextRef = useRef(0);
  const firstTracksRef = useRef(null);
  const [items, setItems] = useState([]);
  const [phase, setPhase] = useState("loading");
  const [label, setLabel] = useState(null);

  useEffect(() => {
    if (!firstTracksRef.current) firstTracksRef.current = tracks;
    if (poolRef.current) return undefined;
    let alive = true;
    const adopt = () => {
      if (!alive || poolRef.current || !tracks.length) return;
      const first = Math.min(FIRST, tracks.length);
      const initial = tracks.slice(0, first).map((t, i) => toSong(t, i));
      const seen = new Set(initial.map((s) => s.title.toLowerCase()));
      const pool = [
        ...INCOMING.filter((t) => !seen.has(t.title.toLowerCase())),
        ...tracks.slice(first),
      ];
      poolRef.current = pool;
      nextRef.current = 0;
      const upcoming = toSong(pool[0], FIRST);
      Promise.all([
        ...initial.map((s) => decode(s.image)),
        decode(upcoming.image),
      ]).then(() => {
        if (!alive) return;
        setItems(initial.map((s) => ({ ...s, intro: true })));
        setLabel(upcoming.image);
        engineRef.current?.ready();
      });
      pool.forEach((t) => decode(t.image || t.imageLarge));
    };
    if (tracks !== firstTracksRef.current) {
      adopt();
      return () => {
        alive = false;
      };
    }
    const timer = window.setTimeout(adopt, LIVE_WAIT);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [tracks]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const audio = createVinylAudio();
    const st = {
      phase: "loading",
      pull: 0,
      y: 0,
      vy: 0,
      target: 0,
      out: 0,
      vout: 0,
      spin: 0,
      spinV: 0,
      armed: false,
      wheel: false,
      drag: null,
      loaded: false,
      arrive: null,
      wheelTimer: 0,
      timers: [],
      raf: 0,
      last: 0,
    };

    const go = (p) => {
      st.phase = p;
      setPhase(p);
    };

    const rubber = (d) => MAX * (1 - Math.exp(-Math.max(0, d) / 210));
    const unrubber = (y) =>
      Math.max(0, -210 * Math.log(1 - Math.min(0.999, Math.max(0, y) / MAX)));

    const setArmed = (armed) => {
      if (armed === st.armed) return;
      st.armed = armed;
      zoneRef.current.dataset.armed = armed ? "true" : "false";
    };

    const paintArrive = (now) => {
      const a = st.arrive;
      if (a.t0 === null && now !== null) a.t0 = now;
      const u =
        a.t0 === null ? 0 : Math.min(1, Math.max(0, (now - a.t0) / ARRIVE));
      const e = reduce ? 1 : easeOut(span(u, 0.18, 1));
      const es = reduce || u >= 1 ? 1 : settle((u * ARRIVE) / 1000, 11);
      const yOld = lerp(a.y0, a.blockH, e);
      const listY = yOld - a.blockH * e;
      listRef.current.style.transform = `translate3d(0, ${listY.toFixed(2)}px, 0)`;
      a.rows.forEach((li, i) => {
        li.style.height = `${(a.heights[i] * e).toFixed(2)}px`;
      });
      a.texts.forEach((el, i) => {
        const et = reduce
          ? 1
          : easeOut(span(u, 0.4 + i * 0.08, 0.92 + i * 0.08));
        el.style.transform = `translate3d(${(-(1 - et) * 104).toFixed(2)}%, 0, 0)`;
      });
      zoneRef.current.style.height = `${Math.ceil(yOld)}px`;
      const gx = lerp(0, a.dx, es);
      const gy = lerp(a.gy0, a.ty, es);
      const sc = lerp(1, a.scale, es);
      groupRef.current.style.transform = `translate3d(${gx.toFixed(2)}px, ${gy.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
      groupRef.current.style.setProperty("--pv-lift", (1 - es).toFixed(3));
      groupRef.current.style.setProperty(
        "--pv-radius",
        `${lerp(4, a.radius, es).toFixed(2)}px`,
      );
      paintDisc();
      return u >= 1;
    };

    const finishArrive = () => {
      const a = st.arrive;
      st.arrive = null;
      st.y = 0;
      st.vy = 0;
      st.target = 0;
      a.texts.forEach((el) => {
        el.style.transform = "";
      });
      a.rows.forEach((li) => {
        li.style.height = "";
        li.style.overflow = "";
      });
      if (a.thumb) a.thumb.style.visibility = "";
      const g = groupRef.current;
      g.style.zIndex = "";
      g.style.removeProperty("--pv-lift");
      g.style.removeProperty("--pv-radius");
      go("idle");
      engineRef.current?.arrived();
    };

    const paintDisc = () => {
      const out = Math.max(0, st.out);
      sleeveRef.current.style.transform = `translate3d(${(-36 * out).toFixed(2)}px, 0, 0)`;
      discRef.current.style.transform = `translate3d(${(40 * out).toFixed(2)}px, 0, 0)`;
      spinRef.current.style.transform = `rotate(${st.spin.toFixed(2)}deg)`;
    };

    const paint = (now) => {
      if (st.phase === "arriving" && st.arrive) {
        if (paintArrive(now)) finishArrive();
        else return;
      }
      const y = Math.max(0, st.y);
      listRef.current.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      zoneRef.current.style.height = `${Math.ceil(y)}px`;
      groupRef.current.style.transform = `translate3d(0, ${((y - 120) / 2).toFixed(2)}px, 0)`;
      groupRef.current.style.visibility = y < 0.5 ? "hidden" : "visible";
      paintDisc();
    };

    const loop = (now) => {
      const dt = Math.min(0.033, Math.max(0.001, (now - st.last) / 1000));
      st.last = now;
      if (st.phase === "pulling" && !st.wheel) {
        const goal = rubber(st.pull);
        st.vy = Math.max(
          -3000,
          Math.min(3000, (goal - st.y) / Math.max(dt, 0.004)),
        );
        st.y = goal;
      } else if (!st.arrive) {
        if (st.phase === "pulling") st.target = rubber(st.pull);
        const k = st.phase === "pulling" ? 900 : 170;
        const c = 2 * Math.sqrt(k);
        const n = Math.max(1, Math.ceil(dt * 240));
        for (let i = 0; i < n; i += 1) {
          st.vy += ((k * (st.target - st.y) - c * st.vy) * dt) / n;
          st.y += (st.vy * dt) / n;
        }
      }
      const outTarget =
        st.phase === "refreshing"
          ? 1
          : st.phase === "pulling"
            ? Math.min(1, Math.max(0, st.y) / THRESHOLD)
            : 0;
      const ko =
        st.phase === "pulling" ? 700 : st.phase === "returning" ? 160 : 260;
      const n2 = Math.max(1, Math.ceil(dt * 240));
      const before = st.out;
      for (let i = 0; i < n2; i += 1) {
        st.vout +=
          ((ko * (outTarget - st.out) - 2 * Math.sqrt(ko) * st.vout) * dt) / n2;
        st.out += (st.vout * dt) / n2;
      }
      const roll = (((st.out - before) * 76) / DISC_R) * (180 / Math.PI);
      const spinTarget = st.phase === "refreshing" ? 400 : 0;
      st.spinV +=
        (spinTarget - st.spinV) *
        Math.min(1, dt * (st.phase === "refreshing" ? 3 : 5));
      st.spin = (st.spin + st.spinV * dt + roll) % 360;
      if (st.phase === "pulling") {
        const armed = st.y >= THRESHOLD;
        if (armed && !st.armed) {
          audio.slide(0.035);
          if (navigator.vibrate) navigator.vibrate(6);
        }
        setArmed(armed);
      }
      paint(now);
      const idle =
        st.phase === "idle" &&
        Math.abs(st.y) < 0.2 &&
        Math.abs(st.vy) < 0.5 &&
        Math.abs(st.out) < 0.002 &&
        Math.abs(st.spinV) < 1;
      if (idle) {
        st.y = 0;
        st.vy = 0;
        st.out = 0;
        st.vout = 0;
        paint(now);
        st.raf = 0;
        return;
      }
      st.raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (st.raf) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(loop);
    };

    const later = (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      st.timers.push(id);
    };

    const arrive = () => {
      audio.slide(0.02);
      go("arriving");
      st.arrive = null;
      engineRef.current?.load();
      kick();
    };

    const comeBack = () => {
      st.loaded = false;
      audio.stopCrackle();
      go("returning");
      st.target = HOLD;
      kick();
      later(arrive, reduce ? 0 : 400);
    };

    const refresh = () => {
      go("refreshing");
      st.target = HOLD;
      st.loaded = false;
      setArmed(false);
      audio.startCrackle();
      kick();
      later(
        () => {
          if (st.drag?.active) st.loaded = true;
          else comeBack();
        },
        reduce ? 300 : 1500,
      );
    };

    const release = () => {
      const drag = st.drag;
      st.drag = null;
      if (st.phase === "refreshing") {
        st.target = HOLD;
        kick();
        if (st.loaded) comeBack();
        return;
      }
      if (st.phase !== "pulling" || !drag?.active) return;
      if (st.y >= THRESHOLD) {
        refresh();
      } else {
        go("idle");
        setArmed(false);
        st.target = 0;
        kick();
      }
    };

    const begin = (startY, id) => {
      audio.wake();
      if (st.phase === "loading") return;
      st.drag = { y: startY, base: 0, active: false, id };
      st.wheel = false;
    };

    const moveTo = (clientY) => {
      const drag = st.drag;
      if (!drag.active) {
        if (st.phase === "returning" || st.phase === "arriving") {
          drag.y = Math.min(drag.y, clientY);
          return false;
        }
        if (clientY - drag.y < 4 || scroller.scrollTop > 0) return false;
        drag.active = true;
        drag.y = clientY;
        if (st.phase === "refreshing") {
          drag.base = 0;
          drag.hold = true;
        } else {
          drag.base = unrubber(st.y);
          go("pulling");
        }
        kick();
      }
      const d = drag.base + (clientY - drag.y);
      if (drag.hold) {
        st.target = HOLD + 40 * (1 - Math.exp(-Math.max(0, d) / 120));
        kick();
      } else {
        st.pull = Math.max(0, d);
      }
      return true;
    };

    const onPointerDown = (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      if (scroller.scrollTop > 0) return;
      begin(e.clientY, e.pointerId);
    };
    const onPointerMove = (e) => {
      if (!st.drag || st.drag.id !== e.pointerId) return;
      if (moveTo(e.clientY) && !scroller.hasPointerCapture(e.pointerId))
        scroller.setPointerCapture(e.pointerId);
    };
    const onPointerUp = (e) => {
      if (!st.drag || st.drag.id !== e.pointerId) return;
      release();
    };

    const onTouchStart = (e) => {
      if (scroller.scrollTop > 0 || e.touches.length !== 1) return;
      begin(e.touches[0].clientY, "touch");
    };
    const onTouchMove = (e) => {
      if (!st.drag || st.drag.id !== "touch") return;
      if (moveTo(e.touches[0].clientY)) e.preventDefault();
    };
    const onTouchEnd = () => {
      if (!st.drag || st.drag.id !== "touch") return;
      release();
    };

    const onWheel = (e) => {
      if (scroller.scrollTop > 0 || st.drag) return;
      if (st.phase !== "idle" && st.phase !== "pulling") return;
      if (e.deltaY >= 0 && st.phase !== "pulling") return;
      e.preventDefault();
      audio.wake();
      if (st.phase !== "pulling") {
        st.pull = unrubber(st.y);
        st.wheel = true;
        go("pulling");
        kick();
      }
      st.pull = Math.max(0, st.pull - e.deltaY * 0.9);
      window.clearTimeout(st.wheelTimer);
      st.wheelTimer = window.setTimeout(() => {
        if (st.phase !== "pulling" || st.drag) return;
        st.drag = { active: true };
        release();
      }, 160);
    };

    engineRef.current = {
      ...engineRef.current,
      ready() {
        if (st.phase === "loading") go("idle");
      },
      trigger() {
        if (st.phase !== "idle") return;
        audio.wake();
        audio.slide(0.035);
        st.vy = 900;
        refresh();
      },
      committed(rows) {
        if (st.phase !== "arriving" || st.arrive) return;
        const list = listRef.current;
        const g = groupRef.current;
        const thumb = rows[0]?.querySelector("img") || null;
        const listY = Math.max(0, st.y);
        list.style.transform = `translate3d(0, ${listY.toFixed(2)}px, 0)`;
        const blockH = rows.reduce((h, li) => h + li.offsetHeight, 0);
        const sRect = scroller.getBoundingClientRect();
        const t = thumb?.getBoundingClientRect();
        const tx = t ? t.left - sRect.left : 24;
        const ty = t ? t.top - sRect.top + scroller.scrollTop - listY : 8;
        const tw = t ? t.width : 56;
        const a = {
          t0: null,
          y0: listY,
          blockH,
          rows,
          heights: rows.map((li) => li.offsetHeight),
          texts: rows.flatMap((li) =>
            Array.from(
              li.querySelectorAll(".pull-vinyl-song, .pull-vinyl-meta"),
            ),
          ),
          thumb,
          gy0: (listY - 120) / 2,
          dx: tx - g.offsetLeft,
          ty: ty - g.offsetTop,
          scale: tw / g.offsetWidth,
          radius: 6 / (tw / g.offsetWidth),
        };
        if (thumb) thumb.style.visibility = "hidden";
        rows.forEach((li) => {
          li.style.overflow = "hidden";
          li.style.height = "0px";
        });
        g.style.zIndex = "2";
        g.style.visibility = "visible";
        st.arrive = a;
        paintArrive(null);
        kick();
      },
    };

    paint(performance.now());
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", onPointerUp);
    scroller.addEventListener("pointercancel", onPointerUp);
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(st.raf);
      st.timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(st.wheelTimer);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("pointercancel", onPointerUp);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
      audio.destroy();
    };
  }, []);

  useEffect(() => {
    engineRef.current = {
      ...engineRef.current,
      load() {
        const pool = poolRef.current;
        const start = nextRef.current;
        const count = Math.min(BATCH, pool.length);
        const fresh = Array.from({ length: count }, (_, i) => ({
          ...toSong(pool[(start + i) % pool.length], FIRST + start + i),
          fresh: true,
        }));
        nextRef.current = start + count;
        Promise.all(fresh.map((s) => decode(s.image))).then(() => {
          setItems((prev) => [
            ...fresh,
            ...prev.map((it) => (it.fresh ? { ...it, fresh: false } : it)),
          ]);
        });
      },
      arrived() {
        const pool = poolRef.current;
        const n = nextRef.current;
        const upcoming = toSong(pool[n % pool.length], FIRST + n);
        decode(upcoming.image).then(() => setLabel(upcoming.image));
        setItems((prev) =>
          prev.length > FIRST + pool.length
            ? prev.slice(0, FIRST + pool.length)
            : prev,
        );
      },
    };
  }, []);

  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (!engine?.committed || !items.length || !items[0].fresh) return;
    const list = listRef.current;
    const rows = Array.from(list.children).filter(
      (li) => li.dataset.fresh !== undefined,
    );
    engine.committed(rows);
  }, [items]);

  const Root = embedded ? "div" : "main";

  return (
    <Root className="pull-vinyl" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="pull-vinyl-head">
          <h1 className="pull-vinyl-title">Pull Vinyl</h1>
        </header>
      )}

      <section className="pull-vinyl-screen" data-phase={phase}>
        <div className="pull-vinyl-bar">
          <h2 className="pull-vinyl-h">Recently added</h2>
          <button
            type="button"
            className="pull-vinyl-refresh"
            aria-label="Refresh"
            onClick={() => engineRef.current?.trigger()}
            disabled={phase !== "idle"}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2" />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="pull-vinyl-scroll"
          data-scroll-contain=""
        >
          <div
            ref={zoneRef}
            className="pull-vinyl-zone"
            data-armed="false"
            aria-hidden="true"
          />
          <div ref={groupRef} className="pull-vinyl-group" aria-hidden="true">
            <div ref={discRef} className="pull-vinyl-disc">
              <div ref={spinRef} className="pull-vinyl-spin">
                <span className="pull-vinyl-label">
                  {label ? <img src={label} alt="" draggable={false} /> : null}
                </span>
              </div>
              <span className="pull-vinyl-sheen" />
            </div>
            <div ref={sleeveRef} className="pull-vinyl-sleeve">
              {label ? <img src={label} alt="" draggable={false} /> : null}
            </div>
          </div>

          <div
            className="pull-vinyl-deck"
            data-ready={items.length ? "" : undefined}
          >
            <ul ref={listRef} className="pull-vinyl-list" aria-live="polite">
              {items.map((it, i) => (
                <li
                  key={it.key}
                  className="pull-vinyl-item"
                  data-fresh={it.fresh ? "" : undefined}
                  data-intro={it.intro ? "" : undefined}
                  style={it.intro ? { "--pv-i": i } : undefined}
                >
                  <div className="pull-vinyl-row">
                    <img src={it.image} alt="" draggable={false} />
                    <span className="pull-vinyl-text">
                      <span className="pull-vinyl-song">{it.title}</span>
                      <span className="pull-vinyl-meta">{it.meta}</span>
                    </span>
                    {it.fresh ? (
                      <span className="pull-vinyl-sr">New</span>
                    ) : null}
                    <span className="pull-vinyl-new" aria-hidden="true" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </Root>
  );
}
