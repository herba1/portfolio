'use client'

import { motion } from 'motion/react'

/* Small form primitives shared by the work studio's inspector. They exist
 * only so the inspector reads as a list of fields instead of 300 lines of
 * repeated inline style. Everything themes off the same --studio-* vars the
 * blog studio uses, so the light/dark toggle drives both. */

const spring = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

export function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-ui-sm" style={{ color: 'var(--studio-text-2)' }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-ui-xs" style={{ color: 'var(--studio-text-3)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}

const inputStyle = {
  background: 'var(--studio-bg)',
  borderColor: 'var(--studio-border)',
  color: 'var(--studio-text)',
}

export function TextInput({ value, onChange, placeholder, mono, ...rest }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-lg border px-2.5 py-1.5 text-ui outline-none transition-colors duration-200 focus:border-accent ${mono ? 'font-mono' : ''}`}
      style={inputStyle}
      {...rest}
    />
  )
}

export function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="resize-y rounded-lg border px-2.5 py-1.5 text-ui leading-relaxed outline-none transition-colors duration-200 focus:border-accent"
      style={inputStyle}
    />
  )
}

export function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border px-2.5 py-1.5 text-ui outline-none transition-colors duration-200 focus:border-accent"
      style={inputStyle}
    >
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        return (
          <option key={val} value={val}>
            {label}
          </option>
        )
      })}
    </select>
  )
}

export function Segmented({ value, onChange, options }) {
  return (
    <div
      className="flex h-8 overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--studio-border)' }}
    >
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        const active = value === val
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className="flex-1 px-2 text-ui-sm font-medium transition-colors duration-200"
            style={{
              background: active ? 'var(--studio-active)' : 'transparent',
              color: active ? 'var(--studio-text)' : 'var(--studio-text-3)',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 rounded-lg px-0.5 py-1 text-ui transition-colors duration-200"
      style={{ color: 'var(--studio-text-2)' }}
    >
      <span>{label}</span>
      <span
        className="relative h-4.5 w-8 shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? 'var(--color-accent)' : 'var(--studio-active)' }}
      >
        <motion.span
          className="absolute top-0.5 left-0.5 block h-3.5 w-3.5 rounded-full bg-white shadow-sm"
          animate={{ x: checked ? 14 : 0 }}
          transition={spring}
        />
      </span>
    </button>
  )
}

export function Divider() {
  return <div className="h-px w-full" style={{ background: 'var(--studio-border)' }} />
}
