export const MACHINE = {
  width: 560,
  height: 256,
  tapeY: 30,
  reelRadius: 96,
  windowInner: 37,
  windowOuter: 82,
  hubRadius: 30,
  packEmpty: 33,
  packFull: 90,
  takeup: { x: 124, y: 148 },
  supply: { x: 436, y: 148 },
  capstan: { x: 226, y: 35, r: 5 },
  pinch: { x: 226, y: 18, r: 12 },
  leftPivot: { x: 206, y: 74 },
  rightPivot: { x: 354, y: 74 },
  armLength: 36,
  postRadius: 6,
  heads: [
    { x: 254, kind: "play" },
    { x: 280, kind: "record" },
    { x: 306, kind: "erase" },
  ],
};

const REEL_SECONDS = 1200;
const TAKEUP_START = 480;

const round = (value) => Math.round(value * 100) / 100;

export function packRadii(position) {
  const share = Math.min(0.96, Math.max(0.04, (TAKEUP_START + position) / REEL_SECONDS));
  const empty = MACHINE.packEmpty * MACHINE.packEmpty;
  const span = MACHINE.packFull * MACHINE.packFull - empty;
  return {
    takeup: Math.sqrt(empty + share * span),
    supply: Math.sqrt(empty + (1 - share) * span),
  };
}

function tangent(from, centre, radius, side) {
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  const distance = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx);
  const spread = Math.acos(Math.min(1, radius / distance));
  const angle = base + side * spread;
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

function armEnd(pivot, swing, lean) {
  const angle = -Math.PI / 2 + lean + swing;
  return { x: pivot.x + MACHINE.armLength * Math.cos(angle), y: pivot.y + MACHINE.armLength * Math.sin(angle) };
}

export function layoutMachine(radii, leftSwing, rightSwing) {
  const r = MACHINE.postRadius;
  const left = armEnd(MACHINE.leftPivot, leftSwing, -0.11);
  const right = armEnd(MACHINE.rightPivot, rightSwing, 0.11);
  const leftWrap = { x: left.x - r * 0.72, y: left.y - r * 0.7 };
  const rightWrap = { x: right.x + r * 0.72, y: right.y - r * 0.7 };
  const intoTakeup = tangent(leftWrap, MACHINE.takeup, radii.takeup, 1);
  const outOfSupply = tangent(rightWrap, MACHINE.supply, radii.supply, -1);
  const y = MACHINE.tapeY;
  const capstanTop = MACHINE.capstan.y - MACHINE.capstan.r;
  const points = [
    outOfSupply,
    rightWrap,
    { x: right.x, y: right.y - r },
    { x: MACHINE.heads[2].x + 9, y },
    { x: MACHINE.capstan.x, y: capstanTop },
    { x: left.x, y: left.y - r },
    leftWrap,
    intoTakeup,
  ];
  const d = points.map((point, i) => `${i ? "L" : "M"}${round(point.x)} ${round(point.y)}`).join("");
  return { left, right, d };
}

const polar = (cx, cy, r, angle) => [round(cx + r * Math.cos(angle)), round(cy + r * Math.sin(angle))];

function circlePath(cx, cy, r) {
  return `M${round(cx - r)} ${round(cy)}A${r} ${r} 0 1 0 ${round(cx + r)} ${round(cy)}A${r} ${r} 0 1 0 ${round(cx - r)} ${round(cy)}Z`;
}

function windowPath(cx, cy, inner, outer, from, to, corner) {
  const p = (r, a) => polar(cx, cy, r, a).join(" ");
  return [
    `M${p(outer, from + corner / outer)}`,
    `A${outer} ${outer} 0 0 1 ${p(outer, to - corner / outer)}`,
    `Q${p(outer, to)} ${p(outer - corner, to)}`,
    `L${p(inner + corner, to)}`,
    `Q${p(inner, to)} ${p(inner, to - corner / inner)}`,
    `A${inner} ${inner} 0 0 0 ${p(inner, from + corner / inner)}`,
    `Q${p(inner, from)} ${p(inner + corner, from)}`,
    `L${p(outer - corner, from)}`,
    `Q${p(outer, from)} ${p(outer, from + corner / outer)}`,
    "Z",
  ].join("");
}

