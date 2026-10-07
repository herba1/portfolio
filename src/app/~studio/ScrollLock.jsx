'use client'

import { useEffect } from 'react'
import { lockPageScroll } from '@/lib/pageScroll'

export function ScrollLock() {
  useEffect(() => lockPageScroll(), [])
  return null
}
