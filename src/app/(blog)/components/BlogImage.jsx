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
      <div className="blog-image-wrap relative">
        {/* Animated blur blobs behind the image */}
        <div
          className="blog-image-glow"
          style={{ backgroundImage: `url(${src})` }}
          aria-hidden="true"
        />
        <Image
          src={src}
          alt={alt || caption || ''}
          width={width}
          height={height}
          priority={priority}
          className="relative z-[1] w-full rounded-2xl"
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-dark/50">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