function spokesPath(cx, cy) {
  const parts = [circlePath(cx, cy, MACHINE.windowOuter + 1.5), circlePath(cx, cy, MACHINE.windowInner - 1.5)];
  const span = (Math.PI * 2) / 3;
  const open = (74 * Math.PI) / 180;
  for (let i = 0; i < 3; i++) {
    const centre = -Math.PI / 2 + i * span;
    parts.push(windowPath(cx, cy, MACHINE.windowInner, MACHINE.windowOuter, centre - open / 2, centre + open / 2, 9));
  }
  return parts.join("");
}

function ringPath(cx, cy, outer, inner) {
  return `${circlePath(cx, cy, outer)}${circlePath(cx, cy, inner)}`;
}

const SPIN_BOX = MACHINE.reelRadius;
const HUB_BOX = 24;
const PINCH_BOX = MACHINE.pinch.r;

function brushedLines() {
  let seed = 1979;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const lines = [];
  for (let i = 0; i < 288; i++) {
    const y = round(next() * MACHINE.height);
    const x = round(next() * MACHINE.width);
    const length = round(80 + next() * 420);
    const light = next() > 0.45;
    const alpha = round(0.006 + next() * 0.01);
    const tone = light ? "#ffffff" : "#0b0d10";
    lines.push(
      `<rect x="${x}" y="${y}" width="${length}" height="${round(0.5 + next() * 0.7)}" fill="${tone}" opacity="${alpha}"/>`,
      `<rect x="${round(x - MACHINE.width)}" y="${y}" width="${length}" height="0.6" fill="${tone}" opacity="${alpha}"/>`,
    );
  }
  return lines.join("");
}

function screw(x, y, angle) {
  const [ax, ay] = polar(x, y, 3.2, angle);
  const [bx, by] = polar(x, y, 3.2, angle + Math.PI);
  const [cx, cy] = polar(x, y, 3.2, angle + Math.PI / 2);
  const [dx, dy] = polar(x, y, 3.2, angle - Math.PI / 2);
  return `<g><circle cx="${x}" cy="${y + 0.6}" r="5" fill="#ffffff" opacity="0.05"/><circle cx="${x}" cy="${y}" r="5" fill="url(#tm-screw)" stroke="#272a2e" stroke-width="0.6"/><path d="M${ax} ${ay}L${bx} ${by}M${cx} ${cy}L${dx} ${dy}" stroke="#25282c" stroke-width="1.1" stroke-linecap="round"/></g>`;
}

function shade(cx, cy, rx, ry, strength) {
  return `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="url(#tm-shade)" opacity="${strength}"/>`;
}

