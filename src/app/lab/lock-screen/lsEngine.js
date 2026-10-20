const STEP = 1 / 240;
const W = 390;
const PHONE_H = 844;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rubber = (x) => (x * 0.5) / (0.5 + x);

const clock = (seconds) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function createLock(n, { count, start = 0, onIndex, duration }) {
  const X = { x: start, v: 0, to: start, k: 220, c: 2 * 0.9 * Math.sqrt(220) };
  const beat = { x: 1, v: 0, to: 1, k: 170, c: 2 * 0.7 * Math.sqrt(170) };
  const geo = { s: 1, h: PHONE_H, phone: true };
  const media = { playing: true, offset: 38, startedAt: performance.now(), duration: duration(start), scrubbing: false };
  let total = count;
  let index = start;
  let drag = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let seen = true;
  let lastSecond = -1;
  let dragged = false;

  const position = (now = performance.now()) => {
    if (!media.playing || media.scrubbing) return media.offset;
    return (media.offset + (now - media.startedAt) / 1000) % media.duration;
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
    const art = Math.max(120, Math.min(264, h - 236 - 340));
    n.root.style.setProperty("--ls-s", String(s));
    n.root.style.setProperty("--ls-h", `${h}px`);
    n.root.style.setProperty("--ls-art", `${art}px`);
    n.root.toggleAttribute("data-phone", phone);
  };

  const shown = () => {
    const x = X.x;
    if (x < 0) return -rubber(-x);
    if (x > total - 1) return total - 1 + rubber(x - total + 1);
    return x;
  };

  const write = (now) => {
    const x = shown();
    const gap = 296;
    for (let i = 0; i < n.covers.length; i += 1) {
      const d = i - x;
      const ad = Math.abs(d);
      const el = n.covers[i];
      if (ad > 2.5) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      const near = 1 - Math.min(1, ad);
      const sc = (1 - (1 - near) * 0.18) * (1 + (beat.x - 1) * near);
      el.style.transform = `translateX(${(d * gap).toFixed(2)}px) scale(${sc.toFixed(4)})`;
      el.style.zIndex = String(10 - Math.round(ad * 2));
      el.style.setProperty("--ls-near", near.toFixed(3));
    }
    n.strip.style.transform = `translateX(${(-x * 100).toFixed(3)}%)`;
    n.dots.forEach((dot, i) => dot.style.setProperty("--ls-on", clamp(1 - Math.abs(i - x)).toFixed(3)));

    const t = position(now);
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
      if (!drag?.active) {
        X.v += (-X.k * (X.x - X.to) - X.c * X.v) * STEP;
        X.x += X.v * STEP;
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

  const land = (i, velocity) => {
    const next = Math.round(clamp(i, 0, total - 1));
    X.to = next;
    if (velocity !== undefined) X.v = velocity;
    if (next !== index) {
      index = next;
      media.duration = duration(next);
      media.offset = 0;
      media.startedAt = performance.now();
      lastSecond = -1;
      onIndex?.(next);
    }
    wake();
  };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("[data-nodrag]")) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: X.x, active: false, samples: [{ x: e.clientX, t: performance.now() }] };
    if (Math.abs(X.v) > 0.05) {
      drag.active = true;
      X.v = 0;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const unit = (el) => (el === "strip" ? n.stripBox.clientWidth * geo.s : 296 * geo.s);

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    drag.samples.push({ x: e.clientX, t: now });
    if (drag.samples.length > 6) drag.samples.shift();
    if (!drag.active) {
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        drag = null;
        return;
      }
      drag.active = true;
      drag.x0 = e.clientX;
      drag.p0 = X.x;
    }
    X.x = drag.p0 - (e.clientX - drag.x0) / unit(drag.on);
    wake();
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (!d.active) return;
    const s = d.samples;
    const b = s[s.length - 1];
    const recent = s.find((m) => b.t - m.t < 120);
    const a = recent && recent !== b ? recent : s[Math.max(0, s.length - 2)];
    const vx = b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0;
    const vi = clamp(-vx / unit(d.on), -6, 6);
    X.x = shown();
    const projected = X.x + vi * 0.2;
    const base = Math.round(d.p0);
    const target = Math.abs(vi) > 0.5 ? base + Math.sign(vi) * Math.max(1, Math.round(Math.abs(projected - base))) : Math.round(projected);
    land(clamp(target, base - 2, base + 2), vi);
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

  const downGallery = (e) => {
    onDown(e);
    if (drag) drag.on = "gallery";
  };
  const downWidget = (e) => {
    onDown(e);
    if (drag) drag.on = "strip";
  };
  n.gallery.addEventListener("pointerdown", downGallery);
  n.widget.addEventListener("pointerdown", downWidget);
  n.gallery.addEventListener("click", onClickCapture, true);
  n.widget.addEventListener("click", onClickCapture, true);

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
    go(i) {
      land(i, 0);
    },
    step(dir) {
      land(index + dir, 0);
    },
    setCount(c) {
      total = c;
      if (index > c - 1) land(c - 1);
      wake();
    },
    setPlaying(next) {
      if (next === media.playing) return;
      media.offset = position();
      media.startedAt = performance.now();
      media.playing = next;
      beat.to = next ? 1 : 0.88;
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
      n.gallery.removeEventListener("pointerdown", downGallery);
      n.widget.removeEventListener("pointerdown", downWidget);
      n.gallery.removeEventListener("click", onClickCapture, true);
      n.widget.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    },
  };
}
