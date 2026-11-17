import { useState, useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent } from 'react'

const DEFAULT_INTRO =
  'Computer Science (AI & ML) student with hands-on experience building machine learning, deep learning, computer vision, and retrieval-augmented generation applications.'

const SUGGESTIONS = [
  'help', 'about', 'journey', 'projects', 'skills', 'education', 'contact', 'flute', 'matrix', 'clear',
]

interface HistoryItem {
  id: number
  command: string
  lines: string[]
  egg?: boolean
}

interface CommandResult {
  lines: string[]
  egg?: boolean
  target?: string
}

function wrap(text: string, width: number) {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/)) {
    if (!word) continue
    const next = cur ? `${cur} ${word}` : word
    if (next.length > width && cur) {
      lines.push(cur)
      cur = word
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function runCommand(cmd: string, skillDomains: string[]): CommandResult {
  switch (cmd) {
    case 'help':
      return {
        lines: [
          'AVAILABLE COMMANDS:',
          '  help       show this list',
          '  about      developer background  -> #about',
          '  journey    learning roadmap      -> #journey',
          '  projects   all 9 projects        -> #projects',
          '  skills     skill constellation   -> #skills',
          '  education  college & school      -> #education',
          '  contact    message form & links  -> #contact',
          '  clear      clear this terminal',
          '  flute      [easter egg]',
          '  matrix     [easter egg]',
          '  sudo       [admin]',
        ],
      }
    case 'about':
      return {
        lines: [
          'SHIVANSH DHAKAD // DEVELOPER DOSSIER',
          'Student focusing on Machine Learning & AI development',
          'LNCT Bhopal · B.Tech CSE (AI & ML) · 2024–2028',
          'Opening #about ...',
        ],
        target: 'about',
      }
    case 'journey':
      return {
        lines: [
          'LEARNING HIGHWAY:',
          '  [01] Basic Languages  [02] Data Analysis  [03] Machine Learning',
          '  [04] Deep Learning    [05] Generative AI  [06] Agentic AI',
          'Opening #journey ...',
        ],
        target: 'journey',
      }
    case 'projects':
      return {
        lines: [
          'PROJECTS (9):',
          '  ★ VarunaDrishti · LUMINA · KrishiMitra · CardioShield AI · English–Hindi Translator',
          '    ResQGrid · Data Analysis & ML Website · NibandhAI · Mobile Price Prediction',
          'Opening #projects ...',
        ],
        target: 'projects',
      }
    case 'skills': {
      const domainLines = skillDomains.length
        ? wrap(skillDomains.join(' · '), 46).map((line) => `  ${line}`)
        : ['  No domains assigned.']
      return {
        lines: [
          `SKILL DOMAINS (${skillDomains.length}):`,
          ...domainLines,
          'Opening #skills ...',
        ],
        target: 'skills',
      }
    }
    case 'education':
      return {
        lines: [
          'EDUCATION:',
          '  LNCT Bhopal: B.Tech CSE (AI & ML), 2024–2028',
          '  Gurukul School, Bareli: Class XII completed (PCM), 2022–2024',
          'Opening #education ...',
        ],
        target: 'education',
      }
    case 'contact':
      return {
        lines: [
          'CONTACT:',
          '  GitHub    github.com/shivansh-dhakad',
          '  LinkedIn  linkedin.com/in/shivansh-dhakad-007679294',
          'Opening #contact ...',
        ],
        target: 'contact',
      }
    case 'flute':
      return {
        egg: true,
        lines: [
          '♪ ♫ ♩  BANSURI  ♪ ♫ ♩',
          '  |o|==[o]=[o]=[o]=[o]=[o]=[o]====>',
          'Raag Bhupali: Sa Re Ga Pa Dha Sa',
          'Breath control and patient resonance, much like tuning a neural network.',
        ],
      }
    case 'matrix':
      return {
        egg: true,
        lines: [
          '01010011 01001000 01001001 01010110 01000001 01001110 01010011 01001000',
          'Initializing amber neural stream...',
          'Weights: CONVERGED  |  Loss: 0.0012',
          'Welcome to the code universe.',
        ],
      }
    case 'sudo':
      return {
        lines: [
          'visitor is not in the sudoers file.',
          'This incident will be reported.',
        ],
      }
    default:
      return { lines: [`command not found: ${cmd}. Type "help" for options.`] }
  }
}

export default function HeroTerminal({ intro, skillDomains }: { intro?: string; skillDomains: string[] }) {
  const safeIntro = intro && intro.trim().length > 0 ? intro : DEFAULT_INTRO

  const rows = useMemo(
    () => [
      { text: 'cat intro.txt', prompt: true },
      ...wrap(safeIntro, 44).map((text) => ({ text, prompt: false })),
    ],
    [safeIntro],
  )

  // intro typewriter
  const [currentRow, setCurrentRow] = useState(0)
  const [currentChar, setCurrentChar] = useState(1)
  const [isWaitingLoop, setIsWaitingLoop] = useState(false)

  // interactive shell
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [cmdLog, setCmdLog] = useState<string[]>([])
  const [cmdIdx, setCmdIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const idRef = useRef(0)

  const introDone = currentRow >= rows.length
  const paused = history.length > 0 || focused || input.length > 0

  // Typewriter + auto-rerun (2.6 s). Pauses while the visitor is interacting.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setCurrentRow(rows.length)
      setCurrentChar(999)
      return
    }
    if (paused) return

    if (isWaitingLoop) {
      const t = setTimeout(() => {
        setCurrentRow(0)
        setCurrentChar(1)
        setIsWaitingLoop(false)
      }, 2600)
      return () => clearTimeout(t)
    }

    if (currentRow >= rows.length) {
      setIsWaitingLoop(true)
      return
    }

    const target = rows[currentRow]
    if (!target) return

    if (currentChar < target.text.length) {
      const t = setTimeout(() => setCurrentChar((c) => Math.min(c + 1, target.text.length)), 20)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setCurrentRow((r) => r + 1)
      setCurrentChar(0)
    }, target.prompt ? 300 : 100)
    return () => clearTimeout(t)
  }, [currentRow, currentChar, isWaitingLoop, rows, paused])

  // keep newest output in view (inside the terminal only)
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history])

  // allow the command palette to focus the terminal
  useEffect(() => {
    const onFocusReq = () => {
      setCurrentRow(rows.length)
      window.setTimeout(() => inputRef.current?.focus(), 60)
    }
    window.addEventListener('portfolio:focus-terminal', onFocusReq)
    return () => window.removeEventListener('portfolio:focus-terminal', onFocusReq)
  }, [rows.length])

  const execute = (raw: string) => {
    const cmd = raw.trim().toLowerCase()
    if (!cmd) return
    setCmdLog((p) => [...p, cmd])
    setCmdIdx(-1)
    setInput('')

    if (cmd === 'clear') {
      setHistory([])
      return
    }
    const res = runCommand(cmd, skillDomains)
    idRef.current += 1
    setHistory((p) => [...p, { id: idRef.current, command: cmd, lines: res.lines, egg: res.egg }])
    if (res.target) {
      const id = res.target
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 450)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    execute(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!cmdLog.length) return
      const i = cmdIdx === -1 ? cmdLog.length - 1 : Math.max(0, cmdIdx - 1)
      setCmdIdx(i)
      setInput(cmdLog[i])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (cmdIdx === -1) return
      const i = cmdIdx + 1
      if (i >= cmdLog.length) {
        setCmdIdx(-1)
        setInput('')
      } else {
        setCmdIdx(i)
        setInput(cmdLog[i])
      }
    }
  }

  return (
    <div className="term" role="group" aria-label="Interactive introduction terminal">
      <div className="term-bar">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="term-title">zsh: shivansh@portfolio ~ (auto-reruns)</span>
        <span className="term-loop-tag" style={{ opacity: paused || isWaitingLoop ? 1 : 0.4 }}>
          {paused ? 'interactive' : isWaitingLoop ? 'rerunning in 2s...' : 'active'}
        </span>
      </div>

      <div
        className="term-body"
        ref={bodyRef}
        onClick={() => introDone && inputRef.current?.focus()}
      >
        {rows.map((row, idx) => {
          if (idx > currentRow) return null
          const isCurrent = idx === currentRow
          const visible = isCurrent ? row.text.slice(0, currentChar) : row.text
          return (
            <p key={idx} className={row.prompt ? 'row cmd' : 'row'}>
              {row.prompt && (
                <span className="ps" aria-hidden="true">
                  ~ %
                </span>
              )}
              <span className="txt" style={{ color: row.prompt ? '#ffffff' : '#ece9e1' }}>
                {visible}
              </span>
              {isCurrent && <span className="caret" aria-hidden="true" />}
            </p>
          )
        })}

        <div aria-live="polite">
          {history.map((item) => (
            <div key={item.id} className="term-entry">
              <p className="row cmd">
                <span className="ps" aria-hidden="true">
                  ~ %
                </span>
                <span className="txt">{item.command}</span>
              </p>
              {item.lines.map((l, i) => (
                <p key={i} className={`term-line ${item.egg ? 'egg' : ''}`}>
                  {l}
                </p>
              ))}
            </div>
          ))}
        </div>

        {introDone && (
          <form className="term-form" onSubmit={onSubmit}>
            <span className="ps" aria-hidden="true">
              ~ %
            </span>
            <input
              ref={inputRef}
              className="term-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder='type "help"'
              aria-label="Terminal command input"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </form>
        )}
      </div>

      <div className="term-chips" aria-label="Command suggestions">
        {SUGGESTIONS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            className="chip-btn"
            onClick={() => {
              setCurrentRow(rows.length)
              execute(cmd)
            }}
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  )
}