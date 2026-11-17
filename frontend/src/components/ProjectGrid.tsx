import { useState, useMemo, useEffect } from 'react'
import type { ProjectItem } from '../data/portfolioData'
import ProjectCard from './ProjectCard'
import ProjectEditorExpansion from './ProjectEditorExpansion'
import { IconFolder, IconStar, IconChevronDown } from './Icons'

// Matches the breakpoints of .projects-grid in components.css (3 / 2 / 1 columns)
const columnCount = () => {
  if (typeof window === 'undefined') return 3
  if (window.matchMedia('(min-width: 1040px)').matches) return 3
  if (window.matchMedia('(min-width: 640px)').matches) return 2
  return 1
}

function useColumns() {
  const [cols, setCols] = useState(columnCount)
  useEffect(() => {
    const onResize = () => setCols(columnCount())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return cols
}

interface ProjectGridProps {
  projects: ProjectItem[]
  selectedSkill: string | null
  onClearSkillFilter: () => void
}

export default function ProjectGrid({ projects, selectedSkill, onClearSkillFilter }: ProjectGridProps) {
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'All' | 'Featured'>('All')
  const [showAll, setShowAll] = useState(false)
  const cols = useColumns()

  const displayedProjects = useMemo(() => {
    let list = [...projects]
    if (activeTab === 'Featured') list = list.filter((p) => p.featured)
    return list.sort((a, b) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      return a.sortOrder - b.sortOrder
    })
  }, [projects, activeTab])

  // Collapsed = one row. While a skill is selected, show everything so every match is visible.
  const expanded = showAll || Boolean(selectedSkill)
  const visibleProjects = expanded ? displayedProjects : displayedProjects.slice(0, cols)
  const needsToggle = displayedProjects.length > cols && !selectedSkill

  // Lets the command palette open a project window
  useEffect(() => {
    const onOpen = (e: Event) => {
      const slug = (e as CustomEvent<string>).detail
      if (projects.some((p) => p.slug === slug)) setOpenSlug(slug)
    }
    window.addEventListener('portfolio:open-project', onOpen)
    return () => window.removeEventListener('portfolio:open-project', onOpen)
  }, [projects])

  const openProject = projects.find((p) => p.slug === openSlug) ?? null
  const featuredCount = projects.filter((p) => p.featured).length

  const toggleShowAll = () => {
    if (showAll) {
      setShowAll(false)
      document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setShowAll(true)
    }
  }

  return (
    <section id="projects" className="section-block" aria-labelledby="projects-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconFolder />
          <span>PROJECTS // IDE EXPLORER</span>
        </div>
        <h2 id="projects-heading" className="section-title">
          Projects
        </h2>
        <p className="section-desc">
          Featured work comes first. Click any card to open its full details in an IDE window.
        </p>
      </div>

      <div className="projects-toolbar">
        <div className="tab-pills" role="tablist" aria-label="Project filter">
          <button
            type="button" role="tab" aria-selected={activeTab === 'All'}
            className={`tab-pill ${activeTab === 'All' ? 'active' : ''}`}
            onClick={() => setActiveTab('All')}
          >
            All Projects ({projects.length})
          </button>
          <button
            type="button" role="tab" aria-selected={activeTab === 'Featured'}
            className={`tab-pill ${activeTab === 'Featured' ? 'active' : ''}`}
            onClick={() => setActiveTab('Featured')}
          >
            <IconStar />
            <span>Featured First ({featuredCount})</span>
          </button>
        </div>

        <div className="projects-toolbar-right">
          {selectedSkill && (
            <div className="active-skill-notice">
              <span>Filtered by: <strong>{selectedSkill}</strong></span>
              <button type="button" className="clear-pill" onClick={onClearSkillFilter} aria-label="Remove skill filter">
                Clear
              </button>
            </div>
          )}

          {needsToggle && (
            <button
              type="button"
              className="tab-pill view-all-pill"
              onClick={toggleShowAll}
              aria-expanded={showAll}
              aria-controls="projects-grid"
            >
              <span>{showAll ? 'Show less' : `View all (${displayedProjects.length})`}</span>
              <span className={`view-all-chevron ${showAll ? 'open' : ''}`} aria-hidden="true">
                <IconChevronDown />
              </span>
            </button>
          )}
        </div>
      </div>

      <div id="projects-grid" className="projects-grid" role="region" aria-label="Project collection">
        {visibleProjects.map((project) => {
          const isMatchingSkill = Boolean(
            selectedSkill && project.skills.some((s) => s.toLowerCase() === selectedSkill.toLowerCase()),
          )
          return (
            <div key={project.id} className="project-grid-item">
              <ProjectCard
                project={project}
                isExpanded={openSlug === project.slug}
                isMatchingSkill={isMatchingSkill}
                onToggleExpand={() => setOpenSlug(project.slug)}
              />
            </div>
          )
        })}
      </div>

      {openProject && (
        <ProjectEditorExpansion
          key={openProject.slug}
          project={openProject}
          onClose={() => setOpenSlug(null)}
        />
      )}
    </section>
  )
}