function layer(className, box, attributes, body) {
  const { x, y, half } = box;
  const size = half * 2;
  return `<svg class="tape__machine-layer ${className}" ${attributes} viewBox="${round(x - half)} ${round(y - half)} ${size} ${size}" width="${size}" height="${size}" style="left:${round(x - half)}px;top:${round(y - half)}px" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

function reelWell(centre) {
  const { x, y } = centre;
  const R = MACHINE.reelRadius;
  return `${shade(x + 1, y + 4, R + 6, R + 6, 0.2)}<circle cx="${x}" cy="${y}" r="${R - 2}" fill="url(#tm-well)"/>`;
}

function reelPack(name, centre, pack) {
  const { x, y } = centre;
  return `<circle data-pack="${name}" cx="${x}" cy="${y}" r="${round(pack)}" fill="url(#tm-pack)"/><circle data-pack-edge="${name}" cx="${x}" cy="${y}" r="${round(pack)}" fill="none" stroke="#4a372c" stroke-width="0.8" opacity="0.5"/>`;
}

function reelLayers(name, centre) {
  const { x, y } = centre;
  const R = MACHINE.reelRadius;
  const reelBox = { x, y, half: SPIN_BOX };
  const hubBox = { x, y, half: HUB_BOX };
  const spindle = [0, 1, 2]
    .map((i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const [px, py] = polar(x, y, 8.5, a);
      const deg = round((a * 180) / Math.PI + 90);
      return `<rect x="${round(px - 2.2)}" y="${round(py - 3.6)}" width="4.4" height="7.2" rx="1.6" fill="url(#tm-chrome-v)" transform="rotate(${deg} ${px} ${py})"/>`;
    })
    .join("");
  const bolts = [0, 1, 2]
    .map((i) => {
      const a = -Math.PI / 6 + (i * Math.PI * 2) / 3;
      const [px, py] = polar(x, y, 21, a);
      return `<circle cx="${px}" cy="${py}" r="2.1" fill="#5e6369" stroke="#2f3338" stroke-width="0.6"/>`;
    })
    .join("");
  const blur = layer(
    "tape__reel-blur",
    reelBox,
    `data-blur="${name}"`,
    `<path d="${ringPath(x, y, MACHINE.windowOuter + 1.5, MACHINE.windowInner - 1.5)}" fill="url(#tm-flange)" fill-rule="evenodd"/>`,
  );
  const spin = layer(
    "tape__reel-spin",
    reelBox,
    `data-spin="${name}"`,
    `<path d="${spokesPath(x, y)}" fill="url(#tm-flange)" fill-rule="evenodd" stroke="#34383d" stroke-width="0.7"/><g transform="translate(${x} ${round(y + 60)})"><rect x="-13" y="-6" width="26" height="12" rx="2" fill="#7d786d" stroke="#6b665c" stroke-width="0.5"/><path d="M-9 -1.5H6M-9 2H2" stroke="#3b3a36" stroke-width="1" stroke-linecap="round" opacity="0.6"/></g>`,
  );
  const front = layer(
    "tape__reel-front",
    reelBox,
    "",
    `<path d="${ringPath(x, y, R, MACHINE.windowOuter)}" fill="url(#tm-flange)" fill-rule="evenodd" stroke="#34383d" stroke-width="0.7"/><circle cx="${x}" cy="${y}" r="${R - 1.6}" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.06"/><circle cx="${x}" cy="${y}" r="${MACHINE.windowInner - 1}" fill="url(#tm-flange)" stroke="#34383d" stroke-width="0.7"/><circle cx="${x}" cy="${y}" r="${MACHINE.hubRadius - 3}" fill="url(#tm-hub)" stroke="#2f3338" stroke-width="0.6"/>`,
  );
  const hub = layer(
    "tape__reel-hub",
    hubBox,
    `data-spin-hub="${name}"`,
    `${bolts}<circle cx="${x}" cy="${y}" r="12.5" fill="#16181b"/>${spindle}`,
  );
  const cap = layer(
    "tape__reel-cap",
    reelBox,
    "",
    `<circle cx="${x}" cy="${y}" r="5.5" fill="url(#tm-cap)" stroke="#2f3338" stroke-width="0.5"/><circle cx="${x}" cy="${y}" r="${R}" fill="url(#tm-sheen)"/><circle class="tape__reel-glint" data-glint="${name}" cx="${x}" cy="${y}" r="${R}" fill="url(#tm-glint)"/>`,
  );
  return `${blur}${spin}${front}${hub}${cap}`;
}

