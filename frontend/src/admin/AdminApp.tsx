import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { count } from './api'
import { Link, usePath } from './router'
import { Field } from './ui'
import Dashboard from './Dashboard'
import ProfileAdmin from './ProfileAdmin'
import ProjectsList from './ProjectsList'
import ProjectForm from './ProjectForm'
import SkillsAdmin from './SkillsAdmin'
import ContentAdmin from './ContentAdmin'
import BeyondCodeAdmin from './BeyondCodeAdmin'
import MessagesAdmin from './MessagesAdmin'
import './admin.css'

type Gate = 'loading' | 'out' | 'denied' | 'in' | 'noconfig'

const NAV = [
  { to: '/admin', label: 'Overview', key: '' },
  { to: '/admin/profile', label: 'Profile', key: 'profile' },
  { to: '/admin/projects', label: 'Projects', key: 'projects' },
  { to: '/admin/skills', label: 'Skills', key: 'skills' },
  { to: '/admin/content', label: 'Education & credentials', key: 'content' },
  { to: '/admin/beyond-code', label: 'Beyond the code', key: 'beyond-code' },
  { to: '/admin/messages', label: 'Messages', key: 'messages' },
]

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr('Sign-in failed. Check your email and password.')
    setBusy(false)
  }
  return (
    <main className="ad-login">
      <form className="ad-card" onSubmit={submit}>
        <h1 className="ad-h1">Admin sign in</h1>
        <Field label="Email"><input className="ad-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="ad-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <p className="ad-notice err" role="alert">{err}</p>}
        <button className="ad-btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a className="ad-muted" href="/">← Back to portfolio</a>
      </form>
    </main>
  )
}

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>('loading')
  const [unread, setUnread] = useState(0)
  const path = usePath()

  useEffect(() => {
    document.title = 'Admin | Portfolio'
    const m = document.createElement('meta')
    m.name = 'robots'; m.content = 'noindex,nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])

  useEffect(() => {
    if (!supabase) { setGate('noconfig'); return }
    const db = supabase
    // Server-side check: is_admin() reads the admins table (not readable by clients) inside the database.
    const check = async (hasSession: boolean) => {
      if (!hasSession) { setGate('out'); return }
      const { data, error } = await db.rpc('is_admin')
      setGate(!error && data === true ? 'in' : 'denied')
    }
    const { data } = db.auth.onAuthStateChange((_e, session) => { setTimeout(() => void check(Boolean(session)), 0) })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (gate === 'in') count('messages', (q) => q.eq('is_read', false)).then(setUnread).catch(() => undefined)
  }, [gate, path])

  if (gate === 'loading') return <main className="ad-login"><p className="ad-muted">Loading…</p></main>
  if (gate === 'noconfig') return <main className="ad-login"><p className="ad-notice err">Supabase is not configured (.env).</p></main>
  if (gate === 'out') return <Login />
  if (gate === 'denied')
    return (
      <main className="ad-login">
        <div className="ad-card">
          <h1 className="ad-h1">Not authorised</h1>
          <p>This account is not the portfolio administrator.</p>
          <button className="ad-btn" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
        </div>
      </main>
    )

  const seg = path.replace(/^\/admin\/?/, '').split('/').filter(Boolean)
  const section = seg[0] ?? ''
  let page
  if (section === 'profile') page = <ProfileAdmin />
  else if (section === 'projects') page = seg[1] === 'new' ? <ProjectForm key="new" /> : seg[1] ? <ProjectForm key={seg[1]} id={seg[1]} /> : <ProjectsList />
  else if (section === 'skills') page = <SkillsAdmin />
  else if (section === 'content') page = <ContentAdmin />
  else if (section === 'beyond-code') page = <BeyondCodeAdmin />
  else if (section === 'messages') page = <MessagesAdmin />
  else page = <Dashboard />

  return (
    <div className="ad-shell">
      <aside className="ad-side">
        <strong className="ad-brand">sd // admin</strong>
        <nav aria-label="Admin sections">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={`ad-nav ${section === n.key ? 'on' : ''}`}>
              {n.label}
              {n.key === 'messages' && unread > 0 && <span className="ad-badge feat">{unread}</span>}
            </Link>
          ))}
        </nav>
        <a className="ad-nav ad-view-site" href="/" target="_blank" rel="noopener noreferrer">View site ↗</a>
        <button className="ad-nav ad-signout" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
      </aside>
      <main className="ad-main" id="admin-main">{page}</main>
    </div>
  )
}
