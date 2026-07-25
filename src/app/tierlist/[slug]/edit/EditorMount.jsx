'use client'

import ClientOnly from '@/app/ui/ClientOnly'

export default function EditorMount({ slug }) {
  return <ClientOnly load={() => import('./TierListEditor')} slug={slug} />
}
