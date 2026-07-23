import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { MonitoringErrorBoundary } from './monitoring/MonitoringErrorBoundary'
import { initializeErrorMonitoring, scheduleBrowserTracing } from './monitoring/sentry'
import './styles.css'

initializeErrorMonitoring()
scheduleBrowserTracing()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MonitoringErrorBoundary>
      <App />
    </MonitoringErrorBoundary>
  </StrictMode>,
)
