// The sleeves, drawn rather than photographed: flat colour, one geometric
// idea and a flush-left block of type, in the idiom of Swiss posters and of
// the austere label sleeves of the late seventies. Each is a 160-unit square,
// the open panel's sleeve at its own size, so its type is set at real sizes
// with the tracking the law gives for them, and it scales as vector from the
// pill's 24px thumbnail to the poster without a bitmap step.
//
// The sleeve's type is set in the panel's own face, so the record and the
// column beside it are one piece of typography. All of it is quiet: small
// type, flat fields, no photograph, so the white figures stay the loudest
// element in the frame.

import { trackPx } from "./states";

const U = 160;
const INSET = 12; // the sleeve's margin, the same on every edge
const LINE = 12; // its type's leading
const FIELD = {
  vermilion: "#e2421f",
  cobalt: "#2a3fd0",
  stone: "#dbdbd5",
  yellow: "#efc22b",
  black: "#0b0b0a",
  white: "#ffffff",
};

// one line of sleeve type, at a real size with the law's tracking for it
function Line({ y, size = 9, strong = false, fill, anchor, x = INSET, children }) {
  return (
    <text
      x={anchor === "end" ? U - INSET : x}
      y={y}
      fill={fill}
      textAnchor={anchor}
      style={{
        fontSize: `${size}px`,
        letterSpacing: `${trackPx(size).toFixed(3)}px`,
        fontWeight: strong ? "var(--font-weight-strong)" : "var(--font-weight-meta)",
      }}
    >
      {children}
    </text>
  );
}

// The block every sleeve carries top left: artist, then record, two lines
// on a 12-unit leading, hung from the same inset as the art itself.
function Credit({ track, ink }) {
  return (
    <>
      <Line y={INSET + 8} strong fill={ink}>
        {track.artist}
      </Line>
      <Line y={INSET + 8 + LINE} fill={ink}>
        {track.album}
      </Line>
    </>
  );
}

// Raster: a halftone screen on vermilion, ten cells to the side so it tiles
// the sleeve exactly, the dots swelling from nothing beside the credit to
// touching across the far half, which goes almost solid black.
function Raster({ track }) {
  const dots = [];
  const PITCH = U / 10;
  for (let i = 0; i < 10; i += 1)
    for (let j = 0; j < 10; j += 1) {
      const r = (PITCH / 2) * Math.min(1, Math.max(0, (i + j - 5) / 9));
      if (r < 0.6) continue;
      dots.push(<circle key={`${i}-${j}`} cx={PITCH / 2 + i * PITCH} cy={PITCH / 2 + j * PITCH} r={r} />);
    }
  return (
    <>
      <rect width={U} height={U} fill={FIELD.vermilion} />
      <g fill={FIELD.black}>{dots}</g>
      <Credit track={track} ink={FIELD.black} />
    </>
  );
}

// Door: cobalt, the credit reversed out in white, a catalogue number at the
// far edge, and one black doorway standing on the foot under it, the width
// of two grid steps and run off the bottom edge, so the sleeve is a field
// with a way out of it.
function Door({ track }) {
  const W = 32;
  return (
    <>
      <rect width={U} height={U} fill={FIELD.cobalt} />
      <Credit track={track} ink={FIELD.white} />
      <Line y={INSET + 8} anchor="end" fill={FIELD.white}>
        {track.cat}
      </Line>
      <rect x={U - INSET - W} y={72} width={W} height={U - 72} fill={FIELD.black} />
    </>
  );
}

// Rule: stone grey with a single hairline across two thirds of the way down,
// and nothing else but the credit; a sleeve made almost entirely of air.
function Rule({ track }) {
  return (
    <>
      <rect width={U} height={U} fill={FIELD.stone} />
      <Credit track={track} ink={FIELD.black} />
      <rect x={INSET} y={104} width={U - 2 * INSET} height={0.75} fill={FIELD.black} />
    </>
  );
}

// Bars: yellow, ruled across in black bars that thin toward the credit, run
// off both sides and standing on a margin of yellow at the foot, so the
// sleeve keeps its own edge against the black.
function Bars({ track }) {
  const bars = [];
  let y = U - INSET;
  for (const h of [16, 10, 6, 4, 2, 1]) {
    bars.push(<rect key={h} x={0} y={y - h} width={U} height={h} />);
    y -= h + 6;
  }
  return (
    <>
      <rect width={U} height={U} fill={FIELD.yellow} />
      <g fill={FIELD.black}>{bars}</g>
      <Credit track={track} ink={FIELD.black} />
    </>
  );
}

const SLEEVES = { raster: Raster, door: Door, rule: Rule, bars: Bars };

export default function Sleeve({ track, ...rest }) {
  const Art = SLEEVES[track?.sleeve] || Rule;
  return (
    <svg viewBox={`0 0 ${U} ${U}`} aria-hidden="true" {...rest}>
      {track ? <Art track={track} /> : <rect width={U} height={U} fill={FIELD.stone} />}
    </svg>
  );
}
