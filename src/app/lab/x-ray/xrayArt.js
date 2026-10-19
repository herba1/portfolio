export const BAG = { width: 1000, height: 600 };

export const ITEMS = [
  { id: "camera", label: "35 mm compact camera, loaded", box: [492, 248, 236, 150], anchor: [610, 262] },
  { id: "cassette", label: "Cassette, a mixtape", box: [632, 336, 226, 160], anchor: [744, 346] },
  { id: "keys", label: "House keys", box: [490, 392, 150, 96], anchor: [566, 404] },
  { id: "pen", label: "Ballpoint pen", box: [736, 244, 140, 96], anchor: [800, 262] },
  { id: "headphones", label: "Wired headphones", box: [320, 238, 210, 200], anchor: [420, 250] },
  { id: "book", label: "Paperback novel", box: [168, 248, 168, 248], anchor: [252, 258] },
  { id: "shirt", label: "Folded shirt", box: [150, 440, 690, 70], anchor: [300, 470] },
];

const BODY =
  "M170 222 C300 196 700 196 830 222 C886 233 906 286 906 366 C906 448 886 503 830 514 C700 532 300 532 170 514 C114 503 94 448 94 366 C94 286 114 233 170 222 Z";

const SAND = "#cdb791";
const SAND_DEEP = "#b8a07a";
const SAND_SOFT = "#d9c6a2";
const LEATHER = "#764327";
const LEATHER_DEEP = "#5c321c";
const LEATHER_SOFT = "#8e5634";
const STITCH = "#e9d9b8";
const METAL = "#b9b3a6";
const METAL_DEEP = "#8d877b";
const ZIP = "#2d2925";

function handles(fill, deep, soft) {
  return `
    <path d="M352 226 C360 120 420 96 500 96 C580 96 640 120 648 226" fill="none" stroke="${deep}" stroke-width="24" stroke-linecap="round"/>
    <path d="M330 232 C338 112 410 80 500 80 C590 80 662 112 670 232" fill="none" stroke="${fill}" stroke-width="24" stroke-linecap="round"/>
    <path d="M336 214 C346 122 414 92 500 92 C586 92 654 122 664 214" fill="none" stroke="${soft}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <path d="M330 232 C338 112 410 80 500 80 C590 80 662 112 670 232" fill="none" stroke="${STITCH}" stroke-width="1.6" stroke-dasharray="5 6" opacity="0.55"/>
    <rect x="456" y="66" width="88" height="38" rx="12" fill="${soft}"/>
    <rect x="456" y="66" width="88" height="38" rx="12" fill="none" stroke="${STITCH}" stroke-width="1.6" stroke-dasharray="5 5" opacity="0.6"/>
    <circle cx="476" cy="85" r="4" fill="${METAL}"/>
    <circle cx="524" cy="85" r="4" fill="${METAL}"/>
  `;
}

function tabs() {
  return [318, 658]
    .map(
      (x) => `
    <rect x="${x - 4}" y="214" width="32" height="60" rx="6" fill="${LEATHER}"/>
    <rect x="${x - 4}" y="214" width="32" height="60" rx="6" fill="none" stroke="${STITCH}" stroke-width="1.4" stroke-dasharray="4 4" opacity="0.6"/>
    <circle cx="${x + 12}" cy="232" r="4.5" fill="${METAL}"/>
    <circle cx="${x + 12}" cy="258" r="4.5" fill="${METAL}"/>
    <circle cx="${x + 11}" cy="231" r="1.6" fill="${METAL_DEEP}"/>
    <circle cx="${x + 11}" cy="257" r="1.6" fill="${METAL_DEEP}"/>`,
    )
    .join("");
}

