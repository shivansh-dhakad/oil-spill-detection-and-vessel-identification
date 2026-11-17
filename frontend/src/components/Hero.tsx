import { PROFILE_DATA, type ProjectItem } from '../data/portfolioData'
import PhotoPixelDissolve from './PhotoPixelDissolve'
import HeroTerminal from './HeroTerminal'
import AmberParticles from './AmberParticles'
import { IconGitHub, IconLinkedIn } from './Icons'

interface HeroProps {
  profile: typeof PROFILE_DATA
  projects: ProjectItem[]
  skillDomains: string[]
}

export default function Hero({ profile, projects, skillDomains }: HeroProps) {
  const [first, ...rest] = profile.fullName.split(' ')

  const featured = projects.filter((p) => p.featured).length
  const repos = projects.filter((p) => p.repoUrl).length
  const stats = [
    { n: projects.length, label: projects.length === 1 ? 'project' : 'projects' },
    { n: featured, label: 'featured' },
    { n: repos, label: repos === 1 ? 'GitHub repo' : 'GitHub repos' },
  ]

  return (
    <section id="index" className="hero" aria-labelledby="hero-title">
      <AmberParticles />

      <div className="hero-grid">
        {/* Left Column: Photograph with pixel dissolve corner effect */}
        <div className="hero-photo-col">
          <PhotoPixelDissolve
            src={profile.photoUrl}
            alt="Shivansh Dhakad - AI and Machine Learning student developer"
          />
        </div>

        {/* Right Column: Prominent name, headline, terminal intro, actions */}
        <div className="hero-copy">
          <div className="hero-badge" aria-hidden="true">
            <span className="badge-dot" />
            <span>AI & ML DEVELOPER // LNCT BHOPAL</span>
          </div>

          <h1 id="hero-title" className="hero-name">
            <span className="name-first">{first}</span>{' '}
            <span className="name-rest">{rest.join(' ')}</span>
          </h1>

          <p className="headline">{profile.headline}</p>

          {projects.length > 0 && (
            <ul className="hero-stats" aria-label="Portfolio at a glance">
              {stats.map((st) => (
                <li key={st.label}>
                  <strong>{st.n}</strong> {st.label}
                </li>
              ))}
            </ul>
          )}

          <HeroTerminal intro={profile.intro} skillDomains={skillDomains} />

          <div className="actions">
            <a
              className="btn btn-primary"
              href={profile.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Shivansh Dhakad GitHub profile"
            >
              <IconGitHub />
              <span>GitHub</span>
            </a>

            <a
              className="btn btn-secondary"
              href={profile.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Shivansh Dhakad LinkedIn profile"
            >
              <IconLinkedIn />
              <span>LinkedIn</span>
            </a>

            {profile.resumeUrl ? (
              <a
                className="btn btn-secondary"
                href={profile.resumeUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Download Resume PDF"
              >
                <span>Resume (PDF)</span>
              </a>
            ) : (
              <span
                className="btn btn-disabled"
                title="Sanitized PDF (without phone number) being uploaded soon"
                aria-label="Resume coming soon"
              >
                <span className="btn-tag">COMING SOON</span>
                <span>Resume</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}