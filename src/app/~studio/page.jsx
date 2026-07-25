'use client'

import ClientOnly from '@/app/ui/ClientOnly'

export default function StudioPage() {
  return <ClientOnly load={() => import('./Studio')} />
}
