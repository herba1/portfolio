import Link from 'next/link'
import { listTierlists } from './lib'
import NewListButton from './NewListButton'

export const dynamic = 'force-static'

// A small stack of item thumbs that fans out (polaroid-style) on row hover.
function PolaroidStack({ covers }) {
  const pics = (covers || []).filter(Boolean).slice(0, 3)
  if (!pics.length) return null
  const mid = (pics.length - 1) / 2
  return (
    <div className="tl-pol-stack hidden shrink-0 sm:block">
      {pics.map((src, i) => {
        const off = i - mid
        const style = {
          '--rest': `rotate(${off * 5}deg)`,
          '--hov': `rotate(${off * 15}deg) translate(${off * 26}px, ${-9 - (mid - Math.abs(off)) * 3}px)`,
          '--d': `${i * 35}ms`,
          zIndex: 10 - Math.abs(off),
        }
        return (
          <div key={i} className="tl-pol squircle-sm" style={style}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" />
          </div>
        )
      })}
    </div>
  )
}

export default async function TierListIndex() {
  const lists = await listTierlists()
  const isDev = process.env.NODE_ENV === 'development'

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:px-8">
        <header className="tl-fade mb-8 flex items-end justify-between gap-4">
          <h1 className="text-5xl font-bold tracking-tighter sm:text-6xl">
            Tier&nbsp;Lists
          </h1>
          {isDev ? <NewListButton /> : null}
        </header>

        {lists.length === 0 ? (
          <p className="text-dark/40">
            No lists yet.{isDev ? ' Hit “New list” to make one.' : ''}
          </p>
        ) : (
          <ul className="flex flex-col">
            {lists.map((list, i) => (
              <li
                key={list.slug}
                className="tl-fade"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <Link href={`/tierlist/${list.slug}`} className="group block">
                  <div className="tl-row ease-out-quart flex items-center justify-between gap-5 py-4 transition-transform duration-300 group-hover:translate-x-1">
                    <div className="min-w-0">
                      <h2 className="text-dark truncate text-2xl font-semibold transition-colors group-hover:text-blue-500">
                        {list.title}
                      </h2>
                      {list.description || list.subtitle ? (
                        <p className="text-dark/45 mt-0.5 truncate text-sm">
                          {list.description || list.subtitle}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-5">
                      {list.covers?.filter(Boolean).length ? (
                        <PolaroidStack covers={list.covers} />
                      ) : (
                        // fallback for image-less lists: tier color spectrum
                        <div className="squircle-sm hidden h-4 overflow-hidden sm:flex">
                          {list.tiers.map((t) => (
                            <span
                              key={t.id}
                              className="h-full w-4"
                              style={{ backgroundColor: t.color }}
                            />
                          ))}
                        </div>
                      )}
                      <span className="text-dark/40 text-sm tabular-nums">
                        {list.rankedCount}/{list.count}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
