const STEP = 1 / 240;
const COMPACT = { w: 236, h: 44, r: 22 };
const EXPANDED_H = 220;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function spring(stiffness, ratio) {
  return { x: 0, v: 0, to: 0, k: stiffness, c: 2 * ratio * Math.sqrt(stiffness) };
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
  const P = spring(300, 0.8);
  const H = spring(250, 0.84);
  const press = spring(700, 0.9);
  press.x = 1;
  press.to = 1;
  const amp = spring(60, 1);
  const bars = n.bars.map(() => 0.2);
  const media = { playing: true, offset: 41, startedAt: performance.now(), duration: 185, bpm: 120, scrubbing: false };
  const geo = { W: 0, ew: 400 };
  let angle = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let seen = true;
  let lastSecond = -1;
  let ended = false;
  amp.x = 1;
  amp.to = 1;

  const position = (now = performance.now()) => {
    if (!media.playing || media.scrubbing) return media.offset;
    return media.offset + (now - media.startedAt) / 1000;
  };

  const measure = () => {
    geo.W = n.root.clientWidth;
    geo.ew = Math.min(400, geo.W - 24);
    n.root.style.setProperty("--dp-ew", `${geo.ew}px`);
  };

  const levelAt = (t) => {
    const beat = (t * media.bpm) / 60;
    const env = Math.exp(-(beat - Math.floor(beat)) * 4.2);
    return env;
  };

  const write = (t, env) => {
    const p = P.x;
    const h = H.x;
    const s = press.x;
    const w = lerp(COMPACT.w, geo.ew, p);
    const ht = lerp(COMPACT.h, EXPANDED_H, h);
    const r = Math.min(ht / 2, lerp(COMPACT.r, 44, clamp(h * 1.4)));
    const lev = amp.x * env;
    n.island.style.width = `${w}px`;
    n.island.style.height = `${ht}px`;
    n.island.style.borderRadius = `${r}px`;
    n.island.style.transform = `translateX(-50%) scale(${s})`;
    const ringOpacity = String(clamp(0.5 + p * 0.5) * (0.6 + lev * 0.4));
    for (const ring of n.rings) {
      ring.style.width = `${w + 4}px`;
      ring.style.height = `${ht + 4}px`;
      ring.style.borderRadius = `${r + 2}px`;
      ring.style.transform = `translateX(-50%) scale(${s})`;
      ring.style.opacity = ringOpacity;
    }
    n.spin.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    n.spinGlow.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    const gx = (w / geo.ew) * (1.04 + lev * 0.05);
    const gy = (ht / EXPANDED_H) * (1.1 + lev * 0.12);
    n.halo.style.transform = `translateX(-50%) scale(${gx}, ${gy})`;
    n.halo.style.opacity = String(clamp(0.5 + 0.5 * p) * (0.7 + lev * 0.3));
    n.bloom.style.transform = `translateX(-50%) scale(${0.5 + p * 0.6 + lev * 0.06})`;
    n.bloom.style.opacity = String(clamp(p) * (0.5 + lev * 0.25));

    const cs = lerp(28, 64, p);
    n.cover.style.transform = `translate(${lerp(8, 20, p)}px, ${lerp(8, 20, h)}px)`;
    n.cover.style.width = `${cs}px`;
    n.cover.style.height = `${cs}px`;
    n.cover.style.borderRadius = `${lerp(14, 16, p)}px`;

    const bs = lerp(1, 1.4, p);
    const bw = 26 * bs;
    n.barBox.style.transform = `translate(${w - lerp(16, 22, p) - bw}px, ${lerp(13, 30, h)}px) scale(${bs})`;
    for (let i = 0; i < n.bars.length; i += 1) n.bars[i].style.transform = `scaleY(${bars[i]})`;

    const eo = clamp((p - 0.42) / 0.5);
    n.expanded.style.opacity = String(eo);
    n.expanded.style.transform = `translateX(-50%) translateY(${(1 - eo) * -8}px) scale(${0.96 + 0.04 * eo})`;
    n.expanded.style.filter = eo > 0.001 && eo < 0.999 ? `blur(${(1 - eo) * 8}px)` : "none";
    n.expanded.style.visibility = eo < 0.002 ? "hidden" : "visible";

    const frac = clamp(t / media.duration);
    n.fill.style.transform = `scaleX(${frac})`;
    n.knob.style.left = `${frac * 100}%`;
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
      advance(P, STEP);
      advance(H, STEP);
      advance(press, STEP);
      advance(amp, STEP);
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
    const env = levelAt(t);
    angle = (angle + dt * (18 + amp.x * env * 70)) % 360;
    const k = 1 - Math.exp(-dt * 16);
    for (let i = 0; i < bars.length; i += 1) {
      const wob = Math.abs(Math.sin(t * (2.3 + i * 1.41) + i * 1.9)) * (0.6 + 0.4 * Math.sin(t * 0.73 + i * 2.1));
      const fizz = Math.abs(Math.sin(t * (6.1 + i * 0.83) + i * 0.7));
      const hit = env * (i % 2 ? 0.9 : 0.6);
      const target = 0.16 + 0.84 * amp.x * clamp(0.5 * hit + 0.45 * wob * wob + 0.2 * fizz) ** 1.3;
      bars[i] += (target - bars[i]) * k;
    }
    write(t, env);
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
    setOpen(open) {
      P.to = open ? 1 : 0;
      H.to = open ? 1 : 0;
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
