import { useEffect, useState, type ReactNode } from 'react'

export function nav(path: string) {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function usePath() {
  const [p, setP] = useState(location.pathname)
  useEffect(() => {
    const f = () => setP(location.pathname)
    window.addEventListener('popstate', f)
    return () => window.removeEventListener('popstate', f)
  }, [])
  return p
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        nav(to)
      }}
    >
      {children}
    </a>
  )
}
