import { cn } from '@/lib/utils'
import Link from 'next/link'

/* Straight off the `.btn` component in globals.css — the box, the type,
 * the press and the focus ring all come from there, so this file only has
 * to pick a variant and never names a color.
 *
 * The previous version stacked a vertical gradient, a colored drop shadow
 * and an inset white highlight to fake a lit plastic pill. The system
 * separates with flat fills and a 1px line instead, so all of that goes.
 * `outline` is kept as an alias for `secondary` so old call sites work. */
const VARIANTS = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  outline: 'btn--secondary',
  dark: 'btn--inverse',
  ghost: 'btn--ghost',
}

export function LinkButton({ href, children, variant = 'primary' }) {
  const isExternal = href?.startsWith('http')
  const Component = isExternal ? 'a' : Link

  return (
    <Component
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn('btn btn--lg', VARIANTS[variant] || VARIANTS.primary)}
    >
      {children}
    </Component>
  )
}
