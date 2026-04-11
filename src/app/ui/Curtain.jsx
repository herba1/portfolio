'use client'

import { useEffect, useState } from 'react'

export default function Curtain() {
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    // wait for paint + a beat, then fade out
    const timer = setTimeout(() => setReveal(true), 500)
    return () => clearTimeout(timer)
  }, [])

  return <div className={`curtain ${reveal ? 'reveal' : ''}`} aria-hidden="true" />
}
