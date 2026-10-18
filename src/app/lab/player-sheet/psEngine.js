const STEP = 1 / 240;
const W = 390;
const PHONE_H = 844;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rubber = (x) => (x * 0.22) / (0.22 + x);

const clock = (seconds) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function createSheet(n, { onOpenChange }) {
  const P = { x: 0, v: 0, to: 0, k: 300, c: 2 * 0.88 * Math.sqrt(300) };
  const beat = { x: 1, v: 0, to: 1, k: 180, c: 2 * 0.72 * Math.sqrt(180) };
  const geo = { s: 1, h: PHONE_H, miniTop: 0, fullTop: 48, cover: 326, phone: true };
  const media = { playing: true, offset: 52, startedAt: performance.now(), duration: 200, scrubbing: false };
  let drag = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let seen = true;
  let lastSecond = -1;
  let open = false;
  let dragged = false;

  const position = (now = performance.now()) => {
    if (!media.playing || media.scrubbing) return media.offset;
    const t = media.offset + (now - media.startedAt) / 1000;
    return t % media.duration;
  };

  const measure = () => {
    const rw = n.root.clientWidth;
    const rh = n.root.clientHeight;
    const phone = rw >= 560 && rh >= 560;
    const s = phone ? Math.min(1, (rh - 64) / PHONE_H, (rw - 48) / W) : rw / W;
    const h = phone ? PHONE_H : rh / s;
    geo.s = s;
    geo.h = h;
    geo.phone = phone;
    geo.miniTop = h - 28 - 64;
    geo.cover = Math.max(160, Math.min(W - 64, h - 48 - 56 - 420));
    n.root.style.setProperty("--ps-s", String(s));
    n.root.style.setProperty("--ps-h", `${h}px`);
    n.root.style.setProperty("--ps-cover", `${geo.cover}px`);
    n.root.style.setProperty("--ps-mini-top", `${geo.miniTop}px`);
    n.root.toggleAttribute("data-phone", phone);
  };

  const shown = () => {
    const p = P.x;
    if (p < 0) return -rubber(-p);
    if (p > 1) return 1 + rubber(p - 1);
    return p;
  };

  const write = (now) => {
    const p = drag?.active ? drag.shown : shown();
    const q = clamp(p);
    const travel = geo.miniTop - geo.fullTop;
    const top = geo.miniTop - p * travel;
    const side = lerp(8, 0, q);
    const bottom = lerp(28, 0, q);
    const r = lerp(16, 40, q);
    n.sheet.style.clipPath = `inset(${top.toFixed(2)}px ${side}px ${bottom}px ${side}px round ${r}px ${r}px ${geo.phone ? 48 : lerp(16, 0, q)}px ${geo.phone ? 48 : lerp(16, 0, q)}px)`;
    n.light.style.opacity = String(1 - clamp(p * 2.6));
    n.shadow.style.opacity = String(1 - clamp(p * 3));
    n.mini.style.opacity = String(1 - clamp(p * 4));
    n.mini.style.transform = `translateY(${(top - geo.miniTop).toFixed(2)}px)`;
    const fo = clamp((p - 0.3) / 0.5);
    n.full.style.opacity = String(fo);
    n.full.style.transform = `translateY(${(top - geo.fullTop + (1 - fo) * 24).toFixed(2)}px)`;
    n.library.style.transform = `translateY(${q * (geo.phone ? 12 : 8)}px) scale(${1 - 0.07 * q})`;
    n.library.style.borderRadius = `${q * 24}px`;
    n.dim.style.opacity = String(q * 0.4);

    const x0 = 18;
    const y0 = geo.miniTop + 10;
    const s0 = 44;
    const s1 = geo.cover;
    const x1 = (W - s1) / 2;
    const y1 = geo.fullTop + 56;
    const play = lerp(1, beat.x, q);
    const base = lerp(s0, s1, q);
    const size = base * play;
    const arc = Math.sin(Math.PI * q) * 28;
    const overshoot = p > 1 ? top - geo.fullTop : p < 0 ? top - geo.miniTop : 0;
    const x = lerp(x0, x1, q) + (base - size) / 2 - arc * 0.4;
    const y = lerp(y0, y1, q) + (base - size) / 2 - arc * 0.6 + overshoot;
    n.cover.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    n.cover.style.width = `${size.toFixed(2)}px`;
    n.cover.style.height = `${size.toFixed(2)}px`;
    n.cover.style.borderRadius = `${lerp(8, 14, q)}px`;
    n.cover.style.setProperty("--ps-lift", q.toFixed(3));

    const t = position(now);
    const frac = clamp(t / media.duration);
    n.fill.style.transform = `scaleX(${frac})`;
    n.knob.style.left = `${frac * 100}%`;
    n.miniFill.style.transform = `scaleX(${frac})`;
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
      if (!drag?.active) {
        P.v += (-P.k * (P.x - P.to) - P.c * P.v) * STEP;
        P.x += P.v * STEP;
      }
      beat.v += (-beat.k * (beat.x - beat.to) - beat.c * beat.v) * STEP;
      beat.x += beat.v * STEP;
      acc -= STEP;
    }
    write(now);
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!raf && seen && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const setOpen = (next, velocity) => {
    P.to = next ? 1 : 0;
    if (velocity !== undefined) P.v = velocity;
    if (next !== open) {
      open = next;
      onOpenChange?.(next);
    }
    wake();
  };

  const toLocal = (e) => {
    const rect = n.phoneEl.getBoundingClientRect();
    return (e.clientY - rect.top) / geo.s;
  };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("[data-nodrag]")) return;
    const y = toLocal(e);
    const fromMini = !open && P.x < 0.5;
    drag = { id: e.pointerId, y0: y, p0: P.x, shown: shown(), active: false, samples: [{ y, t: performance.now() }], fromMini };
    if (Math.abs(P.v) > 0.05 || Math.abs(P.x - P.to) > 0.01) {
      drag.active = true;
      drag.p0 = P.x;
      drag.shown = shown();
      P.v = 0;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const y = toLocal(e);
    const now = performance.now();
    drag.samples.push({ y, t: now });
    if (drag.samples.length > 6) drag.samples.shift();
    if (!drag.active) {
      if (Math.abs(y - drag.y0) < 6) return;
      drag.active = true;
      drag.y0 = y;
    }
    const travel = geo.miniTop - geo.fullTop;
    const raw = drag.p0 + (drag.y0 - y) / travel;
    P.x = raw;
    drag.shown = shown();
    wake();
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (!d.active) {
      if (d.fromMini && !e.target.closest("button")) setOpen(true);
      return;
    }
    const s = d.samples;
    const b = s[s.length - 1];
    const recent = s.find((m) => b.t - m.t < 120);
    const a = recent && recent !== b ? recent : s[Math.max(0, s.length - 2)];
    const vy = b.t > a.t ? (b.y - a.y) / ((b.t - a.t) / 1000) : 0;
    const travel = geo.miniTop - geo.fullTop;
    const vp = clamp(-vy / travel, -8, 8);
    P.x = d.shown;
    const projected = P.x + vp * 0.25;
    const next = Math.abs(vp) > 0.45 ? vp > 0 : projected > 0.5;
    setOpen(next, vp);
    dragged = true;
    setTimeout(() => {
      dragged = false;
    }, 0);
  };

  const onClickCapture = (e) => {
    if (!dragged) return;
    e.stopPropagation();
    e.preventDefault();
  };
  n.sheet.addEventListener("pointerdown", onDown);
  n.sheet.addEventListener("click", onClickCapture, true);

  const ro = new ResizeObserver(() => {
    measure();
    wake();
  });
  ro.observe(n.root);
  const io = new IntersectionObserver(([en]) => {
    seen = en.isIntersecting;
    wake();
  });
  io.observe(n.root);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);
  measure();
  wake();

  return {
    setOpen,
    setPlaying(next) {
      if (next === media.playing) return;
      media.offset = position();
      media.startedAt = performance.now();
      media.playing = next;
      beat.to = next ? 1 : 0.84;
      wake();
    },
    load(track) {
      media.duration = track.duration;
      media.offset = 0;
      media.startedAt = performance.now();
      lastSecond = -1;
      wake();
    },
    elapsed: () => position(),
    seek(frac, done) {
      media.scrubbing = !done;
      media.offset = clamp(frac, 0, 0.999) * media.duration;
      media.startedAt = performance.now();
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
      n.sheet.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      n.sheet.removeEventListener("click", onClickCapture, true);
    },
  };
}
