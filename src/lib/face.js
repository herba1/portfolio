// The site's face, as static SVG.
//
// The favicon in the tab is drawn live on a canvas (ui/AnimatedFavicon.jsx)
// so it can look at the cursor. Everything that has to be a still image —
// the Apple touch icon, the manifest icons, the generated share cards — is
// drawn from this, with the same geometry as that canvas at rest: a 64-unit
// square, a 28.5 radius head, eyes at (20,26) and (44,26), a 10-radius smile
// centred on (32,41). Change one and change the other.

export const FACE = {
  ink: "#0b0b0c",
  skin: "#f1f5f9",
  white: "#ffffff",
}

export function FaceSvg({ size = 64, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      {...props}
    >
      <circle cx="32" cy="32" r="28.5" fill={FACE.skin} stroke={FACE.ink} strokeWidth="4.2" />
      <ellipse cx="20" cy="26" rx="7.6" ry="9" fill={FACE.white} stroke={FACE.ink} strokeWidth="3" />
      <ellipse cx="44" cy="26" rx="7.6" ry="9" fill={FACE.white} stroke={FACE.ink} strokeWidth="3" />
      <circle cx="20" cy="26" r="4.1" fill={FACE.ink} />
      <circle cx="44" cy="26" r="4.1" fill={FACE.ink} />
      <path
        d="M40.607 46.09 A10 10 0 0 1 23.393 46.09"
        fill="none"
        stroke={FACE.ink}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

// A square tile for the icon routes. `inset` is the fraction of the canvas
// the face occupies: 0.86 for ordinary icons, 0.66 for maskable ones so the
// whole head survives Android's circular and squircle masks (the safe zone
// is the inner 80%).
export function FaceTile({ size, inset = 0.86 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: FACE.skin,
      }}
    >
      <FaceSvg size={Math.round(size * inset)} />
    </div>
  )
}
