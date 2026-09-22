import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { listSlugs, readTierlist } from '../lib'
import TierListView from '../TierListView'
import { isDevView } from '@/lib/viewMode'
import { pageMetadata } from '@/lib/seo'
import { JsonLd, breadcrumbNode, graph, webPageNode } from '@/lib/jsonld'

export const dynamic = 'force-static'

export async function generateStaticParams() {
  return (await listSlugs()).map((slug) => ({ slug }))
}

const listTitle = (data) => (data?.title ? `${data.title} · Tier List` : 'Tier List')
const listDescription = (data) => {
  const ranked = (data?.items || []).filter((i) => i.tier != null).length
  const blurb = data?.description || data?.subtitle
  return `${blurb ? `${blurb}. ` : ''}${ranked} of ${(data?.items || []).length} ranked, S through the bottom tier, by Herb.`
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const data = await readTierlist(slug)
  return pageMetadata({
    title: listTitle(data),
    description: listDescription(data),
    path: `/tierlist/${slug}`,
  })
}

export default async function TierListSlugPage({ params }) {
  const { slug } = await params
  const data = await readTierlist(slug)
  if (!data) notFound()

  const isDev = isDevView()

  // The list as structured data: one ListItem per ranked entry, in tier
  // order, so the ranking itself is readable without the grid.
  const tierRank = new Map((data.tiers || []).map((t, i) => [t.id, { i, label: t.label }]))
  const rankedItems = (data.items || [])
    .filter((i) => i.tier != null && i.label && tierRank.has(i.tier))
    .sort((a, b) => tierRank.get(a.tier).i - tierRank.get(b.tier).i)
  const listLd = graph(
    webPageNode({
      path: `/tierlist/${slug}`,
      name: data.title || slug,
      description: listDescription(data),
      extra: {
        mainEntity: {
          '@type': 'ItemList',
          name: data.title || slug,
          numberOfItems: rankedItems.length,
          itemListOrder: 'https://schema.org/ItemListOrderDescending',
          itemListElement: rankedItems.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: `${item.label} — tier ${tierRank.get(item.tier).label}`,
          })),
        },
      },
    }),
    breadcrumbNode([
      { name: 'herb.art', path: '/' },
      { name: 'Tier Lists', path: '/tierlist' },
      { name: data.title || slug, path: `/tierlist/${slug}` },
    ]),
  )

  // The index fans out the first 3 items as preview thumbs (see lib.listTierlists).
  // Tag those same items here so each one morphs from its thumb into its tier
  // position on the way in — and back on the way out — via view transitions.
  const coverIds = (data.items || [])
    .filter((i) => i.src)
    .slice(0, 3)
    .map((i) => i.id)

  return (
    <div className="flex h-full w-full flex-col">
      <JsonLd data={listLd} />
      {/* Slim header bar. No morph target lives in here, so it gets the full
          rise rather than the geometry-safe fade the tier rows use. */}
      <div className="tl-rise flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/tierlist"
          className="LinkMask text-ink-secondary hover:text-ink inline-flex items-center gap-1.5 text-ui-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> All lists
        </Link>
        <div className="min-w-0 px-2 text-center">
          <h1 className="text-heading truncate">
            {data.title}
          </h1>
          {data.description ? (
            <p className="text-ink-secondary truncate text-ui-lg" title={data.description}>
              {data.description}
            </p>
          ) : null}
        </div>
        {isDev ? (
          <Link
            href={`/tierlist/${slug}/edit`}
            className="LinkMask text-ink-secondary hover:text-ink text-ui-lg font-medium transition-colors"
          >
            Edit →
          </Link>
        ) : (
          <span className="w-16" />
        )}
      </div>

      <div className="min-h-0 flex-1">
        <TierListView
          tiers={data.tiers}
          items={data.items}
          slug={slug}
          coverIds={coverIds}
        />
      </div>
    </div>
  )
}
