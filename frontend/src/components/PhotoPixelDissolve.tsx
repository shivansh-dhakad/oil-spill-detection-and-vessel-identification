import { useMemo } from 'react'

interface PhotoPixelDissolveProps {
  src: string
  alt: string
}

export default function PhotoPixelDissolve({ src, alt }: PhotoPixelDissolveProps) {
  // Deterministic subtle amber particles floating around the organic silhouette
  const floatingPixels = useMemo(() => {
    return Array.from({ length: 18 }).map((_, i) => ({
      id: i,
      x: (Math.sin(i * 1.7) * 48 + 50), // percentage 0-100%
      y: (Math.cos(i * 2.1) * 45 + 50),
      size: (i % 3 === 0 ? 5 : i % 2 === 0 ? 3 : 4),
      opacity: 0.2 + ((i % 4) * 0.15),
      delay: (i * 0.3) % 2.5,
    }))
  }, [])

  return (
    <div className="photo-organic-container" aria-label={alt}>
      {/* Ambient background glow directly behind the silhouette */}
      <div className="photo-ambient-glow" aria-hidden="true" />

      {/* Floating subtle amber pixel dust */}
      <div className="photo-dust-layer" aria-hidden="true">
        {floatingPixels.map((p) => (
          <span
            key={p.id}
            className="organic-dust-pixel"
            style={{
              top: `${p.y}%`,
              left: `${p.x}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              opacity: p.opacity,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      {/* The portrait photograph floating without any card or frame */}
      <img
        src={src}
        alt={alt}
        width={480}
        height={600}
        fetchPriority="high"
        decoding="async"
        className="photo-organic-img"
      />
    </div>
  )
}
