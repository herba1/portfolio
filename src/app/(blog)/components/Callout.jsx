import { cn } from '@/lib/utils'
import { geist } from '@/app/fonts'

const styles = {
  info: 'border-blue-200 bg-linear-to-b from-blue-50 to-blue-100/80 text-blue-900 shadow-blue-200/40 inset-shadow-white/60',
  warning: 'border-amber-200 bg-linear-to-b from-amber-50 to-amber-100/80 text-amber-900 shadow-amber-200/40 inset-shadow-white/60',
  error: 'border-red-200 bg-linear-to-b from-red-50 to-red-100/80 text-red-900 shadow-red-200/40 inset-shadow-white/60',
  success: 'border-green-200 bg-linear-to-b from-green-50 to-green-100/80 text-green-900 shadow-green-200/40 inset-shadow-white/60',
  note: 'border-dark/10 bg-linear-to-b from-white to-slate-50 text-dark shadow-dark/5 inset-shadow-white/80',
}

export function Callout({ type = 'note', title, children }) {
  return (
    <aside
      className={cn(
        'blog-callout squircle my-6 border p-5 shadow-sm inset-shadow-sm',
        geist.className,
        styles[type] || styles.note,
      )}
    >
      {title && (
        <p className="mb-1.5 text-sm font-semibold tracking-body-base">
          {title}
        </p>
      )}
      <div className="text-sm leading-relaxed font-normal [&>p]:m-0">
        {children}
      </div>
    </aside>
  )
}
