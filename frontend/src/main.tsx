import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/overrides.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

// The admin dashboard is a separate lazy chunk: visitors never download it.
const AdminApp = lazy(() => import('./admin/AdminApp'))
const isAdmin = location.pathname === '/admin' || location.pathname.startsWith('/admin/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isAdmin ? (
        <Suspense fallback={null}>
          <AdminApp />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
)