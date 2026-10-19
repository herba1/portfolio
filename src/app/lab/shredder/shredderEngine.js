import { drawBinBack, drawBinFront, drawButton, drawHeadBack, drawHeadFront, geometry } from "./shredderBody";

const SEG = 8;
const GRAVITY = 1400;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function createSound() {
  let ctx = null;
  let motor = null;
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }
  function noiseBuffer() {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  return {
    wake() {
      const c = ensure();
      if (c && c.state === "suspended") c.resume();
    },
    tick() {
      if (!ctx || ctx.state !== "running") return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 1800;
      g.gain.setValueAtTime(0.03, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.04);
    },
    start() {
      if (!ctx || ctx.state !== "running" || motor) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(1, t + 0.12);
      out.connect(ctx.destination);
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(70, t);
      o.frequency.linearRampToValueAtTime(96, t + 0.25);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      const og = ctx.createGain();
      og.gain.value = 0.035;
      o.connect(lp).connect(og).connect(out);
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer();
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2600;
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.value = 0.012;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.009;
      lfo.connect(lfoGain).connect(ng.gain);
      n.connect(bp).connect(ng).connect(out);
      o.start(t);
      n.start(t);
      lfo.start(t);
      motor = { out, nodes: [o, n, lfo] };
    },
    stop() {
      if (!ctx || !motor) return;
      const t = ctx.currentTime;
      motor.out.gain.cancelScheduledValues(t);
      motor.out.gain.setValueAtTime(motor.out.gain.value, t);
      motor.out.gain.linearRampToValueAtTime(0, t + 0.18);
      motor.nodes.forEach((n) => n.stop(t + 0.2));
      motor = null;
    },
    destroy() {
      ctx?.close();
      ctx = null;
      motor = null;
    },
  };
}

