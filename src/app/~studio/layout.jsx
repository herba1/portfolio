import { LenisKiller } from './LenisKiller'
import { HideChrome } from './HideChrome'

export const metadata = {
  title: 'Studio',
  robots: { index: false, follow: false },
}

export default function StudioLayout({ children }) {
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#0d0d0d] text-white"
      style={{ zIndex: 99999 }}
      data-lenis-prevent
    >
      <LenisKiller />
      <HideChrome />
      {children}
    </div>
  )
}
