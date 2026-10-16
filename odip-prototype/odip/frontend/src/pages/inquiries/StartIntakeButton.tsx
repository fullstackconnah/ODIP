import { useId, useState } from 'react'
import { isAxiosError } from 'axios'
import { Link, useNavigate } from 'react-router-dom'
import { useConvertParticipantInquiry } from '@/api/hooks'
import type { IntakeVisitDto } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { convertRefusal, fullName, startIntakeReason } from '@/lib/inquiryDetails'
import { visitStage } from '@/lib/intakeBooking'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'

const TRY_AGAIN = "Couldn't start the intake. Try again."

/**
 * Start intake (or Resume intake) from a schedule entry, with today's behaviour: convert the enquiry, then open the intake form prefilled. It shows
 * nothing once the intake is complete, and nothing to a role that cannot convert an enquiry or fill the intake (a staff member moved to support
 * worker keeps the visit on My shifts). "Starting…" while busy, aria-disabled so focus stays; a failure is an alert line under the button.
 * Until the enquiry has its full address and a named main contact (L5, D1) the button stays, aria-disabled and described by why, with a link to fix it.
 */
export function StartIntakeButton({ visit, size = 'md' }: { visit: IntakeVisitDto; size?: 'sm' | 'md' }) {
  const navigate = useNavigate()
  const convert = useConvertParticipantInquiry()
  const { canManageParticipantLifecycle } = usePermissions()
  const [failed, setFailed] = useState<string | null>(null)
  const reasonId = useId()
  const stage = visitStage(visit)
  if (stage === 'complete' || !canManageParticipantLifecycle) return null
  const name = fullName(visit.firstName, visit.lastName)
  const reason = stage === 'new' ? startIntakeReason({ id: visit.inquiryId, hasAddress: visit.hasAddress, contactNeedsName: visit.contactNeedsName }) : null
  const start = () => {
    if (convert.isPending || reason) return
    setFailed(null)
    if (stage === 'draftintake') {
      navigate(`/participants/${visit.participantId}/intake`)
      return
    }
    convert.mutate({ id: visit.inquiryId }, {
      onSuccess: inquiry => { if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`) },
      // A 409 carries its own sentence (the role rules, closed, changed by someone else); anything else is not the coordinator's to read.
      onError: err => setFailed(convertRefusal(err, name) ?? (isAxiosError(err) && err.response?.status === 409 ? extractErrorMessage(err, TRY_AGAIN) : TRY_AGAIN)),
    })
  }
  return (
    <div>
      <Button
        variant="secondary"
        size={size}
        onClick={start}
        aria-disabled={convert.isPending || !!reason || undefined}
        aria-describedby={reason ? reasonId : undefined}
        className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
      >
        {convert.isPending ? 'Starting…' : stage === 'draftintake' ? 'Resume intake' : 'Start intake'}<span className="sr-only"> for {name}</span>
      </Button>
      {reason && (
        <p id={reasonId} className="mt-1.5 max-w-[18rem] whitespace-normal text-sm text-[var(--color-muted-foreground)]">
          {reason.address ? `Start intake needs ${visit.firstName}'s full address.` : "Start intake needs the main contact's name."}{' '}
          <Link to={reason.to} className="underline underline-offset-2 hover:text-[var(--color-primary)]">{reason.text}</Link>
        </p>
      )}
      {failed && <p role="alert" className="mt-1.5 text-sm text-[var(--color-destructive)]">{failed}</p>}
    </div>
  )
}
