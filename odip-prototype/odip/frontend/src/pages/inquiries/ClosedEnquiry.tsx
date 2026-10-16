import { useState } from 'react'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { CLOSE_OUTCOME_LABELS } from '@/lib/inquiryClose'
import { FALLBACK_ZONE, visitDay } from '@/lib/intakeBooking'
import { ReopenInquiryDialog } from './ReopenInquiryDialog'

/**
 * A closed enquiry in the form (SHAPE.md section 11): read-only. Why and when it closed, with Reopen; the details as facts, not disabled inputs;
 * where its contacts went; one way back. No Intake visit card: an upcoming visit was cancelled with the close.
 */
export function ClosedEnquiry({ row, onReopened, onBack }: {
  row: ParticipantInquiryDto
  onReopened: (answer: ParticipantInquiryDto) => void
  onBack: () => void
}) {
  const [reopening, setReopening] = useState(false)
  const when = row.closedAt ? visitDay(row.closedAt, row.timeZoneId || FALLBACK_ZONE) : ''
  const why = row.closeOutcome ? `: ${CLOSE_OUTCOME_LABELS[row.closeOutcome]}` : ''
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Callout tone="info" title={`Closed on ${when}${why}.`} actions={<Button variant="secondary" size="sm" onClick={() => setReopening(true)}>Reopen enquiry</Button>}>
        {row.closeNote && <span className="break-words">{row.closeNote}</span>}
      </Callout>
      <Card title="Enquiry">
        <FactList items={[
          { label: 'Name', value: `${row.firstName} ${row.lastName}` },
          { label: 'Phone', value: row.phone },
          { label: 'Email', value: row.email },
          { label: 'Source', value: row.source },
          { label: 'Provenance or referral notes', value: row.provenance },
        ]} />
      </Card>
      <Card title="Contacts">
        <p className="text-sm">Contacts were deleted when this enquiry closed.</p>
      </Card>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack}>Back to enquiries</Button>
      </div>
      {reopening && <ReopenInquiryDialog row={row} onCancel={() => setReopening(false)} onDone={answer => { setReopening(false); onReopened(answer) }} />}
    </div>
  )
}
