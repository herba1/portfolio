import TransitionLink from '@/app/ui/TransitionLink'
import GlitchText from '@/app/ui/GlitchText'
import ImageFan from '@/app/ui/ImageFan'
import { listTierlists } from './lib'
import NewListButton from './NewListButton'
import { isDevView } from '@/lib/viewMode'

export const dynamic = 'force-static'

export const metadata = {
  title: 'Tier Lists',
  description: 'Things, ranked.',
  alternates: {
    canonical: '/tierlist',
  },
  openGraph: {
    type: 'website',
    title: 'Tier Lists',
    description: 'Things, ranked.',
    url: 'https://herb.art/tierlist',
  },
}

// The index is a reading page, not the app view — same shell, type scale, row
// rhythm and entrance stagger as /blog, so the two indexes feel like one site.
// The full-height shell lives in [slug]/layout.jsx, where the tier grid needs it.
export default async function TierListIndex() {
  const lists = await listTierlists()
  const isDev = isDevView()

  return (
    <div className="bg-surface min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <header className="mb-8 flex items-end justify-between gap-4">
          <h1 className="text-ink text-title-xl md:text-display">
            <GlitchText text="Tier Lists" />
          </h1>
          {isDev ? <NewListButton /> : null}
        </header>

        {lists.length === 0 ? (
          <p className="text-ink-secondary">
            No lists yet.{isDev ? ' Hit “New list” to make one.' : ''}
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {lists.map((list, i) => (
              // No entrance on the <li>: it wraps the fan, whose thumbs morph
              // across the navigation, and a container that is still fading
              // when the morph lands would fade the thumb up with it. The
              // row's arrival is carried by the text column below.
              <li key={list.slug}>
                <TransitionLink
                  href={`/tierlist/${list.slug}`}
                  className="group block"
                >
                  <article className="border-line ease-out-quart flex items-center justify-between gap-6 border-b pb-6 transition-transform duration-300 group-hover:translate-x-1">
                    {/* The rise lives here rather than on the <li>: the fan
                        beside this column holds the shared-element morph
                        targets, and a transform on their ancestor would offset
                        the geometry the browser measures them against. */}
                    <div
                      className="tl-rise min-w-0 flex-1"
                      style={{ '--tl-delay': `${0.2 + i * 0.08}s` }}
                    >
                      {/* tabular-nums so the count doesn't reflow the label
                          beside it as it changes. */}
                      <span className="text-ink-secondary text-ui-lg tabular-nums">
                        {list.rankedCount} of {list.count} ranked
                      </span>
                      <h2 className="text-ink text-title-sm md:text-title mt-1 transition-colors group-hover:text-accent">
                        {list.title}
                      </h2>
                      {list.description || list.subtitle ? (
                        <p className="text-ink-secondary text-body mt-2">
                          {list.description || list.subtitle}
                        </p>
                      ) : null}
                      {/* Occupies the slot a post's tags do on /blog: the list's
                          own tier palette, so the row still says something at a
                          glance when there are no cover images. */}
                      {list.tiers.length ? (
                        <div className="squircle-sm mt-3 flex h-3.5 w-fit overflow-hidden">
                          {list.tiers.map((t) => (
                            <span
                              key={t.id}
                              className="h-full w-3.5"
                              style={{ backgroundColor: t.color }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* Each thumb shares a view-transition name with its tile in
                        the tier grid, so it flies into place on the way in. */}
                    <ImageFan
                      images={list.covers}
                      sharePrefix={`tl-${list.slug}-`}
                    />
                  </article>
                </TransitionLink>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
