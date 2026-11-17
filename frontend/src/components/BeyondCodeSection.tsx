import type { BeyondCodeItem } from '../data/portfolioData'
import { IconMusic, IconBike, IconInstagram } from './Icons'

// Keep the card short: only the first sentence of the description is shown
const firstSentence = (text: string) => {
  const m = text.match(/^.*?[.!?](?:\s|$)/)
  return m ? m[0].trim() : text
}

export default function BeyondCodeSection({ instagramUrl, items }: { instagramUrl: string | null; items: BeyondCodeItem[] }) {
  if (items.length === 0) return null

  return (
    <section id="beyond-code" className="section-block" aria-labelledby="beyond-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconMusic />
          <span>INTERESTS // BEYOND THE TERMINAL</span>
        </div>
        <h2 id="beyond-heading" className="section-title">
          Beyond the Code
        </h2>
        <p className="section-desc">Interests and activities outside the screen.</p>
      </div>

      <div className="beyond-grid">
        {items.map((item) => {
          const isFlute = item.placeholderType === 'audio'
          return (
            <div key={item.id} className="beyond-card beyond-card-compact">
              <div className="beyond-card-header">
                <div className="beyond-icon-box">{isFlute ? <IconMusic /> : <IconBike />}</div>
                <div>
                  <span className="beyond-cat">{item.category}</span>
                  <h3 className="beyond-title">{item.title}</h3>
                </div>
              </div>

              <p className="beyond-desc">{firstSentence(item.description)}</p>

              <div className="beyond-footer-row">
                {instagramUrl ? (
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="instagram-placeholder-link"
                  >
                    <IconInstagram />
                    <span>Follow on Instagram</span>
                  </a>
                ) : (
                  <a
                    href="#contact"
                    className="instagram-placeholder-link"
                    title="Instagram link will be added soon"
                  >
                    <IconInstagram />
                    <span>Instagram (soon)</span>
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}