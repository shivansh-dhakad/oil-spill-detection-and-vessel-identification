import { useEffect, useState } from 'react'
import { client, run } from './api'
import { Notice, useTask } from './ui'
import type { Row } from './CrudTable'

export default function MessagesAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { busy, notice, task } = useTask()

  const load = async () => setRows(await run<Row[]>(client().from('messages').select('*').order('created_at', { ascending: false })))
  useEffect(() => { void task(load) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const setRead = (m: Row, is_read: boolean) =>
    task(async () => {
      await run(client().from('messages').update({ is_read }).eq('id', m.id))
      setRows((r) => r?.map((x) => (x.id === m.id ? { ...x, is_read } : x)) ?? r)
    })

  const open = (m: Row) => {
    setOpenId(openId === m.id ? null : m.id)
    if (!m.is_read && openId !== m.id) void setRead(m, true)
  }

  const remove = (m: Row) => {
    if (!window.confirm(`Delete the message from ${m.name}?`)) return
    void task(async () => {
      await run(client().from('messages').delete().eq('id', m.id))
      setRows((r) => r?.filter((x) => x.id !== m.id) ?? r)
      setOpenId(null)
    })
  }

  const unread = rows?.filter((m) => !m.is_read).length ?? 0

  return (
    <>
      <h1 className="ad-h1">Messages {rows && <span className="ad-badge feat">{unread} unread</span>}</h1>
      <Notice n={notice} />
      {rows?.length === 0 && <p className="ad-muted">No messages yet.</p>}
      {rows?.map((m) => (
        <article key={m.id} className={`ad-card ad-msg ${m.is_read ? '' : 'unread'}`}>
          <button type="button" className="ad-msg-head" aria-expanded={openId === m.id} onClick={() => open(m)}>
            <strong>{m.name}</strong>
            <span>{m.email}</span>
            <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time>
          </button>
          {openId === m.id && (
            <div className="ad-msg-body">
              <p className="ad-pre">{m.message}</p>
              <div className="ad-actions">
                <a className="ad-btn primary" href={`mailto:${m.email}?subject=${encodeURIComponent('Re: your message')}`}>Reply by email</a>
                <button type="button" className="ad-btn" disabled={busy} onClick={() => void setRead(m, !m.is_read)}>Mark as {m.is_read ? 'unread' : 'read'}</button>
                <button type="button" className="ad-btn danger" disabled={busy} onClick={() => remove(m)}>Delete</button>
              </div>
            </div>
          )}
        </article>
      ))}
    </>
  )
}