export function exteriorBag() {
  return `
  <defs>
    <clipPath id="body"><path d="${BODY}"/></clipPath>
    <linearGradient id="fold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.78" stop-color="#000" stop-opacity="0.05"/>
      <stop offset="0.92" stop-color="#000" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.14"/>
    </linearGradient>
  </defs>
  ${handles(LEATHER, LEATHER_DEEP, LEATHER_SOFT)}
  <path d="${BODY}" fill="${SAND}"/>
  <g clip-path="url(#body)">
    <path d="M94 230 C230 214 330 210 500 210 C670 210 770 214 906 230 L906 250 C770 236 670 232 500 232 C330 232 230 236 94 250 Z" fill="${SAND_SOFT}" opacity="0.7"/>
    <path d="M150 300 C240 330 300 318 330 300 M690 312 C740 336 800 330 856 300 M220 420 C260 400 300 404 320 418 M700 430 C740 410 790 414 820 440" fill="none" stroke="${SAND_DEEP}" stroke-width="2.4" stroke-linecap="round" opacity="0.55"/>
    <rect x="94" y="200" width="78" height="340" fill="${LEATHER}"/>
    <rect x="828" y="200" width="78" height="340" fill="${LEATHER}"/>
    <path d="M168 200 L168 540 M832 200 L832 540" stroke="${LEATHER_DEEP}" stroke-width="4"/>
    <path d="M158 206 L158 532 M842 206 L842 532" stroke="${STITCH}" stroke-width="1.6" stroke-dasharray="6 6" opacity="0.6"/>
    <rect x="94" y="478" width="812" height="60" fill="${LEATHER}"/>
    <path d="M94 478 L906 478" stroke="${LEATHER_DEEP}" stroke-width="4"/>
    <path d="M94 488 L906 488" stroke="${STITCH}" stroke-width="1.6" stroke-dasharray="6 6" opacity="0.6"/>
    <rect x="94" y="200" width="812" height="340" fill="url(#fold)"/>
  </g>
  <path d="M188 230 C320 206 680 206 812 230" fill="none" stroke="${ZIP}" stroke-width="9" stroke-linecap="round"/>
  <path d="M188 230 C320 206 680 206 812 230" fill="none" stroke="${METAL_DEEP}" stroke-width="3" stroke-dasharray="1.6 2.4"/>
  <g transform="translate(748 214) rotate(8)">
    <rect x="-6" y="-2" width="12" height="16" rx="3" fill="${METAL}"/>
    <rect x="-9" y="12" width="18" height="34" rx="7" fill="${LEATHER_DEEP}"/>
    <rect x="-5" y="20" width="10" height="18" rx="4" fill="${LEATHER_SOFT}"/>
  </g>
  <rect x="338" y="318" width="324" height="140" rx="20" fill="${SAND_DEEP}" opacity="0.55"/>
  <rect x="338" y="318" width="324" height="140" rx="20" fill="none" stroke="${STITCH}" stroke-width="1.6" stroke-dasharray="6 6" opacity="0.75"/>
  <path d="M360 340 L640 340" stroke="${ZIP}" stroke-width="6" stroke-linecap="round"/>
  <path d="M360 340 L640 340" stroke="${METAL_DEEP}" stroke-width="2" stroke-dasharray="1.4 2.2"/>
  <g transform="translate(612 336)">
    <rect x="-5" y="-2" width="10" height="13" rx="3" fill="${METAL}"/>
    <rect x="-7" y="9" width="14" height="26" rx="6" fill="${LEATHER_DEEP}"/>
  </g>
  ${tabs()}
  <g>
    <path d="M90 318 C78 318 72 330 72 344 C72 358 78 368 90 368" fill="none" stroke="${METAL}" stroke-width="7" stroke-linecap="round"/>
    <path d="M910 318 C922 318 928 330 928 344 C928 358 922 368 910 368" fill="none" stroke="${METAL}" stroke-width="7" stroke-linecap="round"/>
  </g>
  <g>
    <path d="M362 148 C340 170 320 214 300 262" fill="none" stroke="#b5452f" stroke-width="2.4" stroke-linecap="round"/>
    <g transform="translate(300 262) rotate(14)">
      <path d="M-34 10 L-14 -6 L14 -6 L34 10 L34 118 Q34 124 28 124 L-28 124 Q-34 124 -34 118 Z" fill="#f2e8d3"/>
      <path d="M-34 10 L-14 -6 L14 -6 L34 10 L34 118 Q34 124 28 124 L-28 124 Q-34 124 -34 118 Z" fill="none" stroke="#d8c9a8" stroke-width="1.4"/>
      <circle cx="0" cy="8" r="5" fill="#d6c6a3"/>
      <circle cx="0" cy="8" r="2.5" fill="${SAND_DEEP}"/>
      <path d="M-22 40 C-12 36 -4 42 6 38 C12 36 18 38 22 36 M-22 58 C-10 54 0 60 14 56 M-22 76 C-14 73 -6 78 4 75" fill="none" stroke="#3b4a6b" stroke-width="2" stroke-linecap="round"/>
      <rect x="-22" y="94" width="44" height="14" rx="2" fill="#e3d4b3"/>
    </g>
  </g>`;
}

