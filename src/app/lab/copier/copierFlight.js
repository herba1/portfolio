import { springProgress } from "./copierMotion";

const DROP_PX = 24;
const DROP_MS = 130;
const RETURN_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

function centreOffset(sheetRect, pileRect, nudge) {
  return {
    dx: pileRect.left + pileRect.width / 2 + nudge.x - (sheetRect.left + sheetRect.width / 2),
    dy: pileRect.top + pileRect.height / 2 + nudge.y - (sheetRect.top + sheetRect.height / 2),
    scale: pileRect.width / Math.max(sheetRect.width, 1),
  };
}

function towardPile(offset, rotate, progress, drop) {
  const scale = 1 + (offset.scale - 1) * progress;
  return `translate(${(offset.dx * progress).toFixed(2)}px, ${(offset.dy * progress + drop).toFixed(2)}px) rotate(${(rotate * progress).toFixed(3)}deg) scale(${scale.toFixed(4)})`;
}

let flightStamp = 0;

export function flyCopy({ sheet, sheetRect, pileRect, direction, rotate = 0, nudge = { x: 0, y: 0 } }) {
  const node = sheet;
  for (const running of node.getAnimations()) running.cancel();
  flightStamp += 1;
  node.dataset.flight = String(flightStamp);
  node.className = "copier-flight";
  node.setAttribute("aria-hidden", "true");
  node.style.left = `${sheetRect.left}px`;
  node.style.top = `${sheetRect.top}px`;
  node.style.width = `${sheetRect.width}px`;
  node.style.height = `${sheetRect.height}px`;
  const offset = centreOffset(sheetRect, pileRect, nudge);

  let frames;
  let timing;
  if (direction === "out") {
    const spring = springProgress(420, 0.18, 36);
    const total = DROP_MS + spring.durationMs;
    frames = [];
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      frames.push({ offset: (DROP_MS * t) / total, transform: towardPile(offset, rotate, 0, DROP_PX * t * t) });
    }
    spring.values.forEach((value, index) => {
      if (index === 0) return;
      const at = DROP_MS + (spring.durationMs * index) / (spring.values.length - 1);
      frames.push({ offset: Math.min(at / total, 1), transform: towardPile(offset, rotate, value, DROP_PX * (1 - Math.min(value, 1))) });
    });
    frames[frames.length - 1].offset = 1;
    timing = { duration: total, easing: "linear", fill: "forwards" };
  } else {
    frames = [{ transform: towardPile(offset, rotate, 1, 0) }, { transform: towardPile(offset, rotate, 0, 0) }];
    timing = { duration: 460, easing: RETURN_EASE, fill: "forwards" };
  }

  node.style.transform = frames[0].transform;
  document.body.appendChild(node);
  const animation = node.animate(frames, timing);
  const finished = animation.finished.then(
    () => node,
    () => node,
  );
  return { node, finished };
}

export function settleNode(node) {
  const stamp = node.dataset.flight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (node.dataset.flight !== stamp) return;
      for (const running of node.getAnimations()) running.cancel();
      node.remove();
    });
  });
}
