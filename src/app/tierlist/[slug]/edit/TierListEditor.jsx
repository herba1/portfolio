'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  ImagePlus,
  Loader2,
  Check,
  ArrowLeft,
  X,
} from 'lucide-react'

const POOL = '__pool__'

// Pleasant defaults for freshly-added tiers, cycled in order.
const NEW_TIER_COLORS = [
  '#e26d6d', '#e2966d', '#e2c46d', '#a8c47e', '#7ea8c4', '#9d8ec4', '#c47ea8',
]

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Longest-edge cap for stored thumbnails — tier tiles are tiny, so anything
// past this is wasted bytes. Big enough to stay crisp on retina.
const MAX_EDGE = 512
const WEBP_QUALITY = 0.86
// Pass these through unconverted: GIF (keep animation), SVG (keep vector).
const PASSTHROUGH = new Set(['image/gif', 'image/svg+xml'])

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

// Normalize any browser-decodable image to a downscaled WebP File. Falls back
// to the original blob if decoding/encoding isn't possible.
async function processImage(file) {
  if (PASSTHROUGH.has(file.type)) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return file
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise((res) =>
      canvas.toBlob(res, 'image/webp', WEBP_QUALITY),
    )
    if (!blob) return file // browser couldn't encode webp — keep original
    const base = (file.name || 'pasted').replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.webp`, { type: 'image/webp' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Pull image files out of a clipboard/drop DataTransfer.
function imagesFromDataTransfer(dt) {
  const out = []
  for (const item of dt?.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  if (!out.length && dt?.files?.length) {
    for (const f of dt.files) if (f.type.startsWith('image/')) out.push(f)
  }
  return out
}

export default function TierListEditor({ slug }) {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [description, setDescription] = useState('')
  const [tiers, setTiers] = useState([])
  const [items, setItems] = useState([])

  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const [status, setStatus] = useState('idle') // idle | saving | saved | error
  const [uploading, setUploading] = useState(false)

  // Drag state. draggedId held in a ref too so DnD handlers read it sync.
  const [draggedId, setDraggedId] = useState(null)
  const draggedIdRef = useRef(null)
  const [overTier, setOverTier] = useState(null)
  const insertBeforeRef = useRef(null)

  // File-drop veil (counter avoids flicker as drag crosses child elements).
  const [fileOver, setFileOver] = useState(false)
  const fileDepth = useRef(0)
  const fileInputRef = useRef(null)

  // ── Load ────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    fetch(`/api/tierlist?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('missing')
        return r.json()
      })
      .then((data) => {
        if (!alive) return
        setTitle(data.title ?? slug)
        setSubtitle(data.subtitle ?? '')
        setDescription(data.description ?? '')
        setTiers(Array.isArray(data.tiers) ? data.tiers : [])
        setItems(Array.isArray(data.items) ? data.items : [])
        setLoaded(true)
      })
      .catch(() => {
        if (!alive) return
        setMissing(true)
        setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [slug])

  const markDirty = useCallback(() => {
    setStatus((s) => (s === 'saving' ? s : 'idle'))
  }, [])

  // ── Item moves ──────────────────────────────────────────
  // Rendering filters items by tier preserving array order, so within-tier
  // position is just the relative order of same-tier items in the flat array.
  const moveItem = useCallback((itemId, targetTier, beforeId) => {
    setItems((prev) => {
      const moving = prev.find((i) => i.id === itemId)
      if (!moving) return prev
      const rest = prev.filter((i) => i.id !== itemId)
      const updated = { ...moving, tier: targetTier === POOL ? null : targetTier }
      if (beforeId == null || beforeId === itemId) {
        rest.push(updated)
      } else {
        const idx = rest.findIndex((i) => i.id === beforeId)
        if (idx === -1) rest.push(updated)
        else rest.splice(idx, 0, updated)
      }
      return rest
    })
    markDirty()
  }, [markDirty])

  const removeItem = useCallback((itemId) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    markDirty()
  }, [markDirty])

  // Quick label edit via prompt (double-click) — no modal.
  const editItemLabel = useCallback((item) => {
    const next = window.prompt('Label (optional):', item.label || '')
    if (next == null) return
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, label: next } : i)),
    )
    markDirty()
  }, [markDirty])

  // ── Tier ops ────────────────────────────────────────────
  const addTier = useCallback(() => {
    setTiers((prev) => {
      const color = NEW_TIER_COLORS[prev.length % NEW_TIER_COLORS.length]
      return [...prev, { id: uid(), label: 'New', color }]
    })
    markDirty()
  }, [markDirty])

  const updateTier = useCallback((id, patch) => {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    markDirty()
  }, [markDirty])

  const deleteTier = useCallback((id) => {
    setItems((prev) => prev.map((i) => (i.tier === id ? { ...i, tier: null } : i)))
    setTiers((prev) => prev.filter((t) => t.id !== id))
    markDirty()
  }, [markDirty])

  const moveTier = useCallback((id, dir) => {
    setTiers((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = idx + dir
      if (idx === -1 || next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
      return copy
    })
    markDirty()
  }, [markDirty])

  // ── Uploads ─────────────────────────────────────────────
  const uploadFiles = useCallback(
    async (fileList) => {
      const files = [...fileList].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      setUploading(true)
      for (const raw of files) {
        try {
          const file = await processImage(raw) // → optimized WebP (or passthrough)
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetch('/api/tierlist/upload', { method: 'POST', body: fd })
          const json = await res.json()
          if (json.src) {
            setItems((prev) => [
              ...prev,
              { id: uid(), src: json.src, label: '', tier: null },
            ])
          }
        } catch {
          /* skip a failed file, keep going */
        }
      }
      setUploading(false)
      markDirty()
    },
    [markDirty],
  )

  // ── Clipboard paste (Cmd/Ctrl+V) ────────────────────────
  useEffect(() => {
    const onPaste = (e) => {
      const imgs = imagesFromDataTransfer(e.clipboardData)
      if (imgs.length) {
        e.preventDefault() // don't also paste the filename into a focused input
        uploadFiles(imgs)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFiles])

  // ── Save / delete list ──────────────────────────────────
  const save = useCallback(async () => {
    setStatus('saving')
    try {
      const res = await fetch('/api/tierlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title, subtitle, description, tiers, items }),
      })
      if (!res.ok) throw new Error('save failed')
      setStatus('saved')
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1600)
    } catch {
      setStatus('error')
    }
  }, [slug, title, subtitle, description, tiers, items])

  const deleteList = useCallback(async () => {
    if (!window.confirm(`Delete the entire "${title}" tier list? This can't be undone.`))
      return
    try {
      await fetch('/api/tierlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, delete: true }),
      })
      router.push('/tierlist')
    } catch {
      /* ignore */
    }
  }, [slug, title, router])

  // ── DnD: item drag ──────────────────────────────────────
  const onItemDragStart = (e, item) => {
    draggedIdRef.current = item.id
    setDraggedId(item.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.id)
  }
  const onItemDragEnd = () => {
    draggedIdRef.current = null
    setDraggedId(null)
    setOverTier(null)
    insertBeforeRef.current = null
  }

  const nextItemIdAfter = (item) => {
    const tierId = item.tier ?? null
    const group = items.filter((i) => (i.tier ?? null) === tierId)
    const idx = group.findIndex((i) => i.id === item.id)
    return idx >= 0 && idx + 1 < group.length ? group[idx + 1].id : null
  }

  const onItemDragOver = (e, item) => {
    if (!draggedIdRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > rect.left + rect.width / 2
    insertBeforeRef.current = after ? nextItemIdAfter(item) : item.id
    setOverTier(item.tier ?? POOL)
  }

  // ── DnD: zone (tier row body / tray) ────────────────────
  const onZoneDragOver = (e, tierKey) => {
    if (!draggedIdRef.current) return
    e.preventDefault()
    setOverTier(tierKey)
    insertBeforeRef.current = null
  }
  const onZoneDrop = (e, tierKey) => {
    const id = draggedIdRef.current || e.dataTransfer.getData('text/plain')
    if (id) {
      e.preventDefault()
      moveItem(id, tierKey, insertBeforeRef.current)
    }
    onItemDragEnd()
  }

  // ── File-drop veil (whole editor) ───────────────────────
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')

  const onRootDragEnter = (e) => {
    if (!hasFiles(e)) return
    fileDepth.current += 1
    setFileOver(true)
  }
  const onRootDragOver = (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onRootDragLeave = (e) => {
    if (!hasFiles(e)) return
    fileDepth.current = Math.max(0, fileDepth.current - 1)
    if (fileDepth.current === 0) setFileOver(false)
  }
  const onRootDrop = (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    fileDepth.current = 0
    setFileOver(false)
    uploadFiles(imagesFromDataTransfer(e.dataTransfer))
  }

  const poolItems = items.filter((i) => i.tier == null)

  if (!loaded) {
    return (
      <main className="grid h-full w-full place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-black/40" />
      </main>
    )
  }

  if (missing) {
    return (
      <main className="grid h-full w-full place-items-center">
        <div className="text-center">
          <p className="mb-4 text-black/50">No tier list named “{slug}”.</p>
          <Link
            href="/tierlist"
            className="LinkMask text-dark/70 hover:text-dark inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to lists
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main
      className="flex h-full w-full flex-col"
      onDragEnter={onRootDragEnter}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
    >
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/10 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/tierlist"
            className="LinkMask text-dark/50 hover:text-dark inline-flex shrink-0 items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Lists
          </Link>
          <div className="flex min-w-0 flex-col">
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                markDirty()
              }}
              placeholder="Untitled"
              className="min-w-0 bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-black/20"
            />
            <input
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                markDirty()
              }}
              placeholder="Add a description — a witty comment…"
              className="text-dark/55 min-w-0 bg-transparent text-sm outline-none placeholder:text-black/20"
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={deleteList}
            className="LinkMask text-dark/50 hidden text-sm transition-colors hover:text-[#e26d6d] sm:inline-flex"
            title="Delete this list"
          >
            Delete
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="LinkMask text-dark/70 hover:text-dark inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            Add images
          </button>
          <button
            onClick={save}
            disabled={status === 'saving'}
            className="LinkMask text-dark hover:text-dark inline-flex items-center gap-1.5 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {status === 'saving' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : status === 'saved' ? (
              <Check className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {status === 'saved' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* ── Tiers (scrollable) ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tiers.map((tier, i) => {
          const rowItems = items.filter((it) => it.tier === tier.id)
          const isOver = overTier === tier.id
          return (
            <div
              key={tier.id}
              className="flex min-h-[96px] items-stretch border-b border-black/10"
            >
              {/* Label cell */}
              <div
                className="relative flex w-24 shrink-0 flex-col items-center justify-center gap-1.5 py-2"
                style={{ backgroundColor: tier.color }}
              >
                <input
                  value={tier.label}
                  onChange={(e) => updateTier(tier.id, { label: e.target.value })}
                  className="w-full bg-transparent text-center font-bold tracking-tight text-3xl text-black/85 outline-none"
                />
                <input
                  type="color"
                  value={tier.color}
                  onChange={(e) => updateTier(tier.id, { color: e.target.value })}
                  title="Tier color"
                  className="squircle-sm h-5 w-8 cursor-pointer border border-black/20 bg-transparent p-0"
                />
              </div>

              {/* Drop zone */}
              <div
                className={`tl-dropzone flex flex-1 items-center gap-1.5 overflow-x-auto bg-white/40 px-2 ${
                  isOver ? 'is-over' : ''
                }`}
                onDragOver={(e) => onZoneDragOver(e, tier.id)}
                onDrop={(e) => onZoneDrop(e, tier.id)}
              >
                {rowItems.map((item) => (
                  <ItemThumb
                    key={item.id}
                    item={item}
                    dragging={draggedId === item.id}
                    onDragStart={onItemDragStart}
                    onDragEnd={onItemDragEnd}
                    onDragOver={onItemDragOver}
                    onRemove={removeItem}
                    onEditLabel={editItemLabel}
                  />
                ))}
                {rowItems.length === 0 && (
                  <span className="px-1 text-xs text-black/25 select-none">
                    Drop here
                  </span>
                )}
              </div>

              {/* Row controls */}
              <div className="flex w-10 shrink-0 flex-col items-center justify-center gap-1 border-l border-black/10">
                <button
                  onClick={() => moveTier(tier.id, -1)}
                  disabled={i === 0}
                  className="text-black/30 hover:text-black disabled:opacity-20"
                  title="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => moveTier(tier.id, 1)}
                  disabled={i === tiers.length - 1}
                  className="text-black/30 hover:text-black disabled:opacity-20"
                  title="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete tier "${tier.label}"? Items go back to the tray.`))
                      deleteTier(tier.id)
                  }}
                  className="text-black/30 hover:text-[#e26d6d]"
                  title="Delete tier"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}

        <button
          onClick={addTier}
          className="flex w-full items-center justify-center gap-1.5 py-3 text-sm text-black/40 transition-colors hover:bg-black/[0.03] hover:text-black"
        >
          <Plus className="h-4 w-4" /> Add tier
        </button>
      </div>

      {/* ── Tray (unranked) ── */}
      <div className="shrink-0 border-t border-black/10 bg-white/30 px-3 py-3">
        <div className="mb-2 flex items-center justify-between text-xs text-black/40">
          <span className="tracking-wide uppercase">Tray · {poolItems.length}</span>
          <span>Paste, drop, or click to add — auto-optimized to WebP</span>
        </div>
        <div
          className={`tl-dropzone flex min-h-[88px] items-center gap-1.5 overflow-x-auto border border-dashed border-black/15 bg-white/40 px-2 ${
            overTier === POOL ? 'is-over' : ''
          }`}
          onDragOver={(e) => onZoneDragOver(e, POOL)}
          onDrop={(e) => onZoneDrop(e, POOL)}
        >
          {poolItems.map((item) => (
            <ItemThumb
              key={item.id}
              item={item}
              dragging={draggedId === item.id}
              onDragStart={onItemDragStart}
              onDragEnd={onItemDragEnd}
              onDragOver={onItemDragOver}
              onRemove={removeItem}
              onEditLabel={editItemLabel}
            />
          ))}
          {poolItems.length === 0 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1 py-3 text-xs text-black/30 transition-colors hover:text-black/60"
            >
              <ImagePlus className="h-5 w-5" />
              Drop or click to add images
            </button>
          )}
        </div>
      </div>

      {/* ── File-drop veil ── */}
      {fileOver && (
        <div className="tl-file-veil pointer-events-none fixed inset-0 z-50 grid place-items-center bg-light/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-dark">
            <ImagePlus className="h-10 w-10" />
            <span className="text-lg font-medium">Drop images — they’ll be optimized to WebP</span>
          </div>
        </div>
      )}
    </main>
  )
}

// ── Item thumbnail ────────────────────────────────────────
function ItemThumb({
  item,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onRemove,
  onEditLabel,
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, item)}
      onDoubleClick={() => onEditLabel(item)}
      title="Click for details · drag to rank"
      className={`tl-edit-item group relative aspect-square h-[76px] shrink-0 cursor-pointer overflow-hidden bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/10 ${
        dragging ? 'is-dragging' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.src}
        alt={item.label || ''}
        draggable={false}
        className="pointer-events-none h-full w-full object-cover"
      />
      {item.label ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {item.label}
        </span>
      ) : null}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(item.id)
        }}
        className="squircle-pill absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
        title="Remove"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
