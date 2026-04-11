'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

export default function SplitPane({ left, right, showPreview = true }) {
  const [ratio, setRatio] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('studio-split')
      if (saved) return parseFloat(saved)
    }
    return 0.5
  })
  const [dragging, setDragging] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const containerRef = useRef(null)

  // Detect mobile
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768) }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const ratioRef = useRef(ratio)
  ratioRef.current = ratio

  useEffect(() => {
    if (!dragging) return

    function onMouseMove(e) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (e.clientX - rect.left) / rect.width
      const clamped = Math.min(0.8, Math.max(0.2, x))
      setRatio(clamped)
      ratioRef.current = clamped
    }

    function onMouseUp() {
      setDragging(false)
      localStorage.setItem('studio-split', String(ratioRef.current))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging])

  if (!showPreview) {
    return <div className="h-full w-full">{left}</div>
  }

  // Mobile: vertical stack, preview on top
  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        <div className="h-1/2 min-h-0 overflow-hidden">{right}</div>
        <div
          className="h-px w-full"
          style={{ background: 'var(--studio-border)' }}
        />
        <div className="h-1/2 min-h-0 overflow-hidden">{left}</div>
      </div>
    )
  }

  // Desktop: horizontal split with draggable divider
  return (
    <div ref={containerRef} className="flex h-full w-full select-none">
      <div style={{ width: `${ratio * 100}%` }} className="h-full min-w-0 overflow-hidden">
        {left}
      </div>

      {/* Divider */}
      <div
        onMouseDown={onMouseDown}
        className="group relative z-10 flex w-px cursor-col-resize items-center justify-center"
      >
        <div
          className="h-full w-px transition-all duration-300"
          style={{ background: dragging ? 'var(--color-accent)' : 'var(--studio-border)' }}
        />
        <div className="absolute inset-y-0 -left-2 -right-2" />
        <div className="pointer-events-none absolute flex flex-col gap-0.5 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="h-0.5 w-1 rounded-full" style={{ background: 'var(--studio-text-4)' }} />
          <span className="h-0.5 w-1 rounded-full" style={{ background: 'var(--studio-text-4)' }} />
          <span className="h-0.5 w-1 rounded-full" style={{ background: 'var(--studio-text-4)' }} />
        </div>
      </div>

      <div style={{ width: `${(1 - ratio) * 100}%` }} className="h-full min-w-0 overflow-hidden">
        {right}
      </div>
    </div>
  )
}
