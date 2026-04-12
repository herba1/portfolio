'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import Image from 'next/image'

const PIXEL_SIZE = 10
const TRAIL_RADIUS = 50
const FADE_SPEED = 0.98
// Snap alpha to discrete steps (like step-end easing)
const STEPS = [1, 0.8, 0.55, 0.3, 0.12, 0]
function quantize(alpha) {
  for (let i = 0; i < STEPS.length; i++) {
    if (alpha >= STEPS[i]) return STEPS[i]
  }
  return 0
}

export function BlogImagePixel({
  src,
  alt,
  caption,
  priority = false,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const maskCanvasRef = useRef(null)
  const imgRef = useRef(null)
  const rafRef = useRef(null)
  const trailRef = useRef([])
  const [imageLoaded, setImageLoaded] = useState(false)
  const [aspect, setAspect] = useState(null)
  const isTouchRef = useRef(false)
  const paintingRef = useRef(false)
  const lastPosRef = useRef(null)

  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    isTouchRef.current = touch
    setIsTouch(touch)
  }, [])

  useEffect(() => {
    if (!imageLoaded) return
    const container = containerRef.current
    const canvas = canvasRef.current
    const maskCanvas = maskCanvasRef.current
    const img = imgRef.current
    if (!container || !canvas || !maskCanvas || !img) return

    const rect = container.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio, 2)
    const w = rect.width
    const h = rect.height

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    maskCanvas.width = w * dpr
    maskCanvas.height = h * dpr

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const maskCtx = maskCanvas.getContext('2d')
    maskCtx.scale(dpr, dpr)

    function render() {
      rafRef.current = requestAnimationFrame(render)

      const trail = trailRef.current
      if (trail.length === 0) {
        ctx.clearRect(0, 0, w, h)
        return
      }

      // Decay trail
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].alpha *= FADE_SPEED
        if (trail[i].alpha < 0.01) trail.splice(i, 1)
      }

      if (trail.length === 0) {
        ctx.clearRect(0, 0, w, h)
        return
      }

      ctx.clearRect(0, 0, w, h)
      maskCtx.clearRect(0, 0, w, h)

      // Draw trail mask snapped to pixel grid — blocky edges
      for (const point of trail) {
        const a = quantize(point.alpha)
        if (a <= 0) continue

        // Snap brush area to the pixel grid
        const bx = Math.floor((point.x - TRAIL_RADIUS) / PIXEL_SIZE) * PIXEL_SIZE
        const by = Math.floor((point.y - TRAIL_RADIUS) / PIXEL_SIZE) * PIXEL_SIZE
        const bw = Math.ceil(TRAIL_RADIUS * 2 / PIXEL_SIZE) * PIXEL_SIZE
        const bh = bw

        // Fill grid-aligned blocks within brush radius
        maskCtx.globalAlpha = a
        for (let gx = bx; gx < bx + bw; gx += PIXEL_SIZE) {
          for (let gy = by; gy < by + bh; gy += PIXEL_SIZE) {
            // Check if block center is within brush radius
            const cx = gx + PIXEL_SIZE / 2
            const cy = gy + PIXEL_SIZE / 2
            const dx = cx - point.x
            const dy = cy - point.y
            if (dx * dx + dy * dy <= TRAIL_RADIUS * TRAIL_RADIUS) {
              maskCtx.fillRect(gx, gy, PIXEL_SIZE, PIXEL_SIZE)
            }
          }
        }
      }
      maskCtx.globalAlpha = 1

      // Draw fully pixelated image
      const smallW = Math.ceil(w / PIXEL_SIZE)
      const smallH = Math.ceil(h / PIXEL_SIZE)
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = smallW
      tempCanvas.height = smallH
      const tempCtx = tempCanvas.getContext('2d')
      tempCtx.imageSmoothingEnabled = false
      tempCtx.drawImage(img, 0, 0, smallW, smallH)

      ctx.imageSmoothingEnabled = false
      ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, w, h)
      ctx.imageSmoothingEnabled = true

      // Mask with soft trail
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(maskCanvas, 0, 0, w * dpr, h * dpr, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
    }

    rafRef.current = requestAnimationFrame(render)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [imageLoaded])

  const addTrailPoints = useCallback((clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clientX - rect.left
    const y = clientY - rect.top

    const last = lastPosRef.current
    if (last) {
      const dx = x - last.x
      const dy = y - last.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const steps = Math.max(1, Math.floor(dist / 3))
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        trailRef.current.push({ x: last.x + dx * t, y: last.y + dy * t, alpha: 1 })
      }
    }
    trailRef.current.push({ x, y, alpha: 1 })
    lastPosRef.current = { x, y }
  }, [])

  // Mobile: auto-reveal sweep that repeats while visible
  useEffect(() => {
    if (!isTouch || !imageLoaded) return
    const container = containerRef.current
    if (!container) return

    let sweepTimeout = null
    let sweepInterval = null
    let visible = false

    function runSweep() {
      const rect = container.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const steps = 30
      let step = 0
      // Randomize sweep path each time
      const startY = 0.2 + Math.random() * 0.3
      const curve = 0.3 + Math.random() * 0.2
      const reverse = Math.random() > 0.5

      sweepInterval = setInterval(() => {
        if (step >= steps) {
          clearInterval(sweepInterval)
          sweepInterval = null
          // Schedule next sweep
          if (visible) {
            sweepTimeout = setTimeout(runSweep, 3000 + Math.random() * 2000)
          }
          return
        }
        const t = step / steps
        const tx = reverse ? 1 - t : t
        const x = w * (0.1 + tx * 0.8)
        const y = h * (startY + Math.sin(t * Math.PI) * curve)
        trailRef.current.push({ x, y, alpha: 1 })
        step++
      }, 50)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (visible && !sweepInterval) {
          runSweep()
        } else if (!visible) {
          clearTimeout(sweepTimeout)
          clearInterval(sweepInterval)
          sweepInterval = null
        }
      },
      { threshold: 0.4 }
    )
    observer.observe(container)
    return () => {
      observer.disconnect()
      clearTimeout(sweepTimeout)
      clearInterval(sweepInterval)
    }
  }, [isTouch, imageLoaded])

  // Desktop: auto on pointer move (no click needed)
  const onPointerMove = useCallback((e) => {
    if (isTouchRef.current && !paintingRef.current) return
    addTrailPoints(e.clientX, e.clientY)
  }, [addTrailPoints])

  const onPointerDown = useCallback((e) => {
    paintingRef.current = true
    lastPosRef.current = null
    addTrailPoints(e.clientX, e.clientY)
  }, [addTrailPoints])

  const onPointerUp = useCallback(() => {
    paintingRef.current = false
    lastPosRef.current = null
  }, [])

  const onPointerEnter = useCallback(() => {
    lastPosRef.current = null
  }, [])

  const onPointerLeave = useCallback(() => {
    lastPosRef.current = null
    paintingRef.current = false
  }, [])

  return (
    <figure className="not-prose blog-figure my-8">
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl select-none"
        style={{ touchAction: isTouch ? 'auto' : 'none', aspectRatio: aspect || undefined }}
        onPointerMove={isTouch ? undefined : onPointerMove}
        onPointerDown={isTouch ? undefined : onPointerDown}
        onPointerUp={isTouch ? undefined : onPointerUp}
        onPointerLeave={isTouch ? undefined : onPointerLeave}
        onPointerEnter={isTouch ? undefined : onPointerEnter}
      >
        <Image
          ref={imgRef}
          src={src}
          alt={alt || caption || ''}
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          priority={priority}
          className="pointer-events-none m-0 object-cover"
          onLoad={(e) => {
            setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)
            setImageLoaded(true)
          }}
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 rounded-2xl"
        />
        <canvas ref={maskCanvasRef} className="hidden" />
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-dark/50">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
