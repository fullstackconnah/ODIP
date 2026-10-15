import { useIntakeVisits } from '@/api/hooks'
import type { IntakeVisitDto } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { isPastVisit, visitDay, visitTimes } from '@/lib/intakeBooking'
import { StartIntakeButton } from '@/pages/inquiries/StartIntakeButton'

const columns: Column<IntakeVisitDto>[] = [
  { key: 'firstName', header: 'Person', mobile: 'primary', render: v => `${v.firstName} ${v.lastName}` },
  { key: 'startsAt', header: 'When', mobile: 'meta', render: v => `${visitDay(v.startsAt, v.timeZoneId)}, ${visitTimes(v.startsAt, v.durationMinutes, v.timeZoneId, true)}` },
  { key: 'location', header: 'Where', mobile: 'meta', maxWidth: '16rem' },
  { key: 'staffName', header: "Who's going", mobile: 'meta' },
  {
    key: 'confirmedAt', header: 'Reply', mobile: 'status',
    render: v => (v.confirmedAt ? <StatusBadge tone="success" label="Confirmed" /> : <StatusBadge tone="warning" label="Not confirmed" />),
  },
  { key: 'actions', header: 'Actions', type: 'custom', render: v => <StartIntakeButton visit={v} size="sm" /> },
]

/**
 * Upcoming intake visits for every staff member, on the Schedule page (SHAPE.md section 3). The page is a trips-by-resources matrix with no day
 * axis and no staff rows when there are no trips, so the visits get a section of their own above it. It shows with or without trips, never
 * holds the matrix up, and draws nothing while it loads or when no visit is coming up.
 */
export function IntakeVisitsSection() {
  const visits = useIntakeVisits({})
  if (visits.isLoading) return null
  if (visits.isError) {
    return (
      <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => visits.refetch()}>Try again</Button>}>
        Couldn't load intake visits.
      </Callout>
    )
  }
  const upcoming = (visits.data ?? []).filter(v => !isPastVisit(v.startsAt, v.durationMinutes))
  if (upcoming.length === 0) return null
  return (
    <section aria-labelledby="intake-visits-heading" className="flex flex-col gap-3">
      <h2 id="intake-visits-heading" className="text-sm font-semibold text-[var(--color-foreground)]">Intake visits</h2>
      <DataTable data={upcoming} columns={columns} keyField="inquiryId" />
    </section>
  )
}
