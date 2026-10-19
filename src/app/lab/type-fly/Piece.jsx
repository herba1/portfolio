"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import { closeAudio, flick, wakeAudio } from "./whoosh";

import "./type-fly.css";

const SET = ["abbey-road", "revolver", "rubber-soul", "let-it-be", "help", "magical-mystery-tour"].map((id) => albumById(id));

const ARRIVE_K = 70;
const ARRIVE_C = 2 * Math.sqrt(ARRIVE_K);
const LEAVE_K = 46;
const LEAVE_C = 2 * Math.sqrt(LEAVE_K) * 0.9;
const LIFT_K = 240;
const LIFT_C = 2 * Math.sqrt(LIFT_K) * 0.92;
const TAP_SLOP = 8;
const MAX_LINES = 3;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function trackEm(fs) {
  return (-0.043 * (fs - 12)) / fs;
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

function Title({ album, id, role }) {
  const words = album.title.split(" ");
  let n = 0;
  return (
    <div className="tf-set" data-id={id} data-role={role} aria-hidden={role === "out" ? "true" : undefined}>
      <p className="tf-name" aria-label={album.title}>
        {words.map((w, wi) => (
          <span key={wi} className="tf-word" aria-hidden="true">
            {Array.from(w).map((c, ci) => {
              n += 1;
              return (
                <span key={ci} className="tf-ch" data-n={n}>
                  {c}
                </span>
              );
            })}
          </span>
        ))}
      </p>
      <p className="tf-byline" aria-label={`${album.artist}, ${album.year}`}>
        {`${album.artist}, ${album.year}`.split(" ").map((w, wi) => (
          <span key={wi} className="tf-word" aria-hidden="true">
            {Array.from(w).map((c, ci) => {
              n += 1;
              return (
                <span key={ci} className="tf-ch" data-n={n}>
                  {c}
                </span>
              );
            })}
          </span>
        ))}
      </p>
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const areaRef = useRef(null);
  const simRef = useRef(null);
  const pressRef = useRef(null);
  const seq = useRef(1);
  const [sets, setSets] = useState([{ id: 0, index: 0, role: "in" }]);
  const current = sets[sets.length - 1];
  const index = current.index;
  const album = SET[index];

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sim = {
      sets: new Map(),
      pointer: null,
      pressed: false,
      clock: 0,
      last: 0,
      raf: 0,
      family: getComputedStyle(area).fontFamily,
      onDone: (id) => setSets((list) => list.filter((s) => s.id !== id)),
    };
    simRef.current = sim;

    const measure = (rec) => {
      const box = area.getBoundingClientRect();
      const { fs, lh } = fitTitle(rec.title, box.width * 0.96, box.height - rec.bylineH - 16, sim.family);
      rec.el.style.setProperty("--tf-fs", `${fs}px`);
      rec.el.style.setProperty("--tf-lh", `${lh}px`);
      rec.el.style.setProperty("--tf-track", `${trackEm(fs).toFixed(4)}em`);
      rec.fs = fs;
      rec.letters.forEach((l) => {
        l.size = l.el.closest(".tf-name") ? fs : 24;
        const [ox, oy] = offsetIn(l.el, area);
        l.cx = ox + l.el.offsetWidth / 2;
        l.cy = oy + l.el.offsetHeight / 2;
      });
    };
    sim.measure = measure;

    const adopt = () => {
      area.querySelectorAll(".tf-set").forEach((el) => {
        const id = Number(el.dataset.id);
        const role = el.dataset.role;
        let rec = sim.sets.get(id);
        const fresh = !rec;
        if (fresh) {
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
              a: 1,
              av: 0,
              aTarget: 1,
              aAt: 0,
              b: 0,
              bv: 0,
              bTarget: 0,
              bAt: 0,
              h: 0,
              hv: 0,
              rest: false,
              seed: [hash(id * 97 + i), hash(id * 131 + i * 3.1), hash(id * 17 + i * 7.7), hash(id * 3 + i * 1.9)],
            })),
          };
          sim.sets.set(id, rec);
          measure(rec);
        }
        if (rec.role !== role) {
          rec.role = role;
          const n = rec.letters.length;
          rec.letters.forEach((l) => {
            if (role === "in") {
              l.aTarget = 0;
              l.aAt = sim.clock + (id === 0 ? 0.25 : 0.16) + l.i * Math.min(0.034, 0.5 / n);
              if (reduce) {
                l.a = 0;
                l.av = 0;
              }
            } else {
              l.bTarget = 1;
              l.bAt = sim.clock + l.i * Math.min(0.02, 0.3 / n);
              if (reduce) l.b = 1;
            }
          });
        }
      });
      for (const id of [...sim.sets.keys()]) {
        if (!area.querySelector(`.tf-set[data-id="${id}"]`)) sim.sets.delete(id);
      }
    };
    sim.adopt = adopt;

    const spring = (x, v, target, k, c, dt) => {
      const steps = 2;
      const h = dt / steps;
      for (let s = 0; s < steps; s += 1) {
        v += ((target - x) * k - v * c) * h;
        x += v * h;
      }
      return [x, v];
    };

    const render = (dt) => {
      const ptr = sim.pointer;
      for (const rec of sim.sets.values()) {
        const fs = rec.fs || 100;
        let gone = rec.role === "out";
        for (const l of rec.letters) {
          if (sim.clock >= l.aAt) [l.a, l.av] = spring(l.a, l.av, l.aTarget, ARRIVE_K, ARRIVE_C, dt);
          if (sim.clock >= l.bAt) [l.b, l.bv] = spring(l.b, l.bv, l.bTarget, LEAVE_K, LEAVE_C, dt);
          let hTarget = 0;
          if (ptr && rec.role === "in") {
            const reach = Math.max(l.size * 1.5, 64);
            const d = Math.hypot(ptr.x - l.cx, (ptr.y - l.cy) * 1.15) / reach;
            hTarget = Math.pow(clamp(1 - d, 0, 1), 1.3) * (sim.pressed ? 1.25 : 0.6);
          }
          [l.h, l.hv] = spring(l.h, l.hv, hTarget, LIFT_K, LIFT_C, dt);
          const [s0, s1, s2, s3] = l.seed;
          const a = clamp(l.a, -0.2, 1.2);
          const b = clamp(l.b, 0, 1.1);
          const sz = l.size;
                    let x = a * (1.1 + s1 * 0.9) * fs + b * (0.2 + s0 * 0.5) * fs;
          let y = a * (0.15 + s2 * 0.5) * fs - b * (0.5 + s1 * 0.6) * fs;
          let z = -a * (520 + s3 * 380) - b * (420 + s2 * 520);
          let rx = a * (14 + s2 * 22) - b * (58 + s3 * 22);
          let ry = -a * (58 + s3 * 24) + b * (18 + s1 * 34);
          let rz = a * (s0 - 0.5) * 16 + b * (s2 - 0.5) * 22;
          const lift = l.h;
          if (lift > 0.0005 && ptr) {
            const lean = clamp((l.cx - ptr.x) / Math.max(sz, 40), -1, 1);
            z += lift * sz * 0.7;
            y -= lift * sz * 0.1;
            rx -= lift * 46;
            ry += lift * lean * 26;
            rz += lift * lean * -4;
          } else if (lift > 0.0005) {
            z += lift * sz * 0.7;
            rx -= lift * 46;
          }
          const opacity = smooth(1, 0.66, a) * (1 - smooth(0.3, 0.78, b));
          if (b < 0.98) gone = false;
          const still = Math.abs(l.a) < 0.0015 && Math.abs(l.av) < 0.02 && l.b < 0.0004 && Math.abs(l.h) < 0.002 && Math.abs(l.hv) < 0.02;
          if (still) {
            if (!l.rest) {
              l.rest = true;
              l.a = 0;
              l.av = 0;
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
          l.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
          l.el.style.opacity = opacity >= 0.999 ? "" : opacity.toFixed(3);
        }
        if (gone && !rec.done) {
          rec.done = true;
          sim.onDone(rec.id);
        }
      }
    };

    const step = (now) => {
      sim.raf = requestAnimationFrame(step);
      const dt = Math.min(1 / 20, sim.last ? (now - sim.last) / 1000 : 1 / 60);
      sim.last = now;
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
    simRef.current?.adopt();
  }, [sets]);

  const go = useCallback((next) => {
    setSets((list) => {
      const top = list[list.length - 1];
      const target = ((next % SET.length) + SET.length) % SET.length;
      if (target === top.index) return list;
      const kept = list.slice(-3).map((s) => ({ ...s, role: "out" }));
      const id = seq.current;
      seq.current += 1;
      return [...kept, { id, index: target, role: "in" }];
    });
    flick();
  }, []);

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
    if (!cancelled && !p.moved && p.onArt) go(index + 1);
  };

  const onPointerLeave = (event) => {
    const sim = simRef.current;
    if (sim && event.pointerType === "mouse" && !pressRef.current) sim.pointer = null;
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      wakeAudio();
      go(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      wakeAudio();
      go(index - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      wakeAudio();
      go(index + 1);
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
        aria-roledescription="album titles"
        aria-label={`${album.title} by ${album.artist}, ${album.year}. Arrow keys change the record.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
      >
        <div className="tf-spread">
          <div className="tf-cover tf-hit">
            {SET.map((a, i) => (
              <img
                key={a.id}
                src={a.cover}
                alt={i === index ? `${a.title} cover` : ""}
                aria-hidden={i === index ? undefined : "true"}
                data-on={i === index ? "" : undefined}
                draggable={false}
              />
            ))}
          </div>
          <div className="tf-text">
            <nav className="tf-thumbs" aria-label="Records">
              {SET.map((a, i) => (
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
                <Title key={s.id} id={s.id} role={s.role} album={SET[s.index]} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Root>
  );
}
