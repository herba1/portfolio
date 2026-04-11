import Image from 'next/image'

export function BlogImage({
  src,
  alt,
  width = 800,
  height = 450,
  caption,
  priority = false,
}) {
  return (
    <figure className="blog-figure my-8">
      <Image
        src={src}
        alt={alt || caption || ''}
        width={width}
        height={height}
        priority={priority}
        className="w-full rounded-lg"
      />
      {caption && (
        <figcaption className="mt-2 text-center text-sm text-dark/50">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
