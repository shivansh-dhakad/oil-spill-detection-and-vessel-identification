import { useEffect, useState } from 'react'
import { count, errMsg } from './api'
import { Link } from './router'

interface Counts { total: number; featured: number; published: number; draft: number; archived: number; unread: number }

export default function Dashboard() {
  const [c, setC] = useState<Counts | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [total, featured, published, draft, archived, unread] = await Promise.all([
          count('projects'),
          count('projects', (q) => q.eq('featured', true)),
          count('projects', (q) => q.eq('state', 'published')),
          count('projects', (q) => q.eq('state', 'draft')),
          count('projects', (q) => q.eq('state', 'archived')),
          count('messages', (q) => q.eq('is_read', false)),
        ])
        setC({ total, featured, published, draft, archived, unread })
      } catch (e) {
        setErr(errMsg(e))
      }
    })()
  }, [])

  const cards: { label: string; key: keyof Counts; to: string }[] = [
    { label: 'Total projects', key: 'total', to: '/admin/projects' },
    { label: 'Featured', key: 'featured', to: '/admin/projects' },
    { label: 'Published', key: 'published', to: '/admin/projects' },
    { label: 'Drafts', key: 'draft', to: '/admin/projects' },
    { label: 'Archived', key: 'archived', to: '/admin/projects' },
    { label: 'Unread messages', key: 'unread', to: '/admin/messages' },
  ]

  return (
    <>
      <h1 className="ad-h1">Overview</h1>
      {err && <p className="ad-notice err" role="alert">{err}</p>}
      <div className="ad-stats">
        {cards.map((s) => (
          <Link key={s.label} to={s.to} className="ad-stat">
            <strong>{c ? c[s.key] : '…'}</strong>
            <span>{s.label}</span>
          </Link>
        ))}
      </div>
      <p className="ad-muted">Counts are read live from the database. Only <b>published</b> projects are visible to visitors.</p>
      <div className="ad-actions">
        <Link to="/admin/projects/new" className="ad-btn primary">+ New project</Link>
        <Link to="/admin/profile" className="ad-btn">Edit profile</Link>
        <a href="/" className="ad-btn" target="_blank" rel="noopener noreferrer">View public site</a>
      </div>
    </>
  )
}
