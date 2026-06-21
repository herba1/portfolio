export const metadata = {
  title: 'Tier Lists',
  description: 'Drag-and-drop tier lists.',
}

export default function TierListLayout({ children }) {
  // Sits inside the global layout (keeps the site navbar). Fills the viewport
  // height below the fixed nav; bg matches the homepage (slate-100 token).
  return (
    <div
      className="bg-light text-dark flex h-svh w-full flex-col"
      data-lenis-prevent
    >
      {/* clearance for the fixed global navbar */}
      <div className="h-16 shrink-0 md:h-20" />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
