import localFont from "next/font/local";

/* Inter — the mono-volt tiles on /work and the whole /psa kit.
 *
 * Both are another product's interface shown as itself, so they carry that
 * product's typeface rather than this site's.
 *
 * Why local and not `next/font/google`: Google's build is stripped the same
 * way its Geist is. Parsing what it actually serves (Inter 4.001, latin
 * subset) shows only
 *   calt ccmp dnom frac locl numr pnum tnum  +  kern mark mkmk
 * — every character variant (cv01–cv14), every stylistic set, `zero` and
 * the `opsz` AXIS ITSELF are gone. /psa asks for cv01…cv11, slashed-zero
 * and `font-optical-sizing: auto`; against Google's file all of that is
 * inert CSS. The official rsms binary carries the full table:
 *   aalt calt case ccmp cv01–cv14 dlig ... ss01–ss08 subs sups tnum zero
 *   axes: opsz 14–32, wght 100–900
 *
 * Subset to latin + latin-ext + punctuation/currency/arrows/math with
 * `--layout-features='*'`, so the feature tables survive the cut: 192 KB
 * for the upright variable. Italic is not loaded — nothing on this site
 * sets Inter italic, and `font-synthesis: none` means nothing fakes it. */
export const inter = localFont({
    src: "../../public/fonts/Inter-Variable.woff2",
    weight: "100 900",
    style: "normal",
    display: "swap",
    variable: "--font-inter",
    fallback: ["ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
});

/* ── Primary typeface ─────────────────────────────────────────────
 * Geist (Vercel, OFL — see public/fonts/GEIST-LICENSE.txt), served
 * through `next/font/local` from the official variable binaries.
 *
 * Why local and not `next/font/google`: Google's build of Geist is
 * stripped. Parsing what it actually serves shows only
 *   ccmp dnom frac kern liga locl numr pnum tnum
 * — all eleven stylistic sets (ss01–ss11) and `calt` are gone. The
 * official binary carries the full set:
 *   aalt case ccmp dlig ... ss01–ss11 subs sups tnum
 * Two files, ~70 KB each, self-hosted and preloaded by next/font.
 *
 * Geist is VARIABLE (wght 100–900), so the whole weight axis is
 * continuous. That's what lets the type scale compensate optically at
 * each size — small text slightly heavier — instead of being pinned to
 * two masters the way the previous Typekit Helvetica was.
 *
 * Exposed as CSS variables, consumed via --font-sans / --font-mono in
 * globals.css. `sans` and `geist` are the same object so existing
 * `${geist.className}` call sites keep working untouched.
 * ─────────────────────────────────────────────────────────────── */
export const sans = localFont({
    src: "../../public/fonts/Geist-Variable.woff2",
    weight: "100 900",
    style: "normal",
    display: "swap",
    variable: "--font-geist-sans",
    fallback: ["ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
})

export const mono = localFont({
    src: "../../public/fonts/GeistMono-Variable.woff2",
    weight: "100 900",
    style: "normal",
    display: "swap",
    variable: "--font-geist-mono",
    fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
})

// Historical name — kept so existing imports/call sites resolve.
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
