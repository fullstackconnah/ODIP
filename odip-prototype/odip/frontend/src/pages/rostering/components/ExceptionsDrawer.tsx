import type { RosterExceptionDto } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ShieldCheck, AlertOctagon, AlertTriangle } from 'lucide-react'
import { SlideOver } from '@/components/SlideOver'
import { formatDateAu } from '@/lib/utils'

export type ExceptionsDrawerProps = {
  open: boolean
  onClose: () => void
  exceptions: RosterExceptionDto[]
  onJumpToShift: (shiftId: string) => void
}

export function ExceptionsDrawer({ open, onClose, exceptions, onJumpToShift }: ExceptionsDrawerProps) {
  if (!open) return null

  return (
    <SlideOver open onClose={onClose} title="Exceptions this week">
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
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-surface-container-low px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent disabled:cursor-default disabled:hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </SlideOver>
  )
}