function head(spec) {
  const x = spec.x;
  const top = MACHINE.tapeY + 1;
  const gapClass = spec.kind === "play" ? ` class="tape__machine-gap"` : "";
  return `<g>
  ${shade(x, top + 21, 14, 20, 0.4)}
  <path d="M${x - 9} ${top + 28}V${top + 6}Q${x - 9} ${top} ${x} ${top}Q${x + 9} ${top} ${x + 9} ${top + 6}V${top + 28}Z" fill="url(#tm-chrome-h)" stroke="#2a2d31" stroke-width="0.6"/>
  <rect x="${x - 6}" y="${top + 9}" width="12" height="15" rx="1.5" fill="url(#tm-head-face)"/>
  <rect${gapClass} x="${x - 0.6}" y="${top}" width="1.2" height="7" rx="0.6" fill="#2a2f35"/>
</g>`;
}

function defs() {
  return `<defs>
  <linearGradient id="tm-plate" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3b3f44"/>
    <stop offset="0.18" stop-color="#383c41"/>
    <stop offset="0.55" stop-color="#34383c"/>
    <stop offset="0.85" stop-color="#303438"/>
    <stop offset="1" stop-color="#2d3034"/>
  </linearGradient>
  <linearGradient id="tm-plate-light" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.05"/>
    <stop offset="0.3" stop-color="#ffffff" stop-opacity="0.015"/>
    <stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="1" stop-color="#0b0d10" stop-opacity="0.12"/>
  </linearGradient>
  <pattern id="tm-brush" width="${MACHINE.width}" height="${MACHINE.height}" patternUnits="userSpaceOnUse">${brushedLines()}</pattern>
  <radialGradient id="tm-shade" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#0b0d10" stop-opacity="1"/>
    <stop offset="0.5" stop-color="#0b0d10" stop-opacity="0.92"/>
    <stop offset="0.7" stop-color="#0b0d10" stop-opacity="0.62"/>
    <stop offset="0.82" stop-color="#0b0d10" stop-opacity="0.32"/>
    <stop offset="0.92" stop-color="#0b0d10" stop-opacity="0.1"/>
    <stop offset="1" stop-color="#0b0d10" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="tm-flange" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#474b51"/>
    <stop offset="0.3" stop-color="#4b4f55"/>
    <stop offset="0.38" stop-color="#45494f"/>
    <stop offset="0.5" stop-color="#4c5056"/>
    <stop offset="0.62" stop-color="#464a50"/>
    <stop offset="0.74" stop-color="#4a4e54"/>
    <stop offset="0.84" stop-color="#44484e"/>
    <stop offset="0.93" stop-color="#494d53"/>
    <stop offset="1" stop-color="#3f4349"/>
  </radialGradient>
  <linearGradient id="tm-sheen" x1="0.1" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.06"/>
    <stop offset="0.25" stop-color="#ffffff" stop-opacity="0.02"/>
    <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="0.7" stop-color="#0b0d10" stop-opacity="0.05"/>
    <stop offset="1" stop-color="#0b0d10" stop-opacity="0.16"/>
  </linearGradient>
  <radialGradient id="tm-glint" cx="0.64" cy="0.3" r="0.72">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.15"/>
    <stop offset="0.2" stop-color="#ffffff" stop-opacity="0.12"/>
    <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.07"/>
    <stop offset="0.6" stop-color="#ffffff" stop-opacity="0.028"/>
    <stop offset="0.8" stop-color="#ffffff" stop-opacity="0.006"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="tm-well" cx="0.5" cy="0.45" r="0.55">
    <stop offset="0" stop-color="#1f2225"/>
    <stop offset="0.7" stop-color="#25282c"/>
    <stop offset="1" stop-color="#222529"/>
  </radialGradient>
  <radialGradient id="tm-pack" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#2a1f19"/>
    <stop offset="0.45" stop-color="#281d17"/>
    <stop offset="0.55" stop-color="#31241d"/>
    <stop offset="0.66" stop-color="#261b16"/>
    <stop offset="0.78" stop-color="#2f231c"/>
    <stop offset="0.9" stop-color="#241a15"/>
    <stop offset="0.97" stop-color="#35281f"/>
    <stop offset="1" stop-color="#1d1511"/>
  </radialGradient>
  <radialGradient id="tm-hub" cx="0.42" cy="0.38" r="0.7">
    <stop offset="0" stop-color="#565b61"/>
    <stop offset="0.45" stop-color="#4a4f55"/>
    <stop offset="0.8" stop-color="#3f4349"/>
    <stop offset="1" stop-color="#373b40"/>
  </radialGradient>
  <radialGradient id="tm-cap" cx="0.38" cy="0.32" r="0.75">
    <stop offset="0" stop-color="#62676d"/>
    <stop offset="0.5" stop-color="#4b5056"/>
    <stop offset="1" stop-color="#34383d"/>
  </radialGradient>
  <radialGradient id="tm-screw" cx="0.4" cy="0.35" r="0.75">
    <stop offset="0" stop-color="#5d6268"/>
    <stop offset="0.6" stop-color="#4a4f55"/>
    <stop offset="1" stop-color="#3c4045"/>
  </radialGradient>
  <linearGradient id="tm-chrome-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#363a3f"/>
    <stop offset="0.18" stop-color="#4b5056"/>
    <stop offset="0.36" stop-color="#5f646a"/>
    <stop offset="0.55" stop-color="#4f545a"/>
    <stop offset="0.78" stop-color="#43484e"/>
    <stop offset="1" stop-color="#34383d"/>
  </linearGradient>
  <linearGradient id="tm-chrome-v" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6a6f75"/>
    <stop offset="0.5" stop-color="#50555b"/>
    <stop offset="1" stop-color="#3c4045"/>
  </linearGradient>
  <linearGradient id="tm-head-face" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3a3f45"/>
    <stop offset="0.5" stop-color="#2c3035"/>
    <stop offset="1" stop-color="#343940"/>
  </linearGradient>
  <linearGradient id="tm-block" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a2d31"/>
    <stop offset="0.12" stop-color="#25282c"/>
    <stop offset="0.6" stop-color="#1f2225"/>
    <stop offset="1" stop-color="#1a1c1f"/>
  </linearGradient>
  <radialGradient id="tm-rubber" cx="0.4" cy="0.35" r="0.7">
    <stop offset="0" stop-color="#3a3e43"/>
    <stop offset="0.55" stop-color="#222528"/>
    <stop offset="1" stop-color="#141618"/>
  </radialGradient>
  <radialGradient id="tm-post" cx="0.38" cy="0.32" r="0.8">
    <stop offset="0" stop-color="#6a6f75"/>
    <stop offset="0.4" stop-color="#555a60"/>
    <stop offset="0.85" stop-color="#43484e"/>
    <stop offset="1" stop-color="#393d42"/>
  </radialGradient>
  <linearGradient id="tm-window" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d0f12"/>
    <stop offset="0.5" stop-color="#16191d"/>
    <stop offset="1" stop-color="#1b1e22"/>
  </linearGradient>
  <linearGradient id="tm-glass" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.05"/>
    <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.015"/>
    <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
</defs>`;
}

