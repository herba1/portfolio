# Blog

MDX-powered blog with custom components, built on Next.js 16 + `@next/mdx`.

## Adding a Post

**1. Create the file:**

```
src/app/(blog)/your-slug/page.mdx      ← standard post
src/app/(blog)/your-slug/page.jsx      ← fully custom layout
```

The `(blog)` route group is invisible in the URL — your post renders at `herb.art/your-slug`.

**2. Register it in `src/app/(blog)/posts.js`:**

```js
{
  slug: 'your-slug',
  title: 'Your Title',
  description: 'A short summary for the listing page.',
  date: '2026-04-15',
  tags: ['topic'],
  published: true,     // set false to hide from listing
}
```

**3. Post template:**

```mdx
import BlogHeader from '../components/BlogHeader'

export const metadata = {
  title: 'Your Title | herb.art',
  description: 'A short summary.',
}

<BlogHeader
  title="Your Title"
  date="2026-04-15"
  tags={['topic']}
/>

<article className="prose prose-slate max-w-none prose-headings:tracking-heading-mobile prose-a:text-blue-500 prose-pre:p-0 prose-code:before:content-[''] prose-code:after:content-['']">

Your content here...

</article>
```

## Components

All components are available in any MDX file without importing.

### Media

```mdx
<BlogImage src="/blog/images/photo.png" alt="Alt text" caption="Optional caption" />
<YouTube id="dQw4w9WgXcQ" title="Video title" />
<Video src="/blog/videos/clip.mp4" caption="A short clip" />
<Audio src="/blog/audio/beat.mp3" title="Beat Sketch" caption="Early draft" />
```

Put media files in `/public/blog/images/`, `/public/blog/videos/`, `/public/blog/audio/`.

### Typography

```mdx
<Lead>Intro paragraph with larger, lighter text.</Lead>
<Label>Mono Uppercase Label</Label>
<Quote author="Name" source="Book Title">Quoted text in serif.</Quote>
<Aside>A subtle side note in italics.</Aside>
```

### UI

```mdx
<Callout type="info" title="Title">Content inside the callout.</Callout>
<!-- types: note, info, warning, error, success -->

<LinkButton href="/somewhere" variant="primary">Click Me</LinkButton>
<!-- variants: primary, dark, outline -->

<Badge color="blue">Label</Badge>
<!-- colors: default, blue, green, amber, red -->

<Divider />
<Divider label="Section Name" />
```

### Custom Layouts

For posts that break the mold, use `page.jsx`:

```jsx
export const metadata = { title: 'Special | herb.art' }

export default function SpecialPost() {
  return (
    <div>
      {/* full creative control — GSAP, Three.js, whatever */}
    </div>
  )
}
```

Add an entry in `posts.js` so it appears on the listing page.

### Breaking Out of Prose

Wrap content in `not-prose` to use raw Tailwind inside a prose article:

```mdx
<div className="not-prose my-8 grid grid-cols-3 gap-4">
  <div className="rounded-xl border p-4">Custom card</div>
</div>
```

## File Structure

```
src/app/
  (blog)/                        ← route group (no URL impact)
    layout.jsx                   ← shared navbar + container
    posts.js                     ← post metadata registry
    components/                  ← all MDX components
    my-first-post/page.mdx       ← herb.art/my-first-post
    test/page.mdx                ← herb.art/test
  blog/
    page.jsx                     ← herb.art/blog (listing)
mdx-components.jsx               ← registers components for MDX
```