const X_ORGANIC = "rgb(236 146 52)";
const X_PLASTIC = "rgb(78 168 104)";
const X_METAL = "rgb(46 92 196)";
const X_DENSE = "rgb(22 34 92)";

function key(x, y, angle, length, scale = 1) {
  const teeth = [];
  for (let i = 0; i < 5; i += 1) {
    const tx = 30 + i * ((length - 40) / 5);
    teeth.push(`L${tx} ${8 + (i % 2 ? 6 : 10)} L${tx + (length - 40) / 10} 8`);
  }
  return `
    <g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
      <path d="M-26 -16 Q-36 -16 -36 -6 L-36 6 Q-36 16 -26 16 L-4 16 Q4 16 6 8 L${length} 8 L${length} -2 L${length - 6} -8 L6 -8 Q4 -16 -4 -16 Z ${teeth.join(" ")}" fill="${X_METAL}" fill-opacity="0.78" stroke="${X_DENSE}" stroke-width="1.6" stroke-opacity="0.6"/>
      <circle cx="-22" cy="0" r="6" fill="#eef3f6"/>
    </g>`;
}

export function xrayBag() {
  return `
  <defs><clipPath id="xbody"><path d="${BODY}"/></clipPath></defs>
  <g style="mix-blend-mode:multiply">
    <path d="M352 226 C360 120 420 96 500 96 C580 96 640 120 648 226" fill="none" stroke="${X_ORGANIC}" stroke-opacity="0.18" stroke-width="24" stroke-linecap="round"/>
    <path d="M330 232 C338 112 410 80 500 80 C590 80 662 112 670 232" fill="none" stroke="${X_ORGANIC}" stroke-opacity="0.24" stroke-width="24" stroke-linecap="round"/>
    <rect x="456" y="66" width="88" height="38" rx="12" fill="${X_ORGANIC}" fill-opacity="0.3"/>
    <circle cx="476" cy="85" r="4" fill="${X_DENSE}"/>
    <circle cx="524" cy="85" r="4" fill="${X_DENSE}"/>
  </g>
  <g style="mix-blend-mode:multiply">
    <path d="${BODY}" fill="${X_ORGANIC}" fill-opacity="0.1" stroke="${X_ORGANIC}" stroke-opacity="0.4" stroke-width="3"/>
    <path d="M94 200 L172 200 L172 540 L94 540 Z M828 200 L906 200 L906 540 L828 540 Z M94 478 L906 478 L906 540 L94 540 Z" fill="${X_ORGANIC}" fill-opacity="0.14" clip-path="url(#xbody)"/>
    <path d="M188 230 C320 206 680 206 812 230" fill="none" stroke="${X_METAL}" stroke-width="5" stroke-dasharray="2 2.4" stroke-opacity="0.85"/>
    <path d="M360 340 L640 340" fill="none" stroke="${X_METAL}" stroke-width="3.4" stroke-dasharray="1.6 2.2" stroke-opacity="0.75"/>
    <rect x="742" y="212" width="12" height="16" rx="3" fill="${X_DENSE}" transform="rotate(8 748 214)"/>
    <rect x="607" y="334" width="10" height="13" rx="3" fill="${X_DENSE}"/>
    <path d="M90 318 C78 318 72 330 72 344 C72 358 78 368 90 368 M910 318 C922 318 928 330 928 344 C928 358 922 368 910 368" fill="none" stroke="${X_DENSE}" stroke-width="7" stroke-linecap="round"/>
    ${[330, 330, 670, 670].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 258 : 232}" r="4.5" fill="${X_DENSE}"/>`).join("")}
    <path d="M150 282 L850 282 L850 498 L150 498" fill="none" stroke="${X_PLASTIC}" stroke-opacity="0.22" stroke-width="2"/>
  </g>

  <g style="mix-blend-mode:multiply">
    <path d="M160 452 C300 436 700 436 840 452 L846 506 C700 520 300 520 154 506 Z" fill="${X_ORGANIC}" fill-opacity="0.26"/>
    <path d="M190 470 C320 458 520 462 610 470 M240 488 C380 480 640 482 800 490 M620 462 C700 456 780 458 830 466" fill="none" stroke="${X_ORGANIC}" stroke-opacity="0.5" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M520 452 L540 470 L560 452" fill="none" stroke="${X_ORGANIC}" stroke-opacity="0.45" stroke-width="2"/>
  </g>

  <g transform="translate(252 372) rotate(-9)" style="mix-blend-mode:multiply">
    <rect x="-76" y="-116" width="152" height="232" rx="4" fill="${X_ORGANIC}" fill-opacity="0.52" stroke="${X_ORGANIC}" stroke-width="2.4"/>
    <rect x="-76" y="-116" width="16" height="232" fill="${X_ORGANIC}" fill-opacity="0.4"/>
    ${Array.from({ length: 9 }, (_, i) => `<path d="M${-56 + i * 14} -110 L${-56 + i * 14} 110" stroke="${X_ORGANIC}" stroke-opacity="0.16" stroke-width="1.4"/>`).join("")}
    <path d="M70 -110 L70 110" stroke="${X_ORGANIC}" stroke-opacity="0.5" stroke-width="3"/>
  </g>

  <g transform="translate(420 338)" style="mix-blend-mode:multiply">
    <path d="M-64 46 C-74 -40 -36 -96 4 -96 C48 -96 84 -40 70 52" fill="none" stroke="${X_PLASTIC}" stroke-opacity="0.6" stroke-width="16" stroke-linecap="round"/>
    <path d="M-64 46 C-74 -40 -36 -96 4 -96 C48 -96 84 -40 70 52" fill="none" stroke="${X_METAL}" stroke-opacity="0.7" stroke-width="3"/>
    <g transform="translate(-60 52)">
      <circle r="50" fill="${X_ORGANIC}" fill-opacity="0.34" stroke="${X_ORGANIC}" stroke-opacity="0.6" stroke-width="2"/>
      <circle r="34" fill="${X_PLASTIC}" fill-opacity="0.5" stroke="${X_PLASTIC}" stroke-width="2"/>
      <circle r="15" fill="${X_DENSE}" fill-opacity="0.9"/>
      <circle r="24" fill="none" stroke="${X_METAL}" stroke-width="3" stroke-opacity="0.8"/>
    </g>
    <g transform="translate(70 60)">
      <circle r="50" fill="${X_ORGANIC}" fill-opacity="0.34" stroke="${X_ORGANIC}" stroke-opacity="0.6" stroke-width="2"/>
      <circle r="34" fill="${X_PLASTIC}" fill-opacity="0.5" stroke="${X_PLASTIC}" stroke-width="2"/>
      <circle r="15" fill="${X_DENSE}" fill-opacity="0.9"/>
      <circle r="24" fill="none" stroke="${X_METAL}" stroke-width="3" stroke-opacity="0.8"/>
    </g>
    <path d="M70 108 C76 132 44 124 24 134 C4 144 20 160 50 154 C80 148 104 150 116 140" fill="none" stroke="${X_PLASTIC}" stroke-opacity="0.75" stroke-width="3.4" stroke-linecap="round"/>
    <rect x="114" y="126" width="9" height="24" rx="3" fill="${X_DENSE}" transform="rotate(-60 118 138)"/>
  </g>

  <g transform="translate(610 324) rotate(5)" style="mix-blend-mode:multiply">
    <rect x="-116" y="-64" width="232" height="128" rx="18" fill="${X_PLASTIC}" fill-opacity="0.46" stroke="${X_PLASTIC}" stroke-width="2.6"/>
    <rect x="-100" y="-50" width="44" height="92" rx="10" fill="${X_METAL}" fill-opacity="0.5" stroke="${X_METAL}" stroke-width="2"/>
    <rect x="-86" y="-58" width="16" height="10" rx="2" fill="${X_METAL}" fill-opacity="0.8"/>
    <circle cx="-78" cy="-4" r="8" fill="${X_DENSE}" fill-opacity="0.85"/>
    <path d="M-56 -40 L56 -40 M-56 40 L56 40" stroke="${X_ORGANIC}" stroke-opacity="0.6" stroke-width="10"/>
    <circle cx="80" cy="0" r="24" fill="${X_METAL}" fill-opacity="0.55" stroke="${X_METAL}" stroke-width="2"/>
    <circle cx="80" cy="0" r="9" fill="${X_DENSE}" fill-opacity="0.8"/>
    <circle cx="6" cy="6" r="48" fill="${X_PLASTIC}" fill-opacity="0.3"/>
    <circle cx="6" cy="6" r="48" fill="none" stroke="${X_METAL}" stroke-width="5" stroke-opacity="0.85"/>
    <circle cx="6" cy="6" r="38" fill="none" stroke="${X_METAL}" stroke-width="3" stroke-opacity="0.7"/>
    <circle cx="6" cy="6" r="26" fill="${X_PLASTIC}" fill-opacity="0.35" stroke="${X_METAL}" stroke-width="2" stroke-opacity="0.6"/>
    <circle cx="6" cy="6" r="13" fill="none" stroke="${X_METAL}" stroke-width="2.4" stroke-opacity="0.75"/>
    <rect x="62" y="-78" width="26" height="14" rx="3" fill="${X_METAL}" fill-opacity="0.85"/>
    <rect x="-36" y="-60" width="40" height="18" rx="3" fill="${X_PLASTIC}" fill-opacity="0.55" stroke="${X_PLASTIC}" stroke-width="1.6"/>
    <rect x="36" y="-58" width="18" height="34" rx="3" fill="${X_DENSE}" fill-opacity="0.8"/>
    <path d="M-40 -28 L-24 -28 L-24 -16 M30 34 L48 34 L48 46 M-30 44 L-18 52 L-6 44" fill="none" stroke="${X_METAL}" stroke-width="1.6" stroke-opacity="0.7"/>
  </g>

  <g transform="translate(745 416) rotate(-12)" style="mix-blend-mode:multiply">
    <rect x="-104" y="-66" width="208" height="132" rx="10" fill="${X_PLASTIC}" fill-opacity="0.44" stroke="${X_PLASTIC}" stroke-width="2.6"/>
    <rect x="-70" y="-30" width="140" height="44" rx="6" fill="none" stroke="${X_PLASTIC}" stroke-opacity="0.8" stroke-width="2"/>
    <circle cx="-46" cy="-8" r="40" fill="${X_ORGANIC}" fill-opacity="0.55"/>
    <circle cx="46" cy="-8" r="26" fill="${X_ORGANIC}" fill-opacity="0.55"/>
    ${[-46, 46]
      .map(
        (cx) => `<circle cx="${cx}" cy="-8" r="12" fill="#eef3f6" stroke="${X_METAL}" stroke-width="3"/>
      ${Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return `<path d="M${(cx + Math.cos(a) * 7).toFixed(1)} ${(-8 + Math.sin(a) * 7).toFixed(1)} L${(cx + Math.cos(a) * 11).toFixed(1)} ${(-8 + Math.sin(a) * 11).toFixed(1)}" stroke="${X_METAL}" stroke-width="2.4"/>`;
      }).join("")}`,
      )
      .join("")}
    <path d="M-46 32 L-30 60 L30 60 L46 32" fill="none" stroke="${X_ORGANIC}" stroke-opacity="0.6" stroke-width="3"/>
    <rect x="-10" y="48" width="20" height="8" fill="${X_METAL}" fill-opacity="0.8"/>
    ${[
      [-94, -56],
      [94, -56],
      [-94, 56],
      [94, 56],
      [0, 50],
    ]
      .map(([sx, sy]) => `<circle cx="${sx}" cy="${sy}" r="4.6" fill="${X_DENSE}"/>`)
      .join("")}
  </g>

  <g style="mix-blend-mode:multiply">
    <circle cx="566" cy="436" r="20" fill="none" stroke="${X_DENSE}" stroke-width="4.4"/>
    ${key(584, 446, 14, 92)}
    ${key(550, 452, 158, 78, 0.9)}
    ${key(578, 420, -28, 66, 0.75)}
    <path d="M548 420 C524 400 500 406 496 422 C492 440 516 448 546 436 Z" fill="${X_ORGANIC}" fill-opacity="0.45" stroke="${X_ORGANIC}" stroke-width="1.6"/>
  </g>
  <g transform="translate(806 292) rotate(24)" style="mix-blend-mode:multiply">
    <rect x="-70" y="-7" width="140" height="14" rx="7" fill="${X_PLASTIC}" fill-opacity="0.5" stroke="${X_PLASTIC}" stroke-width="1.6"/>
    <path d="M-62 0 L44 0" stroke="${X_ORGANIC}" stroke-opacity="0.7" stroke-width="4"/>
    <path d="M44 -3 L52 3 L56 -3 L60 3 L64 -3" fill="none" stroke="${X_DENSE}" stroke-width="1.8"/>
    <path d="M66 -3 L80 0 L66 3 Z" fill="${X_DENSE}"/>
    <rect x="-66" y="-12" width="44" height="5" rx="2" fill="${X_METAL}" fill-opacity="0.85"/>
  </g>
  <g style="mix-blend-mode:multiply">
    <circle cx="468" cy="488" r="11" fill="${X_DENSE}" fill-opacity="0.85"/>
    <circle cx="482" cy="494" r="9" fill="${X_DENSE}" fill-opacity="0.85"/>
    <circle cx="214" cy="500" r="10" fill="${X_DENSE}" fill-opacity="0.85"/>
  </g>`;
}

export function belt(width, top, height, xray) {
  if (xray) {
    return `
    <rect x="0" y="${top}" width="${width}" height="${height}" fill="rgb(120 150 160)" fill-opacity="0.16"/>
    <rect x="0" y="${top}" width="${width}" height="2" fill="rgb(46 92 196)" fill-opacity="0.35"/>
    <rect x="0" y="${top + height - 2}" width="${width}" height="2" fill="rgb(46 92 196)" fill-opacity="0.25"/>`;
  }
  const seams = [];
  for (let x = -40; x < width + 40; x += 120) seams.push(`<path d="M${x} ${top + 6} L${x} ${top + height - 4}" stroke="#26282a" stroke-width="2"/>`);
  return `
    <rect x="0" y="${top}" width="${width}" height="${height}" fill="#34373a"/>
    <rect x="0" y="${top}" width="${width}" height="3" fill="#4d5155"/>
    <rect x="0" y="${top + 3}" width="${width}" height="10" fill="#3b3e42"/>
    ${seams.join("")}
    <rect x="0" y="${top + height - 6}" width="${width}" height="6" fill="#2a2c2e"/>`;
}

export const PAGE = "#ecebe6";
export const FILM = "#eef3f6";

export function stageLayout(width, height) {
  const portrait = height > width * 1.1;
  const scale = Math.min((width * (portrait ? 0.92 : 0.8)) / BAG.width, (height * (portrait ? 0.42 : 0.62)) / BAG.height);
  const beltTop = Math.round(height * (portrait ? 0.66 : 0.72));
  const beltHeight = Math.round(Math.max(56, height * (portrait ? 0.08 : 0.12)));
  const x = (width - BAG.width * scale) / 2;
  const y = beltTop - 528 * scale;
  return { scale, x, y, beltTop, beltHeight };
}

export function stageSvg(kind, width, height) {
  const { scale, x, y, beltTop, beltHeight } = stageLayout(width, height);
  const xray = kind === "xray";
  const ground = xray ? FILM : PAGE;
  const shadow = xray
    ? ""
    : `<ellipse cx="${width / 2}" cy="${beltTop + 6}" rx="${(BAG.width * scale) / 2.15}" ry="${12 * scale + 4}" fill="#000" fill-opacity="0.32"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${ground}"/>
  ${belt(width, beltTop, beltHeight, xray)}
  ${shadow}
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})">${xray ? xrayBag() : exteriorBag()}</g>
</svg>`;
}
