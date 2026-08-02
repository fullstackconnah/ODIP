import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
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

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="max-w-md rounded-lg bg-white p-8 text-center shadow-md">
            <h2 className="mb-2 text-xl font-semibold text-[#43493a]">
              Something went wrong
            </h2>
            <p className="mb-6 text-sm text-[#43493a]/70">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={this.handleReset}
              className="rounded-lg bg-[#396200] px-5 py-2 text-sm font-medium text-white hover:bg-[#396200]/90"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
