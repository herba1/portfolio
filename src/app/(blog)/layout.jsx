import { geist } from '@/app/fonts'

export default function BlogLayout({ children }) {
  return (
    <div className={`bg-surface min-h-dvh ${geist.className}`}>
      {/* max-w-2xl (672px), not 3xl: paired with 16px prose that holds the
          ~42em measure the reference sites read at. 768px at 16px would
          stretch the line to ~48em and undo the size drop. */}
      <main className="mx-auto max-w-2xl px-4 pt-24 pb-16 md:px-6">
        {children}
      </main>
    </div>
  )
}
