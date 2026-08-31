# Type system — enforced

Run `npm run lint:type` before shipping type changes. It fails the build on violations in enforced paths.

## The law

Tracking is a function of size, never a constant:

```
tracking_px = -0.043 x (size_px - 12)
```

It crosses zero at 12px. Above 12px type tightens; below 12px it opens back up and goes positive. `0.043` is calibrated for Geist and Inter. A rounder face needs a larger constant — measure it, don't guess.

Below 20px tracking is written in absolute `px`. At 20px and up it is written in `em` so it scales with the type.

Never write a tracking value that is not the law's answer for that size. Never use `tracking-tight`, `tracking-tighter`, `tracking-wide`, or any other fixed tracking utility — one value cannot be correct at more than one size. If type is fluid (`clamp`), reference a scale token: `tracking-[var(--text-title-lg--letter-spacing)]`.

## The scale is the source of truth

`src/app/globals.css` defines every step as a `--text-*` token carrying its own size, line-height, tracking and weight. Use the tokens (`text-ui-lg`, `text-body`, `text-title`, …). Do not hand-assemble a size + weight + leading + tracking stack — that is four independent numbers that will drift.

## Weight ladder

Only these weights exist. They come from `--font-weight-*` tokens, never as bare numbers:

```
430  serif italic emphasis      520  11px caption
440  14px meta                  540  10px body
450  body, small text           550/560  subsection heading
460  body                       590/600  section heading, strong
490  13px body                  700  display only — reach for 600 first
```

Hierarchy comes from **weight, not size**. A heading one step up in size and firmly heavier stays in the same conversation; a large size jump shouts. Body sits at 460, not 400 — 400 goes thin and grey at small sizes.

## Leading

Whole pixels, not ratios, anywhere text needs to sit on a rhythm. `1.5` on 14px gives 21px lines that drift off any grid. Headings may use `normal` and let the font's metrics decide.

## Vertical spacing — the 4px grid

Every **vertical** measurement is a multiple of 4px: line-heights, top/bottom margins and padding, row gaps. The invariant is what makes it work — if every value is a multiple of 4, any sum of them is too, so composition can never drift. One 6px margin knocks everything below it off, and no correct line-height downstream recovers it.

Horizontal spacing is not covered. Side padding and column gaps do not affect vertical rhythm, so `gap-1.5` on an icon row is fine.

Banned: `p-1.5`, `py-2.5`, `mt-0.5` and friends — the `.5` Tailwind steps land on 2, 6, 10, 14px. Use whole steps.

## Inline atoms

Anything living inside a line — `code`, `sup`, badges — is sized in `em` and pinned to `line-height: 1`, so it never stretches the line box.

## Banned

- **All-caps UI text.** Use size and weight to signal a label tier.
- **Faded text** (low opacity, or ink below the secondary token) to mean "less important". Step the weight down to 430 instead and keep full-strength ink.
- **Fixed tracking utilities** and magic tracking values.
- **Bare numeric font weights** in CSS.

## Craft defaults

Every page root sets `font-synthesis: none`, `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`, `text-rendering: optimizeLegibility`. Headings get `text-wrap: balance`. Columns of numbers get `tabular-nums`.

## Emphasis

`em` swaps to the serif and must be compensated on four axes at once, or it lands bigger, heavier and tighter than its neighbours: size up (`1.07em`), weight down (`430`), tracking opened (`+0.16px`), `font-variation-settings: "opsz" 10`.

## Enforced paths

`src/app/tierlist`, `src/app/blog`, `src/app/(blog)`, `src/app/song-search`, `src/app/bio` fail the check. Everywhere else reports as warnings — fix them as you touch them, and add the directory to `ENFORCED` in `scripts/check-type-system.mjs` once it is clean.

## Exception on file

`song-search` keeps its own font sizes and line-heights by decision. Everything else — tracking, weights, craft defaults — follows the system.

# Lab — generated experiments

`src/app/lab/<slug>/` holds agent-built candidates; each carries an `experiment.json` manifest (`status`: candidate → liked/rejected → shipped). `scripts/lab-registry.mjs` generates `src/app/lab/registry.js` from the manifests before dev, build and lint; the experiments index and dev links read from it, so never edit those files to register a lab piece. Judge candidates at `/taste` (localhost only); votes, notes, and pointed elements live in `taste/*.jsonl`. `npm run lab:run` builds a batch: supply → generate → gate → learn → cleanup. The build contract is `.claude/skills/lab-build/SKILL.md`; the learned taste is `.claude/skills/taste/SKILL.md`.
