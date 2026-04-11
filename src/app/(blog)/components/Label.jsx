import { cn } from '@/lib/utils'

export function Label({ children, className }) {
  return (
    <span
      className={cn(
        'text-dark/45 inline-block font-mono text-xs tracking-widest uppercase',
        className,
      )}
    >
      {children}
    </span>
  )
}
