import { useState, useEffect } from 'react'
import { usePortfolioData } from './lib/usePortfolioData'
import ScrollProgress from './components/ScrollProgress'
import TopNav from './components/TopNav'
import CommandPalette from './components/CommandPalette'
import Hero from './components/Hero'
import AboutCodeIntro from './components/AboutCodeIntro'
import EducationSection from './components/EducationSection'
import LearningJourney from './components/LearningJourney'
import SkillConstellation from './components/SkillConstellation'
import ProjectGrid from './components/ProjectGrid'
import BeyondCodeSection from './components/BeyondCodeSection'
import ContactSection from './components/ContactSection'
import StateNotice from './components/StateNotice'
import CertificationsSection from './components/CertificationsSection'
import Reveal from './components/Reveal'
import { useEntries } from './lib/useEntries'
import { useInstagram } from './lib/useInstagram'

export default function App() {
  const { profile, projects, skills, education, beyondCode, status, errorMessage } = usePortfolioData()
  const entries = useEntries()
  const instagramUrl = useInstagram()
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const skillDomains = [...new Set(skills.flatMap((skill) => skill.domains))]
    .filter((domain) => domain.trim() && domain.trim().toLowerCase() !== 'uncategorized')

  // Global Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>

      <ScrollProgress />
      <TopNav onOpenCommandPalette={() => setPaletteOpen(true)} showCertificates={entries.length > 0} />

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectSkill={(skillName) => setSelectedSkill(skillName)}
        skills={skills}
      />

      <main id="main">
        {status === 'loading' && <StateNotice kind="loading" />}
        {status === 'error' && <StateNotice kind="error" message={errorMessage} />}

        {/* Hero: photo + intro + interactive zsh terminal */}
        <Hero profile={profile} projects={projects} skillDomains={skillDomains} />

        <div className="container">
          <Reveal>
            <AboutCodeIntro />
          </Reveal>
          <LearningJourney />

          <SkillConstellation
            skills={skills}
            projects={projects}
            selectedSkill={selectedSkill}
            onSelectSkill={(skill) => setSelectedSkill(skill)}
          />

          <Reveal>
            <ProjectGrid
              projects={projects}
              selectedSkill={selectedSkill}
              onClearSkillFilter={() => setSelectedSkill(null)}
            />
          </Reveal>

          <CertificationsSection entries={entries} />
          <EducationSection items={education} />
          <BeyondCodeSection instagramUrl={instagramUrl} items={beyondCode} />
          <ContactSection profile={profile} instagramUrl={instagramUrl} />
        </div>
      </main>

      <footer className="footer" role="contentinfo">
        <div className="footer-content">
          <div className="footer-meta">
            <span className="footer-title">Shivansh Dhakad</span>
            <span className="footer-dot">•</span>
            <span>B.Tech CSE (AI &amp; ML), LNCT Bhopal</span>
          </div>
          <div className="footer-tech-stack">
            <span className="tech-chip">React 19</span>
            <span className="tech-chip">Vite</span>
            <span className="tech-chip">TypeScript</span>
            <span className="tech-chip">Supabase</span>
            <span className="tech-chip">Netlify</span>
          </div>
          <p className="footer-copyright">
            Interactive IDE Portfolio &bull; All rights reserved &bull; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </>
  )
}