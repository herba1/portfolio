'use client'

import dynamic from 'next/dynamic'

const TierListEditor = dynamic(() => import('./TierListEditor'), { ssr: false })

export default function EditorMount({ slug }) {
  return <TierListEditor slug={slug} />
}
