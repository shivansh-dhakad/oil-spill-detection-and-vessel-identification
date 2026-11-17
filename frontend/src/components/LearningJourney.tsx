import { useEffect, useState, type CSSProperties } from 'react'
import { LEARNING_JOURNEY_DATA } from '../data/portfolioData'
import { IconTerminal } from './Icons'

const MOVE_MS = 900 // keep in sync with .jr-car transition in overrides.css
const DWELL_MS = 2600

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// stagger index for the terminal line reveal
const at = (i: number) => ({ '--i': i }) as CSSProperties

export default function LearningJourney() {
  const items = LEARNING_JOURNEY_DATA
  const n = items.length
  const last = n - 1

  const [reduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [stop, setStop] = useState(0) // where the car is
  const [arrived, setArrived] = useState(true)
  const [resetting, setResetting] = useState(false)
  const [openIdx, setOpenIdx] = useState<number | null>(null) // visitor's choice, overrides the car

  // The marker travels stop to stop, parks for a moment, then starts over.
  useEffect(() => {
    if (reduced) return
    let alive = true
    let timer = 0
    const later = (fn: () => void, ms: number) => {
      timer = window.setTimeout(() => {
        if (alive) fn()
      }, ms)
    }
    const dwell = (i: number) => {
      setStop(i)
      setArrived(true)
      later(() => {
        if (i === last) {
          setArrived(false)
          setResetting(true)
          later(() => {
            setStop(0)
            later(() => {
              setResetting(false)
              dwell(0)
            }, 80)
          }, 400)
        } else {
          setArrived(false)
          setStop(i + 1)
          later(() => dwell(i + 1), MOVE_MS)
        }
      }, DWELL_MS)
    }
    dwell(0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [reduced, last])

  const pct = (i: number) => ((i + 0.5) / n) * 100
  const travelPct = pct(stop)
  const moving = !arrived && !resetting

  const shownIdx = openIdx ?? stop
  const active = items[shownIdx]
  const file = `stop_0${active.step}_${slug(active.category)}.md`

  return (
    <section id="journey" className="section-block" aria-labelledby="journey-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconTerminal />
          <span>ROADMAP // EVOLUTION</span>
        </div>
        <h2 id="journey-heading" className="section-title">
          My Journey of Learning
        </h2>
        <p className="section-desc">
          Six stops, from first lines of code to autonomous agents. Watch the marker travel the route, or
          hover (tap) a stop to read its notes in the terminal below.
        </p>
      </div>

      <div className="jr-wrap">
        <div className="jr-track" style={{ '--n': n } as CSSProperties}>
          <div className="jr-road" aria-hidden="true">
            <div
              className={`jr-road-fill ${resetting ? 'resetting' : ''}`}
              style={{ width: reduced ? '100%' : `${travelPct}%` }}
            />
          </div>

          {!reduced && (
            <div
              className={`jr-traveler ${moving ? '' : 'arrived'} ${resetting ? 'resetting' : ''}`}
              style={{ left: `${travelPct}%` }}
              aria-hidden="true"
            />
          )}

          <div className="jr-pins" role="group" aria-label="Learning journey stops">
            {items.map((dest, i) => {
              const isShown = shownIdx === i
              const passed = reduced || i <= stop
              return (
                <div
                  key={dest.id}
                  className="jr-col"
                  style={{ '--dest-color': dest.color } as CSSProperties}
                >
                  <button
                    type="button"
                    className={`jr-pin ${isShown ? 'lit' : ''} ${passed ? 'passed' : ''}`}
                    aria-label={`Stop ${dest.step}: ${dest.title}`}
                    aria-pressed={openIdx === i}
                    onMouseEnter={() => setOpenIdx(i)}
                    onMouseLeave={() => setOpenIdx((p) => (p === i ? null : p))}
                    onFocus={() => setOpenIdx(i)}
                    onBlur={() => setOpenIdx((p) => (p === i ? null : p))}
                    onClick={() => setOpenIdx(i)}
                  >
                    <span className="jr-marker">
                      <span className="jr-num">0{dest.step}</span>
                    </span>
                    <span className="jr-label">{dest.title.split(' ')[0]}</span>
                    <span className="jr-sub">{dest.category}</span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* IDE terminal that shows the notes for the active stop */}
        <div
          className="jr-term"
          style={{ '--dest-color': active.color } as CSSProperties}
          role="region"
          aria-label={`Notes for stop ${active.step}: ${active.title}`}
        >
          <div className="jr-term-bar">
            <span className="jr-term-dots" aria-hidden="true">
              <i className="d1" />
              <i className="d2" />
              <i className="d3" />
            </span>
            <span className="jr-term-title">zsh: ~/journey/{file}</span>
            <span className="jr-term-right">
              {openIdx !== null && (
                <button type="button" className="jr-follow" onClick={() => setOpenIdx(null)}>
                  follow route
                </button>
              )}
              <span className="jr-term-badge">
                stop 0{active.step}/0{n}
              </span>
            </span>
          </div>

          <div className="jr-term-body" key={active.id}>
            <p className="jr-l" style={at(0)}>
              <span className="jr-ps">$</span> cat {file}
            </p>
            <h3 className="jr-l jr-t" style={at(1)}>
              # {active.title}
            </h3>
            <p className="jr-l jr-cm" style={at(2)}>
              {'// '}
              {active.tagline}
            </p>
            <p className="jr-l jr-desc" style={at(3)}>
              {active.description}
            </p>

            <p className="jr-l" style={at(4)}>
              <span className="jr-ps">$</span> ls ./skills
            </p>
            <div className="jr-l jr-pills" style={at(5)}>
              {active.skills.map((s) => (
                <span key={s} className="jr-pill">
                  {s}
                </span>
              ))}
            </div>

            <p className="jr-l" style={at(6)}>
              <span className="jr-ps">$</span> git log --learnings
            </p>
            <ul className="jr-list">
              {active.keyLearnings.map((k, i) => (
                <li key={k} className="jr-l" style={at(7 + i)}>
                  <span className="jr-ok" aria-hidden="true">
                    ✓
                  </span>
                  <span>{k}</span>
                </li>
              ))}
            </ul>

            <p className="jr-l" style={at(7 + active.keyLearnings.length)}>
              <span className="jr-ps">$</span>
              <span className="caret" aria-hidden="true" />
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}