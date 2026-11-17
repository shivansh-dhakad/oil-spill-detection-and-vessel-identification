import { useEffect, useRef, useState, type ReactNode } from 'react'

// Fades a section in once, the first time it scrolls into view.
export default function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(
    () =>
      typeof window === 'undefined' ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <div ref={ref} className={`reveal ${shown ? 'reveal-in' : ''}`}>
      {children}
    </div>
  )
}
