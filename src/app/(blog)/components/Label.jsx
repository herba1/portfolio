import { cn } from '@/lib/utils'

/* Sentence case, solid ink, on the type scale. The old version stacked
 * uppercase + `tracking-widest` + `text-ink-tertiary` — three separate
 * ways of saying "this is small print", which together make a label
 * harder to read than the thing it's labelling. One step down the ink
 * ramp does the whole job. */
export function Label({ children, className }) {
  return (
    <span
      className={cn(
        'text-ink-secondary text-ui inline-block font-mono',
        className,
      )}
    >
      {children}
    </span>
  )
}
