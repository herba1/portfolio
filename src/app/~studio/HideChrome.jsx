'use client'

import { useEffect } from 'react'

export function HideChrome() {
  useEffect(() => {
    // Hide navbar and footer clock on the studio route
    const nav = document.querySelector('nav')
    const clock = document.querySelector('.footer-clock')

    if (nav) nav.style.display = 'none'
    if (clock) clock.style.display = 'none'

    return () => {
      if (nav) nav.style.display = ''
      if (clock) clock.style.display = ''
    }
  }, [])

  return null
}
