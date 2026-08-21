import { useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { RosterExceptionDto } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ShieldCheck, AlertOctagon, AlertTriangle } from 'lucide-react'
import { useSlideOverA11y } from '../lib/useSlideOverA11y'
import { formatDateAu } from '@/lib/utils'

export type ExceptionsDrawerProps = {
  open: boolean
  onClose: () => void
  exceptions: RosterExceptionDto[]
  onJumpToShift: (shiftId: string) => void
}

export function ExceptionsDrawer({ open, onClose, exceptions, onJumpToShift }: ExceptionsDrawerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useSlideOverA11y(open, onClose, panelRef)

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-card shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="font-display font-semibold text-foreground">Exceptions this week</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {exceptions.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No exceptions this week"
              description="Every shift on the board clears the roster's compliance checks."
            />
          ) : (
            <ul className="space-y-2">
              {exceptions.map((exception, i) => {
                const blocking = exception.finding.severity === 'Blocking'
                return (
                  <li key={`${exception.shiftId ?? 'unlinked'}-${i}`}>
                    <button
                      type="button"
                      disabled={!exception.shiftId}
                      onClick={() => exception.shiftId && onJumpToShift(exception.shiftId)}
                      className="w-full rounded-sm border border-border bg-surface-container-low px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent disabled:cursor-default disabled:hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start gap-2">
                        {blocking ? (
                          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {exception.participantName} · {formatDateAu(exception.serviceDate)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{exception.finding.message}</p>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
