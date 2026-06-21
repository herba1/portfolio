import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { listSlugs, readTierlist } from '../lib'
import TierListView from '../TierListView'

export const dynamic = 'force-static'

export async function generateStaticParams() {
  return (await listSlugs()).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const data = await readTierlist(slug)
  return { title: data?.title ? `${data.title} · Tier List` : 'Tier List' }
}

export default async function TierListSlugPage({ params }) {
  const { slug } = await params
  const data = await readTierlist(slug)
  if (!data) notFound()

  const isDev = process.env.NODE_ENV === 'development'

  return (
    <div className="flex h-full w-full flex-col">
      {/* Slim header bar */}
      <div className="tl-fade flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/tierlist"
          className="LinkMask text-dark/50 hover:text-dark inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> All lists
        </Link>
        <div className="min-w-0 px-2 text-center">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {data.title}
          </h1>
          {data.description ? (
            <p className="text-dark/50 truncate text-sm" title={data.description}>
              {data.description}
            </p>
          ) : null}
        </div>
        {isDev ? (
          <Link
            href={`/tierlist/${slug}/edit`}
            className="LinkMask text-dark/70 hover:text-dark text-sm font-medium transition-colors"
          >
            Edit →
          </Link>
        ) : (
          <span className="w-16" />
        )}
      </div>

      <div className="min-h-0 flex-1">
        <TierListView tiers={data.tiers} items={data.items} />
      </div>
    </div>
  )
}
