import { posts } from '@/app/(blog)/posts'
import GlitchText from '@/app/ui/GlitchText'
import ImageFan from '@/app/ui/ImageFan'
import BlogPostLink from './BlogPostLink'
import { absoluteUrl, pageMetadata } from '@/lib/seo'
import { ID, JsonLd, breadcrumbNode, graph, webPageNode } from '@/lib/jsonld'

const title = 'Writing'
const description =
  "Posts by Herbart Hernandez — notes from a design engineer in New York on building interfaces, creative coding, music and life."

export const metadata = pageMetadata({ title, description, path: '/blog' })

export default function BlogIndex() {
  const publishedPosts = posts
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // The index as a CollectionPage whose main entity is the Blog itself, with
  // every published post listed under it. Each post's own page carries the
  // full BlogPosting node (see (blog)/components/BlogHeader.jsx).
  const blogLd = graph(
    webPageNode({
      path: '/blog',
      name: title,
      description,
      type: 'CollectionPage',
      extra: { mainEntity: { '@id': ID.blog } },
    }),
    {
      '@type': 'Blog',
      '@id': ID.blog,
      url: absoluteUrl('/blog'),
      name: `${title} — herb.art`,
      description,
      inLanguage: 'en-US',
      author: { '@id': ID.person },
      publisher: { '@id': ID.person },
      blogPost: publishedPosts.map((post) => ({
        '@type': 'BlogPosting',
        '@id': `${absoluteUrl(`/${post.slug}`)}#article`,
        url: absoluteUrl(`/${post.slug}`),
        headline: post.title,
        description: post.description,
        datePublished: new Date(post.date).toISOString(),
        ...(post.images && post.images[0] ? { image: absoluteUrl(post.images[0]) } : {}),
        author: { '@id': ID.person },
      })),
    },
    breadcrumbNode([
      { name: 'herb.art', path: '/' },
      { name: title, path: '/blog' },
    ]),
  )

  return (
    <div className="bg-surface min-h-dvh">
      <JsonLd data={blogLd} />
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        {/* Two steps off the scale — each brings its own weight, tracking and
            leading, so there's no font-bold / tracking-tighter stack that has
            to be re-guessed at the md breakpoint. */}
        <h1 className="text-ink text-title-sm mb-8">
          <GlitchText text="Writing" />
        </h1>
        {publishedPosts.length === 0 ? (
          <p className="text-ink-secondary">No posts yet. Check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {publishedPosts.map((post, i) => (
              <li
                key={post.slug}
                className="blog-list-item"
                style={{ animationDelay: `${0.2 + i * 0.08}s` }}
              >
                <BlogPostLink slug={post.slug}>
                  <article className="border-line flex items-center justify-between gap-6 border-b pb-6 transition-transform duration-300 ease-out-quart group-hover:translate-x-1">
                    <div className="min-w-0 flex-1">
                      <time className="text-ink-secondary text-ui-lg">
                        {new Date(post.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </time>
                      <h2 className="text-ink text-heading mt-1 transition-colors group-hover:text-accent">
                        {post.title}
                      </h2>
                      <p className="text-ink-secondary text-body mt-2">
                        {post.description}
                      </p>
                      {post.tags && (
                        <div className="mt-3 flex gap-2">
                          {post.tags.map((tag) => (
                            <span key={tag} className="badge">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ImageFan images={post.images} />
                  </article>
                </BlogPostLink>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
