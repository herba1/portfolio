'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { EASE_HOVER, SPRING_PRESS } from '@/lib/motion'
import { geist } from '@/app/fonts'

// Blog components for MDX rendering
import { BlogImage } from '@/app/(blog)/components/BlogImage'
import { YouTube } from '@/app/(blog)/components/YouTube'
import { Video } from '@/app/(blog)/components/Video'
import { Audio } from '@/app/(blog)/components/Audio'
import { Callout } from '@/app/(blog)/components/Callout'
import { Quote } from '@/app/(blog)/components/Quote'
import { LinkButton } from '@/app/(blog)/components/LinkButton'
import { Label } from '@/app/(blog)/components/Label'
import { Lead } from '@/app/(blog)/components/Lead'
import { Divider } from '@/app/(blog)/components/Divider'
import { Badge } from '@/app/(blog)/components/Badge'
import { Aside } from '@/app/(blog)/components/Aside'
import BlogHeader from '@/app/(blog)/components/BlogHeader'
import { BlogImageDepth } from '@/app/(blog)/components/BlogImageDepth'
import { BlogImagePixel } from '@/app/(blog)/components/BlogImagePixel'
import Link from 'next/link'


const mdxComponents = {
  a: ({ href, children, ...props }) => {
    if (href && (href.startsWith('/') || href.startsWith('#'))) {
      return (
        <Link href={href} {...props}>
          {children}
        </Link>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    )
  },
  img: ({ src, alt, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt || ''} className="rounded-lg" {...props} />
  ),
  YouTube,
  Video,
  Audio,
  BlogImage,
  Callout,
  Quote,
  LinkButton,
  Label,
  Lead,
  Divider,
  Badge,
  Aside,
  BlogHeader,
  BlogImageDepth,
  BlogImagePixel,
}

export default function PreviewPane({ content }) {
  const [MDXContent, setMDXContent] = useState(null)
  const [error, setError] = useState(null)
  const compileRef = useRef(0)

  useEffect(() => {
    if (!content) {
      setMDXContent(null)
      setError(null)
      return
    }

    const id = ++compileRef.current

    async function compile() {
      try {
        const { evaluate } = await import('@mdx-js/mdx')
        const { default: remarkGfm } = await import('remark-gfm')
        const runtime = await import('react/jsx-runtime')

        // Strip import statements and export const metadata — they break client evaluate()
        const cleaned = content
          .replace(/^import\s+.*$/gm, '')
          .replace(/^export\s+const\s+metadata\s*=\s*\{[^}]*\}/gm, '')

        const { default: Component } = await evaluate(cleaned, {
          ...runtime,
          remarkPlugins: [remarkGfm],
          development: false,
        })

        if (id === compileRef.current) {
          setMDXContent(() => Component)
          setError(null)
        }
      } catch (err) {
        if (id === compileRef.current) {
          setError(err)
        }
      }
    }

    compile()
  }, [content])

  return (
    // Mirror the real blog layout exactly: bg-surface, min-h-dvh, geist font
    <div className={`h-full overflow-auto bg-surface ${geist.className}`}>
      {/* Matches (blog)/layout.jsx: max-w-3xl px-4 pt-24 pb-16 md:px-6 */}
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE_HOVER }}
              className="squircle border border-negative/25 bg-negative-tint p-5"
            >
              <p className="mb-1.5 font-mono text-ui-sm text-negative">
                Preview Error
              </p>
              <pre className="overflow-auto font-mono text-ui-sm leading-relaxed whitespace-pre-wrap text-negative-ink">
                {error.message}
              </pre>
            </motion.div>
          ) : MDXContent ? (
            <motion.div
              key="content"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE_HOVER }}
            >
              <MDXContent components={mdxComponents} />
            </motion.div>
          ) : (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-ui text-ink-tertiary italic"
            >
              Start writing to see a preview...
            </motion.p>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
