'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Save, Eye, EyeOff, Loader2, Check, ArrowLeft, Sun, Moon, Columns2, LayoutList } from 'lucide-react'
import { geist, spencer } from '@/app/fonts'
import EditorPane from './EditorPane'
import PreviewPane from './PreviewPane'
import SplitPane from './SplitPane'
import Sidebar from './Sidebar'
import ComponentPalette from './ComponentPalette'
import BlockEditor from './BlockEditor'
import { StudioDialog } from './StudioDialog'

const DEBOUNCE_MS = 300
const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1]
const spring = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

const NEW_POST_TEMPLATE = `import BlogHeader from '../components/BlogHeader'

export const metadata = {
  title: 'Untitled | herb.art',
  description: '',
}

<BlogHeader title="Untitled" date="${new Date().toISOString().slice(0, 10)}" tags={[]} />

<article className="blog-article prose prose-slate max-w-none prose-headings:tracking-heading-mobile prose-a:text-blue-500 prose-code:before:content-[''] prose-code:after:content-['']">

Start writing...

</article>
`

export default function Studio() {
  const [posts, setPosts] = useState([])
  const [activeSlug, setActiveSlug] = useState(null)
  const [content, setContent] = useState('')
  const [debouncedContent, setDebouncedContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('studio-sidebar')
      return s !== null ? s === 'true' : true
    }
    return true
  })
  const [showPreview, setShowPreview] = useState(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('studio-preview')
      return s !== null ? s === 'true' : true
    }
    return true
  })
  const [loadingFile, setLoadingFile] = useState(false)
  const [editorMode, setEditorMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('studio-mode') || 'code'
    }
    return 'code'
  })
  const [vimMode, setVimMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('studio-vim')
      if (saved !== null) return saved === 'true'
      return window.innerWidth >= 768 // auto vim on desktop
    }
    return false
  })
  const [light, setLight] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('studio-light') === 'true'
    }
    return false
  })

  const [newPostOpen, setNewPostOpen] = useState(false)
  const [newPostSlug, setNewPostSlug] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameSlug, setRenameSlug] = useState('')

  const editorRef = useRef(null)
  const debounceRef = useRef(null)
  const savedContentRef = useRef('')

  const toggleLight = useCallback(() => {
    setLight((l) => {
      const next = !l
      localStorage.setItem('studio-light', String(next))
      return next
    })
  }, [])

  // Fetch posts + restore last active post
  const initialLoadRef = useRef(false)
  useEffect(() => {
    fetch('/api/studio/posts')
      .then((r) => r.json())
      .then((data) => {
        setPosts(data)
        // Auto-load last active post on first mount
        if (!initialLoadRef.current) {
          initialLoadRef.current = true
          const lastSlug = localStorage.getItem('studio-active')
          if (lastSlug && data.some((p) => p.slug === lastSlug)) {
            loadPost(lastSlug)
          }
        }
      })
      .catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedContent(content)
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [content])

  const loadPost = useCallback(async (slug) => {
    setLoadingFile(true)
    try {
      const res = await fetch(`/api/studio/read?slug=${slug}`)
      const data = await res.json()
      if (data.content !== undefined) {
        setContent(data.content)
        setDebouncedContent(data.content)
        savedContentRef.current = data.content
        setActiveSlug(slug)
        setDirty(false)
        localStorage.setItem('studio-active', slug)
      }
    } catch (err) {
      console.error('Failed to load post:', err)
    } finally {
      setLoadingFile(false)
    }
  }, [])

  const handleChange = useCallback((value) => {
    setContent(value)
    setDirty(value !== savedContentRef.current)
  }, [])

  const save = useCallback(async () => {
    if (!activeSlug || saving) return
    setSaving(true)
    try {
      await fetch('/api/studio/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: activeSlug, content }),
      })
      savedContentRef.current = content
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [activeSlug, content, saving])

  const handleNew = useCallback(() => {
    setNewPostSlug('')
    setNewPostOpen(true)
  }, [])

  const confirmNewPost = useCallback(() => {
    const slug = newPostSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!slug) return
    setContent(NEW_POST_TEMPLATE)
    setDebouncedContent(NEW_POST_TEMPLATE)
    savedContentRef.current = ''
    setActiveSlug(slug)
    setDirty(true)
    setNewPostOpen(false)
    localStorage.setItem('studio-active', slug)
  }, [newPostSlug])

  const handleInsert = useCallback((snippet) => {
    editorRef.current?.insertSnippet('\n' + snippet + '\n')
  }, [])

  const refreshPosts = useCallback(() => {
    fetch('/api/studio/posts')
      .then((r) => r.json())
      .then(setPosts)
      .catch(console.error)
  }, [])

  const handleStatusChange = useCallback(async (slug, published) => {
    try {
      await fetch('/api/studio/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, updates: { published } }),
      })
      refreshPosts()
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }, [refreshPosts])

  const confirmRename = useCallback(async () => {
    const slug = renameSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!slug || slug === activeSlug) { setRenameOpen(false); return }
    try {
      const res = await fetch('/api/studio/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldSlug: activeSlug, newSlug: slug }),
      })
      const data = await res.json()
      if (data.error) { console.error('Rename failed:', data.error); return }
      setActiveSlug(slug)
      localStorage.setItem('studio-active', slug)
      refreshPosts()
    } catch (err) {
      console.error('Rename failed:', err)
    } finally {
      setRenameOpen(false)
    }
  }, [renameSlug, activeSlug, refreshPosts])

  const handleDelete = useCallback((slug) => {
    setDeleteTarget(slug)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await fetch('/api/studio/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: deleteTarget, content: null, delete: true }),
      })
      if (activeSlug === deleteTarget) {
        setActiveSlug(null)
        setContent('')
        setDebouncedContent('')
        localStorage.removeItem('studio-active')
      }
      refreshPosts()
    } catch (err) {
      console.error('Failed to delete:', err)
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, activeSlug, refreshPosts])

  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') { e.preventDefault(); save() }
      if (mod && e.key === 'b') { e.preventDefault(); setSidebarOpen((o) => { const n = !o; localStorage.setItem('studio-sidebar', String(n)); return n }) }
      if (mod && e.key === '\\') { e.preventDefault(); setShowPreview((p) => { const n = !p; localStorage.setItem('studio-preview', String(n)); return n }) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <div
      className={`studio flex h-full flex-col transition-colors duration-300 ${geist.className} ${light ? 'studio-light' : ''}`}
      style={{ background: 'var(--studio-bg)', color: 'var(--studio-text)' }}
    >
      {/* ── Toolbar ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_QUART }}
        className="flex h-12 shrink-0 items-center"
        style={{ borderBottom: '1px solid var(--studio-border)', background: 'var(--studio-surface)' }}
      >
        <div className="flex w-[220px] items-center gap-3 px-4">
          <a
            href="/"
            className="flex items-center gap-1.5 tracking-body-base text-[12px] transition-colors duration-300 ease-out-quart hover:opacity-70"
            style={{ color: 'var(--studio-text-3)' }}
          >
            <ArrowLeft size={12} />
            <span>Back</span>
          </a>
          <span style={{ color: 'var(--studio-text-4)' }} className="text-[10px]">|</span>
          <span className={`${spencer.className} text-[13px] italic`} style={{ color: 'var(--studio-text-4)' }}>
            studio
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center gap-2.5">
          {activeSlug ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => { setRenameSlug(activeSlug); setRenameOpen(true) }}
                className="font-mono text-[11px] font-medium transition-colors duration-200 hover:underline"
                style={{ color: 'var(--studio-text-2)' }}
                title="Click to rename"
              >
                {activeSlug}
              </button>
              <span className="font-mono text-[11px]" style={{ color: 'var(--studio-text-4)' }}>/page.mdx</span>
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
            </motion.div>
          ) : (
            <span className="font-mono text-[11px] italic" style={{ color: 'var(--studio-text-4)' }}>
              No file selected
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 px-4">
          {/* Vim toggle */}
          {activeSlug && editorMode === 'code' && (
            <button
              onClick={() => {
                setVimMode((v) => {
                  const next = !v
                  localStorage.setItem('studio-vim', String(next))
                  return next
                })
              }}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-mono font-medium tracking-body-base transition-all duration-200"
              style={{
                background: vimMode ? 'var(--studio-active)' : 'transparent',
                color: vimMode ? 'var(--studio-text)' : 'var(--studio-text-3)',
              }}
              title="Toggle Vim mode"
            >
              vim
            </button>
          )}

          {/* Code/Blocks toggle */}
          {activeSlug && (
            <div
              className="flex h-7 overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--studio-border)' }}
            >
              <button
                onClick={() => { setEditorMode('code'); localStorage.setItem('studio-mode', 'code') }}
                className="flex items-center gap-1 px-2 text-[11px] font-medium tracking-body-base transition-all duration-200"
                style={{
                  background: editorMode === 'code' ? 'var(--studio-active)' : 'transparent',
                  color: editorMode === 'code' ? 'var(--studio-text)' : 'var(--studio-text-3)',
                }}
              >
                <Columns2 size={11} />
                Code
              </button>
              <button
                onClick={() => { setEditorMode('blocks'); localStorage.setItem('studio-mode', 'blocks') }}
                className="flex items-center gap-1 px-2 text-[11px] font-medium tracking-body-base transition-all duration-200"
                style={{
                  background: editorMode === 'blocks' ? 'var(--studio-active)' : 'transparent',
                  color: editorMode === 'blocks' ? 'var(--studio-text)' : 'var(--studio-text-3)',
                }}
              >
                <LayoutList size={11} />
                Blocks
              </button>
            </div>
          )}

          {/* Light/dark toggle */}
          <motion.button
            onClick={toggleLight}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.88 }}
            transition={spring}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-300 hover:opacity-70"
            style={{ color: 'var(--studio-text-3)' }}
            title="Toggle light/dark mode"
            aria-label="Toggle light/dark mode"
          >
            <AnimatePresence mode="wait">
              {light ? (
                <motion.span key="moon" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={spring}>
                  <Moon size={13} />
                </motion.span>
              ) : (
                <motion.span key="sun" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={spring}>
                  <Sun size={13} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          {/* Toggle preview */}
          <motion.button
            onClick={() => setShowPreview((p) => { const n = !p; localStorage.setItem('studio-preview', String(n)); return n })}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={spring}
            className={`squircle-sm flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-medium tracking-body-base transition-colors duration-300 ${
              showPreview ? 'bg-accent/10 text-accent' : ''
            }`}
            style={showPreview ? {} : { color: 'var(--studio-text-3)' }}
            title="Toggle preview (⌘\\)"
            aria-label="Toggle preview"
          >
            {showPreview ? <Eye size={12} /> : <EyeOff size={12} />}
            Preview
          </motion.button>

          {/* Save */}
          <motion.button
            onClick={save}
            disabled={!dirty || saving}
            whileHover={dirty ? { scale: 1.05 } : {}}
            whileTap={dirty ? { scale: 0.95 } : {}}
            transition={spring}
            className={`squircle-sm flex h-7 items-center gap-1.5 border px-3 text-[11px] font-medium tracking-body-base transition-all duration-300 ${
              dirty
                ? 'border-white/20 bg-linear-to-b from-blue-400 to-blue-500 text-white shadow-md shadow-blue-500/25 inset-shadow-sm inset-shadow-white/20'
                : ''
            }`}
            style={dirty ? {} : { borderColor: 'var(--studio-border)', color: 'var(--studio-text-4)' }}
            title="Save (⌘S)"
            aria-label="Save"
          >
            <AnimatePresence mode="wait">
              {saving ? (
                <motion.span key="saving" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }} transition={spring}>
                  <Loader2 size={12} className="animate-spin" />
                </motion.span>
              ) : saved ? (
                <motion.span key="saved" initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={spring}>
                  <Check size={12} />
                </motion.span>
              ) : (
                <motion.span key="save" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Save size={12} />
                </motion.span>
              )}
            </AnimatePresence>
            Save
          </motion.button>
        </div>
      </motion.div>

      {/* ── Main area ── */}
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar
          posts={posts}
          activeSlug={activeSlug}
          onSelect={loadPost}
          onNew={handleNew}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => { const n = !o; localStorage.setItem('studio-sidebar', String(n)); return n })}
          dirty={dirty}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />

        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {loadingFile ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex h-full items-center justify-center">
                <Loader2 size={18} className="animate-spin" style={{ color: 'var(--studio-text-4)' }} />
              </motion.div>
            ) : activeSlug ? (
              <motion.div key="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE_OUT_QUART }} className="h-full">
                <SplitPane
                  showPreview={showPreview}
                  left={
                    editorMode === 'blocks'
                      ? <BlockEditor value={content} onChange={handleChange} />
                      : <EditorPane ref={editorRef} value={content} onChange={handleChange} light={light} vimMode={vimMode} />
                  }
                  right={<PreviewPane content={debouncedContent} />}
                />
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE_OUT_QUART, delay: 0.1 }} className="flex h-full flex-col items-center justify-center gap-6">
                <div className="text-center">
                  <p className={`${spencer.className} text-[28px] italic`} style={{ color: 'var(--studio-text-4)' }}>
                    studio
                  </p>
                  <p className="mt-2 text-[13px] tracking-body-base" style={{ color: 'var(--studio-text-3)' }}>
                    Select a post or create a new one
                  </p>
                </div>
                <motion.button
                  onClick={handleNew}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={spring}
                  className="squircle px-5 py-2.5 text-[12px] font-medium tracking-body-base shadow-sm inset-shadow-sm transition-colors duration-300 hover:opacity-80"
                  style={{ border: '1px solid var(--studio-border)', background: 'var(--studio-surface)', color: 'var(--studio-text-2)' }}
                >
                  New Post
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Component Palette ── */}
      <AnimatePresence>
        {activeSlug && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3, ease: EASE_OUT_QUART }}
          >
            <ComponentPalette onInsert={handleInsert} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── New Post Dialog ── */}
      <StudioDialog open={newPostOpen} onOpenChange={setNewPostOpen} title="New Post">
        <div className="flex flex-col gap-3">
          <label className="text-[12px] font-medium tracking-body-base" style={{ color: 'var(--studio-text-2)' }}>
            Slug
          </label>
          <input
            type="text"
            value={newPostSlug}
            onChange={(e) => setNewPostSlug(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmNewPost() }}
            placeholder="my-new-post"
            autoFocus
            className="rounded-lg border px-3 py-2 font-mono text-[13px] outline-none transition-colors duration-200 focus:border-accent"
            style={{
              background: 'var(--studio-bg)',
              borderColor: 'var(--studio-border)',
              color: 'var(--studio-text)',
            }}
          />
          <p className="text-[11px]" style={{ color: 'var(--studio-text-3)' }}>
            Lowercase letters, numbers, and hyphens only. This becomes the URL path.
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <button
              onClick={() => setNewPostOpen(false)}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium tracking-body-base transition-colors duration-200 hover:opacity-70"
              style={{ color: 'var(--studio-text-3)' }}
            >
              Cancel
            </button>
            <motion.button
              onClick={confirmNewPost}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              disabled={!newPostSlug.trim()}
              className="rounded-lg border border-white/20 bg-linear-to-b from-blue-400 to-blue-500 px-4 py-1.5 text-[12px] font-medium tracking-body-base text-white shadow-sm shadow-blue-500/20 inset-shadow-sm inset-shadow-white/20 transition-opacity disabled:opacity-40"
            >
              Create
            </motion.button>
          </div>
        </div>
      </StudioDialog>

      {/* ── Delete Confirmation Dialog ── */}
      <StudioDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} title="Delete Post">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--studio-text-2)' }}>
            Are you sure you want to delete <strong style={{ color: 'var(--studio-text)' }}>{deleteTarget}</strong>? This removes the MDX file permanently.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium tracking-body-base transition-colors duration-200 hover:opacity-70"
              style={{ color: 'var(--studio-text-3)' }}
            >
              Cancel
            </button>
            <motion.button
              onClick={confirmDelete}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              className="rounded-lg border border-red-400/30 bg-linear-to-b from-red-400 to-red-500 px-4 py-1.5 text-[12px] font-medium tracking-body-base text-white shadow-sm shadow-red-500/20 inset-shadow-sm inset-shadow-white/20"
            >
              Delete
            </motion.button>
          </div>
        </div>
      </StudioDialog>

      {/* ── Rename Dialog ── */}
      <StudioDialog open={renameOpen} onOpenChange={setRenameOpen} title="Rename Post">
        <div className="flex flex-col gap-3">
          <label className="text-[12px] font-medium tracking-body-base" style={{ color: 'var(--studio-text-2)' }}>
            Slug
          </label>
          <input
            type="text"
            value={renameSlug}
            onChange={(e) => setRenameSlug(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmRename() }}
            autoFocus
            className="rounded-lg border px-3 py-2 font-mono text-[13px] outline-none transition-colors duration-200 focus:border-accent"
            style={{
              background: 'var(--studio-bg)',
              borderColor: 'var(--studio-border)',
              color: 'var(--studio-text)',
            }}
          />
          <p className="text-[11px]" style={{ color: 'var(--studio-text-3)' }}>
            This renames the directory and updates posts.js.
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <button
              onClick={() => setRenameOpen(false)}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium tracking-body-base transition-colors duration-200 hover:opacity-70"
              style={{ color: 'var(--studio-text-3)' }}
            >
              Cancel
            </button>
            <motion.button
              onClick={confirmRename}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              disabled={!renameSlug.trim() || renameSlug.trim() === activeSlug}
              className="rounded-lg border border-white/20 bg-linear-to-b from-blue-400 to-blue-500 px-4 py-1.5 text-[12px] font-medium tracking-body-base text-white shadow-sm shadow-blue-500/20 inset-shadow-sm inset-shadow-white/20 transition-opacity disabled:opacity-40"
            >
              Rename
            </motion.button>
          </div>
        </div>
      </StudioDialog>
    </div>
  )
}
