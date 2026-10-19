import { albumById } from "@/app/lab/_music/catalog";

import { createFeedAudio } from "./feedAudio";
import { crayonSlide, cutoutSlide, decaySlide, nightSlide, rng, smearSlide } from "./feedSlides";

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6s-7.6-4.6-9.4-9.3C1.4 8 3.4 4.6 6.8 4.6c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.4 0 5.4 3.4 4.2 6.7-1.8 4.7-9.4 9.3-9.4 9.3z" fill="currentColor"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 4.5v4c-6 .6-9 4.6-9.5 10.5 2.2-3.2 5-4.6 9.5-4.6v4.1L21 11z" fill="currentColor"/></svg>';
const SPEAKER_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9h3.3L12 4.8v14.4L6.8 15H3.5z" fill="currentColor"/><path d="M15.6 8.4a5 5 0 0 1 0 7.2M18.3 6a8.4 8.4 0 0 1 0 12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9h3.3L12 4.8v14.4L6.8 15H3.5z" fill="currentColor"/><path d="M15.8 9.2l5 5.6M20.8 9.2l-5 5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>';
const NOTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 12.2V3.6l7-1.6v8.4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><circle cx="4.4" cy="12.4" r="1.9" fill="currentColor"/><circle cx="11.4" cy="10.6" r="1.9" fill="currentColor"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" fill="currentColor"/></svg>';

const SLIDES = [
  { make: nightSlide, opts: "times", song: "Here Comes the Sun", album: "abbey-road", desc: "walked home the long way", likes: 12400 },
  { make: smearSlide, song: "In My Life", album: "rubber-soul", desc: "for whoever needs it tonight", likes: 8310 },
  { make: decaySlide, song: "Help!", album: "help", desc: "how are you, really", likes: 20700 },
  { make: cutoutSlide, opts: "sky", song: "Across the Universe", album: "let-it-be", desc: "cut this out of an old magazine", likes: 5120 },
  { make: crayonSlide, song: "Strawberry Fields Forever", album: "magical-mystery-tour", desc: "drew it on the back of a poster", likes: 9880 },
];

const STIFF = 230;
const DAMP = 2 * Math.sqrt(STIFF) * 0.94;
const MAX_V = 7;

