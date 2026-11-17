import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { client, run, errMsg } from './api'
import { Field, Notice, useTask, validUrl } from './ui'

export type Row = Record<string, any>

export interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'number' | 'textarea' | 'checkbox' | 'select' | 'url'
  options?: { value: string; label: string }[]
  required?: boolean
  nullable?: boolean
  wide?: boolean
  hint?: string
}

export interface CrudProps {
  title: string
  table: string
  fields: FieldDef[]
  defaults: Row
  filter?: [string, string]
  label: (r: Row) => string
  extra?: (row: Row, patch: (p: Row) => void) => ReactNode
  extraKeys?: string[]
  addLabel?: string
  onChange?: () => void
  note?: string
  deleteWarning?: string
}

function clean(fields: FieldDef[], v: Row, extraKeys: string[] = []) {
  const out: Row = {}
  for (const f of fields) {
    const t = f.type ?? 'text'
    const raw = v[f.key]
    if (t === 'checkbox') out[f.key] = Boolean(raw)
    else if (t === 'number') {
      out[f.key] = raw === '' || raw == null ? (f.nullable ? null : 0) : Number(raw)
      if (Number.isNaN(out[f.key])) throw new Error(`${f.label} must be a number.`)
    } else {
      const s = String(raw ?? '').trim()
      if (!s) {
        if (f.required) throw new Error(`${f.label} is required.`)
        out[f.key] = null
      } else {
        if (t === 'url' && !validUrl(s)) throw new Error(`${f.label} must be a full http(s) link.`)
        out[f.key] = s
      }
    }
  }
  for (const k of extraKeys) out[k] = v[k] ?? null
  return out
}

function Inputs({ fields, v, set }: { fields: FieldDef[]; v: Row; set: (k: string, val: unknown) => void }) {
  return (
    <div className="ad-grid">
      {fields.map((f) => {
        const t = f.type ?? 'text'
        const val = v[f.key] ?? ''
        let input: ReactNode
        if (t === 'textarea') input = <textarea className="ad-input" rows={3} value={val} onChange={(e) => set(f.key, e.target.value)} />
        else if (t === 'checkbox') input = <input type="checkbox" checked={Boolean(v[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
        else if (t === 'select')
          input = (
            <select className="ad-input" value={val} onChange={(e) => set(f.key, e.target.value)}>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )
        else input = <input className="ad-input" type={t === 'number' ? 'number' : t === 'url' ? 'url' : 'text'} value={val} onChange={(e) => set(f.key, e.target.value)} />
        return (
          <Field key={f.key} label={f.label} hint={f.hint} className={`${f.wide || t === 'textarea' ? 'wide' : ''} ${t === 'checkbox' ? 'ad-check' : ''}`}>
            {input}
          </Field>
        )
      })}
    </div>
  )
}

function Item({ row, p, reload }: { row: Row; p: CrudProps; reload: () => Promise<void> }) {
  const [v, setV] = useState<Row>(row)
  const { busy, notice, task } = useTask()
  const set = (k: string, val: unknown) => setV((prev) => ({ ...prev, [k]: val }))
  const patch = (o: Row) => setV((prev) => ({ ...prev, ...o }))

  const save = () =>
    task(async () => {
      await run(client().from(p.table).update(clean(p.fields, v, p.extraKeys)).eq('id', row.id))
      p.onChange?.()
      return 'Saved.'
    })

  const remove = () => {
    const warning = p.deleteWarning ?? 'This cannot be undone.'
    if (!window.confirm(`Delete “${p.label(v) || 'this item'}”? ${warning}`)) return
    void task(async () => {
      await run(client().from(p.table).delete().eq('id', row.id))
      await reload()
      p.onChange?.()
    })
  }

  return (
    <article className="ad-card">
      <header className="ad-card-head">
        <strong>{p.label(v) || '(untitled)'}</strong>
      </header>
      <Inputs fields={p.fields} v={v} set={set} />
      {p.extra?.(v, patch)}
      <div className="ad-actions">
        <button type="button" className="ad-btn primary" disabled={busy} onClick={save}>
          {busy ? 'Working…' : 'Save'}
        </button>
        <button type="button" className="ad-btn danger" disabled={busy} onClick={remove}>
          Delete
        </button>
      </div>
      <Notice n={notice} />
    </article>
  )
}

export default function CrudTable(p: CrudProps) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [draft, setDraft] = useState<Row>(p.defaults)
  const [loadErr, setLoadErr] = useState('')
  const add = useTask()

  const load = async () => {
    try {
      let q = client().from(p.table).select('*')
      if (p.filter) q = q.eq(p.filter[0], p.filter[1])
      const data = await run<Row[]>(q.order('sort_order', { ascending: true }))
      setRows(data)
      setLoadErr('')
      if ('sort_order' in p.defaults) {
        const next = data.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1
        setDraft((d) => ({ ...d, sort_order: next }))
      }
    } catch (e) {
      setLoadErr(errMsg(e))
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void add.task(async () => {
      const payload = clean(p.fields, draft, p.extraKeys)
      if (p.filter) payload[p.filter[0]] = p.filter[1]
      await run(client().from(p.table).insert(payload))
      setDraft(p.defaults)
      await load()
      p.onChange?.()
      return 'Added.'
    })
  }

  return (
    <section className="ad-section">
      <h2 className="ad-h2">{p.title}</h2>
      {p.note && <p className="ad-muted">{p.note}</p>}
      {loadErr && <p className="ad-notice err" role="alert">{loadErr}</p>}
      {rows === null && !loadErr && <p className="ad-muted">Loading…</p>}
      {rows?.length === 0 && <p className="ad-muted">Nothing here yet.</p>}
      {rows?.map((r) => (
        <Item key={r.id} row={r} p={p} reload={load} />
      ))}
      <form className="ad-card ad-add" onSubmit={submit}>
        <header className="ad-card-head">
          <strong>{p.addLabel ?? 'Add new'}</strong>
        </header>
        <Inputs fields={p.fields} v={draft} set={(k, val) => setDraft((d) => ({ ...d, [k]: val }))} />
        <div className="ad-actions">
          <button type="submit" className="ad-btn primary" disabled={add.busy}>
            {add.busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        <Notice n={add.notice} />
      </form>
    </section>
  )
}