function buildPlate() {
  const { width: W, height: H, takeup, supply, capstan } = MACHINE;
  return `<svg class="tape__machine-layer tape__machine-plate" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
${defs()}
<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="url(#tm-plate)"/>
<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="url(#tm-brush)"/>
<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="url(#tm-plate-light)"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.07"/>
<rect x="0.25" y="0.25" width="${W - 0.5}" height="${H - 0.5}" rx="17.75" fill="none" stroke="#24272b" stroke-width="0.5"/>
${screw(18, 18, 0.5)}${screw(W - 18, 18, 1.2)}${screw(18, H - 18, 2.1)}${screw(W - 18, H - 18, 0.2)}
${shade(280, MACHINE.tapeY + 32, 56, 30, 0.34)}
<rect x="236" y="${MACHINE.tapeY + 8}" width="88" height="40" rx="6" fill="url(#tm-block)"/>
<rect x="236.5" y="${MACHINE.tapeY + 8.5}" width="87" height="39" rx="5.5" fill="none" stroke="#3a3e43" stroke-width="0.6" opacity="0.8"/>
${MACHINE.heads.map(head).join("")}
<rect x="236" y="102" width="88" height="36" rx="7" fill="#ffffff" opacity="0.05"/>
<rect x="236" y="100" width="88" height="36" rx="7" fill="#26292d"/>
<rect x="237" y="101" width="86" height="34" rx="6" fill="url(#tm-window)"/>
<rect x="237" y="101" width="86" height="34" rx="6" fill="url(#tm-glass)"/>
${shade(capstan.x, capstan.y + 1.5, capstan.r + 5, capstan.r + 5, 0.4)}
<circle cx="${capstan.x}" cy="${capstan.y}" r="${capstan.r}" fill="url(#tm-post)" stroke="#2a2d31" stroke-width="0.6"/>
${reelWell(takeup)}
${reelWell(supply)}
</svg>`;
}

