"use client";

import { useEffect, useRef } from "react";

import { ALBUM, TRACK } from "./content";

import "./sheet.css";

// The screen, in its own points. Everything below is laid out at this size and
// the whole screen is scaled once to fit the box.
const W = 390;
const H = 844;
const FULL = 64; // sheet top at each detent
const HALF = 444; // 24pt under the album's meta line, so half frames the record whole
const PEEK = 732; // the track row and the home indicator's band
const DETENTS = [PEEK, HALF, FULL];
const HEAD = 88; // grabber and the track row: the part that is always out
const VIEW = H - FULL - HEAD; // the credits' scroll viewport at full

// The page behind, at full. It goes from 0 at half to 1 at full.
const CARD_DY = 52;
const CARD_SCALE = 0.94;
const SCREEN_R = 55;
const CARD_R = 12;
const DIM = 0.12;
const TINT_AT = 0.5; // the clock's midline sits at CARD_DY / 2

// Springs in UIKit terms: response (s) and damping ratio.
const spring = (response, damping) => ({
  k: (2 * Math.PI / response) ** 2,
  c: (4 * Math.PI * damping) / response,
});
const SETTLE = spring(0.44, 0.88);
const EDGE = spring(0.4, 1);
const STEP = 1 / 240;
const DECEL = 0.998; // per ms, UIScrollView normal rate

// Where a release at v (pt/s) would come to rest if nothing caught it.
const project = (v) => ((v / 1000) * DECEL) / (1 - DECEL);

// iOS rubber band: the further past the edge, the harder it pulls back.
const RC = 0.55;
const rubber = (x, d) => (1 - 1 / ((x * RC) / d + 1)) * d;
const TOP_BAND = 20; // past full the sheet gives at most this much, short of the clock
const unrubber = (r, d) => (r >= d * 0.999 ? 1e5 : (d / RC) * (1 / (1 - r / d) - 1));
const band = (v, lo, hi, d) => (v < lo ? lo - rubber(lo - v, d) : v > hi ? hi + rubber(v - hi, d) : v);
const unband = (v, lo, hi, d) => (v < lo ? lo - unrubber(lo - v, d) : v > hi ? hi + unrubber(v - hi, d) : v);
const sheetBand = (v) => band(v, FULL, PEEK, TOP_BAND);
const sheetUnband = (v) => unband(v, FULL, PEEK, TOP_BAND);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const nearest = (y) => DETENTS.reduce((best, d) => (Math.abs(d - y) < Math.abs(best - y) ? d : best), DETENTS[0]);

const velocityOf = (samples) => {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last.t - s.t <= 100) { first = s; break; }
  const dt = (last.t - first.t) / 1000;
  return dt > 0.004 ? (last.y - first.y) / dt : 0;
};

