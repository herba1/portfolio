'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Reorder, motion, AnimatePresence } from 'motion/react'
import { EASE_HOVER, SPRING_SETTLE } from '@/lib/motion'
import { GripVertical, Code, Type, Image, MessageSquareQuote, AlertTriangle, Music, Video, Youtube, Minus, Tag, ChevronDown, Trash2, Copy, ArrowUp, ArrowDown, Upload, Loader2 } from 'lucide-react'
import { isMediaFile, mediaFilesFrom, uploadMedia } from './mediaUpload'


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
      transition={{ duration: 0.15, ease: EASE_HOVER }}
      className="fixed z-[var(--z-index-max)] min-w-[150px] rounded-xl border p-1 shadow-lg"
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
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-ui-xs font-medium outline-none transition-colors duration-150 ${ item.danger ? 'text-negative hover:bg-negative/10' : 'hover:bg-[var(--studio-hover)]' }`}
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
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-2xs font-medium transition-colors duration-150 hover:bg-[var(--studio-hover)]"
        style={{ color: 'var(--color-accent)' }}
      >
        {current.label}
        <ChevronDown size={9} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 z-[var(--z-index-nav)] mt-1 min-w-[120px] rounded-lg border p-0.5 shadow-lg"
          style={{ background: 'var(--studio-surface)', borderColor: 'var(--studio-border)' }}
        >
          {IMAGE_VARIANTS.map((variant) => (
            <button
              key={variant.tag}
              onClick={() => { onSwitch(variant.tag); setOpen(false) }}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-ui-xs font-medium transition-colors duration-150 hover:bg-[var(--studio-hover)] ${ variant.tag === currentTag ? 'text-[var(--color-accent)]' : '' }`}
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
      transition={SPRING_SETTLE}
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
          <p className="text-ui-2xs font-medium" style={{ color: 'var(--studio-text-3)' }}>
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
          className="mt-0.5 truncate font-mono text-ui-xs leading-relaxed"
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
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const internalChangeRef = useRef(false)
  const dragCountRef = useRef(0)

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

  // ── Media drop / paste ──

  const appendSnippet = useCallback((snippet) => {
    setBlocks((prev) => {
      const updated = [...prev, { id: `b-${nextId++}`, content: snippet, ...detectBlock(snippet) }]
      internalChangeRef.current = true
      queueMicrotask(() => onChange(updated.map((b) => b.content).join('\n\n')))
      return updated
    })
  }, [onChange])

  const uploadFiles = useCallback(async (files) => {
    if (!files.length) return
    setUploading(true)
    try {
      // Sequential so multi-drops land in the order they were dropped
      for (const file of files) {
        const snippet = await uploadMedia(file)
        if (snippet) appendSnippet(snippet)
      }
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }, [appendSnippet])

  const onDragEnter = useCallback((e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault(); dragCountRef.current++; setDragging(true)
  }, [])
  const onDragLeave = useCallback((e) => {
    if (!dragCountRef.current) return
    e.preventDefault(); dragCountRef.current--; if (dragCountRef.current === 0) setDragging(false)
  }, [])
  const onDragOver = useCallback((e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
  }, [])
  const onDrop = useCallback((e) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault(); dragCountRef.current = 0; setDragging(false)
    uploadFiles(mediaFilesFrom(e.dataTransfer.files))
  }, [uploadFiles])

  // Block mode has no focused text surface, so listen at the window level —
  // but stay out of the way when the user is pasting into a real input.
  useEffect(() => {
    function onPaste(e) {
      const t = e.target
      if (t?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t?.tagName || '')) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!isMediaFile(file)) continue
        e.preventDefault()
        uploadFiles([file])
        return
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFiles])

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
      className="relative h-full overflow-hidden"
      style={{ background: 'var(--studio-bg)' }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="h-full overflow-auto px-3 py-4" data-lenis-prevent>
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
          <p className="py-8 text-center text-ui-sm italic" style={{ color: 'var(--studio-text-3)' }}>
            No blocks to show
          </p>
        )}
      </div>

      {/* Drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[var(--z-index-nav)] flex items-center justify-center"
            style={{ background: 'rgba(59,130,246,0.08)', backdropFilter: 'blur(var(--blur-xs))' }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 px-10 py-8"
              style={{ background: 'var(--studio-surface)' }}
            >
              <Upload size={24} className="text-accent" />
              <p className="text-ui font-medium" style={{ color: 'var(--studio-text-2)' }}>Drop to upload</p>
              <p className="text-ui-xs" style={{ color: 'var(--studio-text-3)' }}>Images, videos, or audio</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress */}
      <AnimatePresence>
        {uploading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-4 left-1/2 z-[var(--z-index-nav)] flex -translate-x-1/2 items-center gap-2 rounded-lg border px-4 py-2 shadow-lg"
            style={{ background: 'var(--studio-surface)', borderColor: 'var(--studio-border)', color: 'var(--studio-text-2)' }}
          >
            <Loader2 size={13} className="animate-spin text-accent" />
            <span className="text-ui-xs font-medium">Uploading...</span>
          </motion.div>
        )}
      </AnimatePresence>

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
