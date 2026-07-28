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

// Wider shell than /blog or /tierlist on purpose — those are reading pages,
// this is a looking page. Same top rhythm and same GlitchText title so it
// still lands as the same site.
export default async function WorkPage() {
  if (isProdView()) notFound()

  const data = await readWork()
  const items = data.items.filter((i) => !i.hidden)

  return (
    <div className="bg-surface min-h-dvh">
      <main className="mx-auto max-w-[1440px] px-4 pt-24 pb-24 md:px-8">
        <header className="mb-10 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-ink text-title-xl md:text-display">
              <GlitchText text={data.title || 'Work'} />
            </h1>
            {data.intro ? (
              <p className="text-ink-secondary text-body-lg mt-3 max-w-xl text-balance">
                {data.intro}
              </p>
            ) : null}
          </div>
          {isDevView() ? <EditLink /> : null}
        </header>

        {items.length === 0 ? (
          <p className="text-ink-secondary text-body">Nothing here yet.</p>
        ) : (
          <WorkGrid items={items} />
        )}
      </main>
    </div>
  )
}
