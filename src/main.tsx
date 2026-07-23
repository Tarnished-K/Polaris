import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initializeErrorMonitoring, Sentry } from './monitoring/sentry'
import './styles.css'

initializeErrorMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<main className="app-loading" role="alert">予期しないエラーが発生しました。ページを再読み込みしてください。</main>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
