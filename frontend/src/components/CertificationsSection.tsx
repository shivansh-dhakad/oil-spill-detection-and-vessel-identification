import { useEffect, useState } from 'react'
import type { EntryItem } from '../lib/useEntries'
import { IconTerminal, IconExternal, IconChevronDown } from './Icons'
import '../styles/certificates.css'

// Matches the .cert-grid breakpoints in overrides.css (3 / 2 / 1 columns)
const columnCount = () => {
  if (typeof window === 'undefined') return 3
  if (window.matchMedia('(min-width: 1040px)').matches) return 3
  if (window.matchMedia('(min-width: 700px)').matches) return 2
  return 1
}

// Hidden completely until at least one certification or achievement exists.
// Shows one row; the rest sit behind "View all".
export default function CertificationsSection({ entries }: { entries: EntryItem[] }) {
  const [cols, setCols] = useState(columnCount)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const onResize = () => setCols(columnCount())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (entries.length === 0) return null

  const visible = showAll ? entries : entries.slice(0, cols)
  const needsToggle = entries.length > cols

  const toggle = () => {
    if (showAll) {
      setShowAll(false)
      document.getElementById('certifications')?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setShowAll(true)
    }
  }

  return (
    <section id="certifications" className="section-block" aria-labelledby="certs-heading">
      <div
        className="section-header"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-2)' }}
      >
        <div>
          <div className="section-tag">
            <IconTerminal />
            <span>CERTIFICATES</span>
          </div>
          <h2 id="certs-heading" className="section-title">
            Certifications &amp; achievements
          </h2>
          <p className="section-desc">Courses I have completed and milestones I have reached.</p>
        </div>

        {needsToggle && (
          <button
            type="button"
            className="tab-pill view-all-pill"
            onClick={toggle}
            aria-expanded={showAll}
            aria-controls="cert-grid"
          >
            <span>{showAll ? 'Show less' : `View all (${entries.length})`}</span>
            <span className={`view-all-chevron ${showAll ? 'open' : ''}`} aria-hidden="true">
              <IconChevronDown />
            </span>
          </button>
        )}
      </div>

      <div id="cert-grid" className="cert-grid">
        {visible.map((e) => (
          <article key={e.id} className="cert-card">
            {e.fileType === 'image' && e.fileUrl ? (
              <a className="cert-thumb" href={e.fileUrl} target="_blank" rel="noopener noreferrer">
                <img src={e.fileUrl} alt={`${e.title} certificate`} loading="lazy" decoding="async" />
              </a>
            ) : (
              <div className="cert-thumb cert-thumb-empty" aria-hidden="true">
                {e.fileType === 'pdf' ? 'PDF certificate' : 'No image'}
              </div>
            )}
            <span className="cert-kind">{e.kind === 'certification' ? 'Certification' : 'Achievement'}</span>
            <h3 className="cert-title">{e.title}</h3>
            {(e.issuer || e.dateLabel) && (
              <p className="cert-meta">
                {e.issuer && <span>{e.issuer}</span>}
                {e.dateLabel && <span>{e.dateLabel}</span>}
              </p>
            )}
            {e.description && <p className="cert-desc">{e.description}</p>}

            {(e.fileUrl || e.url) && (
              <div className="cert-links">
                {e.fileUrl && (
                  <a className="btn btn-secondary btn-sm" href={e.fileUrl} target="_blank" rel="noopener noreferrer">
                    <IconExternal />
                    <span>{e.fileType === 'pdf' ? 'View certificate (PDF)' : 'View full size'}</span>
                  </a>
                )}
                {e.url && (
                  <a className="btn btn-secondary btn-sm" href={e.url} target="_blank" rel="noopener noreferrer">
                    <IconExternal />
                    <span>Verify credential</span>
                  </a>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}