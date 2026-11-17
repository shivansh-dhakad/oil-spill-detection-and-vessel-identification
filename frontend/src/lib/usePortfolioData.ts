import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import {
  PROFILE_DATA,
  EDUCATION_DATA,
  PROJECTS_DATA,
  BEYOND_CODE_DATA,
  LEARNING_JOURNEY_DATA,
  type ProjectItem,
  type SkillItem,
  type EducationItem,
  type BeyondCodeItem,
  type JourneyDestination,
} from '../data/portfolioData'

export type DataStatus = 'loading' | 'ready' | 'error'

export interface PortfolioState {
  profile: typeof PROFILE_DATA
  education: EducationItem[]
  skills: SkillItem[]
  projects: ProjectItem[]
  journey: JourneyDestination[]
  beyondCode: BeyondCodeItem[]
  status: DataStatus
  errorMessage?: string
}

const STATUS: Record<string, ProjectItem['status']> = { live: 'Live', completed: 'Completed', researching: 'Research' }
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const strs = (v: unknown) => arr<unknown>(v).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v : '')

export function usePortfolioData(): PortfolioState {
  const [state, setState] = useState<PortfolioState>({
    profile: PROFILE_DATA,
    education: EDUCATION_DATA,
    skills: [],
    projects: PROJECTS_DATA,
    journey: LEARNING_JOURNEY_DATA,
    beyondCode: BEYOND_CODE_DATA,
    status: supabase ? 'loading' : 'ready',
  })

  useEffect(() => {
    if (!supabase) return

    let cancelled = false
    const db = supabase

    async function fetchData() {
      try {
        const [profileRes, socialRes, projectsRes, skillsRes, catRes, skillDomainsRes, skillLinksRes, projectSkillsRes, mediaRes, eduRes, beyondRes] =
          await Promise.all([
            db.from('profile').select('*').eq('id', 1).maybeSingle(),
            db.from('social_links').select('*').eq('visible', true).order('sort_order'),
            db.from('projects').select('*').eq('state', 'published').order('sort_order'),
            db.from('skills').select('*').order('sort_order'),
            db.from('skill_categories').select('*').order('sort_order').order('name').order('id'),
            db.from('skill_domains').select('*'),
            db.from('skill_links').select('*'),
            db.from('project_skills').select('*'),
            db.from('project_media').select('*').order('sort_order'),
            db.from('education').select('*').eq('visible', true).order('sort_order'),
            db.from('beyond_code_items').select('*').eq('visible', true).order('sort_order'),
          ])

        if (cancelled) return
        const pub = (bucket: string, path?: string | null) =>
          path ? db.storage.from(bucket).getPublicUrl(path).data.publicUrl : null

        // Projects: the database is authoritative (drafts/archived never arrive: RLS). Until a project has been
        // saved once in the dashboard (content_managed), empty fields are filled from the built-in resume content.
        let liveProjects = PROJECTS_DATA
        if (!projectsRes.error && projectsRes.data) {
          liveProjects = projectsRes.data.map((p): ProjectItem => {
            const fb = p.content_managed ? undefined : PROJECTS_DATA.find((item) => item.slug === p.slug)
            const prefer = <T,>(fromDb: T[], fallback?: T[]) => (fromDb.length || !fb ? fromDb : (fallback ?? fromDb))

            const skillNames = (projectSkillsRes.data || [])
              .filter((ps) => ps.project_id === p.id)
              .map((ps) => skillsRes.data?.find((s) => s.id === ps.skill_id)?.name as string | undefined)
              .filter((n): n is string => Boolean(n))

            const ts = (p.tech_stack ?? {}) as Record<string, unknown>
            const dbStack = {
              languages: strs(ts.languages),
              frameworks: strs(ts.frameworks),
              backend: strs(ts.backend),
              tools: strs(ts.tools),
            }
            const stack = Object.values(dbStack).some((a) => a.length) || !fb ? dbStack : fb.techStackGrouped
            const overview = txt(p.overview)

            return {
              id: p.id,
              slug: p.slug,
              title: p.title,
              tagline: txt(p.tagline) || fb?.tagline || '',
              featured: Boolean(p.featured),
              sortOrder: p.sort_order ?? 99,
              status: STATUS[p.status as string] ?? fb?.status ?? 'Completed',
              category: txt(p.category) || fb?.category || '',
              repoUrl: p.repo_url || fb?.repoUrl || null,
              demoUrl: p.demo_url || fb?.demoUrl || null,
              docsUrl: p.docs_url || fb?.docsUrl || null,
              coverImage: pub('media', p.cover_path) ?? fb?.coverImage,
              skills: prefer(skillNames, fb?.skills),
              whatItIs: overview || fb?.whatItIs || '',
              whatIDeveloped: prefer(strs(p.developed), fb?.whatIDeveloped),
              mainFeatures: prefer(strs(p.features), fb?.mainFeatures),
              architectureDiagram: txt(p.architecture) || fb?.architectureDiagram,
              challengesSolved: prefer(
                arr<{ challenge?: string; solution?: string }>(p.challenges_list)
                  .filter((c) => c.challenge || c.solution)
                  .map((c) => ({ challenge: c.challenge ?? '', solution: c.solution ?? '' })),
                fb?.challengesSolved,
              ),
              techStackGrouped: stack,
              files: fb?.files ?? {
                'overview.md': { name: 'overview.md', language: 'markdown', content: overview || `# ${p.title}` },
              },
              problem: txt(p.problem),
              solution: txt(p.solution),
              results: txt(p.results),
              changelog: txt(p.changelog_md),
              metrics: arr<{ name?: string; value?: string; description?: string }>(p.metrics)
                .filter((m) => m.name && m.value)
                .map((m) => ({ name: m.name as string, value: m.value as string, description: m.description })),
              images: (mediaRes.data || [])
                .filter((m) => m.project_id === p.id)
                .map((m) => ({ url: pub('media', m.path) as string, alt: (m.alt as string) || `${p.title} screenshot` })),
              extraLinks: arr<{ label?: string; url?: string }>(p.links)
                .filter((l) => l.label && l.url)
                .map((l) => ({ label: l.label as string, url: l.url as string })),
            }
          })
          liveProjects.sort((a, b) => {
            if (a.featured && !b.featured) return -1
            if (!a.featured && b.featured) return 1
            return a.sortOrder - b.sortOrder
          })
        }

        // Live Profile
        let liveProfile = PROFILE_DATA
        if (profileRes.data) {
          const p = profileRes.data
          const findSocial = (label: string) =>
            socialRes.data?.find((s) => s.label.toLowerCase() === label.toLowerCase())?.url
          liveProfile = {
            ...PROFILE_DATA,
            fullName: p.full_name || PROFILE_DATA.fullName,
            headline: p.headline || PROFILE_DATA.headline,
            intro: p.intro || PROFILE_DATA.intro,
            bio: p.bio || PROFILE_DATA.bio,
            email: p.email || PROFILE_DATA.email,
            photoUrl: pub('media', p.photo_path) || PROFILE_DATA.photoUrl,
            githubUrl: findSocial('github') || PROFILE_DATA.githubUrl,
            linkedinUrl: findSocial('linkedin') || PROFILE_DATA.linkedinUrl,
            resumeUrl: pub('resume', p.resume_path),
          }
        }

        if (skillLinksRes.error) {
          console.warn('Skill links are unavailable. Apply supabase/migration_skill_links.sql to enable admin-managed links.', skillLinksRes.error)
        }
        const skillsError = skillsRes.error ?? catRes.error ?? skillDomainsRes.error
        // Skills <-> domains is many-to-many (skill_domains). Domains keep the admin's order.
        const liveSkills: SkillItem[] = (() => {
          if (skillsError || !skillsRes.data || !catRes.data || !skillDomainsRes.data) return []
          const cats = catRes.data
          const rank = new Map<string, number>(cats.map((c, i) => [c.id as string, i]))
          const catName = new Map<string, string>(cats.map((c) => [c.id as string, c.name as string]))
          const skillName = new Map<string, string>(skillsRes.data.map((s) => [s.id as string, s.name as string]))
          const bySkill = new Map<string, string[]>()
          const relatedBySkill = new Map<string, string[]>()
          for (const l of skillDomainsRes.data) {
            if (!catName.has(l.category_id)) continue
            bySkill.set(l.skill_id, [...(bySkill.get(l.skill_id) ?? []), l.category_id])
          }
          for (const link of skillLinksRes.data ?? []) {
            const a = String(link.skill_a_id)
            const b = String(link.skill_b_id)
            if (!skillName.has(a) || !skillName.has(b)) continue
            relatedBySkill.set(a, [...(relatedBySkill.get(a) ?? []), skillName.get(b) as string])
            relatedBySkill.set(b, [...(relatedBySkill.get(b) ?? []), skillName.get(a) as string])
          }
          return skillsRes.data.map((s) => {
            const ids = (bySkill.get(s.id) ?? []).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
            const storedPrimary = s.primary_domain_id == null ? null : String(s.primary_domain_id)
            const primaryId = storedPrimary && ids.includes(storedPrimary) ? storedPrimary : ids[0]
            return {
              id: s.id as string,
              name: s.name as string,
              domains: ids.length ? ids.map((id) => catName.get(id) as string) : ['Uncategorized'],
              primaryDomain: primaryId ? catName.get(primaryId) as string : undefined,
              relatedSkills: relatedBySkill.get(s.id as string) ?? [],
            }
          })
        })()

        // Education: database rows (College / School). Keeps the built-in record if the query fails.
        const liveEdu: EducationItem[] =
          eduRes.error || !eduRes.data
            ? EDUCATION_DATA
            : eduRes.data.map((e) => ({
                id: e.id,
                type: e.level === 'school' ? 'school' : 'college',
                institute: e.institute,
                degree: e.degree ?? '',
                duration: [e.start_year, e.end_year].filter(Boolean).join(' – '),
                completionYear: e.end_year ? String(e.end_year) : '',
              }))

        const liveBeyondCode: BeyondCodeItem[] =
          beyondRes.error || !beyondRes.data
              ? BEYOND_CODE_DATA
              : beyondRes.data.map((item): BeyondCodeItem => ({
                  id: item.id,
                  title: item.title,
                  category: item.category,
                  description: item.description,
                  placeholderType: item.placeholder_type === 'photo' ? 'photo' : 'audio',
                }))

        setState({
          profile: liveProfile,
          education: liveEdu,
          skills: liveSkills,
          projects: liveProjects,
          journey: LEARNING_JOURNEY_DATA,
          beyondCode: liveBeyondCode,
          status: skillsError ? 'error' : 'ready',
          errorMessage: skillsError ? `Could not load skills from Supabase: ${skillsError.message}` : undefined,
        })
      } catch (err: unknown) {
        if (cancelled) return
        console.warn('Supabase fetch failed:', err)
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Database offline',
        }))
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}