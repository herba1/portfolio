'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Reorder, motion, AnimatePresence } from 'motion/react'
import { GripVertical, Code, Type, Image, MessageSquareQuote, AlertTriangle, Music, Video, Youtube, Minus, Tag, ChevronDown, Trash2, Copy, ArrowUp, ArrowDown } from 'lucide-react'

const spring = { type: 'spring', stiffness: 400, damping: 30, mass: 0.5 }
const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1]

const IMAGE_VARIANTS = [
  { tag: 'BlogImage', label: 'Standard' },
  { tag: 'BlogImageDepth', label: '3D Parallax' },
  { tag: 'BlogImagePixel', label: 'Pixel Trail' },
]

function detectBlock(content) {
  const t = content.trim()
  if (t.startsWith('import ')) return { icon: Code, label: 'Import' }
  if (t.startsWith('export const metadata')) return { icon: Code, label: 'Metadata' }
  if (t.startsWith('<BlogHeader')) return { icon: Type, label: 'Blog Header' }
  if (t.startsWith('<article')) return { icon: Code, label: '<article>' }
  if (t.startsWith('</article>')) return { icon: Code, label: '</article>' }
  if (t.startsWith('<Callout')) return { icon: AlertTriangle, label: 'Callout' }
  if (t.startsWith('<Quote')) return { icon: MessageSquareQuote, label: 'Quote' }
  if (t.startsWith('<BlogImageDepth')) return { icon: Image, label: 'Image 3D', imageVariant: 'BlogImageDepth' }
  if (t.startsWith('<BlogImagePixel')) return { icon: Image, label: 'Image Pixel', imageVariant: 'BlogImagePixel' }
  if (t.startsWith('<BlogImage')) return { icon: Image, label: 'Image', imageVariant: 'BlogImage' }
  if (t.startsWith('<YouTube')) return { icon: Youtube, label: 'YouTube' }
  if (t.startsWith('<Video')) return { icon: Video, label: 'Video' }
  if (t.startsWith('<Audio')) return { icon: Music, label: 'Audio' }
  if (t.startsWith('<Divider')) return { icon: Minus, label: 'Divider' }
  if (t.startsWith('<Badge')) return { icon: Tag, label: 'Badge' }
  if (t.startsWith('<Lead')) return { icon: Type, label: 'Lead' }
  if (t.startsWith('<Aside')) return { icon: MessageSquareQuote, label: 'Aside' }
  if (t.startsWith('<LinkButton')) return { icon: Code, label: 'Button' }
  if (t.startsWith('<')) return { icon: Code, label: 'Component' }
  if (/^#{1,6}\s/.test(t)) return { icon: Type, label: 'Heading' }
  if (t.startsWith('```')) return { icon: Code, label: 'Code Block' }
  return { icon: Type, label: 'Text' }
}

function preview(content, maxLen = 80) {
  const firstLine = content.trim().split('\n')[0]
  return firstLine.length <= maxLen ? firstLine : firstLine.slice(0, maxLen) + '...'
}

function splitBlocks(source) {
  const lines = source.split('\n')
  const chunks = []
  let current = []
  let depth = 0

  for (const line of lines) {
    const trimmed = line.trim()
    const openMatch = trimmed.match(/^<([A-Z]\w*)/)
    const isSelfClosing = trimmed.endsWith('/>')
    const isClosing = trimmed.match(/^<\/([A-Z]\w*)/)

    if (openMatch && !isSelfClosing && !isClosing) depth++
    if (isClosing) depth = Math.max(0, depth - 1)
    if (!openMatch && isSelfClosing && depth > 0) depth = Math.max(0, depth - 1)

    if (line === '' && depth === 0) {
      if (current.length > 0) {
        chunks.push(current.join('\n'))
        current = []
      }
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) chunks.push(current.join('\n'))
  return chunks
}

let nextId = 0

// ── Context Menu ──

function BlockContextMenu({ x, y, blockIndex, totalBlocks, onAction, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function esc(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', handle)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', handle)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const items = [
    { icon: Copy, label: 'Duplicate', action: 'duplicate' },
    blockIndex > 0 && { icon: ArrowUp, label: 'Move up', action: 'moveUp' },
    blockIndex < totalBlocks - 1 && { icon: ArrowDown, label: 'Move down', action: 'moveDown' },
    null,
    { icon: Trash2, label: 'Delete', action: 'delete', danger: true },
  ].filter(Boolean)

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, ease: EASE_OUT_QUART }}
      className="fixed z-[99999] min-w-[150px] rounded-xl border p-1 shadow-lg"
      style={{
        left: x,
        top: y,
        background: 'var(--studio-surface)',
        borderColor: 'var(--studio-border)',
      }}
    >
      {items.map((item, i) => {
        if (!item) {
          return <div key={`sep-${i}`} className="my-1 h-px" style={{ background: 'var(--studio-border)' }} />
        }
        const Icon = item.icon
        return (
          <button
            key={item.action}
            onClick={() => { onAction(item.action); onClose() }}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium tracking-body-base outline-none transition-colors duration-150 ${
              item.danger ? 'text-red-500 hover:bg-red-500/10' : 'hover:bg-[var(--studio-hover)]'
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

// ── Image Variant Select ──

function ImageVariantSelect({ currentTag, onSwitch }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function close(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const current = IMAGE_VARIANTS.find((v) => v.tag === currentTag) || IMAGE_VARIANTS[0]

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-body-base transition-colors duration-150 hover:bg-[var(--studio-hover)]"
        style={{ color: 'var(--color-accent)' }}
      >
        {current.label}
        <ChevronDown size={9} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1 min-w-[120px] rounded-lg border p-0.5 shadow-lg"
          style={{ background: 'var(--studio-surface)', borderColor: 'var(--studio-border)' }}
        >
          {IMAGE_VARIANTS.map((variant) => (
            <button
              key={variant.tag}
              onClick={() => { onSwitch(variant.tag); setOpen(false) }}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-[11px] font-medium tracking-body-base transition-colors duration-150 hover:bg-[var(--studio-hover)] ${
                variant.tag === currentTag ? 'text-[var(--color-accent)]' : ''
              }`}
              style={{ color: variant.tag === currentTag ? undefined : 'var(--studio-text-2)' }}
            >
              {variant.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Block Item ──

function BlockItem({ block, index, totalBlocks, onUpdateBlock, onBlockAction }) {
  const Icon = block.icon

  const handleVariantSwitch = useCallback((newTag) => {
    const newContent = block.content.replace(
      /^<(BlogImageDepth|BlogImagePixel|BlogImage)/,
      `<${newTag}`
    )
    onUpdateBlock(block.id, newContent)
  }, [block, onUpdateBlock])

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    onBlockAction('contextmenu', block.id, index, { x: e.clientX, y: e.clientY })
  }, [block.id, index, onBlockAction])

  return (
    <Reorder.Item
      value={block}
      layout
      transition={spring}
      onContextMenu={handleContextMenu}
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        zIndex: 50,
        cursor: 'grabbing',
      }}
      className="group relative flex cursor-grab items-start gap-2.5 rounded-lg border px-3 py-2.5 active:cursor-grabbing"
      style={{
        background: 'var(--studio-surface)',
        borderColor: 'var(--studio-border)',
      }}
    >
      <div
        className="mt-0.5 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ color: 'var(--studio-text-4)' }}
      >
        <GripVertical size={13} />
      </div>

      <div className="mt-0.5 shrink-0" style={{ color: 'var(--studio-text-3)' }}>
        <Icon size={13} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-medium tracking-widest uppercase" style={{ color: 'var(--studio-text-3)' }}>
            {block.label}
          </p>
          {block.imageVariant && (
            <ImageVariantSelect
              currentTag={block.imageVariant}
              onSwitch={handleVariantSwitch}
            />
          )}
        </div>
        <p
          className="mt-0.5 truncate font-mono text-[11px] leading-relaxed"
          style={{ color: 'var(--studio-text-2)' }}
        >
          {preview(block.content)}
        </p>
      </div>
    </Reorder.Item>
  )
}

// ── Block Editor ──

export default function BlockEditor({ value, onChange }) {
  const [blocks, setBlocks] = useState([])
  const [contextMenu, setContextMenu] = useState(null)
  const internalChangeRef = useRef(false)

  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false
      return
    }
    const chunks = splitBlocks(value || '')
    setBlocks(chunks.map((content) => ({
      id: `b-${nextId++}`,
      content,
      ...detectBlock(content),
    })))
  }, [value])

  const emitChange = useCallback((updated) => {
    internalChangeRef.current = true
    setBlocks(updated)
    queueMicrotask(() => {
      onChange(updated.map((b) => b.content).join('\n\n'))
    })
  }, [onChange])

  const handleReorder = useCallback((reordered) => {
    emitChange(reordered)
  }, [emitChange])

  const handleUpdateBlock = useCallback((blockId, newContent) => {
    setBlocks((prev) => {
      const updated = prev.map((b) =>
        b.id === blockId ? { ...b, content: newContent, ...detectBlock(newContent) } : b
      )
      internalChangeRef.current = true
      queueMicrotask(() => onChange(updated.map((b) => b.content).join('\n\n')))
      return updated
    })
  }, [onChange])

  const handleBlockAction = useCallback((action, blockId, index, pos) => {
    if (action === 'contextmenu') {
      setContextMenu({ blockId, index, ...pos })
      return
    }
  }, [])

  const executeAction = useCallback((action) => {
    if (!contextMenu) return
    const { blockId, index } = contextMenu

    setBlocks((prev) => {
      let updated
      switch (action) {
        case 'delete':
          updated = prev.filter((b) => b.id !== blockId)
          break
        case 'duplicate': {
          const block = prev.find((b) => b.id === blockId)
          if (!block) return prev
          const clone = { ...block, id: `b-${nextId++}` }
          updated = [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)]
          break
        }
        case 'moveUp':
          if (index <= 0) return prev
          updated = [...prev]
          ;[updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]
          break
        case 'moveDown':
          if (index >= prev.length - 1) return prev
          updated = [...prev]
          ;[updated[index], updated[index + 1]] = [updated[index + 1], updated[index]]
          break
        default:
          return prev
      }
      internalChangeRef.current = true
      queueMicrotask(() => onChange(updated.map((b) => b.content).join('\n\n')))
      return updated
    })
  }, [contextMenu, onChange])

  return (
    <div
      className="h-full overflow-auto px-3 py-4"
      style={{ background: 'var(--studio-bg)' }}
    >
      <Reorder.Group
        axis="y"
        values={blocks}
        onReorder={handleReorder}
        className="flex flex-col gap-1.5"
      >
        {blocks.map((block, i) => (
          <BlockItem
            key={block.id}
            block={block}
            index={i}
            totalBlocks={blocks.length}
            onUpdateBlock={handleUpdateBlock}
            onBlockAction={handleBlockAction}
          />
        ))}
      </Reorder.Group>

      {blocks.length === 0 && (
        <p className="py-8 text-center text-[12px] italic" style={{ color: 'var(--studio-text-3)' }}>
          No blocks to show
        </p>
      )}

      {/* Right-click context menu */}
      <AnimatePresence>
        {contextMenu && (
          <BlockContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            blockIndex={contextMenu.index}
            totalBlocks={blocks.length}
            onAction={executeAction}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
