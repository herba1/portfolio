import { cn } from '@/lib/utils'
import Link from 'next/link'

export function LinkButton({ href, children, variant = 'primary' }) {
  const styles = {
    primary: cn(
      'bg-linear-to-b from-blue-400 to-blue-500 text-white',
      'border border-white/30 shadow-md inset-shadow-sm shadow-blue-500/30 inset-shadow-white/50',
      'hover:shadow-lg hover:shadow-blue-500/35',
    ),
    dark: cn(
      'bg-linear-to-b from-slate-800 to-slate-900 text-white',
      'border border-white/10 shadow-md inset-shadow-sm shadow-slate-900/30 inset-shadow-white/20',
      'hover:shadow-lg hover:shadow-slate-900/35',
    ),
    outline: cn(
      'bg-transparent text-dark border border-dark/15',
      'shadow-sm hover:shadow-md hover:bg-dark/5',
    ),
  }

  const isExternal = href?.startsWith('http')
  const Component = isExternal ? 'a' : Link

  return (
    <Component
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'squircle inline-block px-6 py-2.5',
        'tracking-body-base text-center text-sm font-medium',
        'transition-all duration-300 ease-out-quart',
        'hover:scale-105 active:scale-95',
        styles[variant] || styles.primary,
      )}
    >
      {children}
    </Component>
  )
}
