import { useState, useEffect, useMemo } from 'react'
import { IconCode, IconCopy, IconCheck } from './Icons'

interface CodeLine {
  num: number
  html: string
  plain: string
}

export default function AboutCodeIntro() {
  const [copied, setCopied] = useState(false)
  const [revealedCount, setRevealedCount] = useState(0)
  const [isWaitingLoop, setIsWaitingLoop] = useState(false)

  // Concise, readable developer profile code with concise line lengths to prevent overflow
  const codeLines: CodeLine[] = useMemo(
    () => [
      {
        num: 1,
        plain: '# === SHIVANSH DHAKAD // DEVELOPER PROFILE ===',
        html: '<span class="c-comment"># === SHIVANSH DHAKAD // DEVELOPER PROFILE ===</span>',
      },
      {
        num: 2,
        plain: 'name = "Shivansh Dhakad"',
        html: 'name = <span class="c-str">"Shivansh Dhakad"</span>',
      },
      {
        num: 3,
        plain: 'education = "B.Tech CSE (AI & ML) @ LNCT Bhopal"',
        html: 'education = <span class="c-str">"B.Tech CSE (AI & ML) @ LNCT Bhopal"</span>',
      },
      {
        num: 4,
        plain: 'cohort = "2024 - 2028 (Undergraduate)"',
        html: 'cohort = <span class="c-str">"2024 - 2028 (Undergraduate)"</span>',
      },
      {
        num: 5,
        plain: '',
        html: '',
      },
      {
        num: 6,
        plain: 'focus_areas = [',
        html: 'focus_areas = [',
      },
      {
        num: 7,
        plain: '    "Deep Learning & Convolutional Vision",',
        html: '    <span class="c-str">"Deep Learning & Convolutional Vision"</span>,',
      },
      {
        num: 8,
        plain: '    "Satellite SAR Radar Image Processing",',
        html: '    <span class="c-str">"Satellite SAR Radar Image Processing"</span>,',
      },
      {
        num: 9,
        plain: '    "Retrieval-Augmented Generation (RAG)",',
        html: '    <span class="c-str">"Retrieval-Augmented Generation (RAG)"</span>,',
      },
      {
        num: 10,
        plain: '    "Clinical Biomarker Risk Prediction",',
        html: '    <span class="c-str">"Clinical Biomarker Risk Prediction"</span>,',
      },
      {
        num: 11,
        plain: ']',
        html: ']',
      },
      {
        num: 12,
        plain: '',
        html: '',
      },
      {
        num: 13,
        plain: 'flagship_systems = {',
        html: 'flagship_systems = {',
      },
      {
        num: 14,
        plain: '    "VarunaDrishti": "Satellite Oil Spill Detection",',
        html: '    <span class="c-str">"VarunaDrishti"</span>: <span class="c-str">"Satellite Oil Spill Detection"</span>,',
      },
      {
        num: 15,
        plain: '    "LUMINA": "Multimodal Conversational RAG",',
        html: '    <span class="c-str">"LUMINA"</span>: <span class="c-str">"Multimodal Conversational RAG"</span>,',
      },
      {
        num: 16,
        plain: '    "KrishiMitra": "Crop Disease Diagnosis Vision",',
        html: '    <span class="c-str">"KrishiMitra"</span>: <span class="c-str">"Crop Disease Diagnosis Vision"</span>,',
      },
      {
        num: 17,
        plain: '    "CardioShield AI": "Cardiac Risk Stratification",',
        html: '    <span class="c-str">"CardioShield AI"</span>: <span class="c-str">"Cardiac Risk Stratification"</span>,',
      },
      {
        num: 18,
        plain: '    "English-Hindi": "Neural Machine Translation",',
        html: '    <span class="c-str">"English-Hindi"</span>: <span class="c-str">"Neural Machine Translation"</span>,',
      },
      {
        num: 19,
        plain: '}',
        html: '}',
      },
      {
        num: 20,
        plain: '',
        html: '',
      },
      {
        num: 21,
        plain: 'current_research = "Edge tensor quantization & agentic loops"',
        html: 'current_research = <span class="c-str">"Edge tensor quantization & agentic loops"</span>',
      },
      {
        num: 22,
        plain: 'status = "Ready to collaborate on high-impact AI systems."',
        html: 'status = <span class="c-str">"Ready to collaborate on high-impact AI systems."</span>',
      },
    ],
    []
  )

  // Auto-rerun loop: Streams line by line smoothly, then waits 10s before restarting
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setRevealedCount(codeLines.length)
      return
    }

    if (isWaitingLoop) {
      const waitTimer = setTimeout(() => {
        setRevealedCount(0)
        setIsWaitingLoop(false)
      }, 10000) // 10-second timer before smooth rerun (not shown on screen)
      return () => clearTimeout(waitTimer)
    }

    if (revealedCount < codeLines.length) {
      const lineTimer = setTimeout(() => {
        setRevealedCount((prev) => prev + 1)
      }, 70)
      return () => clearTimeout(lineTimer)
    } else {
      // Completed all lines, start 10s pause before re-running
      setIsWaitingLoop(true)
    }
  }, [revealedCount, isWaitingLoop, codeLines.length])

  const handleCopy = async () => {
    const rawText = codeLines.map((l) => l.plain).join('\n')
    try {
      await navigator.clipboard.writeText(rawText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  return (
    <section id="about" className="section-block" aria-labelledby="about-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconCode />
          <span>ABOUT ME // WHO I AM</span>
        </div>
        <h2 id="about-heading" className="section-title">
          Developer Background &amp; Engineering Philosophy
        </h2>
        <p className="section-desc">
          Building end-to-end intelligent systems by uniting mathematical fundamentals with production-grade AI code.
        </p>
      </div>

      <div className="about-redesigned-grid">
        {/* Left Column: Human narrative story cards */}
        <div className="about-narrative-col">
          <div className="about-narrative-card">
            <span className="narrative-tag">ENGINEERING FOCUS</span>
            <h3 className="narrative-title">Machine Learning Student &amp; Applied AI Developer</h3>
            <p className="narrative-para">
              I am an undergraduate Computer Science student at <strong>Lakshmi Narain College of Technology (LNCT), Bhopal (2024–2028)</strong>, specializing in Artificial Intelligence and Machine Learning.
            </p>
            <p className="narrative-para">
              Rather than treating machine learning as abstract theory, I build end-to-end solutions that solve tangible problems. My work ranges from processing satellite Synthetic Aperture Radar (SAR) tiles for oceanic oil spill containment, to developing foliar plant pathology classifiers for Indian farmers, to constructing grounded multimodal RAG platforms with verified citations.
            </p>
          </div>

          <div className="about-pillars-grid">
            <div className="pillar-item">
              <span className="pillar-num">01</span>
              <h4>Mathematical Rigor</h4>
              <p>Linear algebra, multivariate calculus, and probability theory forming the foundation of every model choice.</p>
            </div>
            <div className="pillar-item">
              <span className="pillar-num">02</span>
              <h4>Production Mindset</h4>
              <p>Clean Python, PyTorch, and FastAPI endpoints built for low-latency inference and real-world deployment.</p>
            </div>
            <div className="pillar-item">
              <span className="pillar-num">03</span>
              <h4>Domain Curiosity</h4>
              <p>Deep interest in remote sensing, agricultural technology, clinical diagnostics, and agentic autonomy.</p>
            </div>
          </div>
        </div>

        {/* Right Column: Clean IDE window with fixed size and auto-replaying execution */}
        <div className="about-code-col">
          <div className="ide-window ide-fixed-card">
            <div className="ide-title-bar">
              <div className="ide-controls" aria-hidden="true">
                <span className="dot dot-close" />
                <span className="dot dot-min" />
                <span className="dot dot-max" />
              </div>

              <div className="ide-tabs">
                <div className="ide-tab active" role="tab" aria-selected="true">
                  <span className="file-icon py">py</span>
                  <span className="tab-name">about.py</span>
                </div>
              </div>

              <div className="ide-actions">
                <button
                  type="button"
                  className="ide-btn"
                  onClick={handleCopy}
                  aria-label="Copy code"
                >
                  {copied ? <IconCheck /> : <IconCopy />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Fixed height container, no horizontal bar / scrollbar */}
            <div
              className="ide-code-container fixed-height-body"
              role="region"
              aria-label="about.py interactive code"
            >
              <pre className="code-pre">
                <code>
                  {codeLines.slice(0, revealedCount).map((line) => (
                    <div key={line.num} className="code-row">
                      <span className="line-num" aria-hidden="true">{line.num}</span>
                      <span
                        className="line-content"
                        dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
                      />
                    </div>
                  ))}
                  {revealedCount < codeLines.length && (
                    <div className="code-row">
                      <span className="line-num" aria-hidden="true">{revealedCount + 1}</span>
                      <span className="caret" aria-hidden="true" />
                    </div>
                  )}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
