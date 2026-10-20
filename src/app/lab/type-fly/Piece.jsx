"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { closeAudio, flick, wakeAudio } from "./whoosh";

import "./type-fly.css";

const LIFT_K = 240;
const LIFT_C = 2 * Math.sqrt(LIFT_K) * 0.92;
const TAP_SLOP = 8;
const MAX_LINES = 3;
const SHOWN = 6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function trackEm(fs) {
  return (-0.043 * (fs - 12)) / fs;
}

function recordsFrom(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const cover = t.imageLarge || t.image;
    if (!cover || seen.has(cover)) continue;
    seen.add(cover);
    out.push({ id: t.id ?? cover, title: t.album || t.title, byline: t.year ? `${t.artist}, ${t.year}` : t.artist, cover });
    if (out.length === SHOWN) break;
  }
  return out;
}

function fitTitle(title, width, height, family) {
  const canvas = fitTitle.canvas || (fitTitle.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = `600 100px ${family}`;
  const words = title.split(" ");
  const measure = (w) => ctx.measureText(w).width;
  const wordW = words.map(measure);
  const spaceW = measure(" ");
  const counts = words.map((w) => Array.from(w).length);
  for (let fs = 160; fs >= 32; fs -= 2) {
    const k = fs / 100;
    const tr = trackEm(fs) * fs;
    const lh = Math.round((fs * 0.96) / 4) * 4;
    let lines = 1;
    let run = 0;
    let ok = true;
    for (let i = 0; i < words.length; i += 1) {
      const w = wordW[i] * k + counts[i] * tr;
      if (w > width) {
        ok = false;
        break;
      }
      const add = run === 0 ? w : run + spaceW * k + w;
      if (add > width) {
        lines += 1;
        run = w;
      } else {
        run = add;
      }
    }
    if (ok && lines <= MAX_LINES && lines * lh <= height) return { fs, lh };
  }
  return { fs: 32, lh: 32 };
}

function offsetIn(el, stop) {
  let x = 0;
  let y = 0;
  let node = el;
  while (node && node !== stop) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  return [x, y];
}

function pairUp(from, to) {
  const n = from.length;
  const m = to.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = from[i].ch === to[j].ch ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (from[i].ch === to[j].ch) {
      pairs.set(j, i);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  const used = new Set(pairs.values());
  for (let b = 0; b < m; b += 1) {
    if (pairs.has(b)) continue;
    let best = -1;
    let bestD = Infinity;
    for (let a = 0; a < n; a += 1) {
      if (used.has(a) || from[a].ch !== to[b].ch) continue;
      const d = Math.abs(a / Math.max(1, n - 1) - b / Math.max(1, m - 1));
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (best >= 0) {
      pairs.set(b, best);
      used.add(best);
    }
  }
  return pairs;
}

function Chars({ text, part }) {
  return text.split(" ").map((w, wi) => (
    <span key={wi} className="tf-word" aria-hidden="true">
      {Array.from(w).map((c, ci) => (
        <span key={ci} className="tf-ch" data-part={part}>
          {c}
        </span>
      ))}
    </span>
  ));
}

function Title({ record, id, role }) {
  return (
    <div className="tf-set" data-id={id} data-role={role} aria-hidden={role === "out" ? "true" : undefined}>
      <p className="tf-name" aria-label={record.title}>
        <Chars text={record.title} part="name" />
      </p>
      <p className="tf-byline" aria-label={record.byline}>
        <Chars text={record.byline} part="byline" />
      </p>
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(40);
  const records = useMemo(() => recordsFrom(tracks), [tracks]);
  const rootRef = useRef(null);
  const areaRef = useRef(null);
  const coverRef = useRef(null);
  const simRef = useRef(null);
  const pressRef = useRef(null);
  const seq = useRef(1);
  const [state, setState] = useState({ list: null, sets: [], dir: 1 });
  const sets = state.list === records ? state.sets : [{ id: 0, index: 0, role: "in" }];
  const current = sets[sets.length - 1];
  const index = current.index;
  const record = records[index] ?? records[0];

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sim = {
      sets: new Map(),
      inId: null,
      dir: 1,
      pointer: null,
      pressed: false,
      clock: 0,
      last: 0,
      raf: 0,
      family: getComputedStyle(area).fontFamily,
      onDone: (id) => setState((s) => ({ ...s, sets: s.sets.filter((x) => x.id !== id) })),
    };
    simRef.current = sim;

    const measure = (rec) => {
      const box = area.getBoundingClientRect();
      const { fs, lh } = fitTitle(rec.title, box.width * 0.96, box.height - rec.bylineH - 16, sim.family);
      rec.el.style.setProperty("--tf-fs", `${fs}px`);
      rec.el.style.setProperty("--tf-lh", `${lh}px`);
      rec.el.style.setProperty("--tf-track", `${trackEm(fs).toFixed(4)}em`);
      rec.fs = fs;
      rec.w = box.width;
      rec.letters.forEach((l) => {
        l.size = l.part === "name" ? fs : 24;
        const [ox, oy] = offsetIn(l.el, area);
        l.rx = ox + l.el.offsetWidth / 2;
        l.ry = oy + l.el.offsetHeight / 2;
      });
    };
    sim.measure = measure;

    const now = () => sim.clock;

    const stateOf = (l) => {
      const base = { x: l.rx, y: l.ry, z: 0, s: 1, ax: 0, ay: 0, az: 0, o: 1 };
      const tw = l.tw;
      if (!tw) return base;
      if (tw.hidden) return { ...base, o: 0 };
      const to = tw.toRest ? base : tw.to;
      const t = clamp((now() - tw.t0) / tw.dur, 0, 1);
      const e = tw.ease(t);
      const arc = Math.sin(Math.PI * e);
      const oe = tw.fade === "out" ? smooth(0.42, 1, t) : tw.fade === "in" ? smooth(0, 0.46, t) : e;
      return {
        x: lerp(tw.from.x, to.x, e),
        y: lerp(tw.from.y, to.y, e) - arc * tw.liftY,
        z: lerp(tw.from.z, to.z, e) + arc * tw.liftZ,
        s: lerp(tw.from.s, to.s, e),
        ax: lerp(tw.from.ax, to.ax, e) + arc * tw.tilt,
        ay: lerp(tw.from.ay, to.ay, e),
        az: lerp(tw.from.az, to.az, e),
        o: lerp(tw.from.o, to.o, oe),
        t,
      };
    };

    const exitOf = (l, dir, rec) => {
      const [s0, s1, s2, s3] = l.seed;
      const reach = Math.min(rec.w * 0.34, l.size * 3) * (1 + s0 * 0.35);
      return {
        x: l.rx - dir * reach,
        y: l.ry - l.size * (0.9 + s1 * 0.5),
        z: -Math.min(620, l.size * 6) * (1 + s2 * 0.4),
        s: 1,
        ax: 34 + s3 * 16,
        ay: dir * (46 + s1 * 18),
        az: dir * (s2 - 0.5) * 10,
        o: 0,
      };
    };

    const enterOf = (l, dir, rec) => {
      const [s0, s1, s2, s3] = l.seed;
      const reach = Math.min(rec.w * 0.3, l.size * 2.6) * (1 + s0 * 0.35);
      return {
        x: l.rx + dir * reach,
        y: l.ry + l.size * (0.6 + s1 * 0.4),
        z: -Math.min(620, l.size * 6) * (1 + s2 * 0.4),
        s: 1,
        ax: -(30 + s3 * 16),
        ay: -dir * (46 + s1 * 18),
        az: -dir * (s2 - 0.5) * 10,
        o: 0,
      };
    };

    const leave = (rec, dir, keep) => {
      const live = rec.letters.filter((l) => !keep.has(l));
      live.forEach((l, k) => {
        if (l.tw?.hidden) return;
        const from = stateOf(l);
        if (from.o < 0.002) {
          l.tw = { hidden: true };
          return;
        }
        const order = dir > 0 ? k : live.length - 1 - k;
        l.tw = { from, to: exitOf(l, dir, rec), t0: now() + (reduce ? 0 : order * Math.min(0.016, 0.24 / live.length)), dur: reduce ? 0.001 : 0.62, ease: easeIn, fade: "out", liftY: 0, liftZ: 0, tilt: 0 };
      });
    };

    const arrive = (rec, prev, dir, first) => {
      const handed = new Set();
      const parts = ["name", "byline"];
      for (const part of parts) {
        const to = rec.letters.filter((l) => l.part === part);
        const from = prev ? prev.letters.filter((l) => l.part === part && !l.tw?.hidden && stateOf(l).o > 0.5) : [];
        const pairs = pairUp(from, to);
        const span = Math.max(1, to.length - 1);
        to.forEach((l, j) => {
          const order = (dir > 0 ? j : span - j) / span;
          const delay = (first ? 0.25 : 0.04) + order * (part === "name" ? 0.3 : 0.2);
          const src = pairs.has(j) ? from[pairs.get(j)] : null;
          if (src) {
            const s = stateOf(src);
            handed.add(src);
            src.tw = { hidden: true };
            const from0 = { ...s, s: (s.s * src.size) / l.size, o: 1 };
            const dist = Math.hypot(from0.x - l.rx, from0.y - l.ry);
            l.tw = {
              from: from0,
              toRest: true,
              t0: now() + (reduce ? 0 : delay * 0.6),
              dur: reduce ? 0.001 : 0.6 + Math.min(0.2, dist / 2000),
              ease: inOut,
              fade: null,
              liftY: Math.min(l.size * 0.5, 16 + dist * 0.18),
              liftZ: Math.min(160, 40 + dist * 0.4),
              tilt: -14,
            };
          } else {
            l.tw = { from: enterOf(l, dir, rec), toRest: true, t0: now() + (reduce ? 0 : delay * 0.6 + 0.1), dur: reduce ? 0.001 : 0.7, ease: easeOut, fade: "in", liftY: 0, liftZ: 0, tilt: 0 };
          }
        });
      }
      return handed;
    };

    const adopt = () => {
      let incoming = null;
      area.querySelectorAll(".tf-set").forEach((el) => {
        const id = Number(el.dataset.id);
        const role = el.dataset.role;
        let rec = sim.sets.get(id);
        if (rec && rec.title !== el.querySelector(".tf-name").getAttribute("aria-label")) {
          sim.sets.delete(id);
          if (sim.inId === id) sim.inId = null;
          rec = null;
        }
        if (!rec) {
          const chars = [...el.querySelectorAll(".tf-ch")];
          rec = {
            id,
            el,
            role: null,
            title: el.querySelector(".tf-name").getAttribute("aria-label"),
            bylineH: el.querySelector(".tf-byline").offsetHeight,
            letters: chars.map((ch, i) => ({
              el: ch,
              i,
              ch: ch.textContent,
              part: ch.dataset.part,
              tw: null,
              h: 0,
              hv: 0,
              rest: false,
              seed: [hash(id * 97 + i), hash(id * 131 + i * 3.1), hash(id * 17 + i * 7.7), hash(id * 3 + i * 1.9)],
            })),
          };
          sim.sets.set(id, rec);
          measure(rec);
        }
        if (role === "in" && rec.role !== "in") incoming = rec;
        rec.role = role;
      });
      for (const id of [...sim.sets.keys()]) {
        if (!area.querySelector(`.tf-set[data-id="${id}"]`)) sim.sets.delete(id);
      }
      if (incoming) {
        const prev = sim.inId != null ? sim.sets.get(sim.inId) : null;
        const first = !prev;
        const handed = arrive(incoming, prev && prev !== incoming ? prev : null, sim.dir, first);
        if (prev && prev !== incoming) leave(prev, sim.dir, handed);
        sim.inId = incoming.id;
      }
    };
    sim.adopt = adopt;

    const render = (dt) => {
      const ptr = sim.pointer;
      for (const rec of sim.sets.values()) {
        let busy = false;
        const isIn = rec.id === sim.inId;
        for (const l of rec.letters) {
          const st = stateOf(l);
          const moving = l.tw && !l.tw.hidden && st.t < 1;
          if (moving) busy = true;
          let hTarget = 0;
          if (ptr && isIn && !moving) {
            const reach = Math.max(l.size * 1.5, 64);
            const d = Math.hypot(ptr.x - l.rx, (ptr.y - l.ry) * 1.15) / reach;
            hTarget = Math.pow(clamp(1 - d, 0, 1), 1.3) * (sim.pressed ? 1.25 : 0.6);
          }
          const steps = 2;
          for (let s = 0; s < steps; s += 1) {
            l.hv += ((hTarget - l.h) * LIFT_K - l.hv * LIFT_C) * (dt / steps);
            l.h += l.hv * (dt / steps);
          }
          if (l.tw?.hidden) {
            if (!l.gone) {
              l.gone = true;
              l.rest = false;
              l.el.style.opacity = "0";
              l.el.style.transform = "";
            }
            continue;
          }
          const lift = l.h;
          let { x, y, z, ax, ay, az } = st;
          if (lift > 0.0005) {
            const lean = ptr ? clamp((l.rx - ptr.x) / Math.max(l.size, 40), -1, 1) : 0;
            z += lift * l.size * 0.7;
            y -= lift * l.size * 0.1;
            ax -= lift * 46;
            ay += lift * lean * 26;
            az += lift * lean * -4;
          }
          const still = !moving && Math.abs(lift) < 0.002 && Math.abs(l.hv) < 0.02 && st.o > 0.999;
          if (still) {
            if (!l.rest) {
              l.rest = true;
              l.h = 0;
              l.hv = 0;
              l.el.style.transform = "";
              l.el.style.opacity = "";
              l.el.removeAttribute("data-air");
            }
            continue;
          }
          if (l.rest) {
            l.rest = false;
            l.el.setAttribute("data-air", "");
          }
          l.el.style.transform = `translate3d(${(x - l.rx).toFixed(2)}px, ${(y - l.ry).toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${ax.toFixed(2)}deg) rotateY(${ay.toFixed(2)}deg) rotateZ(${az.toFixed(2)}deg) scale(${st.s.toFixed(4)})`;
          l.el.style.opacity = st.o >= 0.999 ? "" : st.o.toFixed(3);
        }
        if (rec.role === "out" && !busy && !rec.done) {
          rec.done = true;
          sim.onDone(rec.id);
        }
      }
    };

    const step = (ts) => {
      sim.raf = requestAnimationFrame(step);
      const dt = Math.min(1 / 20, sim.last ? (ts - sim.last) / 1000 : 1 / 60);
      sim.last = ts;
      sim.clock += dt;
      render(dt);
    };

    const relayout = () => sim.sets.forEach((rec) => measure(rec));
    const ro = new ResizeObserver(relayout);
    ro.observe(area);
    const onVisibility = () => {
      cancelAnimationFrame(sim.raf);
      sim.last = 0;
      if (!document.hidden) sim.raf = requestAnimationFrame(step);
    };
    document.addEventListener("visibilitychange", onVisibility);
    adopt();
    render(0);
    sim.raf = requestAnimationFrame(step);
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      sim.family = getComputedStyle(area).fontFamily;
      relayout();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(sim.raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      simRef.current = null;
      closeAudio();
    };
  }, []);

  useLayoutEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.dir = state.dir;
    sim.adopt();
  }, [sets, state.dir]);

  useLayoutEffect(() => {
    const box = coverRef.current;
    if (!box) return;
    const imgs = [...box.querySelectorAll("img")];
    const on = imgs.find((img) => img.dataset.index === String(index));
    if (!on || on.dataset.state === "on") return;
    const z = (Number(box.dataset.z) || 1) + 1;
    box.dataset.z = String(z);
    box.dataset.dir = state.dir > 0 ? "next" : "prev";
    imgs.forEach((img) => {
      if (img !== on && img.dataset.state === "on") img.dataset.state = "under";
    });
    on.style.transition = "none";
    on.dataset.state = "cued";
    on.style.zIndex = String(z);
    on.getBoundingClientRect();
    on.style.transition = "";
    on.dataset.state = "on";
    const done = (e) => {
      if (e.propertyName !== "clip-path" || on.dataset.state !== "on") return;
      imgs.forEach((img) => {
        if (img !== on && img.dataset.state === "under") img.dataset.state = "off";
      });
    };
    on.addEventListener("transitionend", done);
    return () => on.removeEventListener("transitionend", done);
  }, [index, state.dir]);

  const go = useCallback(
    (next, dirHint) => {
      setState((s) => {
        const list = s.list === records ? s.sets : [{ id: 0, index: 0, role: "in" }];
        const top = list[list.length - 1];
        const target = ((next % records.length) + records.length) % records.length;
        if (target === top.index) return s.list === records ? s : { list: records, sets: list, dir: s.dir };
        const kept = list.slice(-5).map((x) => ({ ...x, role: "out" }));
        const id = seq.current;
        seq.current += 1;
        const dir = dirHint ?? (target > top.index ? 1 : -1);
        return { list: records, sets: [...kept, { id, index: target, role: "in" }], dir };
      });
      flick();
    },
    [records],
  );

  useEffect(() => {
    const done = () => {
      pressRef.current = null;
    };
    window.addEventListener("blur", done);
    return () => window.removeEventListener("blur", done);
  }, []);

  const toArea = (event) => {
    const area = areaRef.current;
    if (!area) return null;
    const r = area.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  const onPointerMove = (event) => {
    const sim = simRef.current;
    if (!sim) return;
    const p = pressRef.current;
    if (event.pointerType === "mouse" || (p && p.id === event.pointerId)) sim.pointer = toArea(event);
    if (p && p.id === event.pointerId && Math.hypot(event.clientX - p.x, event.clientY - p.y) > TAP_SLOP) p.moved = true;
  };

  const onPointerDown = (event) => {
    const sim = simRef.current;
    if (!sim || event.button > 0) return;
    wakeAudio();
    if (event.target.closest(".tf-thumbs")) return;
    pressRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, onArt: Boolean(event.target.closest(".tf-hit")) };
    sim.pressed = true;
    sim.pointer = toArea(event);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      pressRef.current.free = true;
    }
  };

  const release = (event, cancelled) => {
    const sim = simRef.current;
    const p = pressRef.current;
    if (!sim || !p || p.id !== event.pointerId) return;
    pressRef.current = null;
    sim.pressed = false;
    if (event.pointerType !== "mouse") sim.pointer = null;
    if (!cancelled && !p.moved && p.onArt) go(index + 1, 1);
  };

  const onPointerLeave = (event) => {
    const sim = simRef.current;
    if (sim && event.pointerType === "mouse" && !pressRef.current) sim.pointer = null;
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      wakeAudio();
      go(index + 1, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      wakeAudio();
      go(index - 1, -1);
    } else if (event.key === "Enter" || event.key === " ") {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      wakeAudio();
      go(index + 1, 1);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="tf-root" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="tf-head">
          <h1 className="text-title-sm">Type Fly</h1>
        </header>
      )}
      <div
        className="tf-stage"
        tabIndex={0}
        role="group"
        aria-roledescription="record titles"
        aria-label={`${record.title}, ${record.byline}. Arrow keys change the record.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
      >
        <div className="tf-spread">
          <div ref={coverRef} className="tf-cover tf-hit">
            {records.map((a, i) => (
              <img
                key={a.id}
                src={a.cover}
                alt={i === index ? `${a.title} cover` : ""}
                aria-hidden={i === index ? undefined : "true"}
                data-index={i}
                data-state={i === 0 ? "on" : "off"}
                draggable={false}
              />
            ))}
          </div>
          <div className="tf-text">
            <nav className="tf-thumbs" aria-label="Records">
              {records.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className="tf-thumb"
                  aria-label={a.title}
                  aria-pressed={i === index}
                  onClick={() => {
                    wakeAudio();
                    go(i);
                  }}
                >
                  <img src={a.cover} alt="" draggable={false} />
                </button>
              ))}
            </nav>
            <div ref={areaRef} className="tf-area tf-hit">
              {sets.map((s) => (
                <Title key={s.id} id={s.id} role={s.role} record={records[s.index] ?? records[0]} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Root>
  );
}
