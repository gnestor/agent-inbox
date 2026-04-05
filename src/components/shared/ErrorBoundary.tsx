import { Component, type ReactNode, type ErrorInfo } from "react"
import { Button } from "@hammies/frontend/components/ui"

interface ErrorBoundaryProps {
  children: ReactNode
  /** When any of these values change, the boundary resets (e.g., pass activeTab). */
  resetKeys?: unknown[]
  /** Optional custom fallback UI. Receives the error and a reset function. */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode
  /** Label for logging context (e.g., "SessionTab", "PluginView"). */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * React error boundary that catches rendering errors in children.
 *
 * Placement strategy (3 levels):
 * 1. Root — wraps the entire authenticated app
 * 2. Tab — wraps each tab so one crash doesn't kill the sidebar
 * 3. Plugin — wraps third-party plugin iframes
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.label ?? "unknown"
    console.error(`[ErrorBoundary:${label}] Caught error:`, error, info.componentStack)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (!this.state.error) return
    // Auto-reset when resetKeys change (e.g., user navigates to a different tab)
    const prev = prevProps.resetKeys ?? []
    const next = this.props.resetKeys ?? []
    if (prev.length !== next.length || prev.some((k, i) => k !== next[i])) {
      this.setState({ error: null })
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset })
    }

    return <DefaultFallback error={error} reset={this.reset} label={this.props.label} />
  }
}

function DefaultFallback({ error, reset, label }: { error: Error; reset: () => void; label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 max-w-sm text-center">
        <div className="text-sm font-medium text-destructive">Something went wrong</div>
        <p className="text-xs text-muted-foreground">
          {label ? `An error occurred in ${label}.` : "An unexpected error occurred."}{" "}
          Try again, or reload the page if the problem persists.
        </p>
        <pre className="text-xs text-muted-foreground bg-muted rounded px-3 py-2 max-w-full overflow-auto whitespace-pre-wrap">
          {error.message}
        </pre>
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  )
}
