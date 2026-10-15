import { CalendarClock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAgreementsEnding } from '@/api/hooks'
import type { AgreementEndingDto } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { endingWords } from '@/lib/agreementEnding'
import { formatServiceDate } from '@/lib/planQuote'

const columns: Column<AgreementEndingDto>[] = [
  { key: 'participantName', header: 'Participant', mobile: 'primary' },
  { key: 'agreementEndDate', header: 'Agreement ends', render: row => formatServiceDate(row.agreementEndDate) },
  { key: 'state', header: 'State', mobile: 'status', render: row => <StatusBadge tone={row.daysLeft < 0 ? 'danger' : 'warning'} label={row.daysLeft < 0 ? 'Ended' : 'Ending'} /> },
  // The house's dates, built from the row, not the alert's ISO words (fix round 2).
  { key: 'status', header: 'What it means', wrap: true, mobile: 'meta', render: row => endingWords(row.daysLeft, row.agreementEndDate, row.renewalVersion) },
]

/**
 * The Participants register's Agreements ending view (agreement PR 2, D9): the organisation's agreements ending within 60 days, or ended with no successor approved, in the server's order (soonest
 * end first) and in the participant alert's words. A row opens the agreement, where it is renewed. The search narrows by name, on the list already read.
 */
export function AgreementsEndingList({ search }: { search: string }) {
  const navigate = useNavigate()
  const query = useAgreementsEnding()
  const term = search.trim().toLowerCase()
  const rows = (query.data ?? []).filter(row => !term || row.participantName.toLowerCase().includes(term))

  if (query.isError && !query.data) return <PageState kind="error" noun="list of agreements ending" onRetry={() => { void query.refetch() }} />
  if (!query.isLoading && rows.length === 0) {
    return term
      ? <EmptyState icon={CalendarClock} title="No agreements ending match your search" description="Try a different name, or clear the search." />
      : <EmptyState icon={CalendarClock} title="No agreements ending" description="An agreement approved for rostering shows here from 60 days before it ends, and stays once it has ended until its renewal is approved." />
  }
  return (
    <DataTable
      data={rows} columns={columns} keyField="participantId" sortable={false} loading={query.isLoading}
      onRowClick={row => navigate(`/participants/${row.participantId}/agreement-draft`)}
    />
  )
}
