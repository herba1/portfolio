import { MACHINE, layoutMachine, packRadii } from "./tapeMachineArt";

export const TAPE_PX_PER_SECOND = 206;

const DEGREES = 180 / Math.PI;
const SWING = 0.16;
const SWING_RATE = 14;
const BLUR_FROM = 6;
const BLUR_TO = 25;
const BLUR_RISE = 40;
const BLUR_FALL = 17;
const PINCH_FADE_FROM = 21;
const PINCH_FADE_TO = 66;
const FALLBACK_DT = 1 / 60;

const smoothstep = (from, to, value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

const roundTo = (value, step) => Math.round(value / step) * step;

export function createTapeMachine(root) {
  const pick = (selector) => root.querySelector(selector);
  const reels = ["takeup", "supply"].map((name) => ({
    name,
    centre: MACHINE[name],
    spin: pick(`[data-spin="${name}"]`),
    hub: pick(`[data-spin-hub="${name}"]`),
    pack: pick(`[data-pack="${name}"]`),
    edge: pick(`[data-pack-edge="${name}"]`),
    blurRing: pick(`[data-blur="${name}"]`),
    angle: 0,
    blur: 0,
    shownAngle: NaN,
    shownBlur: NaN,
    shownRadius: NaN,
  }));
  const tape = pick("[data-tape]");
  const pinch = pick('[data-spin="pinch"]');
  const arms = { left: pick('[data-arm-bar="left"]'), right: pick('[data-arm-bar="right"]') };
  const posts = {
    left: [pick('[data-post="left"]'), pick('[data-post-cap="left"]')],
    right: [pick('[data-post="right"]'), pick('[data-post-cap="right"]')],
  };
  let lastPosition = NaN;
  let pinchAngle = 0;
  let pinchShown = NaN;
  let pinchFadeShown = NaN;
  let swing = 0;
  let shownPath = "";
  let radii = packRadii(0);

  const place = (node, end) => {
    node.setAttribute("cx", String(roundTo(end.x, 0.05)));
    node.setAttribute("cy", String(roundTo(end.y, 0.05)));
  };

  const drawPath = () => {
    const layout = layoutMachine(radii, -swing, swing);
    if (layout.d === shownPath) return;
    shownPath = layout.d;
    tape?.setAttribute("d", layout.d);
    for (const side of ["left", "right"]) {
      const end = layout[side];
      arms[side]?.setAttribute("x2", String(roundTo(end.x, 0.05)));
      arms[side]?.setAttribute("y2", String(roundTo(end.y, 0.05)));
      for (const node of posts[side]) if (node) place(node, end);
    }
  };

  return {
    radiusOf(name) {
      return name === "supply" ? radii.supply : radii.takeup;
    },
    update(position, strain, dt) {
      if (!Number.isFinite(lastPosition)) lastPosition = position;
      let delta = position - lastPosition;
      lastPosition = position;
      if (Math.abs(delta) > 30) delta = 0;
      const seconds = dt > 0 ? dt : FALLBACK_DT;
      radii = packRadii(position);
      const travel = delta * TAPE_PX_PER_SECOND;

      for (const reel of reels) {
        const radius = reel.name === "supply" ? radii.supply : radii.takeup;
        const turn = travel / radius;
        reel.angle = (reel.angle + turn * DEGREES) % 360;
        const spin = Math.abs(turn) / seconds;
        const blurGoal = smoothstep(BLUR_FROM, BLUR_TO, spin);
        const rate = blurGoal > reel.blur ? BLUR_RISE : BLUR_FALL;
        reel.blur += (blurGoal - reel.blur) * (1 - Math.exp(-rate * seconds));
        if (Math.abs(blurGoal - reel.blur) < 0.01) reel.blur = blurGoal;
        const angle = roundTo(reel.angle, 0.05);
        if (angle !== reel.shownAngle) {
          reel.shownAngle = angle;
          const transform = `rotate(${angle}deg)`;
          if (reel.spin) reel.spin.style.transform = transform;
          if (reel.hub) reel.hub.style.transform = transform;
        }
        const blur = roundTo(reel.blur, 0.02);
        if (blur !== reel.shownBlur) {
          reel.shownBlur = blur;
          if (reel.spin) reel.spin.style.opacity = String(roundTo(1 - 0.8 * blur, 0.01));
          if (reel.blurRing) reel.blurRing.style.opacity = String(roundTo(0.38 * blur, 0.01));
        }
        const shownRadius = roundTo(radius, 0.05);
        if (shownRadius !== reel.shownRadius) {
          reel.shownRadius = shownRadius;
          reel.pack?.setAttribute("r", String(shownRadius));
          reel.edge?.setAttribute("r", String(shownRadius));
        }
      }

      const pinchTurn = travel / MACHINE.pinch.r;
      pinchAngle = (pinchAngle + pinchTurn * DEGREES) % 360;
      const pinchRounded = roundTo(pinchAngle, 0.1);
      if (pinchRounded !== pinchShown) {
        pinchShown = pinchRounded;
        if (pinch) pinch.style.transform = `rotate(${pinchRounded}deg)`;
      }
      const fade = roundTo(1 - smoothstep(PINCH_FADE_FROM, PINCH_FADE_TO, Math.abs(pinchTurn) / seconds), 0.05);
      if (fade !== pinchFadeShown) {
        pinchFadeShown = fade;
        if (pinch) pinch.style.opacity = String(fade);
      }

      const swingGoal = SWING * Math.tanh(strain * 0.8);
      swing += (swingGoal - swing) * (1 - Math.exp(-SWING_RATE * seconds));
      if (Math.abs(swingGoal - swing) < 1e-4) swing = swingGoal;
      drawPath();

      return reels.some((reel) => reel.blur > 0) || swing !== swingGoal;
    },
  };
}