export async function createShredder({ root, canvas, button, albums, onAlbum, onBusy, onReady }) {
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = createSound();
  const images = await Promise.all(albums.map((a) => loadImage(a.cover)));
  const sans = getComputedStyle(root).getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
  const view = { w: 1, h: 1, dpr: 1, cx: 0, slotY: 0, headBottom: 0, binY: 0 };
  let g = geometry(300);
  let layers = null;
  let pile = null;
  let pileLevel = 0;
  let current = 0;
  let queued = -1;
  let feed = 0;
  let dragging = null;
  let motorOn = false;
  let drop = 1;
  let strips = [];
  let falling = [];
  let raf = 0;
  let last = 0;
  let time = 0;
  let active = true;
  let destroyed = false;
  let dirty = true;
  let glow = 0;

  function layout() {
    const rect = root.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const narrow = view.w < 720;
    const top = narrow ? 140 : 96;
    const bottom = narrow ? 112 : 100;
    const avail = Math.max(240, view.h - top - bottom);
    const S = Math.round(Math.min(view.w * (narrow ? 0.84 : 0.4), 440, avail / 1.62));
    g = geometry(S);
    const stack = g.cover + g.headH + g.lip * 0.4 + g.binH;
    const y0 = top + Math.max(0, (avail - stack) / 2);
    view.cx = view.w / 2;
    view.slotY = y0 + g.cover + 4;
    view.headBottom = view.slotY + g.headH + g.lip * 0.38;
    view.binY = view.headBottom - g.S * 0.03;
    const front = drawHeadFront(g, view.dpr, sans);
    layers = {
      binBack: drawBinBack(g, view.dpr),
      binFront: drawBinFront(g, view.dpr),
      headBack: drawHeadBack(g, view.dpr),
      headFront: front,
    };
    const prev = pile;
    pile = document.createElement("canvas");
    pile.width = Math.round((g.binTop + 8) * view.dpr);
    pile.height = Math.round((g.binH + 8) * view.dpr);
    if (prev && pileLevel > 0) pile.getContext("2d").drawImage(prev, 0, 0, pile.width, pile.height);
    if (button) {
      const b = front.button;
      const x = view.cx - g.headW / 2 + b.x;
      const y = view.slotY - front.top + b.y;
      const size = b.r * 2 + 16;
      button.style.width = `${size}px`;
      button.style.height = `${size}px`;
      button.style.transform = `translate3d(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px, 0)`;
    }
    dirty = true;
  }

  function binPath(c, ox, oy) {
    const inset = (g.binTop - g.binBottom) / 2;
    c.beginPath();
    c.moveTo(ox, oy - (view.binY - view.headBottom) - 2);
    c.lineTo(ox + g.binTop, oy - (view.binY - view.headBottom) - 2);
    c.lineTo(ox + g.binTop - inset, oy + g.binH - 4);
    c.lineTo(ox + inset, oy + g.binH - 4);
    c.closePath();
  }

  function stripX(i) {
    const sw = g.cover / g.strips;
    return view.cx - g.cover / 2 + i * sw;
  }

  function makeStrips() {
    strips = [];
    const rand = (() => {
      let s = current * 977 + 13;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    })();
    for (let i = 0; i < g.strips; i += 1) {
      strips.push({
        i,
        tilt: (i - (g.strips - 1) / 2) * 0.006 + (rand() - 0.5) * 0.03,
        curl: (rand() - 0.5) * 0.012,
        phase: rand() * Math.PI * 2,
        side: rand() < 0.5 ? -1 : 1,
        img: current,
        rest: rand() * g.binH * 0.16 * (1 - (Math.abs(i - (g.strips - 1) / 2) / g.strips) * 0.9),
        drop: 0,
        vy: 0,
      });
    }
  }

  function pileTop() {
    return view.binY + g.binH - 12 - pileLevel;
  }

  function drawStrip(c, s, ox, oy, topY, rows0, rows1) {
    const img = images[s.img];
    const sw = g.cover / g.strips;
    const scale = img.naturalWidth / g.cover;
    const len = rows1 - rows0;
    if (len <= 0) return;
    let x = stripX(s.i) + sw / 2 + ox;
    let y = topY + oy;
    let ang = s.tilt;
    const floor = pileTop() + oy - sw * 0.6 - s.rest;
    const sway = Math.sin(time * 1.6 + s.phase) * 0.0025;
    for (let d = 0; d < len; d += SEG) {
      const seg = Math.min(SEG, len - d);
      const r = rows0 + d;
      if (y + seg * Math.cos(ang) > floor - 2) {
        const lie = s.side * (1.2 + 0.32 * Math.sin(d * 0.07 + s.phase));
        ang += (lie - ang) * 0.45;
      } else ang += s.curl + sway;
      ang = clamp(ang, -1.55, 1.55);
      c.save();
      c.translate(x, y);
      c.rotate(-ang);
      c.drawImage(img, (s.i * sw) * scale, r * scale, sw * scale, seg * scale, -sw / 2 + 0.5, 0, sw - 1, seg + 0.6);
      const shade = Math.abs(Math.sin(ang * 2 + s.phase)) * 0.18;
      if (shade > 0.01) {
        c.fillStyle = `rgb(0 0 0 / ${shade.toFixed(3)})`;
        c.fillRect(-sw / 2 + 0.5, 0, sw - 1, seg + 0.6);
      }
      c.restore();
      x += Math.sin(-ang) * -seg;
      y += Math.cos(ang) * seg;
    }
  }

  function bake(s) {
    const pctx = pile.getContext("2d");
    pctx.save();
    pctx.scale(view.dpr, view.dpr);
    const ox = -(view.cx - g.binTop / 2 - 4);
    const oy = -view.binY;
    binPath(pctx, 4, 0);
    pctx.clip();
    drawStrip(pctx, s, ox, oy, view.headBottom + s.drop, 0, g.cover);
    pctx.restore();
  }

  function render() {
    const d = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (!layers) return;
    const binX = view.cx - g.binTop / 2 - 4;
    ctx.save();
    ctx.translate(view.cx, view.binY + g.binH);
    ctx.scale(1, 0.09);
    const shadowR = g.binTop * 0.62;
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, shadowR);
    shadow.addColorStop(0, "rgb(30 34 40 / 0.26)");
    shadow.addColorStop(0.45, "rgb(30 34 40 / 0.12)");
    shadow.addColorStop(0.75, "rgb(30 34 40 / 0.04)");
    shadow.addColorStop(1, "rgb(30 34 40 / 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, shadowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.drawImage(layers.binBack, binX, view.binY, g.binTop + 8, g.binH + 8);
    ctx.drawImage(pile, binX, view.binY, g.binTop + 8, g.binH + 8);

    ctx.save();
    binPath(ctx, binX + 4, view.binY);
    ctx.clip();
    const emerged = feed - (view.headBottom - view.slotY);
    if (emerged > 0 && strips.length) {
      for (const s of strips) drawStrip(ctx, s, 0, 0, view.headBottom + s.drop, Math.max(0, g.cover - emerged), g.cover);
    }
    for (const f of falling) drawStrip(ctx, f.s, 0, 0, view.headBottom + f.s.drop, 0, g.cover);
    ctx.restore();

    ctx.drawImage(layers.binFront, binX, view.binY, g.binTop + 8, g.binH + 8);
    ctx.drawImage(layers.headBack, view.cx - g.headW / 2 - 4, view.slotY - g.lip * 0.62 - 2, g.headW + 8, g.lip + 8);

    if (feed < g.cover + 1) {
      const img = images[current];
      const entering = easeOut(clamp(drop, 0, 1));
      const y = view.slotY - g.cover + feed - (1 - entering) * 40;
      ctx.save();
      ctx.globalAlpha = clamp(drop * 1.6, 0, 1);
      ctx.beginPath();
      ctx.rect(0, 0, view.w, view.slotY);
      ctx.clip();
      ctx.shadowColor = "rgb(20 24 30 / 0.28)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = "#fff";
      ctx.fillRect(view.cx - g.cover / 2, y, g.cover, g.cover);
      ctx.shadowColor = "transparent";
      ctx.drawImage(img, view.cx - g.cover / 2, y, g.cover, g.cover);
      const sheen = ctx.createLinearGradient(view.cx - g.cover / 2, y, view.cx + g.cover / 2, y + g.cover);
      sheen.addColorStop(0, "rgb(255 255 255 / 0.22)");
      sheen.addColorStop(0.35, "rgb(255 255 255 / 0.04)");
      sheen.addColorStop(0.5, "rgb(255 255 255 / 0)");
      sheen.addColorStop(1, "rgb(0 0 0 / 0.08)");
      ctx.fillStyle = sheen;
      ctx.fillRect(view.cx - g.cover / 2, y, g.cover, g.cover);
      ctx.restore();
    }

    const hf = layers.headFront;
    ctx.drawImage(hf.canvas, view.cx - g.headW / 2 - hf.pad, view.slotY - hf.top - hf.pad, g.headW + hf.pad * 2, g.headH + g.lip + hf.pad * 2);
    const b = hf.button;
    drawButton(ctx, view.cx - g.headW / 2 + b.x, view.slotY - hf.top + b.y, b.r, motorOn, glow);
  }

  function engage() {
    if (motorOn || drop < 1 || feed >= g.cover + g.headH * 2) return;
    motorOn = true;
    dragging = null;
    sound.wake();
    sound.tick();
    sound.start();
    makeStripsIfNeeded();
    onBusy?.(true);
    wake();
  }

  function makeStripsIfNeeded() {
    if (!strips.length) makeStrips();
  }

  function finish() {
    motorOn = false;
    sound.stop();
    for (const s of strips) {
      s.wait = Math.random() * 0.22;
      s.vy = -Math.random() * 40;
      falling.push({ s });
    }
    strips = [];
    const next = queued >= 0 ? queued : (current + 1) % albums.length;
    queued = -1;
    current = next;
    onAlbum?.(current);
    feed = 0;
    drop = 0;
    onBusy?.(false);
  }

  function step(dt) {
    let moving = false;
    time += dt;
    const through = g.cover + (view.headBottom - view.slotY) + 2;
    if (motorOn) {
      feed += dt * (g.cover / 1.7);
      moving = true;
      if (feed >= through) finish();
    } else if (!dragging && feed > 0) {
      feed = Math.max(0, feed - dt * 600);
      moving = true;
    }
    if (drop < 1) {
      drop = reduced ? 1 : Math.min(1, drop + dt / 0.42);
      moving = true;
    }
    if (falling.length) {
      moving = true;
      const keep = [];
      for (const f of falling) {
        if (f.s.wait > 0) {
          f.s.wait -= dt;
          keep.push(f);
          continue;
        }
        f.s.vy += GRAVITY * dt;
        f.s.drop += f.s.vy * dt;
        if (view.headBottom + f.s.drop > pileTop() - g.cover / g.strips - f.s.rest) {
          bake(f.s);
        } else keep.push(f);
      }
      if (keep.length < falling.length) {
        pileLevel = Math.min(g.binH * 0.62, pileLevel + (g.binH * 0.07 * (falling.length - keep.length)) / g.strips);
      }
      falling = keep;
    }
    glow = motorOn ? 1 : Math.max(0, glow - dt * 2);
    if (strips.length && feed > 0) moving = true;
    return moving;
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    const moving = step(dt);
    if (moving || dirty) {
      render();
      dirty = false;
      onReady?.();
    }
    if (moving || strips.length) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || destroyed || !active) return;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onCover(x, y) {
    const top = view.slotY - g.cover + feed;
    return drop >= 1 && Math.abs(x - view.cx) < g.cover / 2 && y > top && y < view.slotY;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = local(e);
    sound.wake();
    if (motorOn || !onCover(x, y)) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    dragging = { id: e.pointerId, y, feed };
    root.dataset.dragging = "";
    makeStripsIfNeeded();
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (!dragging || e.pointerId !== dragging.id) {
      root.toggleAttribute("data-over", onCover(x, y) && !motorOn);
      return;
    }
    feed = clamp(dragging.feed + (y - dragging.y), 0, g.cover * 0.5);
    if (feed > g.S * 0.05) engage();
    dirty = true;
    wake();
  }

  function onUp(e) {
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging = null;
    delete root.dataset.dragging;
    wake();
  }

  layout();
  makeStrips();
  strips = [];
  render();
  onReady?.();

  const ro = new ResizeObserver(() => {
    layout();
    render();
  });
  ro.observe(root);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return {
    setActive(on) {
      active = on;
      if (on) {
        last = 0;
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    shred() {
      engage();
    },
    choose(i) {
      if (motorOn || feed > 0) {
        queued = i;
        return;
      }
      if (i === current) return;
      current = i;
      drop = 0;
      onAlbum?.(current);
      wake();
    },
    empty() {
      if (!pileLevel) return;
      pile.getContext("2d").clearRect(0, 0, pile.width, pile.height);
      pileLevel = 0;
      dirty = true;
      sound.wake();
      sound.tick();
      wake();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      sound.destroy();
    },
  };
}
