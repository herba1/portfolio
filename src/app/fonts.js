import localFont from "next/font/local";

/* ── Primary typeface ─────────────────────────────────────────────
 * Adobe Fonts "Helvetica Neue LT Pro" (Typekit kit psc2klr) is the
 * site's main font. The @font-face rules are delivered by the <link>
 * in layout.js; the family is exposed app-wide through the --font-sans
 * token (see globals.css @theme).
 *
 * `sans` mirrors the next/font shape ({ className, variable }) so it
 * drops into the same `${...className}` call sites with no churn. Its
 * className is the `.font-sans-base` helper, which resolves to the
 * token. `geist` is kept as a back-compat alias for existing imports.
 * ─────────────────────────────────────────────────────────────── */
export const sans = {
    className: 'font-sans-base',
    variable: '',
}

// Deprecated name — historical export, now resolves to the Typekit sans.
export const geist = sans

export const spencer = localFont({
    src: '../../public/spencer-regular-webfont.woff2',
    display: 'swap',
})

export const spencerOutlined = localFont({
    src: '../../public/spencer-outlined-webfont.woff2',
    display: 'swap',
})

export const lastik = localFont({
    src: '../../public/lastikfont.otf',
    display: 'swap',
})

// Segmented LCD display faces for the tuner (DSEG, SIL OFL).
// 14-segment renders note letters (incl. ♯), 7-segment renders digits.
export const dsegFourteen = localFont({
    src: '../../public/DSEG14Classic-Bold.woff2',
    display: 'swap',
    variable: '--font-dseg14',
})

export const dsegSeven = localFont({
    src: '../../public/DSEG7Classic-Bold.woff2',
    display: 'swap',
    variable: '--font-dseg7',
})
