import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ProjectItem } from '../data/portfolioData'
import {
  IconClose,
  IconGitHub,
  IconExternal,
  IconStar,
  IconCheck,
  IconFileMd,
  IconFileJson,
  IconFolder,
} from './Icons'

interface Props {
  project: ProjectItem
  onClose: () => void
}

const splitFeat = (f: string) => {
  const i = f.indexOf(':')
  return i < 0 ? { title: f, desc: '' } : { title: f.slice(0, i).trim(), desc: f.slice(i + 1).trim() }
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="pw-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function CodeBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="pw-code" role="region" aria-label={label} tabIndex={0}>
      {text.split('\n').map((line, i) => (
        <div className="pw-code-row" key={i}>
          <span className="pw-ln" aria-hidden="true">{i + 1}</span>
          <span className="pw-lc">{line || '\u00a0'}</span>
        </div>
      ))}
    </div>
  )
}

export default function ProjectEditorExpansion({ project, onClose }: Props) {
  const [active, setActive] = useState('overview.md')
  const [closing, setClosing] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const winRef = useRef<HTMLDivElement | null>(null)

  const links = useMemo(() => {
    const list: { label: string; url: string }[] = []
    if (project.repoUrl) list.push({ label: 'GitHub repository', url: project.repoUrl })
    if (project.demoUrl) list.push({ label: 'Live demo', url: project.demoUrl })
    if (project.docsUrl) list.push({ label: 'Documentation', url: project.docsUrl })
    project.extraLinks?.forEach((l) => list.push(l))
    return list
  }, [project])

  // Only files that have real content are shown
  const files = useMemo(() => {
    const f: { name: string; kind: 'md' | 'json' }[] = [{ name: 'overview.md', kind: 'md' }]
    if (project.problem) f.push({ name: 'problem.md', kind: 'md' })
    if (project.solution) f.push({ name: 'solution.md', kind: 'md' })
    if (project.architectureDiagram) f.push({ name: 'architecture.md', kind: 'md' })
    if (project.mainFeatures.length) f.push({ name: 'features.md', kind: 'md' })
    if (Object.values(project.techStackGrouped).some((a) => a.length)) f.push({ name: 'tech-stack.json', kind: 'json' })
    if (project.challengesSolved.length) f.push({ name: 'challenges.md', kind: 'md' })
    if (project.results || project.metrics?.length) f.push({ name: 'results.md', kind: 'md' })
    if (project.changelog) f.push({ name: 'changelog.md', kind: 'md' })
    if (links.length) f.push({ name: 'links.md', kind: 'md' })
    return f
  }, [project, links])

  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, 160)
  }, [closing, onClose])

  // scroll lock + focus management
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      prev?.focus?.()
    }
  }, [])

  // Esc + focus trap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key === 'Tab' && winRef.current) {
        const f = Array.from(
          winRef.current.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),select,[tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null)
        if (!f.length) return
        const first = f[0]
        const lastEl = f[f.length - 1]
        const cur = document.activeElement
        if (e.shiftKey && cur === first) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && cur === lastEl) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [requestClose])

  const tech = project.techStackGrouped
  const techEntries: { label: string; cls: string; items: string[] }[] = [
    { label: 'Languages', cls: 'lang', items: tech.languages },
    { label: 'AI & Frameworks', cls: 'framework', items: tech.frameworks },
    { label: 'Backend & Processing', cls: 'backend', items: tech.backend },
    { label: 'Tools & Libraries', cls: 'tools', items: tech.tools },
  ]

  const renderPane = () => {
    switch (active) {
      case 'problem.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>The problem</h3>
            <MarkdownBlock text={project.problem ?? ''} />
          </>
        )
      case 'solution.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>The solution</h3>
            <MarkdownBlock text={project.solution ?? ''} />
          </>
        )
      case 'results.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Results</h3>
            {project.results && <MarkdownBlock text={project.results} />}
            {!!project.metrics?.length && (
              <div className="pw-cards">
                {project.metrics.map((m, i) => (
                  <div className="pw-card" key={i}>
                    <small>{m.name}</small>
                    <strong>{m.value}</strong>
                    {m.description && <p>{m.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )
      case 'changelog.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Development journey</h3>
            <MarkdownBlock text={project.changelog ?? ''} />
          </>
        )
      case 'features.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Key system capabilities</h3>
            <div className="pw-cards">
              {project.mainFeatures.map((feat, i) => {
                const { title, desc } = splitFeat(feat)
                return (
                  <div className="pw-card" key={i}>
                    <small>0{i + 1}</small>
                    <strong>{title}</strong>
                    {desc && <p>{desc}</p>}
                  </div>
                )
              })}
            </div>
          </>
        )
      case 'architecture.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Architecture &amp; data pipeline</h3>
            <CodeBlock text={project.architectureDiagram ?? ''} label="Architecture diagram" />
          </>
        )
      case 'tech-stack.json':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Technology stack</h3>
            <div className="pw-sec pw-groups">
              {techEntries.map((g) => (
                <div key={g.label}>
                  <span className="pw-group-label">{g.label}</span>
                  <div className="pills-row">
                    {g.items.map((t) => (
                      <span key={t} className={`tech-chip ${g.cls}`}>{t}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock text={JSON.stringify(tech, null, 2)} label="tech-stack.json" />
          </>
        )
      case 'challenges.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Challenges &amp; solutions</h3>
            {project.challengesSolved.map((c, i) => (
              <div className="pw-challenge" key={i}>
                <div><span className="lbl bad">CHALLENGE</span><strong>{c.challenge}</strong></div>
                <p><span className="lbl good">SOLUTION</span>{c.solution}</p>
              </div>
            ))}
          </>
        )
      case 'links.md':
        return (
          <>
            <h3 className="pw-h"><span>#</span>Links</h3>
            {links.map((l) => (
              <a key={l.url} className="pw-link-row" href={l.url} target="_blank" rel="noopener noreferrer">
                <IconExternal />
                <strong>{l.label}</strong>
                <span>{l.url}</span>
              </a>
            ))}
          </>
        )
      default:
        return (
          <>
            <div className="pw-hero">
              <div className="pw-pills">
                <span className="pw-pill accent">{project.category}</span>
                <span className="pw-pill">{project.status}</span>
                {project.featured && (
                  <span className="pw-pill accent"><IconStar /> Featured</span>
                )}
              </div>
              <h2 className="pw-title">{project.title}</h2>
              <p className="pw-tagline">{project.tagline}</p>
            </div>

            {!!project.images?.length && (
              <div className="pw-shots">
                {project.images.map((im) => (
                  <img key={im.url} src={im.url} alt={im.alt} loading="lazy" decoding="async" />
                ))}
              </div>
            )}

            {project.whatItIs && (
              <section className="pw-sec">
                <h3 className="pw-h"><span>01</span>What it is &amp; the problem it solves</h3>
                <p className="pw-p">{project.whatItIs}</p>
              </section>
            )}

            {project.whatIDeveloped.length > 0 && (
              <section className="pw-sec">
                <h3 className="pw-h"><span>02</span>What I developed</h3>
                <ul className="pw-list">
                  {project.whatIDeveloped.map((p, i) => (
                    <li key={i}><IconCheck /><span>{p}</span></li>
                  ))}
                </ul>
              </section>
            )}

            {project.mainFeatures.length > 0 && (
              <section className="pw-sec">
                <h3 className="pw-h"><span>03</span>Main features</h3>
                <div className="pw-cards">
                  {project.mainFeatures.map((feat, i) => {
                    const { title, desc } = splitFeat(feat)
                    return (
                      <div className="pw-card" key={i}>
                        <small>0{i + 1}</small>
                        <strong>{title}</strong>
                        {desc && <p>{desc}</p>}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {techEntries.some((g) => g.items.length) && (
            <section className="pw-sec">
              <h3 className="pw-h"><span>04</span>Technology stack</h3>
              <div className="pw-groups">
                {techEntries.filter((g) => g.items.length).map((g) => (
                  <div key={g.label}>
                    <span className="pw-group-label">{g.label}</span>
                    <div className="pills-row">
                      {g.items.map((t) => (
                        <span key={t} className={`tech-chip ${g.cls}`}>{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            )}

            {links.length > 0 && (
              <section className="pw-sec">
                <h3 className="pw-h"><span>05</span>Links</h3>
                {links.map((l) => (
                  <a key={l.url} className="pw-link-row" href={l.url} target="_blank" rel="noopener noreferrer">
                    <IconExternal />
                    <strong>{l.label}</strong>
                    <span>{l.url}</span>
                  </a>
                ))}
              </section>
            )}
          </>
        )
    }
  }

  return createPortal(
    <div
      className={`pw-backdrop ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={winRef}
        className="pw-window"
        role="dialog"
        aria-modal="true"
        aria-label={`${project.title} project details`}
      >
        <div className="pw-top">
          <div className="pw-top-left">
            <div className="pw-dots" aria-hidden="true">
              <span className="dot dot-close" onClick={requestClose} />
              <span className="dot dot-min" />
              <span className="dot dot-max" />
            </div>
            <div className="pw-crumbs">
              <span className="hide-sm">projects /</span>
              <b>{project.slug}</b>
              <span>/</span>
              <em>{active}</em>
            </div>
          </div>
          <div className="pw-top-right">
            {project.repoUrl && (
              <a className="pw-btn" href={project.repoUrl} target="_blank" rel="noopener noreferrer">
                <IconGitHub /><span className="lbl-txt">GitHub</span>
              </a>
            )}
            {project.demoUrl && (
              <a className="pw-btn" href={project.demoUrl} target="_blank" rel="noopener noreferrer">
                <IconExternal /><span className="lbl-txt">Live Demo</span>
              </a>
            )}
            <button ref={closeRef} type="button" className="pw-btn pw-close" onClick={requestClose} aria-label="Close project window (Esc)">
              <IconClose />
            </button>
          </div>
        </div>

        <div className="pw-body">
          <aside className="pw-side" aria-label="Project files">
            <div className="pw-side-h">EXPLORER</div>
            <div className="pw-folder"><IconFolder /> {project.slug}/</div>
            {files.map((f) => (
              <button
                key={f.name}
                type="button"
                className={`pw-file ${active === f.name ? 'active' : ''}`}
                aria-current={active === f.name ? 'true' : undefined}
                onClick={() => setActive(f.name)}
              >
                {f.kind === 'json' ? <IconFileJson /> : <IconFileMd />}
                <span>{f.name}</span>
              </button>
            ))}
            <div className="pw-side-meta">
              <div><strong>{project.category}</strong></div>
              <div>status: {project.status}</div>
              <div>{project.skills.length} technologies</div>
            </div>
          </aside>

          <div className="pw-main">
            <div className="pw-tabs">
              <div className="pw-tab">
                {files.find((f) => f.name === active)?.kind === 'json' ? <IconFileJson /> : <IconFileMd />}
                <span>{active}</span>
              </div>
              <select
                className="pw-select"
                value={active}
                onChange={(e) => setActive(e.target.value)}
                aria-label="Select project file"
              >
                {files.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            </div>
            <div className="pw-pane" key={active}>
              {renderPane()}
            </div>
          </div>
        </div>

        <div className="pw-status" aria-hidden="true">
          <span>git:(main) • {project.slug} • {files.length} files</span>
          <span>Esc or click outside to close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}