import { Link } from 'react-router-dom'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { TAP_FLOOR } from '@/components/tapArea'
import { FACT_LIST_WRAP, mainContactFacts } from '@/lib/inquiryDetails'

/**
 * A converted enquiry's Main contact, Participant details and Other contacts, as one read-only card (SHAPE.md section 11, E5; D7): intake has started,
 * so they are the participant's record now, and the intake save no longer syncs them back (L6). The main contact stays here for reference.
 */
export function ConvertedDetailsCard({ participantId, firstName, contact }: {
  participantId: string
  firstName: string
  contact: Parameters<typeof mainContactFacts>[0]
}) {
  return (
    <Card title="Contacts and details">
      <div className="flex flex-col gap-[var(--field-gap-y)]">
        <p className="text-sm">
          Intake has started, so {firstName}'s main contact, details and other contacts are on their record now.{' '}
          <Link to={`/participants/${participantId}/intake`} className={`font-medium text-[var(--color-primary)] underline underline-offset-2 ${TAP_FLOOR}`}>Open the intake</Link>
        </p>
        <FactList className={FACT_LIST_WRAP} items={mainContactFacts(contact)} />
      </div>
    </Card>
  )
}
