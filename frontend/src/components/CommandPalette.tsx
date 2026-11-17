import { useState, useEffect, useRef, useMemo } from 'react'
import {
  IconSearch,
  IconClose,
  IconCode,
  IconFolder,
  IconTerminal,
  IconGitHub,
  IconLinkedIn,
  IconMusic,
  IconStar,
} from './Icons'
import { PROJECTS_DATA, type SkillItem } from '../data/portfolioData'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onSelectSkill: (skill: string) => void
  skills: SkillItem[]
}

interface PaletteAction {
  id: string
  title: string
  subtitle: string
  category: 'Sections' | 'Projects' | 'Skills' | 'Links'
  icon: typeof IconCode
  action: () => void
}

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectSkill,
  skills,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const actions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [
      // Section Jumps
      {
        id: 'sec-hero',
        title: 'Home // Hero',
        subtitle: 'Profile photograph, headline & introduction',
        category: 'Sections',
        icon: IconTerminal,
        action: () => document.getElementById('index')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-about',
        title: 'About // about.py',
        subtitle: 'Animated code-first introduction',
        category: 'Sections',
        icon: IconCode,
        action: () => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-education',
        title: 'Education // Academic Record',
        subtitle: 'College (LNCT Bhopal) & School Education',
        category: 'Sections',
        icon: IconTerminal,
        action: () => document.getElementById('education')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-journey',
        title: 'Journey // Learning Highway',
        subtitle: 'From Basic Languages to Data, ML, DL, GenAI & Agentic AI',
        category: 'Sections',
        icon: IconTerminal,
        action: () => document.getElementById('journey')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-skills',
        title: 'Skills // Constellation',
        subtitle: 'Interactive connected skill graph and tree',
        category: 'Sections',
        icon: IconTerminal,
        action: () => document.getElementById('skills')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-projects',
        title: 'Projects // In-Place Editor',
        subtitle: '9 machine learning & AI systems',
        category: 'Sections',
        icon: IconFolder,
        action: () => document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-terminal',
        title: 'Terminal // Hero Shell',
        subtitle: 'Run commands in the hero terminal',
        category: 'Sections',
        icon: IconTerminal,
        action: () => {
          document.getElementById('index')?.scrollIntoView({ behavior: 'smooth' })
          window.setTimeout(() => window.dispatchEvent(new Event('portfolio:focus-terminal')), 450)
        },
      },
      {
        id: 'sec-beyond',
        title: 'Beyond Code // Interests',
        subtitle: 'Bansuri flute playing & long-distance bike riding',
        category: 'Sections',
        icon: IconMusic,
        action: () => document.getElementById('beyond-code')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'sec-contact',
        title: 'Contact // Message Form',
        subtitle: 'Direct email messaging & social links',
        category: 'Sections',
        icon: IconTerminal,
        action: () => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }),
      },
    ]

    // All 9 Projects
    PROJECTS_DATA.forEach((p) => {
      list.push({
        id: `proj-${p.slug}`,
        title: p.title,
        subtitle: `${p.featured ? '★ Featured • ' : ''}${p.category}`,
        category: 'Projects',
        icon: p.featured ? IconStar : IconFolder,
        action: () => {
          document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' })
          window.dispatchEvent(new CustomEvent('portfolio:open-project', { detail: p.slug }))
        },
      })
    })

    // Skills from the database
    skills.forEach((s) => {
      list.push({
        id: `skill-${s.id}`,
        title: `Filter by ${s.name}`,
        subtitle: s.domains.join(' · '),
        category: 'Skills',
        icon: IconCode,
        action: () => {
          onSelectSkill(s.name)
          document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' })
        },
      })
    })

    // External links
    list.push({
      id: 'link-github',
      title: 'GitHub Profile',
      subtitle: 'https://github.com/shivansh-dhakad',
      category: 'Links',
      icon: IconGitHub,
      action: () => window.open('https://github.com/shivansh-dhakad', '_blank'),
    })
    list.push({
      id: 'link-linkedin',
      title: 'LinkedIn Profile',
      subtitle: 'https://linkedin.com/in/shivansh-dhakad-007679294',
      category: 'Links',
      icon: IconLinkedIn,
      action: () => window.open('https://linkedin.com/in/shivansh-dhakad-007679294', '_blank'),
    })

    return list
  }, [onSelectSkill, skills])

  // Filter actions by query
  const filteredActions = useMemo(() => {
    if (!query.trim()) return actions
    const q = query.toLowerCase()
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    )
  }, [actions, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
    }
  }, [isOpen])

  // Key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredActions.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev <= 0 ? filteredActions.length - 1 : prev - 1
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = filteredActions[selectedIndex]
      if (target) {
        target.action()
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="palette-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="palette-input-wrapper">
          <IconSearch className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Type a command, section, project, or skill..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search portfolio"
          />
          <button
            type="button"
            className="palette-close-btn"
            onClick={onClose}
            aria-label="Close command palette"
          >
            <IconClose />
          </button>
        </div>

        <div className="palette-results-list" ref={listRef} role="listbox">
          {filteredActions.length === 0 ? (
            <div className="palette-empty">No results found for "{query}"</div>
          ) : (
            filteredActions.map((item, index) => {
              const IconComp = item.icon
              const isSelected = index === selectedIndex
              return (
                <div
                  key={item.id}
                  className={`palette-item ${isSelected ? 'selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    item.action()
                    onClose()
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="palette-item-icon">
                    <IconComp />
                  </div>
                  <div className="palette-item-text">
                    <div className="palette-item-title">{item.title}</div>
                    <div className="palette-item-subtitle">{item.subtitle}</div>
                  </div>
                  <span className="palette-category-badge">{item.category}</span>
                </div>
              )
            })
          )}
        </div>

        <div className="palette-footer" aria-hidden="true">
          <div className="footer-shortcut">
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
          </div>
          <div className="footer-shortcut">
            <kbd>↵</kbd> Select
          </div>
          <div className="footer-shortcut">
            <kbd>Esc</kbd> Close
          </div>
        </div>
      </div>
    </div>
  )
}