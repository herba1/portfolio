import { cn } from '@/lib/utils'
import { geist } from '@/app/fonts'

/* Flat tinted panels. Each tone is the same three moves — a tint fill, a
 * hairline of the same hue, and that hue's dark ink step for the text —
 * so the five read as one family and only the hue changes.
 *
 * The tints come from the balanced set (green 15% / red 9% / amber 12%),
 * which is why an error callout no longer sits louder on the page than a
 * success one. Tinting them all at the same alpha was the bug: red is
 * optically heavier than green at equal strength.
 *
 * Gone: the vertical gradient, the colored drop shadow and the inset
 * white highlight. Separation is the tint step plus the 1px line. */
const TONES = {
  note: 'bg-surface-raised border-line text-ink',
  info: 'bg-accent-surface border-accent/25 text-accent-ink',
  success: 'bg-positive-tint border-positive/25 text-positive-ink',
  warning: 'bg-warning-tint border-warning/25 text-warning-ink',
  error: 'bg-negative-tint border-negative/25 text-negative-ink',
}

export function Callout({ type = 'note', title, children }) {
  return (
    <aside
      className={cn(
        'blog-callout squircle my-6 border p-5',
        geist.className,
        TONES[type] || TONES.note,
      )}
    >
      {/* `text-heading-sm` is 14px on 16px of leading — the same size as the
          body below it, just with the leading pulled in. That's the whole
          heading treatment; it needs no extra weight utility. */}
      {title && <p className="text-heading-sm mb-1.5">{title}</p>}
      <div className="text-ui-lg [&>p]:m-0">{children}</div>
    </aside>
  )
}
