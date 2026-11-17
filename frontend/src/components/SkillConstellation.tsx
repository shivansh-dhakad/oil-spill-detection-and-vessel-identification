import { useState, useMemo, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react'
import {
  SKILL_DOMAINS,
  type SkillItem,
  type SkillDomain,
  type ProjectItem,
} from '../data/portfolioData'
import { IconTerminal, IconClose, IconSearch, IconChevronDown } from './Icons'
import '../styles/skills.css'

interface SkillConstellationProps {
  skills: SkillItem[]
  projects: ProjectItem[]
  selectedSkill: string | null
  onSelectSkill: (skill: string | null) => void
}

interface GNode {
  id: string
  name: string
  domains: SkillDomain[] // hubs: [own name]; skills: every domain they belong to
  color: string
  x: number
  y: number
  r: number
  w: number // pill width (hubs only)
  hw: number // half width / half height used for collision
  hh: number
  ox: number // outward direction, used to place the label away from the graph
  oy: number
  isHub: boolean
  count: number
}
interface GEdge {
  source: string
  target: string
  color: string
  kind: 'domain' | 'related'
  weight: number
}
interface LabelPosition {
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
}
interface LabelBox {
  left: number
  right: number
  top: number
  bottom: number
}
type Box = [number, number, number, number]

const DEG = Math.PI / 180
const NARROW = '(max-width: 760px)'

const DOMAIN_COLOR: Record<string, string> = {
  'Languages & Core': '#38bdf8',
  'Data Analysis': '#10b981',
  'Machine Learning': '#a855f7',
  'Deep Learning': '#f59e0b',
  'Generative AI': '#06b6d4',
  'Agentic AI & Backend': '#ec4899',
}
// Colours for domains created in the admin dashboard
const PALETTE = ['#f472b6', '#facc15', '#34d399', '#fb7185', '#818cf8', '#2dd4bf', '#fb923c', '#a3e635', '#e879f9', '#22d3ee']

function normalizeDomain(d: string): SkillDomain {
  return d.trim() || 'Uncategorized'
}

const hubWidth = (name: string) => Math.round(name.length * 7.3 + 32)

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

// Eases the SVG viewBox toward its target so zooming into a domain feels smooth.
function useTween(target: Box): Box {
  const [value, setValue] = useState<Box>(target)
  const current = useRef<Box>(target)
  const key = target.map((n) => Math.round(n)).join(',')
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      current.current = target
      setValue(target)
      return
    }
    const from = current.current
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 380)
      const e = 1 - Math.pow(1 - k, 3)
      const next = from.map((f, i) => f + (target[i] - f) * e) as Box
      current.current = next
      setValue(next)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value
}

// Pushes overlapping nodes apart (hubs stay fixed) while springing skills back to their targets.
function relax(ns: GNode[], targets: Map<string, [number, number]>) {
  for (let it = 0; it < 180; it++) {
    const pull = it < 120 ? 0.05 : 0.01
    for (const n of ns) {
      if (n.isHub) continue
      const t = targets.get(n.id)
      if (!t) continue
      n.x += (t[0] - n.x) * pull
      n.y += (t[1] - n.y) * pull
    }
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i]
        const b = ns[j]
        if (a.isHub && b.isHub) continue
        let dx = b.x - a.x
        let dy = b.y - a.y
        if (dx === 0 && dy === 0) {
          dx = (i + j) % 2 ? 0.5 : -0.5
          dy = 0.3
        }
        const ox = a.hw + b.hw - Math.abs(dx)
        const oy = a.hh + b.hh - Math.abs(dy)
        if (ox <= 0 || oy <= 0) continue
        const alongX = ox < oy
        const amt = alongX ? ox : oy
        const sx = alongX ? Math.sign(dx) || 1 : 0
        const sy = alongX ? 0 : Math.sign(dy) || 1
        const share = a.isHub || b.isHub ? 1 : 0.5
        if (!b.isHub) {
          b.x += sx * amt * share
          b.y += sy * amt * share
        }
        if (!a.isHub) {
          a.x -= sx * amt * share
          a.y -= sy * amt * share
        }
      }
    }
  }
}

function boxOf(list: GNode[], padX: number, padY: number, minW = 0): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of list) {
    x0 = Math.min(x0, n.x - n.hw)
    x1 = Math.max(x1, n.x + n.hw)
    y0 = Math.min(y0, n.y - n.hh)
    y1 = Math.max(y1, n.y + n.hh)
  }
  if (!Number.isFinite(x0)) return [-200, -150, 400, 300]
  let w = x1 - x0 + padX * 2
  const h = y1 - y0 + padY * 2
  let x = x0 - padX
  if (w < minW) {
    x -= (minW - w) / 2
    w = minW
  }
  return [x, y0 - padY, w, h]
}

