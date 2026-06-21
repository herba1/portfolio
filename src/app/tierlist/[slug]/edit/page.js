import { notFound } from 'next/navigation'
import EditorMount from './EditorMount'

export const metadata = {
  title: 'Tier List · Editor',
  robots: { index: false, follow: false },
}

export default async function TierListEditPage({ params }) {
  // Editor only exists in dev — production builds 404 this route.
  if (process.env.NODE_ENV !== 'development') notFound()
  const { slug } = await params
  return <EditorMount slug={slug} />
}
