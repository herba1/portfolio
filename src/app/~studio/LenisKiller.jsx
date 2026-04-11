'use client'

import { useEffect } from 'react'
import { useLenis } from '@/context/LenisContext'

export function LenisKiller() {
  const { lenis } = useLenis()

  useEffect(() => {
    if (!lenis) return
    lenis.stop()
    return () => lenis.start()
  }, [lenis])

  return null
}
