import { useState } from 'react'
import type { ParticipantInquiryDetailDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { BackActionButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { CLOSE_OUTCOME_LABELS } from '@/lib/inquiryClose'
import { detailFacts, FACT_LIST_WRAP, fullName, hasStoredDetails, mainContactFacts } from '@/lib/inquiryDetails'
import { FALLBACK_ZONE, visitDay } from '@/lib/intakeBooking'
import { ReopenInquiryDialog } from './ReopenInquiryDialog'

/**
 * A closed enquiry in the form (SHAPE.md section 11): read-only. Why and when it closed, with Reopen; the details as facts, not disabled inputs;
 * where its other contacts went; one way back. The main contact lives in the enquiry's own columns, so it survives a close (2026-10-16 redesign). No Intake visit card: an upcoming visit was cancelled with the close.
 */
export function ClosedEnquiry({ row, onReopened }: {
  row: ParticipantInquiryDetailDto
  onReopened: (answer: ParticipantInquiryDto) => void
}) {
  const [reopening, setReopening] = useState(false)
  const when = row.closedAt ? visitDay(row.closedAt, row.timeZoneId || FALLBACK_ZONE) : ''
  const why = row.closeOutcome ? `: ${CLOSE_OUTCOME_LABELS[row.closeOutcome]}` : ''
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Callout tone="info" title={`Closed on ${when}${why}.`} actions={<Button variant="secondary" size="sm" onClick={() => setReopening(true)}>Reopen enquiry</Button>}>
        {row.closeNote && <span className="break-words">{row.closeNote}</span>}
      </Callout>
      <Card title="Participant">
        <FactList className={FACT_LIST_WRAP} items={[
          { label: 'Name', value: fullName(row.firstName, row.lastName) },
          { label: 'Source', value: row.source },
          { label: 'Provenance', value: row.provenance },
        ]} />
      </Card>
      <Card title="Main contact">
        <FactList className={FACT_LIST_WRAP} items={mainContactFacts(row)} />
      </Card>
      {hasStoredDetails(row) && (
        <Card title="Participant details">
          <FactList className={FACT_LIST_WRAP} items={detailFacts(row)} />
        </Card>
      )}
      <Card title="Other contacts">
        <p className="text-sm">Other contacts were deleted when this enquiry closed.</p>
      </Card>
      <div className="flex gap-2">
        <BackActionButton to="/participants?tab=enquiries">Back to enquiries</BackActionButton>
      </div>
      {reopening && <ReopenInquiryDialog row={row} onCancel={() => setReopening(false)} onDone={answer => { setReopening(false); onReopened(answer) }} />}
    </div>
  )
}
