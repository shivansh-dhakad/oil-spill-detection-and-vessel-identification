import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { PROFILE_DATA } from '../data/portfolioData'
import {
  IconSend,
  IconCopy,
  IconCheck,
  IconGitHub,
  IconLinkedIn,
  IconInstagram,
  IconTerminal,
} from './Icons'

interface ContactSectionProps {
  profile: typeof PROFILE_DATA // live profile from the database (email, GitHub, LinkedIn)
  instagramUrl: string | null
}

export default function ContactSection({ profile, instagramUrl }: ContactSectionProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(profile.email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !message.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'Please fill in all fields.',
      })
      return
    }

    setIsSubmitting(true)
    setStatusMessage(null)

    try {
      if (supabase) {
        const { error } = await supabase.from('messages').insert([
          {
            name: name.trim(),
            email: email.trim(),
            message: message.trim(),
          },
        ])

        if (error) {
          throw error
        }
      } else {
        throw new Error('Supabase is not configured')
      }

      setStatusMessage({
        type: 'success',
        text: 'Message sent. Thanks for reaching out!',
      })
      setName('')
      setEmail('')
      setMessage('')
    } catch (err: unknown) {
      console.error('Contact transmission failed:', err)
      setStatusMessage({
        type: 'error',
        text: 'Couldn’t send your message. Please email me directly instead.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const prettyUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

  return (
    <section id="contact" className="section-block" aria-labelledby="contact-heading">
      <div className="section-header">
        <div className="section-tag">
          <IconTerminal />
          <span>CONTACT</span>
        </div>
        <h2 id="contact-heading" className="section-title">
          Contact me
        </h2>
        <p className="section-desc">
          Send me a message, or find me on LinkedIn and GitHub.
        </p>
      </div>

      <div className="contact-grid">
        {/* Contact Form */}
        <div className="contact-form-card">
          <h3 className="card-subhead">Send a message</h3>
          <p className="form-subnote">
            Your message goes straight to my inbox.
          </p>

          <form onSubmit={handleSubmit} className="contact-form">
            <div className="form-group">
              <label htmlFor="contact-name" className="form-label">
                Name:
              </label>
              <input
                id="contact-name"
                type="text"
                required
                maxLength={100}
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="contact-email" className="form-label">
                Email Address:
              </label>
              <input
                id="contact-email"
                type="email"
                required
                maxLength={200}
                placeholder="your.email@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="contact-msg" className="form-label">
                Message:
              </label>
              <textarea
                id="contact-msg"
                required
                maxLength={4000}
                rows={5}
                placeholder="What would you like to talk about?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="form-textarea"
              />
            </div>

            {statusMessage && (
              <div
                className={`form-status-alert ${statusMessage.type === 'success' ? 'status-ok' : 'status-err'}`}
                role="alert"
              >
                {statusMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary btn-submit"
            >
              <IconSend />
              <span>{isSubmitting ? 'Sending…' : 'Send message'}</span>
            </button>
          </form>
        </div>

        {/* Contact Channels & Direct Endpoints */}
        <div className="contact-channels-card">
          <h3 className="card-subhead">Other ways to reach me</h3>
          <p className="form-subnote">
            Email me, or find me on GitHub and LinkedIn.
          </p>

          {/* Copy Email Box */}
          <div className="email-copy-box">
            <div className="email-label-col">
              <span className="email-label">EMAIL</span>
              <span className="email-val">{profile.email}</span>
            </div>
            <button
              type="button"
              className="btn-copy-email"
              onClick={handleCopyEmail}
              aria-label="Copy email address"
            >
              {copied ? (
                <>
                  <IconCheck />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <IconCopy />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Social Links List */}
          <div className="social-links-list">
            <a
              href={profile.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="social-channel-item"
            >
              <div className="channel-icon-wrap">
                <IconGitHub />
              </div>
              <div className="channel-info">
                <span className="channel-name">GitHub</span>
                <span className="channel-sub">{prettyUrl(profile.githubUrl)}</span>
              </div>
              <span className="channel-arrow">&rarr;</span>
            </a>

            <a
              href={profile.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="social-channel-item"
            >
              <div className="channel-icon-wrap">
                <IconLinkedIn />
              </div>
              <div className="channel-info">
                <span className="channel-name">LinkedIn</span>
                <span className="channel-sub">{prettyUrl(profile.linkedinUrl)}</span>
              </div>
              <span className="channel-arrow">&rarr;</span>
            </a>

            {instagramUrl ? (
              <a
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="social-channel-item"
              >
                <div className="channel-icon-wrap">
                  <IconInstagram />
                </div>
                <div className="channel-info">
                  <span className="channel-name">Instagram</span>
                  <span className="channel-sub">{prettyUrl(instagramUrl)}</span>
                </div>
                <span className="channel-arrow">&rarr;</span>
              </a>
            ) : (
              <div className="social-channel-item channel-disabled">
                <div className="channel-icon-wrap">
                  <IconInstagram />
                </div>
                <div className="channel-info">
                  <span className="channel-name">Instagram</span>
                  <span className="channel-sub">Media profile link coming soon</span>
                </div>
                <span className="channel-badge">Pending</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}