import { useEffect, useRef, useState } from 'react'
import { client, run } from './api'
import { Field, Notice, nn, useTask, validUrl } from './ui'
import { Link, nav } from './router'
import { publicUrl, removeFile, uploadImage } from './upload'
import type { Row } from './CrudTable'
import { PROJECTS_DATA, type ProjectItem } from '../data/portfolioData'

type Pair = Record<string, string>
interface Draft {
  id?: string
  slug: string; title: string; tagline: string; category: string
  status: 'live' | 'completed' | 'researching'
  state: 'draft' | 'published' | 'archived'
  featured: boolean; sort_order: number
  overview: string; problem: string; solution: string; architecture: string; results: string; changelog_md: string
  features: string; developed: string
  challenges: { challenge: string; solution: string }[]
  tech: { languages: string; frameworks: string; backend: string; tools: string }
  metrics: { name: string; value: string; description: string }[]
  repo_url: string; demo_url: string; docs_url: string
  links: { label: string; url: string }[]
  cover_path: string | null
  skillIds: string[]
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const join = (a: unknown, sep: string) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').join(sep) : '')
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const blank = (order: number): Draft => ({
  slug: '', title: '', tagline: '', category: '', status: 'completed', state: 'draft', featured: false, sort_order: order,
  overview: '', problem: '', solution: '', architecture: '', results: '', changelog_md: '', features: '', developed: '',
  challenges: [], tech: { languages: '', frameworks: '', backend: '', tools: '' }, metrics: [],
  repo_url: '', demo_url: '', docs_url: '', links: [], cover_path: null, skillIds: [],
})

function rowToDraft(r: Row, skillIds: string[]): Draft {
  const t = r.tech_stack ?? {}
  return {
    id: r.id, slug: r.slug, title: r.title, tagline: r.tagline ?? '', category: r.category ?? '',
    status: r.status, state: r.state, featured: Boolean(r.featured), sort_order: r.sort_order ?? 0,
    overview: r.overview ?? '', problem: r.problem ?? '', solution: r.solution ?? '', architecture: r.architecture ?? '',
    results: r.results ?? '', changelog_md: r.changelog_md ?? '',
    features: join(r.features, '\n'), developed: join(r.developed, '\n'),
    challenges: Array.isArray(r.challenges_list) ? r.challenges_list.map((c: Pair) => ({ challenge: c.challenge ?? '', solution: c.solution ?? '' })) : [],
    tech: { languages: join(t.languages, ', '), frameworks: join(t.frameworks, ', '), backend: join(t.backend, ', '), tools: join(t.tools, ', ') },
    metrics: Array.isArray(r.metrics) ? r.metrics.map((m: Pair) => ({ name: m.name ?? '', value: m.value ?? '', description: m.description ?? '' })) : [],
    repo_url: r.repo_url ?? '', demo_url: r.demo_url ?? '', docs_url: r.docs_url ?? '',
    links: Array.isArray(r.links) ? r.links.map((l: Pair) => ({ label: l.label ?? '', url: l.url ?? '' })) : [],
    cover_path: r.cover_path ?? null, skillIds,
  }
}

// Pre-fills EMPTY fields from the built-in resume content so nothing has to be retyped.
function mergeStatic(d: Draft, s: ProjectItem): Draft {
  const empty = (x: string) => !x.trim()
  const g = s.techStackGrouped
  return {
    ...d,
    category: empty(d.category) ? s.category : d.category,
    overview: empty(d.overview) ? s.whatItIs : d.overview,
    architecture: empty(d.architecture) ? (s.architectureDiagram ?? '') : d.architecture,
    features: empty(d.features) ? s.mainFeatures.join('\n') : d.features,
    developed: empty(d.developed) ? s.whatIDeveloped.join('\n') : d.developed,
    challenges: d.challenges.length ? d.challenges : s.challengesSolved.map((c) => ({ ...c })),
    tech: Object.values(d.tech).some((x) => x.trim())
      ? d.tech
      : { languages: g.languages.join(', '), frameworks: g.frameworks.join(', '), backend: g.backend.join(', '), tools: g.tools.join(', ') },
    repo_url: d.repo_url || s.repoUrl || '', demo_url: d.demo_url || s.demoUrl || '', docs_url: d.docs_url || s.docsUrl || '',
  }
}

function RepList<T extends Pair>({ items, onChange, fields, blank: b, addLabel }: {
  items: T[]; onChange: (x: T[]) => void; blank: T; addLabel: string
  fields: { key: string; placeholder: string; area?: boolean }[]
}) {
  return (
    <div className="ad-rep-list">
      {items.map((it, i) => (
        <div className="ad-rep" key={i}>
          {fields.map((f) => {
            const props = {
              className: 'ad-input', placeholder: f.placeholder, 'aria-label': f.placeholder, value: it[f.key] ?? '',
              onChange: (e: { target: { value: string } }) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x))),
            }
            return f.area ? <textarea key={f.key} rows={2} {...props} /> : <input key={f.key} {...props} />
          })}
          <button type="button" className="ad-btn danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="ad-btn" onClick={() => onChange([...items, { ...b }])}>+ {addLabel}</button>
    </div>
  )
}

function GalleryItem({ m, reload }: { m: Row; reload: () => Promise<void> }) {
  const [alt, setAlt] = useState<string>(m.alt ?? '')
  const [order, setOrder] = useState<number>(m.sort_order ?? 0)
  const { busy, notice, task } = useTask()
  return (
    <div className="ad-gal-item">
      <img className="ad-thumb" src={publicUrl('media', m.path)} alt={alt || 'Project screenshot (no alt text yet)'} loading="lazy" />
      <input className="ad-input" placeholder="Alt text (describe the image)" aria-label="Alt text" value={alt} onChange={(e) => setAlt(e.target.value)} />
      <label className="ad-order">Order <input className="ad-input" type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} /></label>
      <div className="ad-actions">
        <button type="button" className="ad-btn primary" disabled={busy} onClick={() => void task(async () => { await run(client().from('project_media').update({ alt: alt.trim(), sort_order: order }).eq('id', m.id)); await reload(); return 'Saved.' })}>Save</button>
        <label className="ad-btn">Replace
          <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (f) void task(async () => { const path = await uploadImage('media', `projects/${m.project_id}`, f); await run(client().from('project_media').update({ path }).eq('id', m.id)); await removeFile('media', m.path); await reload(); return 'Image replaced.' })
          }} />
        </label>
        <button type="button" className="ad-btn danger" disabled={busy} onClick={() => { if (window.confirm('Delete this image?')) void task(async () => { await run(client().from('project_media').delete().eq('id', m.id)); await removeFile('media', m.path); await reload() }) }}>Delete</button>
      </div>
      <Notice n={notice} />
    </div>
  )
}

