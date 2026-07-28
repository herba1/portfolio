import { cn } from '@/lib/utils'
import Link from 'next/link'

/* Straight off the `.btn` component in globals.css — the box, the type,
 * the press and the focus ring all come from there, so this file only has
 * to pick a variant and never names a color.
 *
 * A call to action in the middle of an essay is the one place the flat
 * system doesn't carry: it has to out-signal a paragraph of running text
 * and a plain fill next to a link doesn't. So `primary` and `dark` take
 * `--raised`, which is a lit surface — a light ramp and a 1px top
 * highlight — not the old drop-shadowed plastic pill.
 * `outline` is kept as an alias for `secondary` so old call sites work. */
const VARIANTS = {
  primary: 'btn--raised',
  secondary: 'btn--secondary',
  outline: 'btn--secondary',
  dark: 'btn--raised-inverse',
  ghost: 'btn--ghost',
}

export function LinkButton({ href, children, variant = 'primary' }) {
  const isExternal = href?.startsWith('http')
  const Component = isExternal ? 'a' : Link

  return (
    <Component
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      /* `not-prose` because this is the one blog component that renders an
       * <a> inside the article's `prose`. Without it the typography plugin
       * repaints the label with the link color and underline — an accent-blue
       * underlined word on an accent-blue fill, which reads as a broken button
       * rather than a link. The variant owns the label color. */
      className={cn('btn btn--lg not-prose', VARIANTS[variant] || VARIANTS.primary)}
    >
      {children}
    </Component>
  )
}
