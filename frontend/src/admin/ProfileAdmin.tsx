import { useEffect, useState } from 'react'
import { client, run } from './api'
import { Field, Notice, nn, useTask, validUrl } from './ui'
import { publicUrl, removeFile, uploadImage, uploadPdf } from './upload'
import CrudTable, { type Row } from './CrudTable'

// Instagram is stored as a social_links row labelled "Instagram"; the public site reads it from there.
function InstagramControl() {
  const [row, setRow] = useState<Row | null>(null)
  const [url, setUrl] = useState('')
  const { busy, notice, task } = useTask()

  const load = async () => {
    const rows = await run<Row[]>(client().from('social_links').select('*').ilike('label', 'instagram'))
    setRow(rows[0] ?? null)
    setUrl(rows[0]?.url ?? '')
  }
  useEffect(() => {
    void task(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = () =>
    task(async () => {
      const u = url.trim()
      if (!validUrl(u)) throw new Error('Enter the full link, e.g. https://instagram.com/yourname')
      if (row) await run(client().from('social_links').update({ url: u, visible: true }).eq('id', row.id))
      else await run(client().from('social_links').insert({ label: 'Instagram', url: u, sort_order: 3, visible: true }))
      await load()
      return 'Instagram link saved. It now shows in Contact and Beyond the Code.'
    })

  const remove = () => {
    if (!row || !window.confirm('Remove the Instagram link? The site goes back to “coming soon”.')) return
    void task(async () => {
      await run(client().from('social_links').delete().eq('id', row.id))
      await load()
      return 'Instagram link removed.'
    })
  }

  return (
    <section className="ad-section">
      <h2 className="ad-h2">Instagram</h2>
      <div className="ad-card">
        <Field label="Instagram profile link" hint="Full URL, e.g. https://instagram.com/yourname. Leave empty to show “coming soon”.">
          <input className="ad-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://instagram.com/…" />
        </Field>
        <div className="ad-actions">
          <button type="button" className="ad-btn primary" disabled={busy} onClick={() => void save()}>Save Instagram</button>
          {row && <button type="button" className="ad-btn danger" disabled={busy} onClick={remove}>Remove</button>}
        </div>
        <Notice n={notice} />
      </div>
    </section>
  )
}

export default function ProfileAdmin() {
  const [v, setV] = useState<Row | null>(null)
  const { busy, notice, task } = useTask()

  useEffect(() => {
    void task(async () => {
      const d = await run<Row | null>(client().from('profile').select('*').eq('id', 1).maybeSingle())
      setV(d ?? { id: 1, full_name: '' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!v) return <><h1 className="ad-h1">Profile</h1><Notice n={notice} /><p className="ad-muted">Loading…</p></>

  const set = (k: string, val: string) => setV((p) => ({ ...(p as Row), [k]: val }))

  const persist = async (patch: Row = {}) => {
    const next = { ...v, ...patch }
    const name = String(next.full_name ?? '').trim()
    if (!name) throw new Error('Full name is required.')
    const email = nn(next.email)
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('That email address looks invalid.')
    await run(
      client().from('profile').upsert({
        id: 1,
        full_name: name,
        headline: nn(next.headline),
        intro: nn(next.intro),
        bio: nn(next.bio),
        email,
        photo_path: next.photo_path ?? null,
        resume_path: next.resume_path ?? null,
      }),
    )
    setV(next)
  }

  const onPhoto = (f?: File) => {
    if (!f) return
    void task(async () => {
      const old = v.photo_path
      await persist({ photo_path: await uploadImage('media', 'profile', f, 1400) })
      await removeFile('media', old)
      return 'Photograph updated.'
    })
  }
  const onResume = (f?: File) => {
    if (!f) return
    void task(async () => {
      const old = v.resume_path
      await persist({ resume_path: await uploadPdf('resume', 'resume', f) })
      await removeFile('resume', old)
      return 'Resume uploaded. The Resume button on the site is now active.'
    })
  }
  const removeResume = () => {
    if (!window.confirm('Remove the resume? The site button goes back to “coming soon”.')) return
    void task(async () => {
      const old = v.resume_path
      await persist({ resume_path: null })
      await removeFile('resume', old)
      return 'Resume removed.'
    })
  }

  return (
    <>
      <h1 className="ad-h1">Profile</h1>
      <form className="ad-card" onSubmit={(e) => { e.preventDefault(); void task(async () => { await persist(); return 'Profile saved.' }) }}>
        <div className="ad-grid">
          <Field label="Full name *"><input className="ad-input" value={v.full_name ?? ''} onChange={(e) => set('full_name', e.target.value)} maxLength={120} /></Field>
          <Field label="Email address" hint="Shown in the Contact section of the public site."><input className="ad-input" type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Professional headline" className="wide"><input className="ad-input" value={v.headline ?? ''} onChange={(e) => set('headline', e.target.value)} /></Field>
          <Field label="Short introduction" className="wide" hint="Typed out in the hero terminal."><textarea className="ad-input" rows={3} value={v.intro ?? ''} onChange={(e) => set('intro', e.target.value)} /></Field>
          <Field label="Full biography" className="wide"><textarea className="ad-input" rows={6} value={v.bio ?? ''} onChange={(e) => set('bio', e.target.value)} /></Field>
        </div>
        <div className="ad-actions">
          <button className="ad-btn primary" disabled={busy}>{busy ? 'Working…' : 'Save profile'}</button>
        </div>
        <Notice n={notice} />
      </form>

      <section className="ad-section">
        <h2 className="ad-h2">Photograph</h2>
        <div className="ad-card ad-media">
          {v.photo_path ? <img className="ad-thumb" src={publicUrl('media', v.photo_path)} alt="Current profile photograph" /> : <p className="ad-muted">No uploaded photograph. The built-in one is used.</p>}
          <Field label="Upload / replace photograph" hint="JPEG, PNG, WebP or AVIF. Converted to WebP automatically.">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = '' }} />
          </Field>
        </div>
      </section>

      <section className="ad-section">
        <h2 className="ad-h2">Resume (PDF)</h2>
        <div className="ad-card">
          {v.resume_path ? (
            <p><a href={publicUrl('resume', v.resume_path)} target="_blank" rel="noopener noreferrer">Current resume PDF ↗</a></p>
          ) : (
            <p className="ad-muted">No resume uploaded: the site shows “Resume — coming soon”. Upload a PDF without your phone number.</p>
          )}
          <Field label="Upload / replace resume" hint="PDF, up to 5 MB.">
            <input type="file" accept="application/pdf" disabled={busy} onChange={(e) => { onResume(e.target.files?.[0]); e.target.value = '' }} />
          </Field>
          {v.resume_path && <div className="ad-actions"><button type="button" className="ad-btn danger" disabled={busy} onClick={removeResume}>Remove resume</button></div>}
        </div>
      </section>

      <InstagramControl />

      <CrudTable
        title="Social links"
        table="social_links"
        note="Labels “GitHub”, “LinkedIn” and “Instagram” feed the public buttons. Instagram is easiest to set in the box above."
        fields={[
          { key: 'label', label: 'Label', required: true },
          { key: 'url', label: 'URL', type: 'url', required: true },
          { key: 'sort_order', label: 'Order', type: 'number' },
          { key: 'visible', label: 'Visible', type: 'checkbox' },
        ]}
        defaults={{ label: '', url: '', sort_order: 1, visible: true }}
        label={(r) => r.label}
        addLabel="Add a link"
      />
    </>
  )
}