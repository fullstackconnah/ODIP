import { AlertOctagon, AlertTriangle } from 'lucide-react'
import type { RosterFindingDto } from '@/api/types'

export type FindingsListProps = {
  findings: RosterFindingDto[]
  className?: string
}

/**
 * Renders roster findings with severity distinguished — Blocking findings read as a hard stop,
 * Warnings read as something the coordinator can choose to override. Reused by the shift
 * slide-over, the drag-and-drop override confirm, and the exceptions drawer.
 */
export function FindingsList({ findings, className }: FindingsListProps) {
  if (findings.length === 0) return null

  return (
    <ul className={`space-y-2 ${className ?? ''}`}>
      {findings.map(finding => {
        const blocking = finding.severity === 'Blocking'
        return (
          <li
            key={finding.code}
            className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${
              blocking
                ? 'border-destructive/30 bg-error-container text-destructive'
                : 'border-border bg-surface-container-low text-foreground'
            }`}
          >
            {blocking ? (
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            )}
            <span>{finding.message}</span>
          </li>
        )
      })}
    </ul>
  )
}
