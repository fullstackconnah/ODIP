import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/Button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /**
   * A caught error is cleared when this value changes. A boundary inside the app shell passes the pathname, so the user who
   * navigates away from a broken page (the shell's nav stays usable for exactly that) lands on a working one instead of the same error.
   */
  resetKey?: string
  /** Fill the area the boundary sits in instead of the whole viewport: for a boundary inside the shell, whose nav must stay on screen. */
  inline?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)

    // After a new deployment, cached JS may reference old chunk filenames that
    // no longer exist. Detect this and force a full page reload (once) so the
    // browser fetches the new entry point with updated chunk hashes.
    if (this.isStaleChunkError(error)) {
      const reloadKey = 'ErrorBoundary_reloaded'
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1')
        window.location.reload()
        return
      }
      // Already reloaded once this session — don't loop
      sessionStorage.removeItem(reloadKey)
    }
  }

  private isStaleChunkError(error: Error): boolean {
    const msg = error.message || ''
    return (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('error loading dynamically imported module')
    )
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) this.handleReset()
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className={`flex items-center justify-center ${this.props.inline ? 'py-16' : 'min-h-screen bg-gray-50'}`}>
          <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-md">
            <h2 className="mb-2 text-xl font-semibold text-[var(--color-muted-foreground)]">
              Something went wrong
            </h2>
            <p className="mb-6 text-sm text-[var(--color-muted-foreground)]/70">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <Button onClick={this.handleReset}>
              Try again
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
