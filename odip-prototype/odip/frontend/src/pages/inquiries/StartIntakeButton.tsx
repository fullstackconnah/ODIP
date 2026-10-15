import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConvertParticipantInquiry } from '@/api/hooks'
import type { IntakeVisitDto } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { visitStage } from '@/lib/intakeBooking'
import { usePermissions } from '@/lib/permissions'

/**
 * Start intake (or Resume intake) from a schedule entry, with today's behaviour: convert the enquiry, then open the intake form prefilled. It shows
 * nothing once the intake is complete, and nothing to a role that cannot convert an enquiry or fill the intake (a staff member moved to support
 * worker keeps the visit on My shifts). "Starting…" while busy, aria-disabled so focus stays; a failure is an alert line under the button.
 */
export function StartIntakeButton({ visit, size = 'md' }: { visit: IntakeVisitDto; size?: 'sm' | 'md' }) {
  const navigate = useNavigate()
  const convert = useConvertParticipantInquiry()
  const { canManageParticipantLifecycle } = usePermissions()
  const [failed, setFailed] = useState(false)
  const stage = visitStage(visit)
  if (stage === 'complete' || !canManageParticipantLifecycle) return null
  const name = `${visit.firstName} ${visit.lastName}`
  const start = () => {
    if (convert.isPending) return
    setFailed(false)
    if (stage === 'draftintake') {
      navigate(`/participants/${visit.participantId}/intake`)
      return
    }
    convert.mutate({ id: visit.inquiryId }, {
      onSuccess: inquiry => { if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`) },
      onError: () => setFailed(true),
    })
  }
  return (
    <div>
      <Button variant="secondary" size={size} onClick={start} aria-disabled={convert.isPending || undefined} className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed">
        {convert.isPending ? 'Starting…' : stage === 'draftintake' ? 'Resume intake' : 'Start intake'}<span className="sr-only"> for {name}</span>
      </Button>
      {failed && <p role="alert" className="mt-1.5 text-sm text-[var(--color-destructive)]">Couldn't start the intake. Try again.</p>}
    </div>
  )
}