function Gallery({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Row[]>([])
  const { busy, notice, task } = useTask()
  const load = async () => setItems(await run<Row[]>(client().from('project_media').select('*').eq('project_id', projectId).order('sort_order')))
  useEffect(() => { void load().catch(() => undefined) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])
  return (
    <fieldset className="ad-card">
      <legend>Screenshots</legend>
      <p className="ad-muted">Shown in the project’s overview on the public site. Add alt text for accessibility.</p>
      <div className="ad-gal">{items.map((m) => <GalleryItem key={m.id + m.path} m={m} reload={load} />)}</div>
      <Field label="Add screenshots" hint="JPEG, PNG, WebP or AVIF — converted to WebP and resized automatically. You can pick several.">
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={(e) => {
          const files = Array.from(e.target.files ?? []); e.target.value = ''
          if (!files.length) return
          void task(async () => {
            let n = items.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0)
            for (const f of files) {
              const path = await uploadImage('media', `projects/${projectId}`, f)
              await run(client().from('project_media').insert({ project_id: projectId, path, alt: '', sort_order: ++n }))
            }
            await load()
            return `Uploaded ${files.length} image${files.length > 1 ? 's' : ''}.`
          })
        }} />
      </Field>
      <Notice n={notice} />
    </fieldset>
  )
}

