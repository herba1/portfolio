const STEP = 1 / 240;
const IDLE_MS = 2600;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const clock = (seconds) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

function spring(k, ratio) {
  return { x: 0, v: 0, to: 0, next: 0, at: 0, k, c: 2 * ratio * Math.sqrt(k) };
}

export function createKaraoke(n, song, { from = 0, playing = true, onActive, onEnd }) {
  n.lines = [...n.list.querySelectorAll(".k-line")];
  n.words = n.lines.map((line) => [...line.querySelectorAll(".k-word")]);
  const lines = song.lines;
  const springs = lines.map(() => spring(150, 0.92));
  const media = { playing, offset: from, startedAt: performance.now(), duration: song.duration, scrubbing: false };
  const manual = { on: false, offset: 0, v: 0, last: 0, dragging: false };
  const geo = { tops: [], anchor: 0, height: 0 };
  let active = -1;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let seen = true;
  let first = true;
  let lastSecond = -1;
  let ended = false;

  const position = (now = performance.now()) => {
    if (!media.playing || media.scrubbing) return media.offset;
    return media.offset + (now - media.startedAt) / 1000;
  };

  const lineAt = (t) => {
    let i = 0;
    while (i + 1 < lines.length && lines[i + 1].start <= t) i += 1;
    return i;
  };

  const measure = () => {
    geo.tops = n.lines.map((el) => el.offsetTop + el.offsetHeight / 2);
    geo.height = n.viewport.clientHeight;
    geo.anchor = geo.height * (n.viewport.clientWidth < 560 ? 0.34 : 0.4);
  };

  const range = () => {
    const a = geo.tops[Math.max(0, active)] || 0;
    return [a - (geo.tops[geo.tops.length - 1] || 0), a - (geo.tops[0] || 0)];
  };

  const baseTarget = () => geo.anchor - (geo.tops[Math.max(0, active)] || 0) + manual.offset;

  const retarget = (now, cascade) => {
    const to = baseTarget();
    const up = to < (springs[active]?.to ?? to);
    springs.forEach((s, i) => {
      const lag = up ? i - (active - 1) : active + 1 - i;
      const delay = cascade ? Math.min(0.2, 0.03 * Math.max(0, lag)) : 0;
      s.next = to;
      s.at = now + delay * 1000;
      if (!cascade) s.to = to;
    });
  };

  const setActive = (i, now) => {
    if (i === active) return;
    const step = Math.abs(i - active) === 1;
    active = i;
    n.lines.forEach((el, j) => {
      const d = j - i;
      el.dataset.dist = String(Math.min(3, Math.abs(d)));
      el.dataset.side = d < 0 ? "past" : d > 0 ? "next" : "now";
    });
    n.words.forEach((list, j) => {
      if (j === i) return;
      for (const el of list) el.style.setProperty("--f", j < i ? "1" : "0");
    });
    retarget(now, !first && step && !manual.on);
    onActive?.(i);
  };

  const paint = (t) => {
    for (let i = 0; i < springs.length; i += 1) n.lines[i].style.transform = `translate3d(0, ${springs[i].x.toFixed(2)}px, 0)`;
    const line = lines[active];
    if (!line) return;
    const list = n.words[active];
    for (let j = 0; j < list.length; j += 1) {
      const w = line.words[j];
      list[j].style.setProperty("--f", clamp((t - w.start) / (w.end - w.start)).toFixed(3));
    }
  };

  const writeClock = (t) => {
    const frac = clamp(t / media.duration);
    n.fill.style.transform = `scaleX(${frac})`;
    n.knob.style.left = `${frac * 100}%`;
    const sec = Math.floor(t);
    if (sec === lastSecond) return;
    lastSecond = sec;
    n.timeA.textContent = clock(t);
    n.timeB.textContent = `-${clock(media.duration - t)}`;
    n.track.setAttribute("aria-valuenow", String(sec));
    n.track.setAttribute("aria-valuetext", `${clock(t)} of ${clock(media.duration)}`);
  };

  const tick = (now) => {
    raf = 0;
    if (!seen || document.hidden) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    let t = position(now);
    if (t >= media.duration && !media.scrubbing) {
      t = media.duration;
      if (!ended) {
        ended = true;
        onEnd?.();
      }
    }
    setActive(lineAt(t), now);
    if (manual.on && !manual.dragging) {
      if (Math.abs(manual.v) > 1) {
        manual.offset += manual.v * dt;
        manual.v *= Math.exp(-dt * 4);
        const [lo, hi] = range();
        if (manual.offset < lo || manual.offset > hi) {
          manual.offset = clamp(manual.offset, lo, hi);
          manual.v = 0;
        }
        retarget(now, false);
      }
      if (now - manual.last > IDLE_MS) {
        manual.on = false;
        manual.offset = 0;
        n.root.removeAttribute("data-manual");
        retarget(now, false);
      }
    }
    for (const s of springs) if (s.at && now >= s.at) {
      s.to = s.next;
      s.at = 0;
    }
    acc += dt;
    while (acc >= STEP) {
      for (const s of springs) {
        s.v += (-s.k * (s.x - s.to) - s.c * s.v) * STEP;
        s.x += s.v * STEP;
      }
      acc -= STEP;
    }
    paint(t);
    writeClock(t);
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!raf && seen && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const settle = () => {
    measure();
    const to = baseTarget();
    springs.forEach((s) => {
      s.to = to;
      s.next = to;
      s.at = 0;
      if (first) {
        s.x = to;
        s.v = 0;
      }
    });
    first = false;
  };

  const ro = new ResizeObserver(() => {
    settle();
    wake();
  });
  ro.observe(n.viewport);
  ro.observe(n.list);
  const io = new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    wake();
  });
  io.observe(n.root);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);

  const nudgeManual = (delta, now) => {
    const [lo, hi] = range();
    const next = manual.offset + delta;
    const over = next < lo ? next - lo : next > hi ? next - hi : 0;
    manual.offset = next - over * 0.6;
    manual.on = true;
    manual.last = now;
    n.root.setAttribute("data-manual", "");
    retarget(now, false);
    wake();
  };

  const onWheel = (e) => {
    e.preventDefault();
    manual.v = 0;
    nudgeManual(-e.deltaY, performance.now());
  };
  n.viewport.addEventListener("wheel", onWheel, { passive: false });

  let drag = null;
  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag = { id: e.pointerId, y: e.clientY, last: e.clientY, t: performance.now(), v: 0, moved: false };
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    if (!drag.moved && Math.abs(e.clientY - drag.y) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      manual.dragging = true;
      try {
        n.viewport.setPointerCapture(e.pointerId);
      } catch {}
    }
    const dy = e.clientY - drag.last;
    const dts = Math.max(1, now - drag.t) / 1000;
    drag.v = drag.v * 0.6 + (dy / dts) * 0.4;
    drag.last = e.clientY;
    drag.t = now;
    nudgeManual(dy, now);
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      manual.dragging = false;
      manual.v = clamp(drag.v, -3000, 3000);
      manual.last = performance.now();
      const [lo, hi] = range();
      manual.offset = clamp(manual.offset, lo, hi);
      retarget(performance.now(), false);
      n.viewport.dataset.dragged = "";
      setTimeout(() => n.viewport && delete n.viewport.dataset.dragged, 0);
    }
    drag = null;
    wake();
  };
  n.viewport.addEventListener("pointerdown", onDown);
  n.viewport.addEventListener("pointermove", onMove);
  n.viewport.addEventListener("pointerup", onUp);
  n.viewport.addEventListener("pointercancel", onUp);

  document.fonts?.ready.then(() => {
    settle();
    wake();
  });
  settle();
  wake();

  return {
    setPlaying(next) {
      if (next === media.playing) return;
      media.offset = position();
      media.startedAt = performance.now();
      media.playing = next;
      wake();
    },
    elapsed: () => position(),
    seek(frac, done) {
      media.scrubbing = !done;
      media.offset = clamp(frac) * media.duration;
      media.startedAt = performance.now();
      ended = false;
      lastSecond = -1;
      manual.on = false;
      manual.offset = 0;
      n.root.removeAttribute("data-manual");
      retarget(performance.now(), false);
      wake();
    },
    seekTo(seconds) {
      this.seek(seconds / media.duration + 0.0001, true);
    },
    nudge(seconds) {
      this.seek((position() + seconds) / media.duration, true);
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      n.viewport.removeEventListener("wheel", onWheel);
      n.viewport.removeEventListener("pointerdown", onDown);
      n.viewport.removeEventListener("pointermove", onMove);
      n.viewport.removeEventListener("pointerup", onUp);
      n.viewport.removeEventListener("pointercancel", onUp);
    },
  };
}