function el(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

function setT(node, value) {
  if (node._t === value) return;
  node._t = value;
  node.style.transform = value;
}

const fmtCount = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US"));

export function createFeed(root, { screen, photos, onSound, onReady }) {
  const n = SLIDES.length;
  let destroyed = false;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let raf = 0;
  let lastTime = 0;
  let visible = true;
  let paused = false;
  let audio = null;
  let soundOn = false;
  let pos = 0;
  let vel = 0;
  let target = 0;
  let drag = null;
  let wheelAcc = 0;
  let wheelAt = 0;
  let lastTap = null;
  let tapTimer = 0;
  let current = 0;
  const bursts = [];

  const track = el("div", "feed-track", screen);
  const grain = el("canvas", "feed-grain", screen);
  grain.setAttribute("aria-hidden", "true");
  const tabs = el("div", "feed-tabs", screen);
  el("span", "feed-tab", tabs, "Following");
  el("span", "feed-tab feed-tab--on", tabs, "For You");
  const pauseIcon = el("div", "feed-pause", screen);
  pauseIcon.innerHTML = PLAY;
  const hearts = el("div", "feed-hearts", screen);
  const live = el("p", "feed-live", screen);
  live.setAttribute("aria-live", "polite");

  const slides = SLIDES.map((def, i) => {
    const album = albumById(def.album);
    const node = el("section", "feed-slide", track);
    node.setAttribute("aria-label", `${def.song}, edit ${i + 1} of ${n}`);
    const art = def.make(node, { photo: def.opts ? photos[def.opts] : null });
    node.dataset.theme = art.theme;
    const rail = el("div", "feed-rail", node);
    const likeBtn = el("button", "feed-rail-btn feed-like", rail);
    likeBtn.type = "button";
    likeBtn.setAttribute("aria-pressed", "false");
    likeBtn.setAttribute("aria-label", "Like");
    const likeIcon = el("span", "feed-rail-icon", likeBtn);
    likeIcon.innerHTML = HEART;
    const likeCount = el("span", "feed-rail-count", likeBtn, fmtCount(def.likes));
    const shareBtn = el("button", "feed-rail-btn", rail);
    shareBtn.type = "button";
    shareBtn.setAttribute("aria-label", "Share");
    el("span", "feed-rail-icon", shareBtn).innerHTML = SHARE;
    el("span", "feed-rail-count", shareBtn, "Share");
    const soundBtn = el("button", "feed-rail-btn feed-rail-sound", rail);
    soundBtn.type = "button";
    soundBtn.setAttribute("aria-label", "Sound");
    const soundIcon = el("span", "feed-rail-icon", soundBtn);
    soundIcon.innerHTML = SPEAKER_OFF;
    const disc = el("span", "feed-disc", rail);
    const discImg = el("img", "", disc);
    discImg.alt = `${album.title} cover`;
    discImg.src = album.cover;
    discImg.decoding = "async";
    const cap = el("div", "feed-cap", node);
    el("p", "feed-cap-user", cap, "herb");
    el("p", "feed-cap-desc", cap, def.desc);
    const song = el("p", "feed-cap-song", cap);
    el("span", "feed-cap-note", song).innerHTML = NOTE;
    const marquee = el("span", "feed-cap-marquee", song);
    const mq = el("span", "feed-cap-run", marquee);
    const songText = `${def.song} · The Beatles · ${album.title}`;
    el("span", "", mq, songText);
    el("span", "", mq, songText);
    const bar = el("div", "feed-progress", node);
    const barFill = el("div", "feed-progress-fill", bar);
    return { def, album, node, art, likeBtn, likeIcon, likeCount, soundIcon, bar, barFill, liked: false, likes: def.likes, lt: i === 0 ? 3.4 : 0, off: 9 };
  });

  const grainFrames = [];
  let grainStep = -1;
  const buildGrain = () => {
    const gw = Math.max(64, Math.round(W));
    const gh = Math.max(64, Math.round(H));
    grain.width = gw;
    grain.height = gh;
    grainFrames.length = 0;
    const rand = rng(77);
    const gctx = grain.getContext("2d");
    for (let f = 0; f < 4; f += 1) {
      const id = gctx.createImageData(gw, gh);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 128 + (rand() - 0.5) * 255;
        id.data[i] = v;
        id.data[i + 1] = v;
        id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      grainFrames.push(id);
    }
    grainStep = -1;
  };

  const wrapOff = (i) => {
    let d = (((i - pos) % n) + n) % n;
    if (d >= n / 2) d -= n;
    return d;
  };

  const nearest = () => ((Math.round(pos) % n) + n) % n;

  const layout = () => {
    const rect = screen.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    if (!W || !H) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    slides.forEach((s) => {
      s.node.style.height = `${H}px`;
      s.art.build(W, H, dpr);
      s.art.reset?.();
      s.art.render(s.lt);
    });
    buildGrain();
    place();
  };

  const place = () => {
    slides.forEach((s, i) => {
      const off = wrapOff(i);
      s.off = off;
      const show = Math.abs(off) < 1.001;
      if (s._show !== show) {
        s._show = show;
        s.node.style.visibility = show ? "visible" : "hidden";
      }
      setT(s.node, `translate3d(0,${(show ? off * H : 0).toFixed(2)}px,0)`);
    });
  };

  const setCurrent = (idx) => {
    if (idx === current) return;
    const prev = slides[current];
    current = idx;
    const s = slides[idx];
    if (prev !== s) {
      s.lt = 0;
      s.art.reset?.();
    }
    slides.forEach((sl, i) => sl.node.toggleAttribute("data-current", i === idx));
    screen.style.setProperty("--feed-grain", String(s.art.grain));
    screen.dataset.top = s.art.top || "dark";
    live.textContent = `${s.def.song}, edit ${idx + 1} of ${n}`;
  };

  const renderGrain = (now) => {
    const step = Math.floor(now / 83) % 4;
    if (step === grainStep || !grainFrames.length) return;
    grainStep = step;
    grain.getContext("2d").putImageData(grainFrames[step], 0, 0);
  };

  const spawnHeart = (x, y) => {
    const h = el("span", "feed-burst", hearts);
    h.innerHTML = HEART;
    const rot = (Math.random() - 0.5) * 34;
    bursts.push({ el: h, x, y, rot, t: 0 });
  };

  const renderBursts = (dt) => {
    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const b = bursts[i];
      b.t += dt;
      const k = b.t;
      let scale;
      if (k < 0.16) scale = 0.3 + (k / 0.16) * 0.9;
      else if (k < 0.3) scale = 1.2 - ((k - 0.16) / 0.14) * 0.2;
      else scale = 1;
      const up = k > 0.45 ? (k - 0.45) * 140 : 0;
      const o = k > 0.45 ? Math.max(0, 1 - (k - 0.45) / 0.35) : Math.min(1, k / 0.06);
      b.el.style.opacity = o.toFixed(3);
      b.el.style.transform = `translate3d(${b.x.toFixed(1)}px,${(b.y - up).toFixed(1)}px,0) translate(-50%,-60%) rotate(${b.rot.toFixed(1)}deg) scale(${(scale * (k > 0.45 ? 1 + (k - 0.45) * 0.4 : 1)).toFixed(3)})`;
      if (k > 0.8) {
        b.el.remove();
        bursts.splice(i, 1);
      }
    }
  };

  const setLiked = (s, on, pop = true) => {
    s.liked = on;
    s.likes += on ? 1 : -1;
    s.likeBtn.setAttribute("aria-pressed", String(on));
    s.likeCount.textContent = fmtCount(s.likes);
    if (pop) {
      s.likeBtn.removeAttribute("data-pop");
      void s.likeBtn.offsetWidth;
      s.likeBtn.setAttribute("data-pop", "");
    }
  };

  const syncBeat = () => {
    if (!audio || !soundOn) return;
    if (paused || !visible || document.hidden) audio.stopBeat();
    else if (!audio._beatOn) audio.startBeat(slides[current].lt);
    audio._beatOn = !(paused || !visible || document.hidden);
  };

  const setPaused = (on) => {
    paused = on;
    root.toggleAttribute("data-paused", on);
    if (audio) audio._beatOn = false;
    syncBeat();
    wake();
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
    lastTime = now;
    let moving = false;
    if (!drag) {
      const a = -STIFF * (pos - target) - DAMP * vel;
      vel += a * dt;
      vel = Math.max(-MAX_V, Math.min(MAX_V, vel));
      pos += vel * dt;
      if (Math.abs(pos - target) < 0.0004 && Math.abs(vel) < 0.01) {
        pos = target;
        vel = 0;
        const wrapped = ((target % n) + n) % n;
        pos = wrapped;
        target = wrapped;
      } else moving = true;
    } else moving = true;
    place();
    setCurrent(nearest());
    const cur = slides[current];
    if (!paused && Math.abs(cur.off) < 0.5) cur.lt += dt;
    slides.forEach((s) => {
      if (Math.abs(s.off) >= 1) return;
      const cue = s.art.render(s.lt);
      if (cue && s === cur && audio) audio.play(cue);
      s.barFill.style.transform = `scaleX(${((s.lt % 12) / 12).toFixed(4)})`;
    });
    renderGrain(now);
    renderBursts(dt);
    const busy = moving || !paused || bursts.length;
    if (busy && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else lastTime = 0;
  };

  const wake = () => {
    if (raf || destroyed || !visible || document.hidden || !W) return;
    lastTime = 0;
    raf = requestAnimationFrame(frame);
  };

  const go = (dir) => {
    const base = Math.round(target);
    target = base + dir;
    audio?.play("swipe");
    wake();
  };

  const localPoint = (e) => {
    const r = screen.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    screen.setPointerCapture(e.pointerId);
    const [x, y] = localPoint(e);
    drag = { id: e.pointerId, x0: x, y0: y, pos0: pos, base: Math.round(pos), t0: performance.now(), samples: [[performance.now(), y]], moved: false };
    vel = 0;
    wake();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y] = localPoint(e);
    const dy = y - drag.y0;
    if (!drag.moved && Math.hypot(x - drag.x0, dy) > 8) drag.moved = true;
    let next = drag.pos0 - dy / H;
    const lo = drag.base - 1;
    const hi = drag.base + 1;
    if (next < lo) next = lo - (1 - Math.exp(-(lo - next) * 3)) / 3;
    if (next > hi) next = hi + (1 - Math.exp(-(next - hi) * 3)) / 3;
    pos = next;
    const now = performance.now();
    drag.samples.push([now, y]);
    while (drag.samples.length > 2 && now - drag.samples[0][0] > 90) drag.samples.shift();
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (screen.hasPointerCapture(e.pointerId)) screen.releasePointerCapture(e.pointerId);
    const [x, y] = localPoint(e);
    if (!d.moved && performance.now() - d.t0 < 350) {
      target = d.base;
      handleTap(x, y);
      wake();
      return;
    }
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const span = Math.max(16, last[0] - first[0]);
    const vy = (last[1] - first[1]) / span;
    vel = Math.max(-MAX_V, Math.min(MAX_V, (-vy * 1000) / H));
    let next = Math.round(pos + vel * 0.14);
    if (Math.abs(vy) > 0.3) next = vy < 0 ? Math.max(next, d.base + 1) : Math.min(next, d.base - 1);
    else if (Math.abs(pos - d.base) > 0.22 && Math.sign(pos - d.base) !== -Math.sign(vel || 0)) next = d.base + Math.sign(pos - d.base);
    next = Math.max(d.base - 1, Math.min(d.base + 1, next));
    if (next !== d.base) audio?.play("swipe");
    target = next;
    wake();
  };

  const handleTap = (x, y) => {
    const now = performance.now();
    if (lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
      clearTimeout(tapTimer);
      lastTap = null;
      spawnHeart(x, y);
      const s = slides[current];
      if (!s.liked) setLiked(s, true);
      else {
        s.likeBtn.removeAttribute("data-pop");
        void s.likeBtn.offsetWidth;
        s.likeBtn.setAttribute("data-pop", "");
      }
      audio?.play("like");
      wake();
      return;
    }
    lastTap = { t: now, x, y };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      lastTap = null;
      setPaused(!paused);
    }, 300);
  };

  const onWheel = (e) => {
    e.preventDefault();
    if (drag) return;
    wheelAcc += e.deltaY;
    const now = performance.now();
    if (Math.abs(wheelAcc) > 36 && now - wheelAt > 480) {
      go(wheelAcc > 0 ? 1 : -1);
      wheelAcc = 0;
      wheelAt = now;
    }
    if (now - wheelAt > 160) wheelAcc *= 0.5;
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "l") {
      const s = slides[current];
      setLiked(s, !s.liked);
      if (s.liked) audio?.play("like");
    } else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      setPaused(!paused);
    }
  };

  const toggleSound = async () => {
    const next = !soundOn;
    const result = await api.setSound(next);
    onSound?.(result);
  };

  const onClick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const s = slides.find((sl) => sl.node.contains(btn));
    if (!s) return;
    if (btn.classList.contains("feed-like")) {
      setLiked(s, !s.liked);
      if (s.liked) audio?.play("like");
    } else if (btn.classList.contains("feed-rail-sound")) toggleSound();
    else audio?.play("pop");
  };

  screen.addEventListener("pointerdown", onDown);
  screen.addEventListener("pointermove", onMove);
  screen.addEventListener("pointerup", onUp);
  screen.addEventListener("pointercancel", onUp);
  screen.addEventListener("wheel", onWheel, { passive: false });
  screen.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => {
    if (!W) return;
    const r = screen.getBoundingClientRect();
    if (Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5) return;
    layout();
    wake();
  });

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (audio) audio._beatOn = false;
    syncBeat();
    wake();
  });
  io.observe(root);
  const onVisibility = () => {
    if (audio) audio._beatOn = false;
    syncBeat();
    wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const boot = async () => {
    await Promise.all([
      document.fonts.load('400 24px "Feed Arimo"'),
      document.fonts.load('400 24px "Feed Tinos"'),
      document.fonts.load('400 12px "Feed Pixel"'),
      document.fonts.load('400 24px "Feed Hand"'),
    ]).catch(() => null);
    await Promise.all(slides.map((s) => s.art.load?.()));
    if (destroyed) return;
    current = -1;
    setCurrent(0);
    slides[0].lt = 3.4;
    layout();
    ro.observe(screen);
    root.setAttribute("data-ready", "");
    onReady?.();
    wake();
  };
  boot();

  const api = {
    async setSound(on) {
      if (on && !audio) audio = createFeedAudio();
      if (!audio) return false;
      const result = await audio.setEnabled(on);
      soundOn = Boolean(result);
      audio._beatOn = false;
      syncBeat();
      slides.forEach((s) => (s.soundIcon.innerHTML = soundOn ? SPEAKER_ON : SPEAKER_OFF));
      root.toggleAttribute("data-sound", soundOn);
      onSound?.(soundOn);
      return soundOn;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(tapTimer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      screen.removeEventListener("pointerdown", onDown);
      screen.removeEventListener("pointermove", onMove);
      screen.removeEventListener("pointerup", onUp);
      screen.removeEventListener("pointercancel", onUp);
      screen.removeEventListener("wheel", onWheel);
      screen.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      audio?.destroy();
      screen.replaceChildren();
    },
  };
  return api;
}
