'use client'

import { useRef, useState, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Upload, Loader2 } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'

function snippetForMedia(mediaType, filePath, fileName) {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/-[a-z0-9]+$/, '')
  switch (mediaType) {
    case 'image': return `<BlogImage src="${filePath}" alt="${name}" caption="" />`
    case 'video': return `<Video src="${filePath}" caption="" />`
    case 'audio': return `<Audio src="${filePath}" title="${name}" caption="" />`
    default: return ''
  }
}

function createTheme(light) {
  const shared = {
    '&': { fontSize: '13.5px', height: '100%', letterSpacing: '-0.01em' },
    '.cm-content': {
      fontFamily: 'var(--font-geist-mono, "Geist Mono", ui-monospace, monospace)',
      padding: '20px 0',
      caretColor: '#3b82f6',
      lineHeight: '1.7',
    },
    '.cm-cursor': { borderLeftColor: '#3b82f6', borderLeftWidth: '1.5px' },
    '.cm-line': { padding: '0 20px' },
    '.cm-scroller': { overflow: 'auto !important' },
    '.cm-link': { color: '#3b82f6', textDecoration: 'none' },
    '.cm-url': { color: 'rgba(59,130,246,0.5)' },
  }

  if (light) {
    return EditorView.theme({
      ...shared,
      '&': { ...shared['&'], background: '#f8fafc' },
      '.cm-content': { ...shared['.cm-content'], color: '#1a1a1a' },
      '.cm-gutters': { background: '#f8fafc', color: 'rgba(0,0,0,0.2)', border: 'none', paddingLeft: '12px', fontSize: '11px' },
      '.cm-activeLineGutter': { background: 'transparent', color: 'rgba(0,0,0,0.4)' },
      '.cm-activeLine': { background: 'rgba(0,0,0,0.03)' },
      '.cm-selectionBackground': { background: 'rgba(59,130,246,0.15) !important' },
      '&.cm-focused .cm-selectionBackground': { background: 'rgba(59,130,246,0.2) !important' },
      '.cm-scroller': { ...shared['.cm-scroller'], scrollbarWidth: 'thin', scrollbarColor: 'rgba(0,0,0,0.1) transparent' },
      '.cm-foldGutter': { color: 'rgba(0,0,0,0.15)' },
      '.cm-header-1': { color: '#1a1a1a', fontWeight: '600' },
      '.cm-header-2': { color: '#2a2a2a', fontWeight: '600' },
      '.cm-header-3': { color: '#3a3a3a', fontWeight: '500' },
      '.cm-tag': { color: '#0369a1' },
      '.cm-attribute': { color: '#7c3aed' },
      '.cm-em': { color: '#64748b', fontStyle: 'italic' },
      '.cm-strong': { color: '#1a1a1a', fontWeight: '600' },
      '.cm-monospace': { color: '#16a34a' },
      '.cm-matchingBracket': { background: 'rgba(59,130,246,0.1)', outline: '1px solid rgba(59,130,246,0.25)' },
      '.cm-vim-panel': { background: '#f1f5f9', color: '#1a1a1a', padding: '2px 8px', fontSize: '12px' },
    }, { dark: false })
  }

  return EditorView.theme({
    ...shared,
    '&': { ...shared['&'], background: '#0d0d0d' },
    '.cm-gutters': { background: '#0d0d0d', color: 'rgba(255,255,255,0.12)', border: 'none', paddingLeft: '12px', fontSize: '11px' },
    '.cm-activeLineGutter': { background: 'transparent', color: 'rgba(255,255,255,0.3)' },
    '.cm-activeLine': { background: 'rgba(255,255,255,0.02)' },
    '.cm-selectionBackground': { background: 'rgba(59,130,246,0.2) !important' },
    '&.cm-focused .cm-selectionBackground': { background: 'rgba(59,130,246,0.25) !important' },
    '.cm-scroller': { ...shared['.cm-scroller'], scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' },
    '.cm-foldGutter': { color: 'rgba(255,255,255,0.1)' },
    '.cm-header-1': { color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
    '.cm-header-2': { color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
    '.cm-header-3': { color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
    '.cm-tag': { color: '#7dd3fc' },
    '.cm-attribute': { color: '#a78bfa' },
    '.cm-em': { color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' },
    '.cm-strong': { color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
    '.cm-monospace': { color: '#a3e635' },
    '.cm-matchingBracket': { background: 'rgba(59,130,246,0.15)', outline: '1px solid rgba(59,130,246,0.3)' },
    '.cm-vim-panel': { background: '#1a1a1a', color: 'rgba(255,255,255,0.7)', padding: '2px 8px', fontSize: '12px' },
  }, { dark: true })
}

const mdExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
]

const EditorPane = forwardRef(function EditorPane({ value, onChange, light, vimMode }, ref) {
  const viewRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCountRef = useRef(0)

  const theme = useMemo(() => createTheme(light), [light])

  const extensions = useMemo(() => {
    return vimMode ? [vim(), ...mdExtensions] : mdExtensions
  }, [vimMode])

  const insertAtCursor = useCallback((text) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    view.focus()
  }, [])

  useImperativeHandle(ref, () => ({
    insertSnippet(text) { insertAtCursor(text) },
    getView() { return viewRef.current },
  }))

  const handleCreateEditor = useCallback((view) => { viewRef.current = view }, [])

  const uploadFile = useCallback(async (file) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/studio/upload', { method: 'POST', body: formData })
      if (!res.ok) { console.error('Upload failed:', res.statusText); return }
      const data = await res.json()
      if (data.error) { console.error('Upload failed:', data.error); return }
      const snippet = snippetForMedia(data.mediaType, data.path, data.fileName)
      if (snippet) insertAtCursor('\n' + snippet + '\n')
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }, [insertAtCursor])

  const onDragEnter = useCallback((e) => { e.preventDefault(); dragCountRef.current++; setDragging(true) }, [])
  const onDragLeave = useCallback((e) => { e.preventDefault(); dragCountRef.current--; if (dragCountRef.current === 0) setDragging(false) }, [])
  const onDragOver = useCallback((e) => { e.preventDefault() }, [])
  const onDrop = useCallback((e) => {
    e.preventDefault(); dragCountRef.current = 0; setDragging(false)
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) uploadFile(file)
    }
  }, [uploadFile])

  // Paste media from clipboard
  const onPaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('audio/'))) {
        e.preventDefault()
        uploadFile(item.getAsFile())
        return
      }
    }
  }, [uploadFile])

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: 'var(--studio-bg)' }}
      data-lenis-prevent
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <div className="min-h-0 flex-1">
        <CodeMirror
          value={value}
          onChange={onChange}
          theme={theme}
          extensions={extensions}
          height="100%"
          style={{ height: '100%' }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            highlightSelectionMatches: true,
            searchKeymap: true,
          }}
          onCreateEditor={handleCreateEditor}
        />
      </div>

      {/* Drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(59,130,246,0.08)', backdropFilter: 'blur(2px)' }}
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
              <p className="text-[13px] font-medium tracking-body-base" style={{ color: 'var(--studio-text-2)' }}>Drop to upload</p>
              <p className="text-[11px]" style={{ color: 'var(--studio-text-3)' }}>Images, videos, or audio</p>
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
            className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-4 py-2 shadow-lg"
            style={{ background: 'var(--studio-surface)', borderColor: 'var(--studio-border)', color: 'var(--studio-text-2)' }}
          >
            <Loader2 size={13} className="animate-spin text-accent" />
            <span className="text-[11px] font-medium tracking-body-base">Uploading...</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default EditorPane
