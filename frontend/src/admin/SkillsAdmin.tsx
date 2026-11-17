import { useEffect, useMemo, useRef, useState } from 'react'
import { client, errMsg, run } from './api'
import CrudTable, { type Row } from './CrudTable'
import { Notice, useTask } from './ui'

interface SkillDraft {
  key: string
  id: string | null
  name: string
  sortOrder: number
  domainIds: string[]
  primaryDomainId: string | null
  relatedSkillKeys: string[]
  deleted: boolean
}

const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])
const pairKey = (a: string, b: string) => orderedPair(a, b).join(':')

function SkillsEditor({ domains }: { domains: Row[] }) {
  const [skills, setSkills] = useState<SkillDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [filter, setFilter] = useState<string>('all') // 'all' | 'none' | domain id
  const [search, setSearch] = useState('')
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const original = useRef<Map<string, string[]>>(new Map())
  const originalLinks = useRef<Map<string, [string, string]>>(new Map())
  const nextId = useRef(0)
  const { busy, notice, task } = useTask()

  const domainIds = useMemo(() => new Set(domains.map((d) => String(d.id))), [domains])
  const own = (s: SkillDraft) => s.domainIds.filter((id) => domainIds.has(id))

  const load = async () => {
    const [rows, links, relations] = await Promise.all([
      run<Row[]>(client().from('skills').select('*').order('sort_order')),
      run<Row[]>(client().from('skill_domains').select('*')),
      run<Row[]>(client().from('skill_links').select('*')),
    ])
    const by = new Map<string, string[]>()
    for (const l of links) by.set(l.skill_id, [...(by.get(l.skill_id) ?? []), l.category_id])
    const relatedBySkill = new Map<string, string[]>()
    const storedRelations = new Map<string, [string, string]>()
    const domainOrder = new Map(domains.map((domain, index) => [String(domain.id), index]))
    for (const relation of relations) {
      const [a, b] = orderedPair(String(relation.skill_a_id), String(relation.skill_b_id))
      storedRelations.set(pairKey(a, b), [a, b])
      relatedBySkill.set(a, [...(relatedBySkill.get(a) ?? []), b])
      relatedBySkill.set(b, [...(relatedBySkill.get(b) ?? []), a])
    }
    original.current = by
    originalLinks.current = storedRelations
    setSkills(
      rows.map((r) => {
        const assignedDomains = (by.get(r.id) ?? [])
          .filter((id) => domainIds.has(id))
          .sort((a, b) => (domainOrder.get(a) ?? 0) - (domainOrder.get(b) ?? 0))
        const savedPrimary = typeof r.primary_domain_id === 'string' ? r.primary_domain_id : null
        return {
          key: r.id,
          id: r.id,
          name: r.name,
          sortOrder: Number(r.sort_order) || 0,
          domainIds: assignedDomains,
          primaryDomainId: savedPrimary && assignedDomains.includes(savedPrimary) ? savedPrimary : assignedDomains[0] ?? null,
          relatedSkillKeys: relatedBySkill.get(r.id) ?? [],
          deleted: false,
        }
      }),
    )
    setDirty(false)
    setExpandedSkill(null)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    load()
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errMsg(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (key: string, patch: Partial<SkillDraft>) => {
    setSkills((current) => current.map((s) => (s.key === key ? { ...s, ...patch } : s)))
    setDirty(true)
  }

  const toggleDomain = (skill: SkillDraft, domainId: string) => {
    const nextDomainIds = skill.domainIds.includes(domainId)
      ? skill.domainIds.filter((id) => id !== domainId)
      : [...skill.domainIds, domainId]
    const assignedDomains = nextDomainIds.filter((id) => domainIds.has(id))
    const primaryDomainId =
      skill.primaryDomainId && assignedDomains.includes(skill.primaryDomainId)
        ? skill.primaryDomainId
        : assignedDomains[0] ?? null
    update(skill.key, { domainIds: nextDomainIds, primaryDomainId })
  }

  const toggleRelatedSkill = (skill: SkillDraft, relatedKey: string) => {
    const enabled = !skill.relatedSkillKeys.includes(relatedKey)
    setSkills((current) =>
      current.map((item) => {
        if (item.key === skill.key) {
          return {
            ...item,
            relatedSkillKeys: enabled
              ? [...item.relatedSkillKeys, relatedKey]
              : item.relatedSkillKeys.filter((key) => key !== relatedKey),
          }
        }
        if (item.key === relatedKey) {
          return {
            ...item,
            relatedSkillKeys: enabled
              ? [...item.relatedSkillKeys, skill.key]
              : item.relatedSkillKeys.filter((key) => key !== skill.key),
          }
        }
        return item
      }),
    )
    setDirty(true)
  }

  const addSkill = () => {
    const sortOrder = skills.reduce((max, s) => (s.deleted ? max : Math.max(max, s.sortOrder)), 0) + 1
    const key = `new-${++nextId.current}`
    const preset = filter !== 'all' && filter !== 'none' ? [filter] : []
    setSkills((current) => [...current, {
      key, id: null, name: '', sortOrder, domainIds: preset,
      primaryDomainId: preset[0] ?? null, relatedSkillKeys: [], deleted: false,
    }])
    setSearch('')
    setExpandedSkill(key)
    setDirty(true)
  }

  const toggleDeleted = (skill: SkillDraft) => {
    update(skill.key, { deleted: !skill.deleted })
    if (!skill.deleted && expandedSkill === skill.key) setExpandedSkill(null)
  }

  const save = () =>
    void task(async () => {
      const active = skills.filter((s) => !s.deleted)
      if (active.some((s) => !s.name.trim())) throw new Error('Enter a name for each skill, or remove empty skill rows.')
      const seen = new Set<string>()
      for (const s of active) {
        const k = s.name.trim().toLowerCase()
        if (seen.has(k)) throw new Error(`“${s.name.trim()}” appears twice. Skill names must be unique.`)
        seen.add(k)
      }

      const removed = skills.filter((s) => s.deleted && s.id).map((s) => s.id as string)
      if (removed.length) await run(client().from('skills').delete().in('id', removed))

      const values = (s: SkillDraft) => ({
        name: s.name.trim(),
        sort_order: s.sortOrder,
        primary_domain_id: own(s).includes(s.primaryDomainId ?? '') ? s.primaryDomainId : own(s)[0] ?? null,
      })
      const existing = active.filter((s): s is SkillDraft & { id: string } => s.id !== null)
      const fresh = active.filter((s) => s.id === null)
      if (existing.length) {
        await run(client().from('skills').upsert(existing.map((s) => ({ id: s.id, ...values(s) })), { onConflict: 'id' }))
      }
      const ids = new Map<string, string>(existing.map((s) => [s.key, s.id]))
      if (fresh.length) {
        const created = await run<Row[]>(client().from('skills').insert(fresh.map(values)).select('id,name'))
        for (const s of fresh) {
          const hit = created.find((c) => String(c.name).toLowerCase() === s.name.trim().toLowerCase())
          if (hit) ids.set(s.key, hit.id)
        }
      }

      // Sync skill <-> domain assignments (many-to-many)
      const add: { skill_id: string; category_id: string }[] = []
      for (const s of active) {
        const id = ids.get(s.key)
        if (!id) continue
        const want = new Set(own(s))
        const had = new Set((original.current.get(id) ?? []).filter((d) => domainIds.has(d)))
        for (const d of want) if (!had.has(d)) add.push({ skill_id: id, category_id: d })
        const drop = [...had].filter((d) => !want.has(d))
        if (drop.length) await run(client().from('skill_domains').delete().eq('skill_id', id).in('category_id', drop))
      }
      if (add.length) await run(client().from('skill_domains').upsert(add, { onConflict: 'skill_id,category_id' }))

      const desiredLinks = new Map<string, [string, string]>()
      for (const skill of active) {
        const id = ids.get(skill.key)
        if (!id) continue
        for (const relatedKey of skill.relatedSkillKeys) {
          const relatedId = ids.get(relatedKey)
          if (!relatedId || relatedId === id) continue
          const pair = orderedPair(id, relatedId)
          desiredLinks.set(pairKey(pair[0], pair[1]), pair)
        }
      }

      for (const [key, [a, b]] of originalLinks.current) {
        if (!desiredLinks.has(key)) {
          await run(client().from('skill_links').delete().eq('skill_a_id', a).eq('skill_b_id', b))
        }
      }
      const linksToAdd = [...desiredLinks.entries()]
        .filter(([key]) => !originalLinks.current.has(key))
        .map(([, [skill_a_id, skill_b_id]]) => ({ skill_a_id, skill_b_id }))
      if (linksToAdd.length) {
        await run(client().from('skill_links').upsert(linksToAdd, { onConflict: 'skill_a_id,skill_b_id' }))
      }

      await load()
      return 'All skills saved.'
    })

  const q = search.trim().toLowerCase()
  const live = skills.filter((s) => !s.deleted)
  const shown = skills.filter((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return false
    if (filter === 'all') return true
    if (filter === 'none') return own(s).length === 0
    return s.domainIds.includes(filter)
  })
  const countIn = (id: string) => live.filter((s) => s.domainIds.includes(id)).length
  const unassigned = live.filter((s) => own(s).length === 0).length
  const removedShown = shown.filter((s) => s.deleted).length
  const primaryDomainName = (skill: SkillDraft) =>
    domains.find((domain) => String(domain.id) === skill.primaryDomainId)?.name

  return (
    <section className="ad-section">
      <h2 className="ad-h2">Skills</h2>
      <p className="ad-muted">
        Assign each skill to one or more domains, choose its primary domain for graph placement, then optionally link related skills.
        All memberships and links appear in the public graph. Save all changes together.
      </p>
      {loading && <p className="ad-muted">Loading skills…</p>}
      {loadError && <p className="ad-notice err" role="alert">Could not load skills: {loadError}</p>}

      {!loading && !loadError && (
        <>
          <div className="ad-skill-tools">
            <select className="ad-input" aria-label="Filter skills by domain" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All skills ({live.length})</option>
              <option value="none">Unassigned ({unassigned})</option>
              {domains.map((d) => (
                <option key={d.id} value={String(d.id)}>{d.name} ({countIn(String(d.id))})</option>
              ))}
            </select>
            <input className="ad-input" placeholder="Search skills…" aria-label="Search skills" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="button" className="ad-btn" disabled={busy} onClick={addSkill}>+ Add skill</button>
          </div>
          <p className="ad-skill-result-count" role="status">
            Showing {shown.length - removedShown} of {live.length} skills{removedShown > 0 ? ` · ${removedShown} marked for removal` : ''}
          </p>

          {shown.length === 0 && <p className="ad-muted">No skills in this view.</p>}
          {shown.map((skill) => (
            <article key={skill.key} className={`ad-skill-item ${skill.deleted ? 'deleted' : ''}`}>
              <div className="ad-skill-summary">
                <button
                  type="button"
                  className="ad-skill-expand"
                  aria-expanded={!skill.deleted && expandedSkill === skill.key}
                  aria-controls={expandedSkill === skill.key ? `skill-editor-${skill.key}` : undefined}
                  disabled={skill.deleted}
                  onClick={() => setExpandedSkill(expandedSkill === skill.key ? null : skill.key)}
                >
                  <span className="ad-skill-chevron" aria-hidden="true">{expandedSkill === skill.key ? '-' : '+'}</span>
                  <span className="ad-skill-summary-name">{skill.name.trim() || 'Unnamed skill'}</span>
                  <span className="ad-skill-summary-domains">
                    {primaryDomainName(skill)
                      ? `Primary: ${primaryDomainName(skill)}${own(skill).length > 1 ? ` · +${own(skill).length - 1} more` : ''}`
                      : 'Unassigned'}
                  </span>
                  {skill.relatedSkillKeys.length > 0 && (
                    <span className="ad-skill-link-count">{skill.relatedSkillKeys.length} linked</span>
                  )}
                  {skill.id === null && <span className="ad-skill-new">New</span>}
                </button>
                <button
                  type="button"
                  className={`ad-btn ${skill.deleted ? '' : 'danger'}`}
                  disabled={busy}
                  onClick={() => toggleDeleted(skill)}
                >
                  {skill.deleted ? 'Undo' : 'Remove'}
                </button>
              </div>
              {skill.deleted ? (
                <small className="ad-hint">Marked for removal. Undo before saving to keep this skill.</small>
              ) : expandedSkill === skill.key ? (
                <div id={`skill-editor-${skill.key}`} className="ad-skill-editor">
                  <div className="ad-skill-row">
                    <input
                      className="ad-input"
                      aria-label={`Skill name${skill.name ? `: ${skill.name}` : ''}`}
                      placeholder="Skill name"
                      value={skill.name}
                      onChange={(e) => update(skill.key, { name: e.target.value })}
                    />
                    <input
                      className="ad-input"
                      aria-label={`Order for ${skill.name || 'new skill'}`}
                      type="number"
                      value={skill.sortOrder}
                      onChange={(e) => update(skill.key, { sortOrder: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <strong className="ad-skill-editor-label">Domains</strong>
                  <div className="ad-chips" role="group" aria-label={`Domains for ${skill.name || 'new skill'}`}>
                    {domains.map((d) => {
                      const on = skill.domainIds.includes(String(d.id))
                      return (
                        <label key={d.id} className={`ad-chip ${on ? 'on' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleDomain(skill, String(d.id))} /> {d.name}
                        </label>
                      )
                    })}
                  </div>
                  <label className="ad-skill-primary">
                    <span className="ad-skill-editor-label">Primary domain</span>
                    <select
                      className="ad-input"
                      aria-label={`Primary domain for ${skill.name || 'new skill'}`}
                      value={skill.primaryDomainId ?? ''}
                      disabled={own(skill).length === 0}
                      onChange={(e) => update(skill.key, { primaryDomainId: e.target.value || null })}
                    >
                      {own(skill).length === 0 && <option value="">Assign a domain first</option>}
                      {domains.filter((domain) => own(skill).includes(String(domain.id))).map((domain) => (
                        <option key={domain.id} value={String(domain.id)}>{domain.name}</option>
                      ))}
                    </select>
                    <small className="ad-hint">Controls where this skill is placed in the public graph.</small>
                  </label>
                  <details className="ad-skill-relations">
                    <summary>Related skills ({skill.relatedSkillKeys.length})</summary>
                    <div className="ad-chips" role="group" aria-label={`Related skills for ${skill.name || 'new skill'}`}>
                      {live.filter((other) => other.key !== skill.key).map((other) => {
                        const on = skill.relatedSkillKeys.includes(other.key)
                        return (
                          <label key={other.key} className={`ad-chip ${on ? 'on' : ''}`}>
                            <input type="checkbox" checked={on} onChange={() => toggleRelatedSkill(skill, other.key)} />
                            {other.name.trim() || `New skill ${other.sortOrder}`}
                          </label>
                        )
                      })}
                      {live.length <= 1 && <small className="ad-hint">Add another skill to create a relationship.</small>}
                    </div>
                  </details>
                  {own(skill).length === 0 && (
                    <small className="ad-hint">No domain ticked: shown as “Uncategorized” on the site.</small>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </>
      )}

      <div className="ad-savebar">
        <button type="button" className="ad-btn primary" disabled={!dirty || busy || loading || Boolean(loadError)} onClick={save}>
          {busy ? 'Saving…' : 'Save all skills'}
        </button>
        {dirty && <span className="ad-muted">Unsaved changes</span>}
        <Notice n={notice} />
      </div>
    </section>
  )
}

export default function SkillsAdmin() {
  const [cats, setCats] = useState<Row[] | null>(null)
  const loadCats = async () =>
    setCats(await run<Row[]>(client().from('skill_categories').select('*').order('sort_order').order('name').order('id')))
  useEffect(() => { void loadCats().catch(() => setCats([])) }, [])

  return (
    <>
      <h1 className="ad-h1">Skills</h1>
      <p className="ad-muted">Filter and edit skills below. Open a skill to change its domains, primary domain, or related-skill links.</p>
      <details className="ad-domain-manager">
        <summary>Manage domains ({cats?.length ?? 0})</summary>
        <CrudTable
          title="Domains"
          table="skill_categories"
          note="Deleting a domain removes only its assignments. Its skills stay, and any skill left with no domain shows as “Uncategorized”."
          fields={[{ key: 'name', label: 'Name', required: true }, { key: 'sort_order', label: 'Order', type: 'number' }]}
          defaults={{ name: '', sort_order: 1 }}
          label={(row) => row.name}
          addLabel="Add a domain"
          deleteWarning="Skills in this domain are kept but lose this assignment."
          onChange={() => void loadCats()}
        />
      </details>
      {cats === null && <p className="ad-muted">Loading domains…</p>}
      {cats && <SkillsEditor key={cats.map((c) => c.id).sort().join('|')} domains={cats} />}
    </>
  )
}
