import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import type { RpReportLine } from '@/api/types/restrictive-practices'
import { RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import { DataTable, CellText, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { TAP_TRUNCATED_LINK } from '@/components/tapArea'
import { formatDateAu } from '@/lib/utils'
import { plural } from '@/lib/format'
import { MonthlyReportModal } from './MonthlyReportModal'
import { monthLabel } from './rpReportFormat'

/** DataTable wants one key field: a practice has one line per month. */
type Row = RpReportLine & { rowKey: string }

const TONE = { Overdue: 'danger', Due: 'warning', Lodged: 'success' } as const

function usageText(l: Row) {
  if (l.useKind === 'Routine') return 'Routine'
  return `As needed · ${l.uses.length === 0 ? 'no uses' : plural(l.uses.length, 'use')}`
}

type Props = {
  /** Every line; the month filter is applied here. */
  lines: RpReportLine[]
  /** '' is every month. */
  month: string
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function RpMonthlyReportsTab({ lines, month, isLoading, isError, onRetry }: Props) {
  const [open, setOpen] = useState<RpReportLine | null>(null)
  const shown: Row[] = (month ? lines.filter(l => l.month === month) : lines).map(l => ({ ...l, rowKey: `${l.restrictivePracticeId}:${l.month}` }))

  const columns: Column<Row>[] = [
    { key: 'state', header: 'Status', mobile: 'status', render: l => <StatusBadge tone={TONE[l.state]} label={l.state} /> },
    { key: 'month', header: 'Month', mobile: 'meta', className: 'max-md:order-0!', render: l => monthLabel(l.month) },
    {
      key: 'participantName',
      header: 'Participant',
      mobile: 'primary',
      render: l => (
        <Link
          to={`/participants/${l.participantId}`}
          title={l.participantName}
          className={`inline-block align-middle text-[var(--color-primary)] hover:underline md:max-w-[12rem] md:truncate ${TAP_TRUNCATED_LINK}`}
        >
          {l.participantName}
        </Link>
      ),
    },
    {
      key: 'practice',
      header: 'Practice',
      render: l => {
        const text = `${RESTRICTIVE_PRACTICE_TYPE_LABELS[l.practiceType]} · ${l.practiceDescription}`
        return <CellText title={text} className="md:max-w-[15rem]">{text}</CellText>
      },
    },
    { key: 'use', header: 'Use', mobile: 'hidden', render: usageText },
    {
      key: 'dueOn',
      header: 'Due by',
      mobile: 'meta',
      className: 'max-md:order-1!',
      render: l => (
        <>
          {formatDateAu(l.dueOn)}
          {l.dueCountedWithoutHolidays && (
            <span className="text-[var(--color-muted-foreground)]" title="No holiday list for this year yet; weekends only."> (weekends only)</span>
          )}
        </>
      ),
    },
    { key: 'lodgedOn', header: 'Lodged', mobile: 'hidden', minWidth: '7rem', render: l => l.report ? formatDateAu(l.report.lodgedOn) : '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      // Always visible, not in a RowMenu: lodging is this queue's whole purpose.
      render: l => l.report
        ? <Button size="sm" variant="ghost" aria-label={`View the ${monthLabel(l.month)} report for ${l.participantName}`} onClick={() => setOpen(l)}>View</Button>
        : <Button size="sm" aria-label={`Lodge the ${monthLabel(l.month)} report for ${l.participantName}`} onClick={() => setOpen(l)}>Lodge</Button>,
    },
  ]

  if (!isLoading && !isError && lines.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No monthly reports yet."
        description="A month shows here once it ends, for each authorised restrictive practice that needs reporting."
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Lodge each report in the NDIS Commission portal, then record it here. Due dates count weekends and national public holidays; the portal may differ.
      </p>
      <DataTable
        data={shown}
        columns={columns}
        keyField="rowKey"
        loading={isLoading}
        error={isError}
        onRetry={onRetry}
        emptyMessage="No monthly reports found"
      />
      <MonthlyReportModal line={open} onClose={() => setOpen(null)} onReload={onRetry} />
    </div>
  )
}
