export default function TierListDetailLayout({ children }) {
  // A single tier list — and its editor — is an app-shaped view: the rows
  // divide the viewport height between them, so this one fills the screen and
  // scrolls internally rather than scrolling the document.
  //
  // The index (/tierlist) deliberately does NOT use this shell. It's a reading
  // page like /blog, so it scrolls the document the way the rest of the site
  // does. (`html, body { scrollbar-gutter: stable }` in globals.css keeps the
  // scrollbar's 8px reserved either way, so moving between the two doesn't
  // shove the page sideways.)
  return (
    <div
      className="bg-light text-ink flex h-svh w-full flex-col"
      data-lenis-prevent
    >
      {/* clearance for the fixed global navbar */}
      <div className="h-16 shrink-0 md:h-20" />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
