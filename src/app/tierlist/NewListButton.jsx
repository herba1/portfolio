'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'

export default function NewListButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const name = window.prompt('Name this tier list (e.g. Movies, Snacks):')
    if (!name) return
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (!slug) return
    setBusy(true)
    try {
      const res = await fetch('/api/tierlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title: name, create: true }),
      })
      if (res.ok || res.status === 409) {
        router.push(`/tierlist/${slug}/edit`)
      } else {
        const j = await res.json().catch(() => ({}))
        alert(j.error || 'Could not create list')
        setBusy(false)
      }
    } catch {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={create}
      disabled={busy}
      className="LinkMask text-dark/70 hover:text-dark inline-flex shrink-0 items-center gap-1 text-sm font-medium transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      New list
    </button>
  )
}