export default function ProjectForm({ id }: { id?: string }) {
  const [d, setD] = useState<Draft | null>(null)
  const [skills, setSkills] = useState<Row[]>([])
  const [cats, setCats] = useState<Row[]>([])
  const [skillLinks, setSkillLinks] = useState<Row[]>([])
  const [imported, setImported] = useState(false)
  const origCover = useRef<string | null>(null)
  const { busy, notice, task } = useTask()
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => (p ? { ...p, [k]: v } : p))

  useEffect(() => {
    void task(async () => {
      const [sk, ct, sd] = await Promise.all([
        run<Row[]>(client().from('skills').select('*').order('sort_order')),
        run<Row[]>(client().from('skill_categories').select('*').order('sort_order')),
        run<Row[]>(client().from('skill_domains').select('*')),
      ])
      setSkills(sk); setCats(ct); setSkillLinks(sd)
      if (!id) {
        const top = await run<Row[]>(client().from('projects').select('sort_order').order('sort_order', { ascending: false }).limit(1))
        setD(blank((top[0]?.sort_order ?? 0) + 1))
        return
      }
      const row = await run<Row>(client().from('projects').select('*').eq('id', id).single())
      const links = await run<Row[]>(client().from('project_skills').select('skill_id').eq('project_id', id))
      let draft = rowToDraft(row, links.map((l) => l.skill_id))
      if (!row.content_managed) {
        const s = PROJECTS_DATA.find((x) => x.slug === row.slug)
        if (s) {
          draft = mergeStatic(draft, s)
          if (!draft.skillIds.length) {
            const names = new Set(s.skills.map((n) => n.toLowerCase()))
            draft.skillIds = sk.filter((x) => names.has(String(x.name).toLowerCase())).map((x) => x.id)
          }
          setImported(true)
        }
      }
      origCover.current = draft.cover_path
      setD(draft)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!d) return <><h1 className="ad-h1">{id ? 'Edit project' : 'New project'}</h1><Notice n={notice} /><p className="ad-muted">Loading…</p></>

  const save = () =>
    task(async () => {
      const title = d.title.trim()
      if (!title) throw new Error('Project name is required.')
      if (!SLUG.test(d.slug)) throw new Error('Slug must be lowercase letters, numbers and hyphens (e.g. my-project).')
      for (const [label, u] of [['GitHub', d.repo_url], ['Live demo', d.demo_url], ['Documentation', d.docs_url]] as const)
        if (u.trim() && !validUrl(u.trim())) throw new Error(`${label} link must be a full http(s) URL.`)
      for (const l of d.links) if ((l.label.trim() || l.url.trim()) && (!l.label.trim() || !validUrl(l.url.trim()))) throw new Error('Each extra link needs a label and a full http(s) URL.')
      for (const m of d.metrics) if (!!m.name.trim() !== !!m.value.trim()) throw new Error('Each metric needs both a name and a value (or remove it).')

      const row = {
        slug: d.slug, title, tagline: nn(d.tagline), category: nn(d.category), status: d.status, state: d.state,
        featured: d.featured, sort_order: Number(d.sort_order) || 0,
        overview: nn(d.overview), problem: nn(d.problem), solution: nn(d.solution), architecture: nn(d.architecture),
        results: nn(d.results), changelog_md: nn(d.changelog_md),
        features: lines(d.features), developed: lines(d.developed),
        challenges_list: d.challenges.filter((c) => c.challenge.trim() || c.solution.trim()),
        tech_stack: { languages: csv(d.tech.languages), frameworks: csv(d.tech.frameworks), backend: csv(d.tech.backend), tools: csv(d.tech.tools) },
        metrics: d.metrics.filter((m) => m.name.trim() && m.value.trim()).map((m) => ({ name: m.name.trim(), value: m.value.trim(), description: m.description.trim() })),
        repo_url: nn(d.repo_url), demo_url: nn(d.demo_url), docs_url: nn(d.docs_url),
        links: d.links.filter((l) => l.label.trim() && l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
        cover_path: d.cover_path, content_managed: true,
      }
      let pid = d.id
      if (pid) await run(client().from('projects').update(row).eq('id', pid))
      else pid = (await run<Row>(client().from('projects').insert(row).select('id').single())).id

      const cur = (await run<Row[]>(client().from('project_skills').select('skill_id').eq('project_id', pid))).map((r) => r.skill_id as string)
      const drop = cur.filter((x) => !d.skillIds.includes(x))
      const add = d.skillIds.filter((x) => !cur.includes(x))
      if (drop.length) await run(client().from('project_skills').delete().eq('project_id', pid).in('skill_id', drop))
      if (add.length) await run(client().from('project_skills').insert(add.map((skill_id) => ({ project_id: pid, skill_id }))))

      if (origCover.current && origCover.current !== d.cover_path) await removeFile('media', origCover.current)
      origCover.current = d.cover_path
      setImported(false)
      if (!d.id) { nav(`/admin/projects/${pid}`); return }
      setD({ ...d, id: pid })
      return d.state === 'published' ? 'Saved — visible on the public site.' : `Saved as ${d.state} — not visible to visitors.`
    })

  const toggleSkill = (sid: string) => set('skillIds', d.skillIds.includes(sid) ? d.skillIds.filter((x) => x !== sid) : [...d.skillIds, sid])
  const text = (k: 'tagline' | 'category' | 'repo_url' | 'demo_url' | 'docs_url', label: string, extra?: string) => (
    <Field label={label} hint={extra}><input className="ad-input" value={d[k]} onChange={(e) => set(k, e.target.value)} /></Field>
  )
  const area = (k: 'overview' | 'problem' | 'solution' | 'architecture' | 'results' | 'changelog_md' | 'features' | 'developed', label: string, rows: number, hint?: string) => (
    <Field label={label} hint={hint} className="wide"><textarea className={`ad-input ${k === 'architecture' ? 'ad-mono' : ''}`} rows={rows} value={d[k]} onChange={(e) => set(k, e.target.value)} /></Field>
  )
  // A skill can sit in several domains; it is listed under each one (same checkbox state).
  const inDomain = (cid: string) => skills.filter((s) => skillLinks.some((l) => l.skill_id === s.id && l.category_id === cid))
  const uncategorised = skills.filter((s) => !skillLinks.some((l) => l.skill_id === s.id && cats.some((c) => c.id === l.category_id)))

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="ad-titlebar">
        <h1 className="ad-h1">{d.id ? 'Edit project' : 'New project'}</h1>
        <Link to="/admin/projects" className="ad-btn">← All projects</Link>
      </div>
      {imported && <p className="ad-notice ok">Empty fields were pre-filled from the built-in resume content. Review them, then Save to store them in the database.</p>}

      <fieldset className="ad-card"><legend>Basic information</legend>
        <div className="ad-grid">
          <Field label="Project name *"><input className="ad-input" value={d.title} maxLength={120} onChange={(e) => set('title', e.target.value)} onBlur={() => !d.slug && set('slug', slugify(d.title))} /></Field>
          <Field label="Slug *" hint="Used in the project’s identifier. Lowercase, hyphens."><input className="ad-input" value={d.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
          {text('tagline', 'Tagline / short description')}
          {text('category', 'Category', 'e.g. Computer Vision & Remote Sensing')}
          <Field label="Project status"><select className="ad-input" value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])}><option value="live">Live</option><option value="completed">Completed</option><option value="researching">Researching</option></select></Field>
          <Field label="Visibility" hint="Only “published” is visible to visitors."><select className="ad-input" value={d.state} onChange={(e) => set('state', e.target.value as Draft['state'])}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></Field>
          <Field label="Order number" hint="Lower numbers come first (featured always first)."><input className="ad-input" type="number" value={d.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} /></Field>
          <Field label="Featured" className="ad-check"><input type="checkbox" checked={d.featured} onChange={(e) => set('featured', e.target.checked)} /></Field>
        </div>
        <div className="ad-media">
          {d.cover_path ? <img className="ad-thumb" src={publicUrl('media', d.cover_path)} alt="Cover" /> : <p className="ad-muted">No cover image: the card shows its placeholder.</p>}
          <Field label="Cover image" hint="Uploaded immediately; click Save to attach it.">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (f) void task(async () => { const old = d.cover_path; const p = await uploadImage('media', 'covers', f, 1400); if (old && old !== origCover.current) await removeFile('media', old); set('cover_path', p); return 'Cover uploaded — remember to Save.' })
            }} />
          </Field>
          {d.cover_path && <button type="button" className="ad-btn" onClick={() => set('cover_path', null)}>Remove cover</button>}
        </div>
      </fieldset>

      <fieldset className="ad-card"><legend>Content (a file appears publicly only when filled)</legend>
        <div className="ad-grid">
          {area('overview', 'overview.md — what it is & the problem it solves', 5)}
          {area('developed', 'What I developed', 5, 'One item per line.')}
          {area('features', 'features.md — main features', 5, 'One per line. Use “Title: description”.')}
          {area('problem', 'problem.md', 4)}
          {area('solution', 'solution.md', 4)}
          {area('architecture', 'architecture.md — diagram / pipeline', 8, 'Monospace text, shown as a code block.')}
          {area('results', 'results.md', 4, 'Only verified results — leave empty otherwise.')}
          {area('changelog_md', 'changelog.md — development journey', 4)}
        </div>
      </fieldset>

      <fieldset className="ad-card"><legend>Tech stack (tech-stack.json)</legend>
        <div className="ad-grid">
          {(['languages', 'frameworks', 'backend', 'tools'] as const).map((k) => (
            <Field key={k} label={{ languages: 'Languages', frameworks: 'AI & frameworks', backend: 'Backend & processing', tools: 'Tools & libraries' }[k]} hint="Comma-separated.">
              <input className="ad-input" value={d.tech[k]} onChange={(e) => set('tech', { ...d.tech, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset className="ad-card"><legend>Technology badges (linked skills)</legend>
        <p className="ad-muted">These drive the badges on the card and the skill-constellation highlighting. Manage the list under Skills.</p>
        {[...cats.map((c) => ({ id: c.id, name: c.name, list: inDomain(c.id) })), { id: 'none', name: 'Uncategorised', list: uncategorised }]
          .filter((g) => g.list.length)
          .map((g) => (
            <div key={g.id} className="ad-skillgroup">
              <span className="ad-label">{g.name}</span>
              <div className="ad-chips">
                {g.list.map((s) => (
                  <label key={s.id} className={`ad-chip ${d.skillIds.includes(s.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={d.skillIds.includes(s.id)} onChange={() => toggleSkill(s.id)} /> {s.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
      </fieldset>

      <fieldset className="ad-card"><legend>challenges.md</legend>
        <RepList items={d.challenges} onChange={(x) => set('challenges', x)} blank={{ challenge: '', solution: '' }} addLabel="Add challenge"
          fields={[{ key: 'challenge', placeholder: 'Challenge' }, { key: 'solution', placeholder: 'How it was solved', area: true }]} />
      </fieldset>

      <fieldset className="ad-card"><legend>Metrics</legend>
        <p className="ad-muted">Leave empty until you have verified numbers. They appear inside results.md.</p>
        <RepList items={d.metrics} onChange={(x) => set('metrics', x)} blank={{ name: '', value: '', description: '' }} addLabel="Add metric"
          fields={[{ key: 'name', placeholder: 'Metric name' }, { key: 'value', placeholder: 'Value' }, { key: 'description', placeholder: 'Optional description' }]} />
      </fieldset>

      <fieldset className="ad-card"><legend>Links (links.md)</legend>
        <div className="ad-grid">{text('repo_url', 'GitHub')}{text('demo_url', 'Live demo')}{text('docs_url', 'Documentation')}</div>
        <span className="ad-label">Other links</span>
        <RepList items={d.links} onChange={(x) => set('links', x)} blank={{ label: '', url: '' }} addLabel="Add link"
          fields={[{ key: 'label', placeholder: 'Label (e.g. Paper)' }, { key: 'url', placeholder: 'https://…' }]} />
      </fieldset>

      {d.id ? <Gallery projectId={d.id} /> : <p className="ad-muted">Save the project once to add screenshots.</p>}

      <div className="ad-savebar">
        <button className="ad-btn primary" disabled={busy}>{busy ? 'Working…' : 'Save project'}</button>
        <Notice n={notice} />
      </div>
    </form>
  )
}