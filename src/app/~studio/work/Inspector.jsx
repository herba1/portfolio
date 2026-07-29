'use client'

import { useRef } from 'react'
import { Upload, Trash2, Copy, ExternalLink } from 'lucide-react'
import { ALLOW_FULL_WIDTH, RATIOS, FITS } from '@/app/work/constants'
import { REGISTRY } from '@/app/work/registry'
import {
  Field,
  TextInput,
  TextArea,
  Select,
  Segmented,
  Toggle,
  Divider,
} from './StudioControls'

// The grid is two columns, so a tile is either a half or the full width.
const SPANS = [
  { value: 1, label: 'Half' },
  { value: 2, label: 'Full width' },
]

const COMPONENT_OPTIONS = [
  { value: '', label: 'Pick a component…' },
  ...Object.entries(REGISTRY).map(([value, entry]) => ({
    value,
    label: entry.label,
  })),
]

/* The right-hand rail. With nothing selected it edits the page header;
 * with a tile selected it edits that tile. Fields are keyed off `kind`,
 * so a note never shows an aspect ratio and an image never shows a
 * component picker. */
export default function Inspector({
  item,
  page,
  onChangePage,
  onChange,
  onDelete,
  onDuplicate,
  onUploadTo,
  uploading,
}) {
  const fileRef = useRef(null)

  if (!item) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <p className="text-ui-lg font-medium" style={{ color: 'var(--studio-text)' }}>
          Page
        </p>
        <Field label="Title">
          <TextInput value={page.title} onChange={(v) => onChangePage({ title: v })} />
        </Field>
        <Field label="Intro" hint="Sits under the title on /work.">
          <TextArea value={page.intro} onChange={(v) => onChangePage({ intro: v })} />
        </Field>
        <Divider />
        <p className="text-ui leading-relaxed" style={{ color: 'var(--studio-text-3)' }}>
          Select a tile to edit it, or drop images and videos anywhere on the
          preview to add them.
        </p>
      </div>
    )
  }

  const isMedia = item.kind === 'image' || item.kind === 'video'
  const entry = item.kind === 'component' ? REGISTRY[item.component] : null

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-lg font-medium capitalize" style={{ color: 'var(--studio-text)' }}>
          {item.kind}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onDuplicate}
            title="Duplicate"
            aria-label="Duplicate tile"
            className="studio-palette-btn rounded-md p-1.5"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            aria-label="Delete tile"
            className="studio-palette-btn rounded-md p-1.5 hover:text-red-400"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Every tile is one column while ALLOW_FULL_WIDTH is off, so there is
          nothing to choose. */}
      {ALLOW_FULL_WIDTH ? (
        <Field label="Width">
          <Segmented
            value={item.span}
            onChange={(v) => onChange({ span: Number(v) })}
            options={SPANS}
          />
        </Field>
      ) : null}

      {item.kind === 'component' ? (
        <>
          <Field label="Component" hint={entry?.note}>
            <Select
              value={item.component}
              onChange={(v) =>
                onChange({
                  component: v,
                  padded: REGISTRY[v]?.padded ?? true,
                })
              }
              options={COMPONENT_OPTIONS}
            />
          </Field>
          <Field
            label="Box"
            hint="Auto grows with the component. A ratio fixes the tile's height, so a component that opens and closes can't move the grid."
          >
            <Select
              value={item.ratio}
              onChange={(v) => onChange({ ratio: v })}
              options={RATIOS}
            />
          </Field>
        </>
      ) : null}

      {isMedia ? (
        <>
          <Field label="Source">
            <div className="flex gap-1.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <TextInput
                  value={item.src}
                  onChange={(v) => onChange({ src: v })}
                  placeholder="/work/images/…"
                  mono
                />
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Upload a file"
                aria-label="Upload a file"
                className="studio-palette-btn shrink-0 rounded-lg px-2"
              >
                <Upload size={13} />
              </button>
            </div>
          </Field>
          <input
            ref={fileRef}
            type="file"
            accept={item.kind === 'video' ? 'video/*' : 'image/*'}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onUploadTo(f)
              e.target.value = ''
            }}
          />

          <Field label="Aspect ratio">
            <Select
              value={item.ratio}
              onChange={(v) => onChange({ ratio: v })}
              options={RATIOS.filter((r) => r !== 'auto')}
            />
          </Field>

          <Field label="Fit">
            <Segmented
              value={item.fit}
              onChange={(v) => onChange({ fit: v })}
              options={FITS.map((f) => ({ value: f, label: f }))}
            />
          </Field>

          {item.kind === 'video' ? (
            <>
              <Field label="Poster" hint="Frame shown before the clip plays.">
                <TextInput
                  value={item.poster}
                  onChange={(v) => onChange({ poster: v })}
                  placeholder="/work/images/…"
                  mono
                />
              </Field>
              <Toggle
                label="Autoplay"
                checked={item.autoplay}
                onChange={(v) => onChange({ autoplay: v })}
              />
            </>
          ) : (
            <Field label="Alt text" hint="Describe the image for screen readers.">
              <TextInput value={item.alt} onChange={(v) => onChange({ alt: v })} />
            </Field>
          )}
        </>
      ) : null}

      <Divider />

      {item.kind === 'note' ? (
        <>
          <Field label="Statement">
            <TextArea
              value={item.title}
              onChange={(v) => onChange({ title: v })}
              rows={3}
              placeholder="The line that carries the tile."
            />
          </Field>
          <Field label="Body">
            <TextArea value={item.body} onChange={(v) => onChange({ body: v })} rows={3} />
          </Field>
        </>
      ) : (
        <Field label="Name" hint="Studio label only — never shown on the page.">
          <TextInput value={item.title} onChange={(v) => onChange({ title: v })} />
        </Field>
      )}

      {/* A component owns its own clicks, so an anchor around it would eat
          them. Only media and notes can be links. */}
      {item.kind !== 'component' ? (
        <Field label="Link" hint="Makes the whole tile a link.">
          <div className="flex gap-1.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <TextInput
                value={item.href}
                onChange={(v) => onChange({ href: v })}
                placeholder="/covers or https://…"
                mono
              />
            </div>
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="studio-palette-btn flex shrink-0 items-center rounded-lg px-2"
                title="Open link"
                aria-label="Open link"
              >
                <ExternalLink size={13} />
              </a>
            ) : null}
          </div>
        </Field>
      ) : null}

      <Divider />

      <Toggle label="Frame" checked={item.frame} onChange={(v) => onChange({ frame: v })} />
      <Toggle label="Padding" checked={item.padded} onChange={(v) => onChange({ padded: v })} />
      <Toggle
        label="Hidden on the live page"
        checked={item.hidden}
        onChange={(v) => onChange({ hidden: v })}
      />

      <Field label="Background" hint="Any CSS colour. Empty falls back to the card surface.">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(item.background) ? item.background : '#ffffff'}
            onChange={(e) => onChange({ background: e.target.value })}
            className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border bg-transparent"
            style={{ borderColor: 'var(--studio-border)' }}
            aria-label="Background colour"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <TextInput
              value={item.background}
              onChange={(v) => onChange({ background: v })}
              placeholder="transparent"
              mono
            />
          </div>
        </div>
      </Field>
    </div>
  )
}
