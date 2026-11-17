import { useEffect, useState } from 'react'
import { client, run } from './api'
import { Notice, useTask } from './ui'
import { Link, nav } from './router'
import { removeFile } from './upload'
import type { Row } from './CrudTable'

type State = 'draft' | 'published' | 'archived'
const TABS: ('all' | State)[] = ['all', 'published', 'draft', 'archived']

export default function ProjectsList() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [tab, setTab] = useState<'all' | State>('all')
  const { busy, notice, task } = useTask()

  const load = async () =>
    setRows(await run<Row[]>(client().from('projects').select('id,slug,title,state,status,featured,sort_order,cover_path').order('sort_order')))
  useEffect(() => { void task(load) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const patch = (id: string, o: Row, msg?: string) =>
    task(async () => {
      await run(client().from('projects').update(o).eq('id', id))
      await load()
      return msg
    })

  const remove = (p: Row) => {
    if (!window.confirm(`Permanently delete “${p.title}” and its images? Consider Archive instead.`)) return
    void task(async () => {
      const media = await run<Row[]>(client().from('project_media').select('path').eq('project_id', p.id))
      await run(client().from('projects').delete().eq('id', p.id))
      await Promise.all([...media.map((m) => removeFile('media', m.path)), removeFile('media', p.cover_path)])
      await load()
      return 'Project deleted.'
    })
  }

  const shown = rows?.filter((r) => tab === 'all' || r.state === tab) ?? []

  return (
    <>
      <div className="ad-titlebar">
        <h1 className="ad-h1">Projects</h1>
        <Link to="/admin/projects/new" className="ad-btn primary">+ New project</Link>
      </div>
      <div className="ad-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ad-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t} {rows && `(${t === 'all' ? rows.length : rows.filter((r) => r.state === t).length})`}
          </button>
        ))}
      </div>
      <Notice n={notice} />
      {rows && shown.length === 0 && <p className="ad-muted">No projects in this view.</p>}
      {shown.map((p) => (
        <article key={p.id} className="ad-card ad-prow">
          <div className="ad-prow-main">
            <strong>{p.title}</strong>
            <span className={`ad-badge ${p.state}`}>{p.state}</span>
            {p.featured && <span className="ad-badge feat">★ Featured</span>}
            <small className="ad-muted">/{p.slug} · {p.status}</small>
          </div>
          <label className="ad-order">
            Order
            <input
              key={`${p.id}-${p.sort_order}`}
              type="number"
              className="ad-input"
              defaultValue={p.sort_order}
              disabled={busy}
              onBlur={(e) => {
                const n = Number(e.target.value)
                if (!Number.isNaN(n) && n !== p.sort_order) void patch(p.id, { sort_order: n })
              }}
            />
          </label>
          <div className="ad-actions">
            <button className="ad-btn primary" onClick={() => nav(`/admin/projects/${p.id}`)}>Edit</button>
            {p.state === 'draft' && <button className="ad-btn" disabled={busy} onClick={() => void patch(p.id, { state: 'published' }, 'Published.')}>Publish</button>}
            {p.state === 'published' && <button className="ad-btn" disabled={busy} onClick={() => void patch(p.id, { state: 'draft' }, 'Moved to drafts.')}>Unpublish</button>}
            {p.state === 'archived' ? (
              <button className="ad-btn" disabled={busy} onClick={() => void patch(p.id, { state: 'draft' }, 'Restored as a draft. Publish it when ready.')}>Restore</button>
            ) : (
              <button className="ad-btn" disabled={busy} onClick={() => void patch(p.id, { state: 'archived' }, 'Archived.')}>Archive</button>
            )}
            <button className="ad-btn" disabled={busy} onClick={() => void patch(p.id, { featured: !p.featured })}>{p.featured ? 'Unfeature' : 'Feature'}</button>
            <button className="ad-btn danger" disabled={busy} onClick={() => remove(p)}>Delete</button>
          </div>
        </article>
      ))}
    </>
  )
}
