import { useEffect, useRef } from 'react'

export default function AmberParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = (canvas.width = canvas.offsetWidth)
    let height = (canvas.height = canvas.offsetHeight)

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = canvas.offsetWidth
      height = canvas.height = canvas.offsetHeight
    }

    window.addEventListener('resize', handleResize)

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Generate ambient amber particles
    const particleCount = prefersReducedMotion ? 12 : 36
    const particles = Array.from({ length: particleCount }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 1,
      speedY: -(Math.random() * 0.35 + 0.1),
      speedX: (Math.random() - 0.5) * 0.2,
      opacity: Math.random() * 0.45 + 0.15,
      pulseSpeed: Math.random() * 0.02 + 0.01,
      pulsePhase: Math.random() * Math.PI * 2,
    }))

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      particles.forEach((p) => {
        if (!prefersReducedMotion) {
          p.y += p.speedY
          p.x += p.speedX
          p.pulsePhase += p.pulseSpeed

          // Wrap edges
          if (p.y < -10) p.y = height + 10
          if (p.x < -10) p.x = width + 10
          if (p.x > width + 10) p.x = -10
        }

        const currentOpacity = p.opacity + Math.sin(p.pulsePhase) * 0.12
        ctx.fillStyle = `rgba(242, 169, 59, ${Math.max(0.08, currentOpacity)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      })

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(render)
      }
    }

    render()

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="hero-particles-canvas"
      aria-hidden="true"
    />
  )
}
