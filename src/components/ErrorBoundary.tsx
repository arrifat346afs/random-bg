/**
 * ErrorBoundary — never let a render bug blank the whole app.
 *
 * The autosaved project survives a render crash, so the recovery path is a
 * reload, with a harder "reset saved project" escape for when the crash is
 * actually caused by bad persisted state.
 */

import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { KEYS } from '@/lib/state/persistence'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Something broke in the UI</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your project is still saved in this browser. Reload to get back to a clean state.
        </p>
        <pre className="max-w-lg overflow-auto rounded-lg border bg-muted p-3 text-left text-xs">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>Reload</Button>
          <Button
            variant="outline"
            onClick={() => {
              try {
                localStorage.removeItem(KEYS.project)
              } catch {
                /* ignore */
              }
              location.reload()
            }}
          >
            Reset saved project
          </Button>
        </div>
      </div>
    )
  }
}