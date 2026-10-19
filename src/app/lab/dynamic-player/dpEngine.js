const STEP = 1 / 240;
const COMPACT = { w: 216, h: 40, r: 20, cover: 24, coverR: 7, pad: 8 };
const EXPANDED = { h: 188, r: 44, cover: 56, coverR: 14, pad: 20 };
const ROWS = [0, 0.14, 0.28];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function spring(stiffness, ratio) {
  return { x: 0, v: 0, to: 0, k: stiffness, c: 2 * ratio * Math.sqrt(stiffness) };
}

function tune(s, stiffness, ratio) {
  s.k = stiffness;
  s.c = 2 * ratio * Math.sqrt(stiffness);
}

function advance(s, dt) {
  s.v += (-s.k * (s.x - s.to) - s.c * s.v) * dt;
  s.x += s.v * dt;
}

const clock = (seconds) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function createPlayer(n, { onEnd }) {
  const W = spring(340, 0.74);
  const H = spring(300, 0.78);
  const C = spring(240, 1);
  const press = spring(700, 0.9);
  press.x = 1;
  press.to = 1;
  const amp = spring(60, 1);
  amp.x = 1;
  amp.to = 1;
  const bars = n.bars.map(() => 0.3);
  const media = { playing: true, offset: 41, startedAt: performance.now(), duration: 185, bpm: 120, scrubbing: false };
  const geo = { ew: 372, base: 1 };
  let open = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let seen = true;
  let lastSecond = -1;
  let ended = false;

  const position = (now = performance.now()) => {
    if (!media.playing || media.scrubbing) return media.offset;
    return media.offset + (now - media.startedAt) / 1000;
  };

  const measure = () => {
    geo.base = n.root.clientWidth >= 900 && n.root.clientHeight >= 640 ? 1.25 : 1;
    geo.ew = Math.max(COMPACT.w, Math.min(372, n.root.clientWidth / geo.base - 24));
    n.root.style.setProperty("--dp-ew", `${geo.ew}px`);
  };

  const write = (t) => {
    const p = W.x;
    const h = H.x;
    const s = press.x;
    const w = lerp(COMPACT.w, geo.ew, p);
    const ht = lerp(COMPACT.h, EXPANDED.h, h);
    const r = Math.min(ht / 2, lerp(COMPACT.r, EXPANDED.r, clamp(h)));
    n.island.style.width = `${w.toFixed(2)}px`;
    n.island.style.height = `${ht.toFixed(2)}px`;
    n.island.style.borderRadius = `${r.toFixed(2)}px`;
    n.island.style.transform = `translateX(-50%) scale(${(s * geo.base).toFixed(4)})`;

    const g = clamp(h, 0, 1.04);
    const pad = lerp(COMPACT.pad, EXPANDED.pad, g);
    const cs = lerp(COMPACT.cover, EXPANDED.cover, g);
    n.cover.style.transform = `translate(${pad.toFixed(2)}px, ${pad.toFixed(2)}px)`;
    n.cover.style.width = `${cs.toFixed(2)}px`;
    n.cover.style.height = `${cs.toFixed(2)}px`;
    n.cover.style.borderRadius = `${lerp(COMPACT.coverR, EXPANDED.coverR, g).toFixed(2)}px`;

    const bs = lerp(1, 1.25, g);
    const bw = 24 * bs;
    const by = lerp(12, 32, g);
    n.barBox.style.transform = `translate(${(w - pad - 4 * g - bw).toFixed(2)}px, ${by.toFixed(2)}px) scale(${bs.toFixed(3)})`;
    for (let i = 0; i < n.bars.length; i += 1) n.bars[i].style.transform = `scaleY(${bars[i].toFixed(3)})`;

    const c = clamp(C.x);
    n.expanded.style.visibility = c < 0.002 ? "hidden" : "visible";
    for (let i = 0; i < n.rows.length; i += 1) {
      const e = clamp((c - ROWS[i]) / (1 - ROWS[i]));
      const el = n.rows[i];
      el.style.opacity = (open ? e * e * (3 - 2 * e) : clamp((e - 0.3) / 0.7) ** 2).toFixed(3);
      el.style.transform = `translateY(${((1 - e) * 8).toFixed(2)}px) scale(${(0.96 + 0.04 * e).toFixed(4)})`;
      el.style.filter = e > 0.001 && e < 0.999 ? `blur(${((1 - e) * 4).toFixed(2)}px)` : "none";
    }

    const frac = clamp(t / media.duration);
    n.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    n.knob.style.left = `${(frac * 100).toFixed(3)}%`;
    const sec = Math.floor(t);
    if (sec !== lastSecond) {
      lastSecond = sec;
      n.timeA.textContent = clock(t);
      n.timeB.textContent = `-${clock(media.duration - t)}`;
      n.track.setAttribute("aria-valuenow", String(sec));
      n.track.setAttribute("aria-valuetext", `${clock(t)} of ${clock(media.duration)}`);
    }
  };

  const tick = (now) => {
    raf = 0;
    if (!seen || document.hidden) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      advance(W, STEP);
      advance(H, STEP);
      advance(press, STEP);
      advance(amp, STEP);
      if (open && C.to === 0 && H.x > 0.3) C.to = 1;
      advance(C, STEP);
      acc -= STEP;
    }
    let t = position(now);
    if (t >= media.duration && !media.scrubbing) {
      t = media.duration;
      if (!ended) {
        ended = true;
        onEnd?.();
      }
    }
    const beat = (t * media.bpm) / 60;
    const env = Math.exp(-(beat - Math.floor(beat)) * 4.2);
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < bars.length; i += 1) {
      const wob = Math.abs(Math.sin(t * (2.3 + i * 1.41) + i * 1.9)) * (0.6 + 0.4 * Math.sin(t * 0.73 + i * 2.1));
      const fizz = Math.abs(Math.sin(t * (6.1 + i * 0.83) + i * 0.7));
      const hit = env * (i % 2 ? 0.9 : 0.6);
      const target = 0.22 + 0.78 * amp.x * clamp(0.5 * hit + 0.45 * wob * wob + 0.2 * fizz) ** 1.3;
      bars[i] += (target - bars[i]) * k;
    }
    write(t);
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!raf && seen && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const ro = new ResizeObserver(() => {
    measure();
    wake();
  });
  ro.observe(n.root);
  const io = new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    wake();
  });
  io.observe(n.root);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);
  measure();
  wake();

  return {
    setOpen(next) {
      open = next;
      W.to = next ? 1 : 0;
      H.to = next ? 1 : 0;
      if (next) {
        tune(W, 340, 0.74);
        tune(H, 300, 0.78);
        tune(C, 380, 1);
        if (H.x > 0.3) C.to = 1;
      } else {
        tune(W, 420, 0.82);
        tune(H, 460, 0.86);
        tune(C, 1400, 1);
        C.to = 0;
      }
      wake();
    },
    press(down) {
      press.to = down ? 0.96 : 1;
      wake();
    },
    setPlaying(playing) {
      if (playing === media.playing) return;
      media.offset = position();
      media.startedAt = performance.now();
      media.playing = playing;
      amp.to = playing ? 1 : 0;
      wake();
    },
    load(track, autoplay, from = 0) {
      media.duration = track.duration;
      media.bpm = track.bpm;
      media.offset = from;
      media.startedAt = performance.now();
      ended = false;
      lastSecond = -1;
      if (autoplay !== undefined) {
        media.playing = autoplay;
        amp.to = autoplay ? 1 : 0;
      }
      wake();
    },
    elapsed: () => position(),
    seek(frac, done) {
      media.scrubbing = !done;
      media.offset = clamp(frac) * media.duration;
      media.startedAt = performance.now();
      ended = media.offset >= media.duration;
      lastSecond = -1;
      wake();
    },
    nudge(seconds) {
      media.offset = clamp(position() + seconds, 0, media.duration - 0.5);
      media.startedAt = performance.now();
      lastSecond = -1;
      wake();
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
