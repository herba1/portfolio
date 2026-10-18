const HEART = "M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.1 1.7-1.9 3.2-3.1 5.4-3.1 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z";

export function createBurstLayer(layer, covers) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const parts = [];
  let raf = 0;
  let last = 0;
  let coverIndex = 0;

  const make = (kind, size) => {
    const el = document.createElement("span");
    el.className = `like-burst-bit like-burst-bit--${kind}`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    if (kind === "cover") {
      const img = document.createElement("img");
      img.src = covers[coverIndex % covers.length];
      img.alt = "";
      img.draggable = false;
      coverIndex += 1;
      el.appendChild(img);
    } else if (kind === "heart") {
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`;
    }
    layer.appendChild(el);
    return el;
  };

  const tick = (now) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const p = parts[i];
      p.age += dt;
      if (p.age < 0) {
        p.el.style.opacity = "0";
        continue;
      }
      const t = p.age / p.life;
      if (t >= 1) {
        p.el.remove();
        parts.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.spin *= Math.exp(-1.2 * dt);
      const grow = Math.min(1, p.age / 0.09);
      const shrink = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const s = p.scale * (0.3 + 0.7 * grow) * Math.max(0, shrink);
      p.el.style.opacity = String(Math.min(1, shrink * 1.6));
      p.el.style.transform = `translate3d(${p.x - p.size / 2}px, ${p.y - p.size / 2}px, 0) rotate(${p.rot}deg) scale(${s})`;
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  };

  const burst = (x, y, { big = false } = {}) => {
    if (reduce) return;
    const count = big ? 26 : 14;
    const speed = big ? 1 : 0.62;
    for (let i = 0; i < count; i += 1) {
      if (parts.length > 160) parts.shift().el.remove();
      const r = Math.random();
      const kind = r < 0.62 ? "cover" : r < 0.82 ? "heart" : "dot";
      const size = kind === "cover" ? (big ? 26 + Math.random() * 18 : 18 + Math.random() * 10) : kind === "heart" ? 12 + Math.random() * 8 : 6 + Math.random() * 4;
      const fan = i / count;
      const angle = -Math.PI / 2 + (fan - 0.5) * Math.PI * 1.9 + (Math.random() - 0.5) * 0.35;
      const v = (360 + Math.random() * 420) * speed;
      parts.push({
        el: make(kind, size),
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - 120 * speed,
        g: 1300,
        drag: 2.2,
        rot: (Math.random() - 0.5) * 50,
        spin: (Math.random() - 0.5) * 720,
        size,
        scale: 0.85 + Math.random() * 0.3,
        age: -Math.random() * 0.05,
        life: 0.9 + Math.random() * 0.5,
      });
    }
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const destroy = () => {
    cancelAnimationFrame(raf);
    parts.forEach((p) => p.el.remove());
    parts.length = 0;
  };

  return { burst, destroy };
}
