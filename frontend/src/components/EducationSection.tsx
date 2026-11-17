import type { EducationItem } from '../data/portfolioData'
import { IconTerminal } from './Icons'

export default function EducationSection({ items }: { items: EducationItem[] }) {
  if (items.length === 0) return null
  return (
    <section id="education" className="section-block" aria-labelledby="education-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconTerminal />
          <span>EDUCATION // ACADEMIC RECORD</span>
        </div>
        <h2 id="education-heading" className="section-title">
          Academic Background
        </h2>
        <p className="section-desc">
          Formal academic institutions, fields of study, and years of completion.
        </p>
      </div>

      <div className="education-minimal-grid">
        {items.map((item) => (
          <div key={item.id} className="education-minimal-card">
            <div className="edu-type-badge">
              {item.type === 'college' ? 'COLLEGE EDUCATION' : 'SCHOOL EDUCATION'}
            </div>

            <h3 className="edu-institute-name">{item.institute}</h3>
            <p className="edu-degree-text">{item.degree}</p>

            <div className="edu-meta-row">
              <span className="edu-meta-label">Duration:</span>
              <span className="edu-meta-value">{item.duration}</span>
              <span className="edu-meta-sep">•</span>
              <span className="edu-meta-label">Completion:</span>
              <span className="edu-meta-value highlight">{item.completionYear}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
