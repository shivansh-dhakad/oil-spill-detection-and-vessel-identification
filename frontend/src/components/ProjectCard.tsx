import type { ProjectItem } from '../data/portfolioData'
import { IconStar, IconGitHub, IconCode, IconExternal } from './Icons'

interface ProjectCardProps {
  project: ProjectItem
  isExpanded: boolean
  isMatchingSkill: boolean
  onToggleExpand: () => void
}

export default function ProjectCard({
  project,
  isExpanded,
  isMatchingSkill,
  onToggleExpand,
}: ProjectCardProps) {
  return (
    <article
      className={`project-card ${project.featured ? 'is-featured' : ''} ${
        isMatchingSkill ? 'matches-selected-skill' : ''
      } ${isExpanded ? 'is-expanded-card' : ''}`}
      aria-expanded={isExpanded}
    >
      {/* Visual Header / IDE Project Thumbnail */}
      <div className="card-media-wrapper" onClick={onToggleExpand}>
        <div className="card-mock-header" aria-hidden="true">
          <span className="dot dot-close" />
          <span className="dot dot-min" />
          <span className="dot dot-max" />
          <span className="mock-slug">{project.slug}.git</span>
        </div>

        <div className="card-preview-art">
          {project.coverImage ? (
            <img src={project.coverImage} alt={project.title} className="cover-img" loading="lazy" />
          ) : (
            <div className="abstract-grid-art" aria-hidden="true">
              <span className="art-line line-1" />
              <span className="art-line line-2" />
              <div className="art-center-box">
                <span className="box-code-prefix">&gt;</span>
                <span className="box-title">{project.title}</span>
              </div>
            </div>
          )}
        </div>

        {/* Badges Overlay */}
        <div className="card-badges-top">
          {project.featured && (
            <span className="badge-featured" title="Featured Project">
              <IconStar />
              <span>FEATURED</span>
            </span>
          )}
          <span className={`badge-status status-${project.status.toLowerCase()}`}>
            {project.status}
          </span>
        </div>
      </div>

      {/* Card Content Body */}
      <div className="card-content-body">
        <div className="card-category-row">
          <span className="category-tag">{project.category}</span>
          <span className="file-count-tag">
            {Object.keys(project.files).length} files
          </span>
        </div>

        <h3 className="project-title" onClick={onToggleExpand}>
          {project.title}
        </h3>

        <p className="project-tagline">{project.tagline}</p>

        {/* Technology Badges */}
        <div className="project-tech-badges" aria-label="Technologies used">
          {project.skills.map((skill) => (
            <span key={skill} className="tech-badge">
              {skill}
            </span>
          ))}
        </div>

        {/* Card Action Buttons */}
        <div className="card-footer-actions">
          <button
            type="button"
            className="btn-expand-editor"
            onClick={onToggleExpand}
            aria-controls={`editor-${project.slug}`}
            aria-expanded={isExpanded}
          >
            <IconCode />
            <span>{isExpanded ? 'Close Editor' : 'Open in Editor'}</span>
          </button>

          <div className="ext-links-group">
            {project.repoUrl && (
              <a
                href={project.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="icon-link-btn"
                title="View GitHub repository"
                aria-label={`${project.title} GitHub repository`}
              >
                <IconGitHub />
              </a>
            )}

            {project.demoUrl && (
              <a
                href={project.demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="icon-link-btn"
                title="Open live demonstration"
                aria-label={`${project.title} live demo`}
              >
                <IconExternal />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
