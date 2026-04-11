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
import Image from 'next/image'

export function useMDXComponents(components) {
  return {
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
      <Image
        src={src}
        alt={alt || ''}
        width={800}
        height={450}
        className="rounded-lg"
        {...props}
      />
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
    ...components,
  }
}
