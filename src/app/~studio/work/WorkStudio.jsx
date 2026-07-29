'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ArrowLeft, Save, Loader2, Check, Sun, Moon, Plus, GripVertical,
  Eye, EyeOff, Image as ImageIcon, Film, Type, Boxes, ExternalLink,
} from 'lucide-react'
import { geist, spencer } from '@/app/fonts'
import WorkGrid from '@/app/work/WorkGrid'
import { blankItem, COLUMNS, EMPTY, sanitize } from '@/app/work/constants'
import { REGISTRY } from '@/app/work/registry'
import { StudioDialog } from '../StudioDialog'
import Inspector from './Inspector'

/* ─────────────────────────────────────────────────────────────
 * WORK STUDIO — the /work page, editable.
 *
 * Same shell language as the blog studio (dark chrome, ⌘S, dirty dot),
 * but the middle pane is not a text editor: it's the REAL grid, mounted
 * from the same WorkGrid component the live page uses. What you drag,
 * drop and nudge here is exactly what ships — no preview renderer to
 * drift out of sync.
 *
 * The preview canvas stays light even when the chrome is dark, because
 * /work is a light page and judging a light layout on black lies to you.
 * ───────────────────────────────────────────────────────────── */

const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1]
const spring = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

const KIND_ICON = { component: Boxes, image: ImageIcon, video: Film, note: Type }

const ADD_KINDS = [
  { kind: 'component', label: 'Component', icon: Boxes },
  { kind: 'image', label: 'Image', icon: ImageIcon },
  { kind: 'video', label: 'Video', icon: Film },
  { kind: 'note', label: 'Note', icon: Type },
]

let idCounter = 0
const nextId = (kind) => `${kind}-${Date.now().toString(36)}-${idCounter++}`

