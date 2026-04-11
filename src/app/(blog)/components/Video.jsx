export function Video({
  src,
  poster,
  caption,
  autoPlay = false,
  loop = true,
  muted = true,
}) {
  return (
    <figure className="my-8">
      <video
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        controls
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
