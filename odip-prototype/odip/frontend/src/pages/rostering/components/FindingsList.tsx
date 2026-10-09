import { AlertOctagon, AlertTriangle } from 'lucide-react'
import type { RosterFindingDto } from '@/api/types'

export type FindingsAnswered = {
  /** The codes of Blocking findings another control on the form has answered. */
  codes: readonly string[]
  /** What those rows say they are now, e.g. "Booking as an emergency". */
  label: string
}

export type FindingsListProps = {
  findings: RosterFindingDto[]
  className?: string
  /**
   * Blocking findings that something else on the form has answered (the shift panel's "Emergency or safety", once its description is real) are drawn as answered, in the warning wash with a label,
   * not as a standing red refusal beside a Save button that now works. They are still listed, and still say what they found.
   */
  answered?: FindingsAnswered
}

/**
 * Renders roster findings with severity distinguished — Blocking findings read as a hard stop,
 * Warnings read as something the coordinator can choose to override. Reused by the shift
 * slide-over, the drag-and-drop override confirm, and the exceptions drawer.
 */
export function FindingsList({ findings, className, answered }: FindingsListProps) {
  if (findings.length === 0) return null

  return (
    <ul className={`space-y-2 ${className ?? ''}`}>
      {findings.map((finding, index) => {
        const blocking = finding.severity === 'Blocking'
        const isAnswered = blocking && !!answered?.codes.includes(finding.code)
        return (
          <li
            // Two pools past their funding are two findings with ONE code, so the pool and period are part of the key (and the position, for two findings that are otherwise the same).
            key={`${finding.code}|${finding.budget?.poolName ?? ''}|${finding.budget?.periodStart ?? ''}|${index}`}
            className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${
              isAnswered
                ? 'border-[var(--color-warning)] bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
                : blocking
                  ? 'border-destructive/30 bg-error-container text-destructive'
                  : 'border-border bg-surface-container-low text-foreground'
            }`}
          >
            {blocking && !isAnswered ? (
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              // The warning ink, not the amber fill: the fill is about 1.9:1 on this box, under what an icon needs.
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-on-warning-container)]" aria-hidden="true" />
            )}
            {isAnswered && answered ? (
              // The label goes under the sentence, not beside it: beside it the sentence was squeezed into a narrow column in a phone-width panel.
              <div className="flex min-w-0 flex-col items-start gap-1">
                <span>{finding.message}</span>
                <span className="rounded-sm border border-[var(--color-on-warning-container)]/40 px-1.5 py-0.5 text-xs font-medium">{answered.label}</span>
              </div>
            ) : (
              <span>{finding.message}</span>
            )}
            {!blocking && finding.requiresReason && (
              <span className="ml-auto shrink-0 rounded-sm bg-[var(--color-warning-container)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-on-warning-container)]">
                Reason required
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
