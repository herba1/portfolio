import { cn } from '@/lib/utils'

/* Tones map onto the STATUS ROLES, not onto colors — `success` asks for
 * the positive role and tracks whatever green the token layer says, so a
 * palette change never has to come through here.
 *
 * The tinted fills behind them use the asymmetric alphas (green 15% /
 * red 9%), so a positive and a negative badge sit at the same visual
 * weight instead of the red shouting over the green.
 *
 * Color names are kept as aliases so existing MDX posts keep rendering. */
const TONES = {
  default: '',
  accent: 'badge--accent',
  blue: 'badge--accent',
  success: 'badge--positive',
  green: 'badge--positive',
  warning: 'badge--warning',
  amber: 'badge--warning',
  error: 'badge--negative',
  red: 'badge--negative',
}

export function Badge({ children, color = 'default' }) {
  return (
    <span className={cn('badge', TONES[color] ?? TONES.default)}>
      {children}
    </span>
  )
}
