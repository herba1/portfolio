'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { FileText, Plus, ChevronLeft, Circle, Eye, EyeOff, Trash2, ExternalLink } from 'lucide-react'
import { spencer } from '@/app/fonts'

const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1]
const spring = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

function ContextMenu({ x, y, post, onStatusChange, onDelete, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function handleEsc(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handleClick)
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('pointerdown', handleClick)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  const items = [
    post.published
      ? { icon: EyeOff, label: 'Unpublish', action: () => { onStatusChange(post.slug, false); onClose() } }
      : { icon: Eye, label: 'Publish', action: () => { onStatusChange(post.slug, true); onClose() } },
    { icon: ExternalLink, label: 'View post', action: () => { window.open(`/${post.slug}`, '_blank'); onClose() } },
    null, // separator
    { icon: Trash2, label: 'Delete', action: () => { onDelete(post.slug); onClose() }, danger: true },
  ]

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, ease: EASE_OUT_QUART }}
      className="fixed z-[99999] min-w-[160px] rounded-xl border p-1 shadow-lg"
      style={{
        left: x,
        top: y,
        background: 'var(--studio-surface)',
        borderColor: 'var(--studio-border)',
      }}
    >
      {items.map((item, i) => {
        if (!item) {
          return (
            <div
              key={`sep-${i}`}
              className="my-1 h-px"
              style={{ background: 'var(--studio-border)' }}
            />
          )
        }
        const Icon = item.icon
        return (
          <button
            key={item.label}
            onClick={item.action}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium tracking-body-base outline-none transition-colors duration-150 ${
              item.danger
                ? 'text-red-500 hover:bg-red-500/10'
                : 'hover:bg-[var(--studio-hover)]'
            }`}
            style={item.danger ? {} : { color: 'var(--studio-text-2)' }}
          >
            <Icon size={12} />
            {item.label}
          </button>
        )
      })}
    </motion.div>
  )
}

export default function Sidebar({
  posts,
  activeSlug,
  onSelect,
  onNew,
  open,
  onToggle,
  dirty,
  onStatusChange,
  onDelete,
}) {
  const [contextMenu, setContextMenu] = useState(null)

  const handleContextMenu = useCallback((e, post) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, post })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  return (
    <>
      {/* Collapse toggle */}
      <motion.button
        onClick={onToggle}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.88 }}
        transition={spring}
        className="absolute top-3.5 left-3.5 z-20 flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-300 hover:opacity-70"
        style={{ color: 'var(--studio-text-3)' }}
        title={open ? 'Collapse (⌘B)' : 'Expand (⌘B)'}
      >
        <motion.span
          animate={{ rotate: open ? 0 : 180 }}
          transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
        >
          <ChevronLeft size={13} />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 220, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
            className="flex h-full flex-col overflow-hidden"
            style={{ borderRight: '1px solid var(--studio-border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-12 pb-3">
              <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'var(--studio-text-4)' }}>
                Posts
              </span>
              <motion.button
                onClick={onNew}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                transition={spring}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-300 hover:opacity-70"
                style={{ color: 'var(--studio-text-3)' }}
                title="New post"
              >
                <Plus size={12} />
              </motion.button>
            </div>

            {/* Post list */}
            <div className="flex-1 overflow-y-auto px-1.5 pb-4">
              {posts.map((post, i) => {
                const isActive = post.slug === activeSlug
                return (
                  <motion.div
                    key={post.slug}
                    onClick={() => onSelect(post.slug)}
                    onContextMenu={(e) => handleContextMenu(e, post)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(post.slug) }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.4,
                      ease: EASE_OUT_QUART,
                      delay: i * 0.05,
                    }}
                    className={`group flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left transition-all duration-300 ease-out-quart ${
                      isActive ? 'rounded-lg' : ''
                    }`}
                    style={{
                      color: isActive ? 'var(--studio-text)' : 'var(--studio-text-3)',
                      background: isActive ? 'var(--studio-active)' : 'transparent',
                    }}
                  >
                    <FileText
                      size={13}
                      className="shrink-0"
                      style={{ color: isActive ? 'var(--color-accent)' : 'var(--studio-text-4)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] leading-tight font-medium tracking-body-base">
                        {post.title}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[9px]" style={{ color: 'var(--studio-text-4)' }}>
                          {post.date}
                        </span>
                        <span
                          className="font-mono text-[9px] uppercase"
                          style={{
                            color: post.published ? 'rgb(34 197 94 / 0.7)' : 'var(--studio-text-4)',
                          }}
                        >
                          {post.published ? 'Live' : 'Draft'}
                        </span>
                      </div>
                    </div>

                    {/* Status dot */}
                    <motion.span
                      animate={{ scale: isActive && dirty ? [1, 1.3, 1] : 1 }}
                      transition={{ duration: 0.6, ease: EASE_OUT_QUART }}
                    >
                      <Circle
                        size={5}
                        className={
                          isActive && dirty
                            ? 'fill-amber-400 text-amber-400'
                            : post.published
                              ? 'fill-emerald-500/80 text-emerald-500/80'
                              : ''
                        }
                        style={
                          !(isActive && dirty) && !post.published
                            ? { fill: 'var(--studio-text-4)', color: 'var(--studio-text-4)' }
                            : {}
                        }
                      />
                    </motion.span>
                  </motion.div>
                )
              })}

              {posts.length === 0 && (
                <p className={`${spencer.className} px-3 py-8 text-center text-sm italic`} style={{ color: 'var(--studio-text-4)' }}>
                  No posts yet
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right-click context menu */}
      <AnimatePresence>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            post={contextMenu.post}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onClose={closeContextMenu}
          />
        )}
      </AnimatePresence>
    </>
  )
}