export default function SkillConstellation({
  skills,
  projects,
  selectedSkill,
  onSelectSkill,
}: SkillConstellationProps) {
  const narrow = useMedia(NARROW)
  const [view, setView] = useState<'graph' | 'tree'>(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW).matches ? 'tree' : 'graph',
  )
  const [activeDomain, setActiveDomain] = useState<SkillDomain | 'All'>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [hovered, setHovered] = useState<GNode | null>(null)
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [experienceFilter, setExperienceFilter] = useState<'all' | 'frequent' | 'some' | 'unfeatured'>('all')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<[number, number]>([0, 0])
  const [fullscreenError, setFullscreenError] = useState('')
  const workspaceRef = useRef<HTMLDivElement>(null)
  const graphCanvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const items = useMemo(
    () =>
      skills.map((s) => {
        const skillDomains = [...new Set(s.domains.map(normalizeDomain))]
        const primaryDomain = s.primaryDomain ? normalizeDomain(s.primaryDomain) : undefined
        const orderedDomains =
          primaryDomain && skillDomains.includes(primaryDomain)
            ? [primaryDomain, ...skillDomains.filter((domain) => domain !== primaryDomain)]
            : skillDomains
        return {
          id: s.id,
          name: s.name,
          domains: orderedDomains,
          relatedSkills: s.relatedSkills ?? [],
        }
      }),
    [skills],
  )

  // Known domains first (fixed order), then any category added in the dashboard
  const domains = useMemo(() => {
    const present = new Set(items.flatMap((s) => s.domains))
    return [
      ...SKILL_DOMAINS.filter((d) => present.has(d)),
      ...[...present].filter((d) => !SKILL_DOMAINS.includes(d)),
    ]
  }, [items])

  const colorOf = useMemo(() => {
    const extras = domains.filter((d) => !DOMAIN_COLOR[d])
    const map = new Map<string, string>(domains.map((d) => [d, DOMAIN_COLOR[d] ?? PALETTE[extras.indexOf(d) % PALETTE.length]]))
    return (d: string) => map.get(d) ?? '#9ca3af'
  }, [domains])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of projects) for (const s of new Set(p.skills.map((x) => x.toLowerCase()))) m.set(s, (m.get(s) ?? 0) + 1)
    return m
  }, [projects])
  const skillCount = (name: string) => counts.get(name.toLowerCase()) ?? 0
  const domainCount = (d: string) => {
    const names = new Set(items.filter((s) => s.domains.includes(d)).map((s) => s.name.toLowerCase()))
    return projects.filter((p) => p.skills.some((s) => names.has(s.toLowerCase()))).length
  }

  // Layout: domain hubs on a content-sized ellipse, with each skill anchored to its first domain.
  // Shared skills retain links to their other domains without drifting into the center.
  const { nodes, edges, fullBox } = useMemo(() => {
    const D = domains.length
    const kids = new Map<string, typeof items>(domains.map((d) => [d, []]))
    items.forEach((s) => {
      const primaryDomain = s.domains[0]
      if (primaryDomain) kids.get(primaryDomain)?.push(s)
    })
    const shape = (d: string) => {
      const k = kids.get(d)?.length ?? 0
      return { rx: hubWidth(d) / 2 + 34 + k * 3.2, ry: 46 + k * 3.4 }
    }
    const clusterR = Math.max(60, ...domains.map((d) => Math.max(shape(d).rx, shape(d).ry)))

    const ringAngle = (i: number) => -Math.PI / 2 + (i / Math.max(1, D)) * Math.PI * 2
    let rx = 0
    let ry = 0
    if (D > 1) {
      const R = (clusterR + 30) / Math.sin(Math.PI / D)
      rx = R * 1.3
      ry = R * 0.8
      let minD = Infinity
      for (let i = 0; i < D; i++)
        for (let j = i + 1; j < D; j++)
          minD = Math.min(
            minD,
            Math.hypot(Math.cos(ringAngle(i)) * rx - Math.cos(ringAngle(j)) * rx, Math.sin(ringAngle(i)) * ry - Math.sin(ringAngle(j)) * ry),
          )
      const need = clusterR * 2 + 40
      if (minD < need) {
        rx *= need / minD
        ry *= need / minD
      }
    }

    const ns: GNode[] = []
    const es: GEdge[] = []
    const targets = new Map<string, [number, number]>()
    const hubs = new Map<string, GNode>()

    domains.forEach((d, i) => {
      const w = hubWidth(d)
      const hub: GNode = {
        id: `hub-${i}`, name: d, domains: [d], color: colorOf(d),
        x: Math.cos(ringAngle(i)) * rx, y: Math.sin(ringAngle(i)) * ry,
        r: 15, w, hw: w / 2 + 6, hh: 21, ox: 0, oy: 0, isHub: true, count: domainCount(d),
      }
      hubs.set(d, hub)
      ns.push(hub)
    })

    items.forEach((s) => {
      const d = s.domains[0]
      const list = kids.get(d) ?? []
      const hub = hubs.get(d) as GNode
      const a = ringAngle(domains.indexOf(d)) + ((list.indexOf(s) + 0.5) / Math.max(1, list.length)) * Math.PI * 2
      const sh = shape(d)
      const tx = hub.x + Math.cos(a) * sh.rx
      const ty = hub.y + Math.sin(a) * sh.ry
      targets.set(s.id, [tx, ty])
      ns.push({
        id: s.id, name: s.name, domains: s.domains, color: colorOf(s.domains[0]),
        x: tx, y: ty, r: 11, w: 0, hw: 19, hh: 19, ox: 0, oy: -1, isHub: false, count: skillCount(s.name),
      })
      s.domains.forEach((d) => es.push({ source: (hubs.get(d) as GNode).id, target: s.id, color: colorOf(d), kind: 'domain', weight: 1 }))
    })

    const nodeByName = new Map(ns.filter((n) => !n.isHub).map((n) => [n.name.toLowerCase(), n]))
    const related = new Map<string, { source: GNode; target: GNode; weight: number }>()
    items.forEach((skill) => {
      const source = nodeByName.get(skill.name.toLowerCase())
      if (!source) return
      skill.relatedSkills?.forEach((name) => {
        const target = nodeByName.get(name.toLowerCase())
        if (!target || target.id === source.id) return
        const key = [source.id, target.id].sort().join(':')
        if (!related.has(key)) related.set(key, { source, target, weight: 1 })
      })
    })
    related.forEach(({ source, target, weight }) => {
      const commonDomain = source.domains.find((domain) => target.domains.includes(domain))
      es.push({
        source: source.id,
        target: target.id,
        color: colorOf(commonDomain ?? source.domains[0]),
        kind: 'related',
        weight,
      })
    })

    relax(ns, targets)

    // outward direction for label placement
    ns.forEach((n) => {
      if (n.isHub) return
      const ref = n.domains.length === 1 ? (hubs.get(n.domains[0]) as GNode) : { x: 0, y: 0 }
      const dx = n.x - ref.x
      const dy = n.y - ref.y
      const len = Math.hypot(dx, dy)
      if (len > 0.5) {
        n.ox = dx / len
        n.oy = dy / len
      }
    })

    return { nodes: ns, edges: es, fullBox: boxOf(ns, 90, 55, 520) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, domains, projects])

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const labelPositions = useMemo(() => {
    const placed: LabelBox[] = []
    const positions = new Map<string, LabelPosition>()
    const shifts = [
      [0, 0], [0, -18], [0, 18], [-18, 0], [18, 0],
      [-18, -18], [18, -18], [-18, 18], [18, 18],
      [0, -36], [0, 36], [-36, 0], [36, 0],
      [-36, -18], [36, -18], [-36, 18], [36, 18],
    ]
    nodes
      .filter((n) => !n.isHub)
      .sort((a, b) => b.name.length - a.name.length)
      .forEach((n) => {
        const sideways = Math.abs(n.ox) > 0.35
        const anchor: LabelPosition['anchor'] = sideways ? (n.ox > 0 ? 'start' : 'end') : 'middle'
        const dist = n.r + 8
        const baseX = n.x + n.ox * dist
        const baseY = n.y + n.oy * dist + (sideways ? 4 : n.oy < 0 ? -2 : 11)
        const width = n.name.length * 7
        let chosen: LabelPosition = { x: baseX, y: baseY, anchor }
        for (const [dx, dy] of shifts) {
          const candidate = { x: baseX + dx, y: baseY + dy, anchor }
          const left = candidate.x - (anchor === 'start' ? 0 : anchor === 'end' ? width : width / 2)
          const box = { left: left - 3, right: left + width + 3, top: candidate.y - 12, bottom: candidate.y + 4 }
          if (!placed.some((o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top)) {
            chosen = candidate
            placed.push(box)
            break
          }
        }
        positions.set(n.id, chosen)
      })
    return positions
  }, [nodes])

  // Choosing a domain zooms the graph into that cluster: readable on phones, never cluttered.
  const targetBox = useMemo<Box>(() => {
    if (activeDomain === 'All') return fullBox
    const list = nodes.filter((n) => n.domains.includes(activeDomain))
    return list.length ? boxOf(list, 120, 60, 460) : fullBox
  }, [activeDomain, nodes, fullBox])
  const baseBox = useTween(targetBox)
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const viewWidth = Math.max(1, baseBox[2] / safeZoom)
  const viewHeight = Math.max(1, baseBox[3] / safeZoom)
  const box: Box = [
    baseBox[0] + (baseBox[2] - viewWidth) / 2 + pan[0],
    baseBox[1] + (baseBox[3] - viewHeight) / 2 + pan[1],
    viewWidth,
    viewHeight,
  ]

  const q = searchQuery.trim().toLowerCase()
  const focusSet = hovered ? new Set(hovered.domains) : activeDomain === 'All' ? null : new Set([activeDomain])
  const passesExperienceCount = (count: number) =>
    experienceFilter === 'all' ||
    (experienceFilter === 'frequent' && count >= 3) ||
    (experienceFilter === 'some' && count > 0 && count < 3) ||
    (experienceFilter === 'unfeatured' && count === 0)
  const passesExperience = (n: GNode) => passesExperienceCount(n.count)

  const isDim = (n: GNode) => {
    if (!passesExperience(n)) return true
    if (q) return !(n.name.toLowerCase().includes(q) || n.domains.some((d) => d.toLowerCase().includes(q)))
    return focusSet ? !n.domains.some((d) => focusSet.has(d)) : false
  }

  const selectedProjects = useMemo(() => {
    if (!selectedSkill) return []
    return projects.filter((p) => p.skills.some((s) => s.toLowerCase() === selectedSkill.toLowerCase()))
  }, [projects, selectedSkill])
  const selectedNode = nodes.find((n) => !n.isHub && selectedSkill?.toLowerCase() === n.name.toLowerCase())
  const detailNode = selectedNode ?? (hovered && !hovered.isHub ? hovered : undefined)
  const detailDomain = detailNode
    ? null
    : activeDomain !== 'All'
      ? activeDomain
      : hovered?.isHub
        ? hovered.name
        : null
  const showDetails = Boolean(detailNode || detailDomain)
  const detailProjects = detailNode
    ? projects.filter((p) => p.skills.some((s) => s.toLowerCase() === detailNode.name.toLowerCase()))
    : []
  const connectedIds = detailNode
    ? new Set([
        ...nodes.filter((n) => !n.isHub && n.id !== detailNode.id && n.domains.some((d) => detailNode.domains.includes(d))).map((n) => n.id),
        ...edges.flatMap((e) => e.source === detailNode.id ? [e.target] : e.target === detailNode.id ? [e.source] : []),
      ])
    : new Set<string>()
  const connectedSkills = [...connectedIds]
    .map((id) => nodeMap.get(id))
    .filter((n): n is GNode => Boolean(n && !n.isHub))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const skillNodes = nodes.filter((n) => !n.isHub)
  const visibleEdges = edges.filter((e) => {
    const source = nodeMap.get(e.source)
    const target = nodeMap.get(e.target)
    if (!source || !target) return false
    const selected = selectedNode && (source.id === selectedNode.id || target.id === selectedNode.id)
    const hoveredLink = hovered && (hovered.isHub
      ? [source, target].some((node) => node.domains.includes(hovered.name))
      : source.id === hovered.id || target.id === hovered.id)
    const domainLink = activeDomain !== 'All' && [source, target].some((node) => node.domains.includes(activeDomain))
    if (e.kind === 'related') return Boolean(selected || hoveredLink || domainLink)
    return edges.length < 400 || Boolean(selected || hoveredLink || domainLink)
  })
  // Esc clears the selection
  useEffect(() => {
    if (!selectedSkill) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelectSkill(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSkill, onSelectSkill])

  const isSelected = (name: string) => selectedSkill?.toLowerCase() === name.toLowerCase()
  const toggleSkill = (name: string) => onSelectSkill(isSelected(name) ? null : name)

  const focusSkill = (n: GNode, toggle: boolean) => {
    const focusBox = boxOf(nodes.filter((item) => item.domains.includes(n.domains[0])), 120, 60, 460)
    setActiveDomain(n.domains[0])
    setZoom(1.45)
    setPan([n.x - (focusBox[0] + focusBox[2] / 2), n.y - (focusBox[1] + focusBox[3] / 2)])
    if (toggle) toggleSkill(n.name)
    else onSelectSkill(n.name)
  }

  const activate = (n: GNode) => {
    setSearchQuery('')
    if (n.isHub) {
      setActiveDomain((cur) => (cur === n.name ? 'All' : n.name))
      setZoom(1)
      setPan([0, 0])
      return
    }
    focusSkill(n, true)
  }

  const showLabel = (n: GNode) => {
    if (n.isHub) return false
    if (isSelected(n.name)) return true
    if (q) return !isDim(n)
    if (hovered) return n.domains.some((d) => hovered.domains.includes(d))
    if (activeDomain !== 'All') return n.domains.includes(activeDomain)
    return skillNodes.length <= 50
  }

  const resetView = () => {
    setActiveDomain('All')
    setZoom(1)
    setPan([0, 0])
  }
  const navigateMiniMap = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const nextZoom = Math.max(zoom, 1.4)
    const width = fullBox[2] / nextZoom
    const height = fullBox[3] / nextZoom
    const pointX = fullBox[0] + ((event.clientX - bounds.left) / bounds.width) * fullBox[2]
    const pointY = fullBox[1] + ((event.clientY - bounds.top) / bounds.height) * fullBox[3]
    const originX = Math.min(fullBox[0] + fullBox[2] - width, Math.max(fullBox[0], pointX - width / 2))
    const originY = Math.min(fullBox[1] + fullBox[3] - height, Math.max(fullBox[1], pointY - height / 2))
    setActiveDomain('All')
    setZoom(nextZoom)
    setPan([
      originX - (fullBox[0] + (fullBox[2] - width) / 2),
      originY - (fullBox[1] + (fullBox[3] - height) / 2),
    ])
  }
  const zoomBy = (amount: number) => setZoom((current) => Math.min(3.5, Math.max(0.65, current + amount)))
  useEffect(() => {
    const canvas = graphCanvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((current) => Math.min(3.5, Math.max(0.65, current + (event.deltaY < 0 ? 0.12 : -0.12))))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])
  const handleGraphPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('.sk-node')) return
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan[0], panY: pan[1] }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handleGraphPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scaleX = baseBox[2] / Math.max(1, bounds.width)
    const scaleY = baseBox[3] / Math.max(1, bounds.height)
    setPan([drag.panX - (event.clientX - drag.x) * scaleX, drag.panY - (event.clientY - drag.y) * scaleY])
  }
  const toggleFullscreen = async () => {
    setFullscreenError('')
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await workspaceRef.current?.requestFullscreen()
    } catch (error) {
      setFullscreenError(error instanceof Error ? error.message : 'Fullscreen is unavailable in this browser.')
    }
  }
  const focusSearchResult = () => {
    const match = skillNodes.find((n) => n.name.toLowerCase() === q) ??
      skillNodes.find((n) => n.name.toLowerCase().includes(q))
    if (!match) return
    activate(match)
  }

  if (items.length === 0) {
    return (
      <section id="skills" className="section-block" aria-labelledby="skills-heading">
        <div className="section-header">
          <div className="section-tag">
            <IconTerminal />
            <span>CONSTELLATION // CONNECTED SKILLS</span>
          </div>
          <h2 id="skills-heading" className="section-title">Interactive Skill Constellation</h2>
          <p className="section-desc">No skills are currently saved in Supabase.</p>
        </div>
      </section>
    )
  }

  // Tree view data
  const treeDomains = domains.filter((d) => activeDomain === 'All' || d === activeDomain)
  const treeGroups = treeDomains
    .map((d) => ({
      domain: d,
      total: items.filter((s) => s.domains.includes(d)).length,
      list: items.filter(
        (s) => s.domains.includes(d) && passesExperienceCount(skillCount(s.name)) &&
          (!q || s.name.toLowerCase().includes(q) || d.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.list.length > 0)
  const toggleOpen = (d: string) =>
    setClosed((cur) => {
      const next = new Set(cur)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  const zoomed = activeDomain !== 'All'

  return (
    <section id="skills" className="section-block" aria-labelledby="skills-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconTerminal />
          <span>CONSTELLATION // CONNECTED SKILLS</span>
        </div>
        <h2 id="skills-heading" className="section-title">
          Interactive Skill Constellation
        </h2>
        <p className="section-desc">
          Explore how technologies connect across domains. Shared skills sit between their clusters; select
          any skill to see its domain and related projects.
        </p>
      </div>

      <div className="sk-workspace" ref={workspaceRef}>
        <aside className="sk-sidebar" aria-label="Skill filters">
          <div className="sk-panel-title">
            <span>Domains & filters</span>
            <span className="sk-total">{skillNodes.length} skills</span>
          </div>
          <div className="sk-filter-list">
            <button type="button" className={`sk-domain-filter ${activeDomain === 'All' ? 'active' : ''}`} aria-pressed={activeDomain === 'All'} onClick={resetView}>
              <span className="sk-filter-check">{activeDomain === 'All' ? '✓' : ''}</span>
              <span>All domains</span><small>{skillNodes.length}</small>
            </button>
            {domains.map((domain) => {
              const count = items.filter((s) => s.domains.includes(domain)).length
              return (
                <button
                  type="button" key={domain}
                  className={`sk-domain-filter ${activeDomain === domain ? 'active' : ''}`}
                  style={{ '--domain-color': colorOf(domain) } as CSSProperties}
                  aria-pressed={activeDomain === domain}
                  onClick={() => { setActiveDomain(activeDomain === domain ? 'All' : domain); setZoom(1); setPan([0, 0]) }}
                >
                  <span className="sk-filter-check">{activeDomain === domain ? '✓' : ''}</span>
                  <span className="sk-domain-swatch" />
                  <span className="sk-domain-name">{domain}</span><small>{count}</small>
                </button>
              )
            })}
          </div>
          <div className="sk-experience">
            <div className="sk-subtitle">Project usage</div>
            <p className="sk-filter-note">Evidence from projects, not a self-reported proficiency rating.</p>
            {([
              ['all', 'Any experience'],
              ['frequent', 'Frequent · 3+ projects'],
              ['some', 'Some · 1–2 projects'],
              ['unfeatured', 'Not featured yet'],
            ] as const).map(([value, label]) => (
              <label className="sk-radio-row" key={value}>
                <input type="radio" name="skill-experience" checked={experienceFilter === value} onChange={() => setExperienceFilter(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="sk-side-bottom">
            <div className="sk-view-toggle" role="group" aria-label="Skill view">
              <button type="button" className={`sk-view-button ${view === 'graph' ? 'active' : ''}`} aria-pressed={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
              <button type="button" className={`sk-view-button ${view === 'tree' ? 'active' : ''}`} aria-pressed={view === 'tree'} onClick={() => setView('tree')}>List view</button>
            </div>
            <span className="sk-list-hint">Accessible grouped skill list</span>
          </div>
        </aside>

        <div className="sk-stage">
          <div className="sk-stage-toolbar">
            <div className="skill-search-box">
              <IconSearch className="search-icon" />
              <input
                type="text" placeholder="Search or click a node..." value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') focusSearchResult() }}
                className="skill-search-input" aria-label="Search skills"
              />
              {searchQuery && (
                <button type="button" className="clear-search-btn" onClick={() => setSearchQuery('')} aria-label="Clear search">
                  <IconClose />
                </button>
              )}
            </div>
            <span className="sk-result-count">{skillNodes.filter((n) => !isDim(n)).length} shown</span>
            <div className="sk-link-legend" aria-label="Graph connection legend">
              <span><i className="sk-legend-domain" />Domains</span>
              <span><i className="sk-legend-related" />Admin links</span>
            </div>
          </div>

          {view === 'graph' ? (
            <div className="constellation-3d-wrapper">
              <div className="sk-graph-canvas" ref={graphCanvasRef}>
            <svg
              viewBox={box.join(' ')}
              className="constellation-3d-svg"
              role="group"
              aria-label="Skill constellation grouped by domain"
              onPointerDown={handleGraphPointerDown}
              onPointerMove={handleGraphPointerMove}
              onPointerUp={() => { dragRef.current = null }}
              onPointerCancel={() => { dragRef.current = null }}
            >
              {/* 1. lines */}
              <g>
                {visibleEdges.map((e) => {
                  const s = nodeMap.get(e.source)
                  const t = nodeMap.get(e.target)
                  if (!s || !t) return null
                  const hot = selectedSkill && (isSelected(t.name) || isSelected(s.name))
                  const dim = isDim(s) || isDim(t)
                  return (
                    <line
                      key={`${e.source}-${e.target}`}
                      className={`sk-edge ${e.kind === 'related' ? 'sk-related-edge' : ''} ${hot ? '' : 'flow'} ${dim ? 'dim' : ''}`}
                      x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                      stroke={hot ? selectedNode?.color ?? '#ffffff' : e.color}
                      strokeWidth={hot ? (e.kind === 'related' ? 1.4 : 2) : e.kind === 'related' ? 1.1 : 1.2}
                      strokeOpacity={hot ? (e.kind === 'related' ? 0.58 : 0.85) : e.kind === 'related' ? Math.min(0.55, 0.2 + e.weight * 0.08) : 0.5}
                      strokeDasharray={hot || e.kind === 'related' ? undefined : '4 3'}
                    />
                  )
                })}
              </g>

              {/* 2. bubbles and domain pills */}
              <g>
                {nodes.map((n) => {
                  const isSel = !n.isHub && isSelected(n.name)
                  const shared = !n.isHub && n.domains.length > 1
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x}, ${n.y})`}
                      className={`sk-node ${n.isHub ? 'sk-hub' : ''} ${isDim(n) ? 'dim' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={n.isHub ? `Zoom into ${n.name} domain` : `${n.name}, ${n.domains.join(' and ')}`}
                      aria-pressed={n.isHub ? activeDomain === n.name : isSel}
                      onClick={() => activate(n)}
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() => setHovered((h) => (h?.id === n.id ? null : h))}
                      onFocus={() => setHovered(n)}
                      onBlur={() => setHovered((h) => (h?.id === n.id ? null : h))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          activate(n)
                        }
                      }}
                    >
                      {n.isHub ? (
                        <>
                          <g className="sk-body">
                            <rect
                              x={-n.w / 2} y={-15} width={n.w} height={30} rx={15}
                              fill="#121216" stroke={n.color} strokeWidth={2}
                              style={{ filter: `drop-shadow(0 0 7px ${n.color})` }}
                            />
                            <text
                              textAnchor="middle" dy={4} fill="#ffffff"
                              fontFamily="var(--font-mono)" fontSize={12} fontWeight={700}
                              style={{ pointerEvents: 'none' }}
                            >
                              {n.name}
                            </text>
                          </g>
                          <rect
                            className="sk-hub-focus-ring"
                            x={-n.w / 2 - 4} y={-19} width={n.w + 8} height={38} rx={18}
                          />
                          <rect x={-n.w / 2 - 4} y={-19} width={n.w + 8} height={38} fill="transparent" />
                        </>
                      ) : (
                        <>
                          {isSel && (
                            <circle className="sk-halo" r={n.r + 12} fill="none" stroke={n.color} strokeWidth="2.5" />
                          )}
                          <g className="sk-body">
                            <circle
                              r={n.r}
                              fill="#181820"
                              stroke={isSel ? '#ffffff' : n.color}
                              strokeWidth={isSel ? 2.8 : 1.6}
                              style={{ filter: isSel ? `drop-shadow(0 0 7px ${n.color})` : undefined }}
                            />
                            {shared ? (
                              // one wedge per domain so shared skills show every colour they belong to
                              n.domains.map((d, i) => {
                                const a0 = (i / n.domains.length) * 360 - 90
                                const a1 = ((i + 1) / n.domains.length) * 360 - 90
                                const rr = n.r * 0.55
                                const p = (a: number) => `${Math.cos(a * DEG) * rr},${Math.sin(a * DEG) * rr}`
                                return (
                                  <path
                                    key={d}
                                    d={`M0,0 L${p(a0)} A${rr},${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)} Z`}
                                    fill={colorOf(d)}
                                  />
                                )
                              })
                            ) : (
                              <circle r={n.r * 0.4} fill={n.color} />
                            )}
                          </g>
                          <circle className="sk-focus-ring" r={n.r + 5} />
                          {/* stable hit area: never moves or scales */}
                          <circle r={n.r + 10} fill="transparent" />
                        </>
                      )}
                    </g>
                  )
                })}
              </g>

              {/* 3. names, drawn last so nothing can cover them */}
              <g aria-hidden="true">
                {nodes.filter(showLabel).map((n) => {
                  const isHover = hovered?.id === n.id
                  const label = labelPositions.get(n.id)
                  if (!label) return null
                  return (
                    <text
                      key={`label-${n.id}`}
                      className="sk-label"
                      x={label.x} y={label.y} textAnchor={label.anchor}
                      fill={n.color}
                      fontSize={isHover ? 12.5 : 11.5}
                      fontWeight={isHover ? 700 : 600}
                      stroke="#0a0a0c" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke"
                    >
                      {n.name}
                    </text>
                  )
                })}
              </g>
            </svg>
                <div className="sk-minimap" aria-label="Skill graph mini-map">
                  <div className="sk-minimap-title">Mini-map</div>
                  <button type="button" className="sk-minimap-map" onClick={navigateMiniMap} aria-label="Navigate graph using mini-map">
                    <svg viewBox={fullBox.join(' ')} role="img" aria-label="Overview of skill domains">
                      {edges.map((e) => {
                        const source = nodeMap.get(e.source)
                        const target = nodeMap.get(e.target)
                        return source && target ? <line key={`mini-${e.source}-${e.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={e.color} strokeOpacity=".35" strokeWidth="3" /> : null
                      })}
                      {skillNodes.map((n) => <circle key={`mini-${n.id}`} cx={n.x} cy={n.y} r="9" fill={n.color} />)}
                      <rect className="sk-minimap-window" x={box[0]} y={box[1]} width={box[2]} height={box[3]} />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="sk-graph-footer">
                <div className="sk-zoom-controls" aria-label="Graph controls">
                  <button type="button" onClick={() => zoomBy(-0.2)} aria-label="Zoom out">−</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => zoomBy(0.2)} aria-label="Zoom in">+</button>
                  <button type="button" onClick={resetView}>Reset</button>
                  <button type="button" onClick={() => { void toggleFullscreen() }}>Fullscreen</button>
                </div>
                <span className="sk-navigation-hint">Scroll to zoom · drag to pan · click a domain or skill</span>
              </div>
              {fullscreenError && <p className="sk-fullscreen-error" role="status">{fullscreenError}</p>}

          {hovered && (
            <div
              className="constellation-tooltip"
              style={{ borderColor: hovered.color, boxShadow: `0 8px 24px rgba(0,0,0,.8), 0 0 16px ${hovered.color}40` }}
            >
              <div className="tooltip-head" style={{ color: hovered.color }}>{hovered.name}</div>
              <div className="tooltip-domain">
                {hovered.isHub ? 'Domain hub' : hovered.domains.join(' + ')}
              </div>
              {hovered.count > 0 && (
                <div className="tooltip-projects">
                  {hovered.isHub ? 'Touches' : 'Used in'} {hovered.count} {hovered.count === 1 ? 'project' : 'projects'}
                </div>
              )}
              {!hovered.isHub && <div className="tooltip-hint">Click to filter projects</div>}
            </div>
          )}
            </div>
          ) : (
        <div className="sk-tree">
          {treeGroups.length === 0 && <p className="sk-empty">No skills match “{searchQuery}”.</p>}
          {treeGroups.map((g) => {
            const color = colorOf(g.domain)
            const open = Boolean(q) || zoomed || !closed.has(g.domain)
            return (
              <div key={g.domain} className="sk-domain" style={{ '--c': color } as CSSProperties}>
                <button
                  type="button"
                  className="sk-domain-head"
                  aria-expanded={open}
                  aria-controls={`sk-dom-${g.domain}`}
                  onClick={() => toggleOpen(g.domain)}
                >
                  <span className="sk-dot" aria-hidden="true" />
                  <span>{g.domain}</span>
                  <span className="sk-count">{g.total} {g.total === 1 ? 'skill' : 'skills'}</span>
                  <span className={`view-all-chevron ${open ? 'open' : ''}`} aria-hidden="true">
                    <IconChevronDown />
                  </span>
                </button>
                {open && (
                  <div id={`sk-dom-${g.domain}`} className="sk-domain-body">
                    {g.list.map((s) => {
                      const others = s.domains.filter((d) => d !== g.domain)
                      const n = skillCount(s.name)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`sk-chip ${isSelected(s.name) ? 'on' : ''}`}
                          aria-pressed={isSelected(s.name)}
                          onClick={() => toggleSkill(s.name)}
                        >
                          <span>{s.name}</span>
                          {n > 0 && <small>{n}</small>}
                          {others.length > 0 && (
                            <>
                              <span className="sk-shared" aria-hidden="true">
                                {others.map((d) => (
                                  <i key={d} title={`Also in ${d}`} style={{ background: colorOf(d) }} />
                                ))}
                              </span>
                              <span className="sk-sr">also in {others.join(', ')}</span>
                            </>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          <p className="sk-legend">Small numbers = projects using the skill. Coloured dots = other domains it also belongs to.</p>
        </div>
      )}
        </div>

        {showDetails && (
          <aside className={`sk-details ${selectedNode || activeDomain !== 'All' ? 'sk-details-pinned' : ''}`} aria-live="polite">
            <div className="sk-panel-title">
              <span>{detailNode ? 'Skill details' : 'Domain details'}</span>
              <button
                type="button"
                className="sk-clear-selection"
                onClick={() => {
                  onSelectSkill(null)
                  setHovered(null)
                  resetView()
                }}
                aria-label="Close skill details"
              >
                <IconClose />
              </button>
            </div>
            {detailNode ? (
              <>
                <div className="sk-detail-heading" style={{ '--domain-color': detailNode.color } as CSSProperties}>
                  <span className="sk-detail-mark">{detailNode.name.slice(0, 2).toUpperCase()}</span>
                  <strong>{detailNode.name}</strong>
                </div>
                <div className="sk-detail-section">
                  <h3>Domain membership</h3>
                  <div className="sk-detail-tags">
                    {detailNode.domains.map((domain) => (
                      <button type="button" key={domain} style={{ '--domain-color': colorOf(domain) } as CSSProperties} onClick={() => { setActiveDomain(domain); setZoom(1); setPan([0, 0]) }}>
                        <i />{domain}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sk-detail-section">
                  <h3>Connected skills <small>{connectedSkills.length}</small></h3>
                  <div className="sk-connected-list">
                    {connectedSkills.map((node) => (
                      <button type="button" key={node.id} onClick={() => focusSkill(node, false)}>{node.name}</button>
                    ))}
                    {connectedSkills.length === 0 && <span className="sk-muted">No related skills listed.</span>}
                  </div>
                </div>
                <div className="sk-detail-section">
                  <h3>Used in {detailProjects.length} {detailProjects.length === 1 ? 'project' : 'projects'}</h3>
                  {detailProjects.length ? (
                    <ul className="sk-project-list">{detailProjects.map((project) => <li key={project.id}>{project.title}</li>)}</ul>
                  ) : <p className="sk-muted">No projects currently reference this skill.</p>}
                </div>
              </>
            ) : detailDomain ? (
              <>
                <div className="sk-detail-heading" style={{ '--domain-color': colorOf(detailDomain) } as CSSProperties}>
                  <span className="sk-detail-mark">◎</span>
                  <strong>{detailDomain}</strong>
                </div>
                <div className="sk-detail-section">
                  <h3>{skillNodes.filter((n) => n.domains.includes(detailDomain)).length} skills</h3>
                  <p className="sk-muted">Used across {domainCount(detailDomain)} {domainCount(detailDomain) === 1 ? 'project' : 'projects'}.</p>
                  <div className="sk-connected-list">
                    {skillNodes.filter((n) => n.domains.includes(detailDomain)).map((node) => (
                      <button type="button" key={node.id} onClick={() => focusSkill(node, false)}>{node.name}</button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </aside>
        )}
      </div>

      {selectedSkill && (
        <div className="skill-filter-banner" role="status" aria-live="polite">
          <div className="filter-info">
            <span className="filter-label">Active Technology Filter:</span>
            <span className="filter-tag">{selectedSkill}</span>
            <span className="filter-count">
              ({selectedProjects.length} {selectedProjects.length === 1 ? 'project' : 'projects'} found)
            </span>
          </div>
          <div className="filter-actions">
            <a href="#projects" className="filter-jump-btn">View Connected Projects &darr;</a>
            <button type="button" className="filter-clear-btn" onClick={() => onSelectSkill(null)} aria-label="Clear skill filter">
              <IconClose />
              <span>Clear Filter (Esc)</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}