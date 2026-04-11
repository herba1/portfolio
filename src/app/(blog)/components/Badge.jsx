import { cn } from '@/lib/utils'

const styles = {
  default: 'bg-dark/5 text-dark/60',
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
}

export function Badge({ children, color = 'default' }) {
  return (
    <span
      className={cn(
        'squircle-pill inline-block px-2.5 py-0.5 font-mono text-xs tracking-wide',
        styles[color] || styles.default,
      )}
    >
      {children}
    </span>
  )
}
