'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { EASE_HOVER, SPRING_PRESS } from '@/lib/motion'
import { X } from 'lucide-react'
import { geist } from '@/app/fonts'


export function StudioDialog({ open, onOpenChange, title, children }) {
  const popupRef = useRef(null)

  // Focus trap + escape
  useEffect(() => {
    if (!open) return

    function onKeyDown(e) {
      if (e.key === 'Escape') onOpenChange(false)
    }

    // Focus first input or the popup itself
    requestAnimationFrame(() => {
      const input = popupRef.current?.querySelector('input, textarea, button[autofocus]')
      if (input) input.focus()
      else popupRef.current?.focus()
    })

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-[var(--z-index-max)] bg-ink/20"
            style={{ backdropFilter: 'blur(var(--blur-xs))' }}
          />

          {/* Dialog */}
          <motion.div
            ref={popupRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: EASE_HOVER }}
            className={`fixed top-1/2 left-1/2 z-[var(--z-index-max)] w-full max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 shadow-2xl outline-none ${geist.className}`}
            style={{
              background: 'var(--studio-surface)',
              border: '1px solid var(--studio-border)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3), 0 0 0 1px var(--studio-border)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2
                className="text-body font-semibold"
                style={{ color: 'var(--studio-text)' }}
              >
                {title}
              </h2>
              <motion.button
                onClick={() => onOpenChange(false)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_PRESS}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity duration-150 hover:opacity-60"
                style={{ color: 'var(--studio-text-3)' }}
              >
                <X size={14} />
              </motion.button>
            </div>

            {/* Content */}
            <div className="mt-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
