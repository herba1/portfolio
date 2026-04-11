import { geist } from '@/app/fonts'

export default function BlogLayout({ children }) {
  return (
    <div className={`bg-slate-100 min-h-dvh ${geist.className}`}>
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        {children}
      </main>
    </div>
  )
}
