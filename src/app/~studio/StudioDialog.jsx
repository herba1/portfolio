'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { geist } from '@/app/fonts'

const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1]
const spring = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

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
            className="fixed inset-0 z-[99999] bg-black/20"
            style={{ backdropFilter: 'blur(2px)' }}
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
            transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
            className={`fixed top-1/2 left-1/2 z-[99999] w-full max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 shadow-2xl outline-none ${geist.className}`}
            style={{
              background: 'var(--studio-surface)',
              border: '1px solid var(--studio-border)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3), 0 0 0 1px var(--studio-border)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2
                className="text-[15px] font-semibold tracking-body-base"
                style={{ color: 'var(--studio-text)' }}
              >
                {title}
              </h2>
              <motion.button
                onClick={() => onOpenChange(false)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={spring}
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
