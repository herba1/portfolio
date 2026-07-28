import { LenisKiller } from './LenisKiller'
import { HideChrome } from './HideChrome'

export const metadata = {
  title: 'Studio',
  robots: { index: false, follow: false },
}

export default function StudioLayout({ children }) {
  // `studio` scopes the dark editor palette (see globals.css). Reading the
  // surface off the token instead of a literal #0d0d0d means the shell and
  // everything inside it always agree on what "background" is.
  return (
    <div
      className="studio fixed inset-0 overflow-hidden bg-[var(--studio-bg)] text-[var(--studio-text)]"
      style={{ zIndex: 99999 }}
      data-lenis-prevent
    >
      <LenisKiller />
      <HideChrome />
      {children}
    </div>
  )
}
