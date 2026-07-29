'use client'

import { useEffect, useState } from 'react'

/* ─────────────────────────────────────────────────────────────
 * Visibility, shared.
 *
 * /work mounts real components — GSAP timelines, motion layouts, rAF
 * loops, canvases. All of those keep running when they are three screens
 * below you, so the page has to know what is actually near the viewport.
 *
 * One IntersectionObserver per rootMargin, shared by every element that
 * asks for that margin: twenty tiles watching '600px' get ONE observer,
 * not twenty. Each observer is its own callback on the main thread, and
 * this page is going to have a lot of watchers.
 * ───────────────────────────────────────────────────────────── */

const pools = new Map()

function poolFor(margin) {
  let pool = pools.get(margin)
  if (!pool) {
    const callbacks = new Map()
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          callbacks.get(entry.target)?.(entry.isIntersecting)
        }
      },
      { rootMargin: margin },
    )
    pool = { io, callbacks }
    pools.set(margin, pool)
  }
  return pool
}

function observe(el, margin, cb) {
  const { io, callbacks } = poolFor(margin)
  callbacks.set(el, cb)
  io.observe(el)
  return () => {
    callbacks.delete(el)
    io.unobserve(el)
  }
}

/* Watch a ref.
 *
 *   margin   grown viewport, so work starts before the tile is on screen
 *   once     stop watching after the first hit — for anything that only
 *            ever needs to happen once, like a reveal
 *   skip     don't observe at all; still a hook call, so the rules hold
 *
 * Without IntersectionObserver (or before hydration on a very old engine)
 * this reports TRUE. Failing open means the worst case is a page that
 * mounts everything eagerly — not a page that renders nothing.
 */
export default function useInView(ref, { margin = '0px', once = false, skip = false } = {}) {
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (skip) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    let stop = null
    let stopped = false
    stop = observe(el, margin, (visible) => {
      setInView(visible)
      if (visible && once) {
        stopped = true
        stop?.()
      }
    })
    if (stopped) stop()

    return () => stop?.()
  }, [ref, margin, once, skip])

  return inView
}
