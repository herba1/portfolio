import { notFound } from 'next/navigation'
import EditorMount from './EditorMount'
import { isProdView } from '@/lib/viewMode'

export const metadata = {
  title: 'Tier List · Editor',
  robots: { index: false, follow: false },
}

export default async function TierListEditPage({ params }) {
  // Editor only exists in dev — production (or forced prod view) 404s this route.
  if (isProdView()) notFound()
  const { slug } = await params
  return <EditorMount slug={slug} />
}
