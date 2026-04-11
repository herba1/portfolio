'use client'

import { useState, useRef, useEffect } from 'react'
import { motion } from 'motion/react'
import {
  MessageSquareQuote,
  AlertTriangle,
  Image,
  Youtube,
  Video,
  Music,
  Tag,
  Type,
  Minus,
  ExternalLink,
  Bookmark,
  AlignLeft,
  ChevronDown,
} from 'lucide-react'

const spring = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

const IMAGE_VARIANTS = [
  { name: 'Standard', snippet: '<BlogImage src="/blog/images/" alt="" caption="" />' },
  { name: '3D Parallax', snippet: '<BlogImageDepth src="/blog/images/" alt="" caption="" />' },
  { name: 'Pixel Trail', snippet: '<BlogImagePixel src="/blog/images/" alt="" caption="" />' },
]

const components = [
  { name: 'Lead', icon: Type, snippet: '<Lead>\n  Intro text here.\n</Lead>' },
  { name: 'Callout', icon: AlertTriangle, snippet: '<Callout type="note" title="Title">\n  Content here.\n</Callout>' },
  { name: 'Quote', icon: MessageSquareQuote, snippet: '<Quote author="Author">\n  Quote text here.\n</Quote>' },
  { name: 'Aside', icon: AlignLeft, snippet: '<Aside>\n  Side note here.\n</Aside>' },
  { name: 'Divider', icon: Minus, snippet: '<Divider label="Section" />' },
  { name: 'YouTube', icon: Youtube, snippet: '<YouTube id="" title="" />' },
  { name: 'Video', icon: Video, snippet: '<Video src="/blog/videos/" caption="" />' },
  { name: 'Audio', icon: Music, snippet: '<Audio src="/blog/audio/" title="" caption="" />' },
  { name: 'Badge', icon: Tag, snippet: '<Badge color="blue">Label</Badge>' },
  { name: 'Button', icon: ExternalLink, snippet: '<LinkButton href="">Click me</LinkButton>' },
  { name: 'Label', icon: Bookmark, snippet: '<Label>LABEL</Label>' },
]

function ImageDropdown({ onInsert }) {
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

  return (
    <div ref={ref} className="relative">
      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={spring}
        className="studio-palette-btn flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium tracking-body-base"
        style={{ color: open ? 'var(--studio-text)' : undefined }}
      >
        <Image size={11} />
        Image
        <ChevronDown size={9} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </motion.button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[140px] rounded-lg border p-0.5 shadow-lg"
          style={{ background: 'var(--studio-surface)', borderColor: 'var(--studio-border)' }}
        >
          {IMAGE_VARIANTS.map((variant) => (
            <button
              key={variant.name}
              onClick={() => { onInsert(variant.snippet); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium tracking-body-base transition-colors duration-150 hover:bg-[var(--studio-hover)]"
              style={{ color: 'var(--studio-text-2)' }}
            >
              <Image size={11} />
              {variant.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PaletteButton({ comp, onInsert }) {
  const Icon = comp.icon
  return (
    <motion.button
      onClick={() => onInsert(comp.snippet)}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={spring}
      className="studio-palette-btn flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium tracking-body-base"
      title={`Insert ${comp.name}`}
      aria-label={`Insert ${comp.name}`}
    >
      <Icon size={11} />
      {comp.name}
    </motion.button>
  )
}

export default function ComponentPalette({ onInsert }) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto px-4 py-2"
      style={{ borderTop: '1px solid var(--studio-border)', background: 'var(--studio-bg)' }}
    >
      <span className="mr-2 shrink-0 font-mono text-[9px] tracking-widest uppercase" style={{ color: 'var(--studio-text-4)' }}>
        Insert
      </span>

      {components.slice(0, 5).map((comp) => (
        <PaletteButton key={comp.name} comp={comp} onInsert={onInsert} />
      ))}

      <ImageDropdown onInsert={onInsert} />

      {components.slice(5).map((comp) => (
        <PaletteButton key={comp.name} comp={comp} onInsert={onInsert} />
      ))}
    </div>
  )
}