export default function Piece() {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const cardRef = useRef(null);
  const dimRef = useRef(null);
  const sheetRef = useRef(null);
  const headRef = useRef(null);
  const bodyRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const card = cardRef.current;
    const dim = dimRef.current;
    const sheet = sheetRef.current;
    const head = headRef.current;
    const body = bodyRef.current;
    const inner = scrollRef.current;
    const box = root.closest(".piece-box") || root;

    const s = {
      k: 1,
      top: PEEK, v: 0, target: PEEK, mode: "rest", // rest | drag | spring
      sc: 0, scv: 0, scMode: "rest", scMax: 0, // rest | drag | coast | edge
      g: null, wheel: null, raf: 0, last: 0,
    };

    const params = new URLSearchParams(window.location.search);
    if (params.has("y")) {
      const y = +params.get("y") || 0;
      s.top = sheetBand(PEEK + y * (FULL - PEEK));
      s.mode = "hold";
      root.dataset.dragging = "";
    }
    if (params.has("s")) s.sc = Math.max(0, +params.get("s") || 0);

    const measure = () => {
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const padY = h > 560 ? 40 : 16;
      s.k = Math.min(1, (h - 2 * padY) / H, (w - 32) / W);
      stage.style.width = `${W * s.k}px`;
      stage.style.height = `${H * s.k}px`;
      root.style.setProperty("--sh-k", s.k);
      s.scMax = Math.max(0, inner.offsetHeight - VIEW);
      s.sc = clamp(s.sc, 0, s.scMax);
      paint();
    };

    const paint = () => {
      const top = s.top;
      sheet.style.transform = `translate3d(0, ${top - FULL}px, 0)`;
      const p = clamp((HALF - top) / (HALF - FULL), 0, 1);
      const scale = 1 - (1 - CARD_SCALE) * p;
      card.style.transform = `translate3d(0, ${CARD_DY * p}px, 0) scale(${scale})`;
      card.style.borderRadius = `${SCREEN_R + (CARD_R - SCREEN_R) * p}px`;
      dim.style.opacity = `${DIM * p}`;
      // The clock flips its tint as a whole, the way iOS does, once the page's
      // edge has passed its midline: dark over the page, light over the black.
      const tint = p > TINT_AT ? "light" : "dark";
      if (root.dataset.tint !== tint) root.dataset.tint = tint;
      const sc = band(s.sc, 0, s.scMax, VIEW);
      inner.style.transform = `translate3d(0, ${-sc}px, 0)`;
      head.style.setProperty("--sh-rule", `${clamp(sc / 12, 0, 1)}`);
    };

    // ---- the loop -------------------------------------------------------
    const active = () => s.mode === "spring" || s.scMode === "coast" || s.scMode === "edge";
    const kick = () => {
      if (s.raf) return;
      s.last = performance.now();
      s.raf = requestAnimationFrame(frame);
    };
    const frame = (now) => {
      s.raf = 0;
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      for (let t = 0; t < dt; t += STEP) {
        const h = Math.min(STEP, dt - t);
        if (s.mode === "spring") {
          const a = -SETTLE.k * (s.top - s.target) - SETTLE.c * s.v;
          s.v += a * h;
          s.top += s.v * h;
        }
        if (s.scMode === "coast") {
          s.scv *= DECEL ** (h * 1000);
          s.sc += s.scv * h;
          if (s.sc < 0 || s.sc > s.scMax) s.scMode = "edge";
          else if (Math.abs(s.scv) < 4) s.scMode = "rest";
        } else if (s.scMode === "edge") {
          const to = clamp(s.sc, 0, s.scMax);
          const a = -EDGE.k * (s.sc - to) - EDGE.c * s.scv;
          s.scv += a * h;
          s.sc += s.scv * h;
        }
      }
      if (s.mode === "spring" && Math.abs(s.top - s.target) < 0.2 && Math.abs(s.v) < 4) {
        s.top = s.target;
        s.v = 0;
        s.mode = "rest";
      }
      if (s.scMode === "edge") {
        const to = clamp(s.sc, 0, s.scMax);
        if (Math.abs(s.sc - to) < 0.2 && Math.abs(s.scv) < 4) {
          s.sc = to;
          s.scv = 0;
          s.scMode = "rest";
        }
      }
      paint();
      if (active()) kick();
    };

    const settle = (v, to) => {
      s.v = v;
      s.target = to ?? nearest(s.top + project(v));
      s.mode = "spring";
      root.dataset.detent = String(DETENTS.indexOf(s.target));
      kick();
    };
    const step = (dir) => {
      const at = DETENTS.indexOf(s.mode === "spring" ? s.target : nearest(s.top));
      const next = clamp(at + dir, 0, DETENTS.length - 1);
      if (next !== at) settle(s.mode === "spring" ? s.v : 0, DETENTS[next]);
    };
    const releaseScroll = (v) => {
      s.scv = v;
      s.scMode = s.sc < 0 || s.sc > s.scMax ? "edge" : "coast";
      kick();
    };

    // ---- pointer --------------------------------------------------------
    const onDown = (e) => {
      if (e.button !== 0 || s.g) return;
      const inBody = body.contains(e.target);
      sheet.setPointerCapture(e.pointerId);
      // Catch whatever is moving, where it is.
      const atFull = Math.abs(s.top - FULL) < 1.5 || (s.mode === "spring" && s.target === FULL && Math.abs(s.top - FULL) < 24);
      const wasResting = s.mode === "rest" || s.mode === "hold";
      s.mode = "drag";
      s.v = 0;
      if (s.scMode !== "rest") s.scMode = "drag";
      s.g = {
        id: e.pointerId,
        y: e.clientY,
        y0: e.clientY,
        raw: sheetUnband(s.top),
        scRaw: s.sc,
        scrollable: inBody && atFull,
        moved: false,
        scrolling: false,
        onHead: head.contains(e.target),
        wasResting,
        samples: [{ t: e.timeStamp, y: e.clientY / s.k }],
      };
      delete root.dataset.still;
      root.dataset.dragging = "";
    };

    const onMove = (e) => {
      const g = s.g;
      if (!g || e.pointerId !== g.id) return;
      if (!g.moved && Math.abs(e.clientY - g.y0) < 3) return;
      g.moved = true;
      let dy = (e.clientY - g.y) / s.k;
      g.y = e.clientY;
      g.samples.push({ t: e.timeStamp, y: e.clientY / s.k });
      if (g.samples.length > 24) g.samples.shift();
      if (g.scrollable) {
        if (dy < 0) {
          // Finger up: the sheet goes back to full first, then the credits scroll.
          if (g.raw > FULL) {
            const m = Math.max(dy, FULL - g.raw);
            g.raw += m;
            dy -= m;
          }
          if (dy < 0) {
            g.scRaw -= dy;
            g.scrolling = true;
          }
        } else if (dy > 0) {
          // Finger down: the credits scroll back to the top, and only then
          // does the rest of the same movement take the sheet down.
          if (g.scRaw > 0) {
            const m = Math.min(dy, g.scRaw);
            g.scRaw -= m;
            dy -= m;
            g.scrolling = true;
          }
          if (dy > 0) {
            g.raw += dy;
            g.scrolling = false;
          }
        }
        s.sc = g.scRaw; // banded past the end at paint
      } else {
        g.raw += dy;
      }
      s.top = sheetBand(g.raw);
      paint();
    };

    const onUp = (e) => {
      const g = s.g;
      if (!g || e.pointerId !== g.id) return;
      s.g = null;
      delete root.dataset.dragging;
      if (!g.moved) {
        // A tap on the track row steps up, or down from full. A tap that
        // only caught the sheet lets it go to the nearest detent.
        const at = DETENTS.indexOf(nearest(s.top));
        const to = g.onHead && g.wasResting ? (at === DETENTS.length - 1 ? at - 1 : at + 1) : at;
        settle(0, DETENTS[to]);
        if (s.scMode === "drag") releaseScroll(0);
        return;
      }
      // Speed over the last 100ms of movement; a finger that stopped before
      // lifting has none left to give.
      const lastMove = g.samples[g.samples.length - 1];
      const v = e.type === "pointercancel" || e.timeStamp - lastMove.t > 90 ? 0 : velocityOf(g.samples);
      if (g.scrollable && g.scrolling && g.raw <= FULL + 0.5) {
        s.top = FULL;
        s.mode = "rest";
        releaseScroll(-v);
        paint();
        return;
      }
      if (s.scMode === "drag" || s.sc < 0 || s.sc > s.scMax) releaseScroll(0);
      settle(v);
    };

    // ---- wheel and trackpad ---------------------------------------------
    // One wheel gesture (events less than 160ms apart) either scrolls the
    // credits or moves the sheet, decided by where it starts.
    const onWheel = (e) => {
      e.preventDefault();
      const dy = (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) / s.k;
      const now = e.timeStamp;
      let w = s.wheel;
      if (!w || now - w.at > 160) {
        const atFull = Math.abs(s.top - FULL) < 1.5;
        const scroll = atFull && body.contains(e.target) && (dy > 0 || s.sc > 0);
        const from = DETENTS.indexOf(nearest(s.top));
        w = s.wheel = { at: now, scroll, from, raw: sheetUnband(s.top), samples: [], timer: 0 };
        if (!scroll) s.mode = "drag";
      }
      w.at = now;
      if (w.scroll) {
        s.scMode = "rest";
        s.sc = clamp(s.sc + dy, 0, s.scMax);
        paint();
        return;
      }
      s.mode = "drag";
      w.raw -= dy;
      s.top = sheetBand(w.raw);
      w.samples.push({ t: now, y: w.raw });
      if (w.samples.length > 24) w.samples.shift();
      paint();
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        if (s.wheel !== w || s.g) return;
        s.wheel = null;
        // A wheel's inertia has already run by the time it goes quiet, so
        // only a little of its last speed is carried into the choice, and one
        // wheel gesture moves at most one detent.
        const v = clamp(velocityOf(w.samples), -1600, 1600) * 0.4;
        const at = clamp(DETENTS.indexOf(nearest(s.top + project(v))), w.from - 1, w.from + 1);
        settle(v, DETENTS[at]);
      }, 140);
    };

    // ---- keys -----------------------------------------------------------
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape" || e.key === "ArrowDown") step(-1);
      else if (e.key === "ArrowUp") step(1);
      else return;
      e.preventDefault();
    };

    sheet.addEventListener("pointerdown", onDown);
    sheet.addEventListener("pointermove", onMove);
    sheet.addEventListener("pointerup", onUp);
    sheet.addEventListener("pointercancel", onUp);
    sheet.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    root.dataset.ready = "";

    let release = 0;
    if (s.mode === "hold" && params.has("v")) {
      release = setTimeout(() => {
        if (s.mode !== "hold") return;
        delete root.dataset.dragging;
        settle(-(+params.get("v") || 0));
      }, 700);
    }

    return () => {
      clearTimeout(release);
      if (s.wheel) clearTimeout(s.wheel.timer);
      cancelAnimationFrame(s.raf);
      ro.disconnect();
      sheet.removeEventListener("pointerdown", onDown);
      sheet.removeEventListener("pointermove", onMove);
      sheet.removeEventListener("pointerup", onUp);
      sheet.removeEventListener("pointercancel", onUp);
      sheet.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);


  return (
    <div className="sh-root" ref={rootRef} data-tint="dark">
      <div className="sh-stage" ref={stageRef}>
        <div className="sh-screen">
          <div className="sh-page" ref={cardRef}>
            <Album />
            <div className="sh-dim" ref={dimRef} />
          </div>

          <span className="sh-clock text-heading tabular-nums" aria-hidden>
            9:41
          </span>

          <section className="sh-sheet" ref={sheetRef} role="dialog" aria-label="Song credits">
            <div className="sh-grabber" aria-hidden />
            <div className="sh-head" ref={headRef}>
              <img className="sh-thumb" src={ALBUM.cover} alt="" draggable={false} />
              <div className="sh-head-text">
                <h2 className="sh-head-title text-heading">{TRACK.title}</h2>
                <p className="sh-head-sub text-ui-lg">{TRACK.by}</p>
              </div>
              <span className="sh-head-time text-ui-lg tabular-nums">{TRACK.length}</span>
            </div>
            <div className="sh-body" ref={bodyRef} data-scroll-contain>
              <div className="sh-scroll" ref={scrollRef}>
                <Credits />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Album() {
  return (
    <div className="sh-album">
      <img className="sh-cover" src={ALBUM.cover} alt="" draggable={false} />
      <h1 className="sh-album-title text-title-sm">{ALBUM.title}</h1>
      <p className="sh-album-artist text-title-sm">{ALBUM.artist}</p>
      <p className="sh-album-meta text-ui">{ALBUM.meta}</p>
      <ol className="sh-tracks">
        {ALBUM.tracks.map(([t, d], i) => (
          <li key={t} data-playing={i === ALBUM.playing ? "" : undefined}>
            <span className="sh-num text-ui-lg tabular-nums">
              {i === ALBUM.playing ? (
                <span className="sh-bars" aria-label="Playing">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                i + 1
              )}
            </span>
            <span className="sh-track-title text-body">{t}</span>
            <span className="sh-track-time text-ui-lg tabular-nums">{d}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const seconds = (d) => {
  const [m, s] = d.split(":").map(Number);
  return m * 60 + s;
};
const clock = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

// The back of the sleeve: one two-column grid for the whole block. Labels
// hang in the left column at the quiet weight, every value starts on the same
// left edge and shares its label's baseline, and a new group only adds space.
function Credits() {
  const total = clock(TRACK.side.reduce((sum, [, d]) => sum + seconds(d), 0));
  return (
    <dl className="sh-credits">
      {TRACK.credits.map(([k, v]) => (
        <Row key={k} label={k}>
          {v}
        </Row>
      ))}

      <Row label="Performed by" group>
        {TRACK.performers.map(([name, role]) => (
          <p key={name} className="sh-performer">
            <span className="sh-name">{name}</span>
            {" "}
            {role}
          </p>
        ))}
      </Row>

      <Row label="Notes" group>
        {TRACK.about.map((p) => (
          <p key={p.slice(0, 12)} className="sh-note">
            {p}
          </p>
        ))}
      </Row>

      <Row label={TRACK.sideLabel} group>
        <ol className="sh-side">
          {TRACK.side.map(([t, d], i) => (
            <li key={t} data-current={i === 0 ? "" : undefined}>
              <span>{t}</span>
              <span className="sh-dur tabular-nums">{d}</span>
            </li>
          ))}
          <li className="sh-total">
            <span className="sr-only">Total</span>
            <span className="sh-dur tabular-nums">{total}</span>
          </li>
        </ol>
      </Row>

      {TRACK.label.map(([k, v], i) => (
        <Row key={k} label={k} group={i === 0}>
          {v}
        </Row>
      ))}
    </dl>
  );
}

function Row({ label, group, children }) {
  const g = group ? "" : undefined;
  return (
    <>
      <dt className="sh-k text-ui-lg" data-group={g}>
        {label}
      </dt>
      <dd className="sh-v text-body" data-group={g}>
        {children}
      </dd>
    </>
  );
}