function kindForFile(file) {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

// A tile's label in the sidebar: whatever it can actually be called.
function labelFor(item) {
  if (item.title) return item.title
  if (item.kind === 'component') return REGISTRY[item.component]?.label || 'Component'
  if (item.src) return item.src.split('/').pop()
  return `Untitled ${item.kind}`
}

export default function WorkStudio() {
  const [data, setData] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [dropping, setDropping] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [error, setError] = useState('')
  const [previewCols, setPreviewCols] = useState(COLUMNS)
  const [light, setLight] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('studio-light') === 'true' : false,
  )

  const dragIndex = useRef(null)
  const dropDepth = useRef(0)

  const items = data.items
  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId],
  )

  useEffect(() => {
    fetch('/api/work')
      .then((r) => r.json())
      .then((d) => setData(sanitize(d)))
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true))
  }, [])

  // ── mutations ──────────────────────────────────────────────
  const mutate = useCallback((fn) => {
    setData((d) => {
      const next = fn(d)
      return next
    })
    setDirty(true)
  }, [])

  const patchItem = useCallback(
    (id, patch) =>
      mutate((d) => ({
        ...d,
        items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      })),
    [mutate],
  )

  const addItem = useCallback(
    (kind, extra = {}) => {
      const item = { ...blankItem(kind, nextId(kind)), ...extra }
      mutate((d) => ({ ...d, items: [...d.items, item] }))
      setSelectedId(item.id)
      setAddOpen(false)
      return item
    },
    [mutate],
  )

  const removeItem = useCallback(
    (id) => {
      mutate((d) => ({ ...d, items: d.items.filter((it) => it.id !== id) }))
      setSelectedId((cur) => (cur === id ? null : cur))
    },
    [mutate],
  )

  const duplicateItem = useCallback(
    (id) => {
      mutate((d) => {
        const i = d.items.findIndex((it) => it.id === id)
        if (i === -1) return d
        const copy = { ...d.items[i], id: nextId(d.items[i].kind) }
        const items = [...d.items]
        items.splice(i + 1, 0, copy)
        return { ...d, items }
      })
    },
    [mutate],
  )

  const moveItem = useCallback(
    (from, to) => {
      if (from === to || from == null || to == null) return
      mutate((d) => {
        const items = [...d.items]
        const [moved] = items.splice(from, 1)
        items.splice(to, 0, moved)
        return { ...d, items }
      })
    },
    [mutate],
  )

  // ── uploads ────────────────────────────────────────────────
  const upload = useCallback(async (file) => {
    setUploading((n) => n + 1)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/work/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      return json
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setUploading((n) => n - 1)
    }
  }, [])

  // Files dropped on the canvas become new tiles, one each, in drop order.
  const handleFiles = useCallback(
    async (files) => {
      for (const file of Array.from(files)) {
        const kind = kindForFile(file)
        const res = await upload(file)
        if (!res) continue
        addItem(kind, {
          src: res.path,
          title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
          ratio: kind === 'video' ? '16/9' : '4/3',
        })
      }
    },
    [upload, addItem],
  )

  // Files chosen from the inspector replace the selected tile's source.
  const uploadToSelected = useCallback(
    async (file) => {
      if (!selected) return
      const res = await upload(file)
      if (res) patchItem(selected.id, { src: res.path })
    },
    [selected, upload, patchItem],
  )

  // ── save ───────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [data, saving])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  // Leaving with unsaved changes is almost always a mistake here — the file
  // is the only copy.
  useEffect(() => {
    if (!dirty) return
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const toggleLight = () =>
    setLight((l) => {
      localStorage.setItem('studio-light', String(!l))
      return !l
    })

  return (
    <div
      className={`studio flex h-full flex-col ${geist.className} ${light ? 'studio-light' : ''}`}
      style={{ background: 'var(--studio-bg)', color: 'var(--studio-text)' }}
    >
      {/* ── Toolbar ── */}
      <div
        className="flex h-12 shrink-0 items-center"
        style={{ borderBottom: '1px solid var(--studio-border)', background: 'var(--studio-surface)' }}
      >
        <div className="flex w-[260px] items-center gap-3 px-4">
          <a
            href="/~studio"
            className="ease-out-quart flex items-center gap-1.5 text-ui-sm transition-colors duration-300 hover:opacity-70"
            style={{ color: 'var(--studio-text-3)' }}
          >
            <ArrowLeft size={12} />
            <span>Studio</span>
          </a>
          <span style={{ color: 'var(--studio-text-4)' }} className="text-ui-2xs">|</span>
          <span className={`${spencer.className} text-ui italic`} style={{ color: 'var(--studio-text-4)' }}>
            work
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center gap-2">
          <span className="font-mono text-ui-xs" style={{ color: 'var(--studio-text-2)' }}>
            work.json
          </span>
          <span className="text-ui-xs tabular-nums" style={{ color: 'var(--studio-text-4)' }}>
            {items.length} tiles
          </span>
          <AnimatePresence>
            {dirty && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={spring}
                className="h-1.5 w-1.5 rounded-full bg-amber-400"
              />
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2 px-4">
          {/* A cap on the preview, not the live count — the page itself picks
              1 or 2 from its own width. This is for sanity-checking how the
              same tiles scan when they stack. */}
          <div className="flex h-7 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--studio-border)' }}>
            {[1, COLUMNS].map((n) => (
              <button
                key={n}
                onClick={() => setPreviewCols(n)}
                className="px-2 text-ui-xs font-medium transition-colors duration-200"
                style={{
                  background: previewCols === n ? 'var(--studio-active)' : 'transparent',
                  color: previewCols === n ? 'var(--studio-text)' : 'var(--studio-text-3)',
                }}
                title={`Preview at ${n} column${n > 1 ? 's' : ''}`}
              >
                {n}
              </button>
            ))}
          </div>

          <a
            href="/work"
            target="_blank"
            rel="noopener noreferrer"
            className="studio-palette-btn flex h-7 items-center gap-1.5 rounded-md px-2 text-ui-xs font-medium"
            title="Open /work"
          >
            <ExternalLink size={12} />
            Open
          </a>

          <motion.button
            onClick={toggleLight}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.88 }}
            transition={spring}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-300 hover:opacity-70"
            style={{ color: 'var(--studio-text-3)' }}
            aria-label="Toggle light/dark chrome"
            title="Toggle light/dark chrome"
          >
            {light ? <Moon size={13} /> : <Sun size={13} />}
          </motion.button>

          <motion.button
            onClick={save}
            disabled={!dirty || saving}
            whileHover={dirty ? { scale: 1.05 } : {}}
            whileTap={dirty ? { scale: 0.95 } : {}}
            transition={spring}
            className={`squircle-sm flex h-7 items-center gap-1.5 border px-3 text-ui-xs font-medium transition-all duration-300 ${
              dirty
                ? 'border-white/20 bg-linear-to-b from-blue-400 to-blue-500 text-white shadow-md shadow-blue-500/25 inset-shadow-sm inset-shadow-white/20'
                : ''
            }`}
            style={dirty ? {} : { borderColor: 'var(--studio-border)', color: 'var(--studio-text-4)' }}
            title="Save (⌘S)"
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : saved ? (
              <Check size={12} />
            ) : (
              <Save size={12} />
            )}
            Save
          </motion.button>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — order is the grid's flow order. */}
        <aside
          className="flex w-[260px] shrink-0 flex-col overflow-hidden"
          style={{ borderRight: '1px solid var(--studio-border)', background: 'var(--studio-surface)' }}
        >
          <div
            className="flex h-10 shrink-0 items-center justify-between px-3"
            style={{ borderBottom: '1px solid var(--studio-border)' }}
          >
            <span className="text-ui-sm" style={{ color: 'var(--studio-text-2)' }}>
              Tiles
            </span>
            <button
              onClick={() => setAddOpen(true)}
              className="studio-palette-btn flex items-center gap-1 rounded-md px-2 py-1 text-ui-xs font-medium"
            >
              <Plus size={11} />
              Add
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {items.map((item, i) => {
              const Icon = KIND_ICON[item.kind] || Boxes
              const active = item.id === selectedId
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    dragIndex.current = i
                    e.dataTransfer.effectAllowed = 'move'
                    // Firefox refuses to start a drag without payload.
                    e.dataTransfer.setData('text/plain', item.id)
                  }}
                  onDragOver={(e) => {
                    if (dragIndex.current == null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    if (dragIndex.current == null) return
                    e.preventDefault()
                    e.stopPropagation()
                    moveItem(dragIndex.current, i)
                    dragIndex.current = null
                  }}
                  onClick={() => setSelectedId(item.id)}
                  className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150"
                  style={{
                    background: active ? 'var(--studio-active)' : 'transparent',
                    color: active ? 'var(--studio-text)' : 'var(--studio-text-2)',
                    opacity: item.hidden ? 0.45 : 1,
                  }}
                >
                  <GripVertical
                    size={12}
                    className="shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--studio-text-3)' }}
                  />
                  <Icon size={12} className="shrink-0" style={{ color: 'var(--studio-text-3)' }} />
                  <span className="min-w-0 flex-1 truncate text-ui">{labelFor(item)}</span>
                  <span className="shrink-0 font-mono text-ui-2xs tabular-nums" style={{ color: 'var(--studio-text-4)' }}>
                    {item.span}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      patchItem(item.id, { hidden: !item.hidden })
                    }}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--studio-text-3)' }}
                    title={item.hidden ? 'Show on /work' : 'Hide from /work'}
                    aria-label={item.hidden ? 'Show tile' : 'Hide tile'}
                  >
                    {item.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              )
            })}

            {loaded && items.length === 0 ? (
              <p className="px-2 py-6 text-center text-ui" style={{ color: 'var(--studio-text-3)' }}>
                No tiles yet. Hit Add, or drop files on the canvas.
              </p>
            ) : null}
          </div>
        </aside>

        {/* Canvas — the real grid, on the real page background. */}
        <div
          className="relative flex-1 overflow-y-auto"
          style={{ background: 'var(--color-surface)' }}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            dropDepth.current += 1
            setDropping(true)
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={() => {
            dropDepth.current -= 1
            if (dropDepth.current <= 0) {
              dropDepth.current = 0
              setDropping(false)
            }
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files?.length) return
            e.preventDefault()
            dropDepth.current = 0
            setDropping(false)
            handleFiles(e.dataTransfer.files)
          }}
          onClick={(e) => {
            // Clicking the empty canvas deselects.
            if (e.target === e.currentTarget) setSelectedId(null)
          }}
        >
          <div className="mx-auto max-w-[1440px] px-6 py-10">
            <h2 className="text-ink text-title-xl mb-2">{data.title || 'Work'}</h2>
            {data.intro ? (
              <p className="text-ink-secondary text-body-lg mb-8 max-w-xl text-balance">{data.intro}</p>
            ) : (
              <div className="mb-8" />
            )}

            {loaded ? (
              <WorkGrid
                items={items}
                columns={previewCols}
                inert
                animate={false}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : (
              <div className="text-ink-secondary flex h-40 items-center justify-center">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
          </div>

          <AnimatePresence>
            {dropping ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-none sticky bottom-0 left-0 z-40 -mt-24 flex h-24 items-center justify-center"
              >
                <span className="squircle-pill bg-accent text-ui-lg px-4 py-2 font-medium text-white shadow-lg">
                  Drop to add
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Inspector */}
        <aside
          className="w-[300px] shrink-0 overflow-y-auto"
          style={{ borderLeft: '1px solid var(--studio-border)', background: 'var(--studio-surface)' }}
        >
          <Inspector
            item={selected}
            page={data}
            onChangePage={(patch) => mutate((d) => ({ ...d, ...patch }))}
            onChange={(patch) => selected && patchItem(selected.id, patch)}
            onDelete={() => selected && setDeleteTarget(selected)}
            onDuplicate={() => selected && duplicateItem(selected.id)}
            onUploadTo={uploadToSelected}
            uploading={uploading > 0}
          />
        </aside>
      </div>

      {/* Status strip — uploads and errors, nothing else. */}
      {(uploading > 0 || error) && (
        <div
          className="flex h-8 shrink-0 items-center gap-2 px-4 text-ui-xs"
          style={{ borderTop: '1px solid var(--studio-border)', background: 'var(--studio-surface)' }}
        >
          {uploading > 0 ? (
            <span className="flex items-center gap-1.5" style={{ color: 'var(--studio-text-2)' }}>
              <Loader2 size={11} className="animate-spin" />
              Uploading {uploading} file{uploading > 1 ? 's' : ''}…
            </span>
          ) : null}
          {error ? <span className="text-red-400">{error}</span> : null}
        </div>
      )}

      {/* ── Add dialog ── */}
      <StudioDialog open={addOpen} onOpenChange={setAddOpen} title="Add a tile">
        <div className="grid grid-cols-2 gap-2">
          {ADD_KINDS.map(({ kind, label, icon: Icon }) => (
            <button
              key={kind}
              onClick={() => addItem(kind)}
              className="flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors duration-200 hover:bg-[var(--studio-hover)]"
              style={{ borderColor: 'var(--studio-border)', color: 'var(--studio-text-2)' }}
            >
              <Icon size={15} />
              <span className="text-ui font-medium">{label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-ui-xs" style={{ color: 'var(--studio-text-3)' }}>
          Or drag files straight onto the canvas.
        </p>
      </StudioDialog>

      {/* ── Delete dialog ── */}
      <StudioDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete tile"
      >
        <div className="flex flex-col gap-4">
          <p className="text-ui leading-relaxed" style={{ color: 'var(--studio-text-2)' }}>
            Remove <strong style={{ color: 'var(--studio-text)' }}>{deleteTarget ? labelFor(deleteTarget) : ''}</strong> from
            the grid? The uploaded file stays on disk.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg px-3 py-1.5 text-ui-sm font-medium transition-colors duration-200 hover:opacity-70"
              style={{ color: 'var(--studio-text-3)' }}
            >
              Cancel
            </button>
            <motion.button
              onClick={() => {
                removeItem(deleteTarget.id)
                setDeleteTarget(null)
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              className="rounded-lg border border-red-400/30 bg-linear-to-b from-red-400 to-red-500 px-4 py-1.5 text-ui-sm font-medium text-white shadow-sm shadow-red-500/20 inset-shadow-sm inset-shadow-white/20"
            >
              Delete
            </motion.button>
          </div>
        </div>
      </StudioDialog>
    </div>
  )
}
