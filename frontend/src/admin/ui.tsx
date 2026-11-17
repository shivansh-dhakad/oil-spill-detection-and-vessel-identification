import { useState, type ReactNode } from 'react'
import { errMsg } from './api'

export function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`ad-field ${className}`}>
      <span className="ad-label">{label}</span>
      {children}
      {hint && <small className="ad-hint">{hint}</small>}
    </label>
  )
}

export type NoticeState = { kind: 'ok' | 'err'; text: string } | null

export function Notice({ n }: { n: NoticeState }) {
  if (!n) return null
  return (
    <p className={`ad-notice ${n.kind}`} role={n.kind === 'err' ? 'alert' : 'status'}>
      {n.text}
    </p>
  )
}

// Runs an async action with busy + success/error feedback.
export function useTask() {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<NoticeState>(null)
  const task = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setNotice(null)
    try {
      const m = await fn()
      if (m) setNotice({ kind: 'ok', text: m })
    } catch (e) {
      setNotice({ kind: 'err', text: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }
  return { busy, notice, setNotice, task }
}

export const nn = (s: string | null | undefined) => (s == null || s.trim() === '' ? null : s.trim())

export const validUrl = (s: string) => {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}
