const SAMPLES = 32;

const lerp = (from, to, progress) => from + (to - from) * progress;

function upwardNormal(dx, dy) {
  const length = Math.hypot(dx, dy) || 1;
  const nx = dy / length;
  const ny = -dx / length;
  const pointsDown = ny > 0 || (ny === 0 && nx > 0);
  return pointsDown ? [-nx, -ny] : [nx, ny];
}

export function flyAlongArc(instance, bend) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const [running] = instance.group.getAnimations();
  const [from] = running?.effect.getKeyframes() ?? [];
  if (!from?.transform || from.transform === "none") return;

  const { duration, delay } = running.effect.getTiming();
  const easing = from.easing ?? "linear";
  running.cancel();

  const to = instance.group.getComputedStyle();
  const start = new DOMMatrix(from.transform);
  const end = new DOMMatrix(to.transform);
  const dx = end.e - start.e;
  const dy = end.f - start.f;
  const lift = Math.hypot(dx, dy) * bend;
  const [nx, ny] = upwardNormal(dx, dy);
  const endWidth = parseFloat(to.width);
  const endHeight = parseFloat(to.height);
  const startWidth = parseFloat(from.width ?? to.width);
  const startHeight = parseFloat(from.height ?? to.height);

  const keyframes = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const progress = i / SAMPLES;
    const offset = 4 * progress * (1 - progress) * lift;
    const matrix = [
      lerp(start.a, end.a, progress),
      lerp(start.b, end.b, progress),
      lerp(start.c, end.c, progress),
      lerp(start.d, end.d, progress),
      lerp(start.e, end.e, progress) + nx * offset,
      lerp(start.f, end.f, progress) + ny * offset,
    ];
    return {
      offset: progress,
      transform: `matrix(${matrix.join(",")})`,
      width: `${lerp(startWidth, endWidth, progress)}px`,
      height: `${lerp(startHeight, endHeight, progress)}px`,
    };
  });

  const flight = instance.group.animate(keyframes, { duration, delay, easing, fill: "both" });
  return () => flight.cancel();
}
