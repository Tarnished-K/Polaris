import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureMonitoringException } from './sentry'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class MonitoringErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureMonitoringException(error, { componentStack: info.componentStack })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="app-loading" role="alert">
          予期しないエラーが発生しました。ページを再読み込みしてください。
        </main>
      )
    }
    return this.props.children
  }
}