function buildThreading() {
  const { width: W, height: H, takeup, supply, pinch } = MACHINE;
  const radii = packRadii(0);
  const rest = layoutMachine(radii, 0, 0);
  const arm = (pivot, end, side) =>
    `<line data-arm-bar="${side}" x1="${pivot.x}" y1="${pivot.y}" x2="${round(end.x)}" y2="${round(end.y)}" stroke="url(#tm-chrome-v)" stroke-width="5" stroke-linecap="round"/>`;
  const pivot = (point) =>
    `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#26292d"/><circle cx="${point.x}" cy="${point.y}" r="2" fill="#55595f"/>`;
  const post = (end, side) =>
    `<circle data-post="${side}" cx="${round(end.x)}" cy="${round(end.y)}" r="${MACHINE.postRadius + 2}" fill="#3d4146"/><circle data-post-cap="${side}" cx="${round(end.x)}" cy="${round(end.y)}" r="${MACHINE.postRadius}" fill="url(#tm-post)" stroke="#2a2d31" stroke-width="0.5"/>`;
  return `<svg class="tape__machine-layer tape__machine-threading" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
${reelPack("takeup", takeup, radii.takeup)}
${reelPack("supply", supply, radii.supply)}
${arm(MACHINE.leftPivot, rest.left, "left")}
${arm(MACHINE.rightPivot, rest.right, "right")}
${pivot(MACHINE.leftPivot)}
${pivot(MACHINE.rightPivot)}
<path data-tape="" d="${rest.d}" fill="none" stroke="#261c16" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
${post(rest.left, "left")}
${post(rest.right, "right")}
${shade(pinch.x + 1, pinch.y + 2.5, pinch.r + 5, pinch.r + 5, 0.42)}
<circle cx="${pinch.x}" cy="${pinch.y}" r="${pinch.r}" fill="url(#tm-rubber)"/>
<circle cx="${pinch.x}" cy="${pinch.y}" r="4.6" fill="url(#tm-cap)" stroke="#2a2d31" stroke-width="0.5"/>
</svg>`;
}

function buildPinch() {
  const { pinch } = MACHINE;
  return layer(
    "tape__pinch-spin",
    { x: pinch.x, y: pinch.y, half: PINCH_BOX },
    'data-spin="pinch"',
    `<rect x="${pinch.x - 1}" y="${pinch.y - pinch.r + 1.5}" width="2" height="5" rx="1" fill="#4a4f55"/>`,
  );
}

function buildMachine() {
  return [
    buildPlate(),
    buildThreading(),
    reelLayers("takeup", MACHINE.takeup),
    reelLayers("supply", MACHINE.supply),
    buildPinch(),
  ].join("");
}

export const MACHINE_MARKUP = buildMachine();
