import { notFound } from 'next/navigation'
import GlitchText from '@/app/ui/GlitchText'
import { isDevView, isProdView } from '@/lib/viewMode'
import { readWork } from './lib'
import WorkGrid from './WorkGrid'
import EditLink from './EditLink'

export const dynamic = 'force-static'

/* Dev-only for now — the grid is still seeded with whatever was lying around
 * the repo, and that is not a portfolio. It is gated the same way the tierlist
 * editor and the studio are: isProdView() → notFound(), so the route does not
 * exist in a production build at all.
 *
 * To launch it: delete the notFound() guard below, flip robots back to
 * index/follow, move "Work" from DEV_LINKS to LINKS in Navigation/LINKS.js,
 * and restore the /work entry in sitemap.js. Nothing else is gated. */
export const metadata = {
  title: 'Work',
  description: 'Interfaces, components and images — the things I have built.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/work' },
  openGraph: {
    type: 'website',
    title: 'Work',
    description: 'Interfaces, components and images — the things I have built.',
    url: 'https://herb.art/work',
  },
}

// Full bleed, and deliberately so: /blog and /tierlist are reading pages and
// get a measure, this is a looking page. The horizontal padding is the nav's
// own `p-4 md:p-6` — the navbar is fixed and full-width, so matching its
// padding is what puts the page title under the logo and the grid's right
// edge under the nav links, at every width.
export default async function WorkPage() {
  if (isProdView()) notFound()

  const data = await readWork()
  const items = data.items.filter((i) => !i.hidden)

  return (
    <div className="bg-surface min-h-dvh">
      <main className="px-4 pt-24 pb-24 md:px-6 md:pt-28">
        {/* Just the title. The tiles are the description — a paragraph
            explaining them was saying out loud what they already show.
            (`data.intro` is still in work.json and still editable in the
            studio; nothing renders it.) */}
        <header className="mb-8 flex items-end justify-between gap-6 md:mb-10">
          <h1 className="text-ink text-title-xl md:text-display min-w-0">
            <GlitchText text={data.title || 'Work'} />
          </h1>
          {isDevView() ? <EditLink /> : null}
        </header>

        {/* The tiles are hidden in the stylesheet and released by the grid as
            each becomes ready. Without JS that release never comes, so this
            hands them straight back — the page degrades to a plain grid of
            work rather than to nothing at all. */}
        <noscript>
          {/* eslint-disable-next-line react/no-danger */}
          <style
            dangerouslySetInnerHTML={{
              __html:
                '.work-cell{opacity:1!important;visibility:visible!important;animation:none!important}',
            }}
          />
        </noscript>

        {items.length === 0 ? (
          <p className="text-ink-secondary text-body">Nothing here yet.</p>
        ) : (
          <WorkGrid items={items} />
        )}
      </main>
    </div>
  )
}
