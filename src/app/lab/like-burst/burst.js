const HEART = "M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.1 1.7-1.9 3.2-3.1 5.4-3.1 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z";
const TINTS = ["#ff2d55", "#ff2d55", "#ff5c7c", "#ff8fa6"];
const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";

export function createBurstLayer(layer) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const groups = [];

  const drop = (group) => {
    group.anims.forEach((a) => a.cancel());
    group.els.forEach((el) => el.remove());
    const i = groups.indexOf(group);
    if (i >= 0) groups.splice(i, 1);
  };

  const piece = (kind, size, tint) => {
    const el = document.createElement("span");
    el.className = `like-burst-bit like-burst-bit--${kind}`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.color = tint;
    if (kind === "heart") el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`;
    return el;
  };

  const burst = (x, y, { big = false } = {}) => {
    if (reduce) return;
    while (groups.length > 3) drop(groups[0]);
    const group = { els: [], anims: [] };
    groups.push(group);
    const hearts = big ? 14 : 10;
    const dots = big ? 14 : 10;
    const reach = big ? [150, 260] : [72, 132];
    const total = hearts + dots;
    let left = total;
    const spin = Math.random() * Math.PI * 2;
    for (let i = 0; i < total; i += 1) {
      const isHeart = i < hearts;
      const k = isHeart ? i / hearts : (i - hearts + 0.5) / dots;
      const angle = spin + k * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const dist = isHeart ? reach[0] + Math.random() * (reach[1] - reach[0]) : reach[0] * (0.55 + Math.random() * 0.3);
      const size = isHeart ? (big ? 22 + Math.random() * 18 : 16 + Math.random() * 10) : big ? 8 : 6;
      const el = piece(isHeart ? "heart" : "dot", size, TINTS[i % TINTS.length]);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      layer.appendChild(el);
      group.els.push(el);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const tilt = isHeart ? (Math.random() - 0.5) * 50 : 0;
      const duration = (big ? 900 : 640) + Math.random() * 160;
      const anim = el.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.2)", opacity: 1, easing: EASE_OUT },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${tilt}deg) scale(1)`, opacity: 1, offset: 0.62, easing: "cubic-bezier(.5, 0, .75, 0)" },
          { transform: `translate(calc(-50% + ${dx * 1.08}px), calc(-50% + ${dy * 1.08 + 12}px)) rotate(${tilt}deg) scale(0)`, opacity: 1 },
        ],
        { duration, delay: isHeart ? 0 : 30, fill: "both" },
      );
      group.anims.push(anim);
      anim.onfinish = () => {
        left -= 1;
        if (left === 0) drop(group);
      };
    }
  };

  const destroy = () => {
    while (groups.length) drop(groups[0]);
  };

  return { burst, destroy };
}
