import { useState, useEffect, useRef } from 'react'
import { IconSearch } from './Icons'

const allTabs = [
  { label: 'profile', href: '#index' },
  { label: 'about', href: '#about' },
  { label: 'journey', href: '#journey' },
  { label: 'skills', href: '#skills' },
  { label: 'projects', href: '#projects' },
  { label: 'certificates', href: '#certifications' },
  { label: 'education', href: '#education' },
  { label: 'beyond', href: '#beyond-code' },
  { label: 'contact', href: '#contact' },
] as const

interface TopNavProps {
  onOpenCommandPalette: () => void
  showCertificates?: boolean
}

export default function TopNav({ onOpenCommandPalette, showCertificates = false }: TopNavProps) {
  const [activeSection, setActiveSection] = useState<string>('index')
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)

  const tabs = allTabs.filter((t) => showCertificates || t.href !== '#certifications')
  const activeLabel = tabs.find((t) => t.href === `#${activeSection}`)?.label ?? 'profile'

  useEffect(() => {
    const handleScroll = () => {
      const sections = [
        'contact', 'beyond-code', 'education', 'certifications', 'projects',
        'skills', 'journey', 'about', 'index',
      ]
      for (const id of sections) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveSection(id)
          break
        }
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Close the mobile menu on Escape or when tapping outside it
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        toggleRef.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [menuOpen])

  return (
    <header className="topnav" role="banner" ref={headerRef}>
      <a className="brand" href="#index" aria-label="Shivansh Dhakad, return to top">
        <span className="brand-dot" aria-hidden="true" />
        <span className="brand-text">sd</span>
      </a>

      {/* Mobile only: shows the current section and opens the menu */}
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-expanded={menuOpen}
        aria-controls="primary-nav"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span className={`nav-toggle-bars ${menuOpen ? 'open' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{menuOpen ? 'menu' : activeLabel}</span>
      </button>

      <nav
        id="primary-nav"
        aria-label="Main Portfolio Sections"
        className={`topnav-nav ${menuOpen ? 'open' : ''}`}
      >
        <ul className="topnav-tabs">
          {tabs.map((tab) => {
            const sectionId = tab.href.replace('#', '')
            const isActive = activeSection === sectionId
            return (
              <li key={tab.href}>
                <a
                  className={`topnav-tab-btn ${isActive ? 'active' : ''}`}
                  href={tab.href}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="tab-dot" aria-hidden="true" />
                  <span>{tab.label}</span>
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      <button
        type="button"
        className="cmd-palette-btn"
        onClick={onOpenCommandPalette}
        aria-label="Open command palette (Ctrl+K)"
        title="Open command palette (Ctrl+K)"
      >
        <IconSearch className="cmd-icon" />
        <span className="cmd-text">Search...</span>
        <kbd className="cmd-kbd">Ctrl K</kbd>
      </button>
    </header>
  )
}