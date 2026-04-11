import { spencer, geist } from '@/app/fonts'
import TransitionLink from '@/app/ui/TransitionLink'
import { ArrowLeft } from 'lucide-react'

function seeded(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function shuffledOrder(count) {
  const indices = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(seeded(i + 999) * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  const order = new Array(count)
  for (let i = 0; i < count; i++) {
    order[indices[i]] = i
  }
  return order
}

function GlitchText({ text, baseDelay = 0.15 }) {
  const chars = [...text]
  const nonSpaceCount = chars.filter((c) => c !== ' ').length
  const order = shuffledOrder(nonSpaceCount)
  let ci = 0

  return (
    <>
      {chars.map((ch, i) => {
        if (ch === ' ') {
          return <span key={i} className="blog-ch-space" />
        }
        const idx = ci++
        const r = seeded(idx) * 16 - 8
        const ox = seeded(idx + 30) * 100
        const oy = seeded(idx + 60) > 0.5 ? 100 : 0
        const delay = baseDelay + order[idx] * 0.04
        return (
          <span
            key={i}
            className="blog-ch"
            style={{
              '--ch-d': `${delay.toFixed(3)}s`,
              '--ch-r': r.toFixed(1),
              '--ch-ox': ox.toFixed(0),
              '--ch-oy': oy,
            }}
          >
            {ch}
          </span>
        )
      })}
    </>
  )
}

export default function NotFound() {
  return (
    <div className={`flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-6 ${geist.className}`}>
      <div className="flex flex-col items-center gap-8 text-center">
        {/* Glitchy 404 in Spencer */}
        <h1 className={`text-dark text-[clamp(100px,25vw,200px)] leading-none ${spencer.className}`}>
          <GlitchText text="404" baseDelay={0.1} />
        </h1>

        {/* Subtitle with blog fade-up entrance */}
        <p
          className="blog-header-date text-dark/40 max-w-xs text-[15px] leading-relaxed tracking-body-base"
        >
          This page doesn't exist, or it wandered off somewhere.
        </p>

        {/* Back home — matches LinkButton outline variant */}
        <div className="blog-header-tags">
          <TransitionLink
            href="/"
            className="squircle inline-flex items-center gap-2 border border-dark/15 bg-linear-to-b from-white to-slate-50 px-6 py-2.5 text-sm font-medium tracking-body-base text-dark/70 shadow-sm inset-shadow-sm inset-shadow-white/80 transition-all duration-300 ease-out-quart hover:scale-105 hover:text-dark active:scale-95"
          >
            <ArrowLeft size={14} />
            Back home
          </TransitionLink>
        </div>
      </div>
    </div>
  )
}
