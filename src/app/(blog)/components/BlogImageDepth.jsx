'use client'

import { useRef, useState, useCallback } from 'react'
import Image from 'next/image'

const INTENSITY = 8 // max degrees of rotation
const SHADOW_SHIFT = 15 // max px shadow offset
const SHINE_OPACITY = 0.12

export function BlogImageDepth({
  src,
  alt,
  caption,
  priority = false,
}) {
  const containerRef = useRef(null)
  const rafRef = useRef(null)
  const [style, setStyle] = useState({
    transform: 'rotateX(0deg) rotateY(0deg)',
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
  })
  const [shineStyle, setShineStyle] = useState({ opacity: 0 })
  const [hovering, setHovering] = useState(false)
  const [aspect, setAspect] = useState(null)

  const handleMouseMove = useCallback((e) => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      // Normalized -1 to 1
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1

      const rotateX = -y * INTENSITY
      const rotateY = x * INTENSITY
      const shadowX = x * SHADOW_SHIFT
      const shadowY = y * SHADOW_SHIFT + 10

      setStyle({
        transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`,
        boxShadow: `${shadowX}px ${shadowY}px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)`,
      })

      // Shine highlight follows cursor
      const shineX = ((e.clientX - rect.left) / rect.width) * 100
      const shineY = ((e.clientY - rect.top) / rect.height) * 100
      setShineStyle({
        opacity: SHINE_OPACITY,
        background: `radial-gradient(circle at ${shineX}% ${shineY}%, rgba(255,255,255,0.5) 0%, transparent 60%)`,
      })
    })
  }, [])

  const handleMouseEnter = useCallback(() => setHovering(true), [])

  const handleMouseLeave = useCallback(() => {
    setHovering(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setStyle({
      transform: 'rotateX(0deg) rotateY(0deg) scale(1)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    })
    setShineStyle({ opacity: 0 })
  }, [])

  return (
    <figure className="not-prose blog-figure my-8">
      {/* Outer: stable hitbox — never transforms, handles all mouse events */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative"
        style={{ perspective: '800px' }}
      >
        {/* Inner: transforms + clips */}
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            ...style,
            aspectRatio: aspect || undefined,
            transformStyle: 'preserve-3d',
            transition: hovering
              ? 'transform 0.1s ease-out, box-shadow 0.2s ease-out'
              : 'transform 0.5s cubic-bezier(0.165, 0.84, 0.44, 1), box-shadow 0.5s cubic-bezier(0.165, 0.84, 0.44, 1)',
            willChange: 'transform',
          }}
        >
          <Image
            src={src}
            alt={alt || caption || ''}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            priority={priority}
            className="pointer-events-none m-0 object-cover select-none"
            onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />

          {/* Specular shine overlay */}
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              ...shineStyle,
              transition: hovering ? 'opacity 0.15s ease-out' : 'opacity 0.5s ease-out',
            }}
          />
        </div>
      </div>

      {caption && (
        <figcaption className="mt-3 text-center text-sm text-dark/50">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
