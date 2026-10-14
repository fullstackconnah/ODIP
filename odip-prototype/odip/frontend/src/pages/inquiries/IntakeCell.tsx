import { AlertCircle } from 'lucide-react'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { TAP_AREA } from '@/components/tapArea'
import { DEFAULT_DURATION, FALLBACK_ZONE, inviteLine, isPastVisit, visitWhen } from '@/lib/intakeBooking'
import { TONE } from '@/lib/tone'

type IntakeCellProps = { row: ParticipantInquiryDto; canManage: boolean; onOpen: (row: ParticipantInquiryDto) => void; now?: Date }

/**
 * The enquiry table's Intake cell (SHAPE.md section 1):
 * - line 1 is the booking ("Fri 16 Oct, 10:00 am · Sam"), which opens the panel, with a badge (Not confirmed, Confirmed or Past);
 * - line 2 is what the latest invite did;
 * - Book intake when there is no booking; a dash for a direct intake (no enquiry) and for a read-only viewer's empty cell.
 * Each control carries `data-intake-control` (the enquiry id): the page focuses it after the panel closes, a cancel, or a dismissed notice.
 */
export function IntakeCell({ row, canManage, onOpen, now = new Date() }: IntakeCellProps) {
  const name = `${row.firstName} ${row.lastName}`
  if (row.isDirectIntake) return <span>—</span>
  if (!row.intakeStartsAt) {
    return canManage ? (
      <Button size="sm" variant="secondary" data-intake-control={row.id} className="max-md:min-h-11" onClick={() => onOpen(row)}>
        Book intake<span className="sr-only"> for {name}</span>
      </Button>
    ) : <span>—</span>
  }
  const past = isPastVisit(row.intakeStartsAt, row.intakeDurationMinutes ?? DEFAULT_DURATION, now)
  const when = visitWhen(row.intakeStartsAt, row.timeZoneId || FALLBACK_ZONE, now)
  const label = [when, row.intakeStaffFirstName].filter(Boolean).join(' · ')
  // A narrow cell breaks line 1 only after the dot, never inside the date and time.
  const text = [when.replaceAll(' ', '\u00a0'), row.intakeStaffFirstName].filter(Boolean).join('\u00a0· ')
  const line2 = past ? null : inviteLine(row)
  const ink = past ? TONE.neutral.ink : ''
  return (
    <div className="max-w-[18rem]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {canManage ? (
          <button
            type="button"
            data-intake-control={row.id}
            // Starts with the visible words (Label in Name); a hidden span would leave a stray space before the comma.
            aria-label={`${label}, intake visit for ${name}`}
            onClick={() => onOpen(row)}
            className={`${TAP_AREA} max-md:min-h-11 rounded-sm text-left font-medium hover:text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${ink}`}
          >
            {text}
          </button>
        ) : <span className={ink}>{text}</span>}
        {past ? <StatusBadge tone="neutral" label="Past" />
          : row.intakeConfirmedAt ? <StatusBadge tone="success" label="Confirmed" />
          : <StatusBadge tone="warning" label="Not confirmed" />}
      </div>
      {line2 && (
        <p className={`mt-0.5 flex items-start gap-1 text-[13px] ${line2.failed ? TONE.danger.ink : 'text-[var(--color-muted-foreground)]'}`}>
          {line2.failed && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {line2.text}
        </p>
      )}
    </div>
  )
}
