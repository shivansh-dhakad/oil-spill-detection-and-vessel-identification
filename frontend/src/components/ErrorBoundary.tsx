import { Component, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="fatal" role="alert">
        <h1>Something broke on this page</h1>
        <p>Reload to try again. If it keeps happening, email me and I will fix it.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Reload page
        </button>
      </main>
    )
  }
}
