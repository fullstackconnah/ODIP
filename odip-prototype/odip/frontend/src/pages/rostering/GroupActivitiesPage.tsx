import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { CalendarDays, Users } from 'lucide-react'
import { useGroupActivities, useModuleVisibility } from '@/api/hooks'
import type { GroupActivityDto, ShiftStatus } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { httpStatusOf } from '@/lib/httpStatus'
import { TONE } from '@/lib/tone'
import { extractErrorMessage } from '@/lib/utils'
import { formatShiftTime, weekStartOf } from './lib/roster'

const PAGE_SIZE = 25

// The states an activity can hold, in the order a coordinator thinks of them.
const STATUS_LABELS: { value: ShiftStatus; label: string }[] = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Published', label: 'Published' },
  { value: 'InProgress', label: 'In progress' },
  { value: 'PendingReview', label: 'Pending review' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
]
const STATUS_ITEMS = [{ value: '', label: 'All statuses' }, ...STATUS_LABELS]
const labelOf = (status: ShiftStatus) => STATUS_LABELS.find(s => s.value === status)?.label ?? status

/** This week, Monday to Sunday: the board's own week. */
function thisWeek() {
  const from = weekStartOf(new Date())
  return { from, to: format(addDays(parseISO(from), 6), 'yyyy-MM-dd') }
}

// The en dash is followed by U+2060 so a narrow cell never breaks after it.
const timeRange = (a: GroupActivityDto) => `${formatShiftTime(a.startTime)}–⁠${formatShiftTime(a.endTime)}${a.endsNextDay ? ' (next day)' : ''}`

function StaffCell({ activity }: { activity: GroupActivityDto }) {
  const names = activity.staff.map(s => s.staffName)
  const short = activity.status !== 'Cancelled' ? activity.staffNeeded - activity.staffAssigned : 0
  return (
    // A div, not a span: DataTable's phone meta line truncates spans, and this cell wraps (so the dot keeps its spaces and nothing leaves the card).
    <div className="min-w-0 md:max-w-56">
      {names.length === 0 ? <span className="text-[var(--color-muted-foreground)]">Nobody yet</span> : names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')}
      {short > 0 && <span className={TONE.warning.ink}> · {short} more needed</span>}
    </div>
  )
}

const columns: Column<GroupActivityDto>[] = [
  { key: 'serviceDate', header: 'Date', mobile: 'meta', render: a => format(parseISO(a.serviceDate), 'EEE d MMM') },
  { key: 'startTime', header: 'Time', mobile: 'meta', render: timeRange },
  {
    // md:w-full takes the room the other columns leave; md:max-w-0 stops the text widening the column, so CellText truncates to the cell.
    key: 'title', header: 'Activity', mobile: 'primary', className: 'md:w-full md:max-w-0',
    render: a => (
      <div className="min-w-0">
        <CellText className="font-semibold">{a.title}</CellText>
        {(a.series || a.location) && <CellText className="text-xs text-[var(--color-muted-foreground)]">{[a.series?.interval, a.location].filter(Boolean).join(' · ')}</CellText>}
      </div>
    ),
  },
  { key: 'staff', header: 'Staff', mobile: 'meta', wrap: true, className: 'max-md:basis-full max-md:max-w-none! md:min-w-44', render: a => <StaffCell activity={a} /> },
  { key: 'participants', header: 'Participants', align: 'right', mobile: 'trail', render: a => <span className="tabular-nums">{a.participants.filter(p => !p.didNotAttend).length}</span> },
  { key: 'status', header: 'Status', mobile: 'status', render: a => <StatusBadge status={a.status} label={labelOf(a.status)} className="whitespace-nowrap" /> },
]

/** Every group activity in a date range, one row each: a register for the office. A row opens the activity on the roster board, at its week. */
export default function GroupActivitiesPage() {
  const navigate = useNavigate()
  const visibility = useModuleVisibility()
  const on = visibility.data?.groupActivitiesEnabled === true
  const [defaults] = useState(thisWeek)
  const [status, setStatus] = useState<ShiftStatus | ''>('')
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, error, refetch } = useGroupActivities({ from, to, ...(status ? { status } : {}) }, page, PAGE_SIZE, on && Boolean(from) && Boolean(to))
  const rows = data?.items ?? []
  const filtered = status !== '' || from !== defaults.from || to !== defaults.to
  const off = (visibility.data && !on) || httpStatusOf(error) === 409
  const rangeRefused = httpStatusOf(error) === 400

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Group activities" />

      {!off && (
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="sm:w-48">
          <FormField label="Status">
            <Dropdown variant="form" value={status} onChange={v => { setStatus(v as ShiftStatus | ''); setPage(1) }} items={STATUS_ITEMS} />
          </FormField>
        </div>
        <TextField label="From" type="date" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPage(1) }} />
        <TextField label="To" type="date" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPage(1) }} />
      </div>
      )}

      {visibility.isLoading || (on && isLoading) ? (
        <PageState kind="loading" noun="group activities" />
      ) : off ? (
        <EmptyState icon={Users} title="Group activities are turned off" description="An admin can turn them on in Settings, under Workspace." />
      ) : !from || !to ? (
        <Callout tone="warning">Choose a from and to date.</Callout>
      ) : rangeRefused ? (
        <Callout tone="warning">{extractErrorMessage(error, 'Choose a shorter date range.')}</Callout>
      ) : isError ? (
        <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>}>
          Couldn't load group activities. Check your connection and try again.
        </Callout>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={CalendarDays} title="No group activities match these filters" description="Try a different status or date range." />
        ) : (
          <EmptyState icon={CalendarDays} title="No group activities this week" description="Add one from the roster board with New, then Group activity." action={{ label: 'Open roster board', to: '/rostering', variant: 'secondary' }} />
        )
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          keyField="id"
          emptyMessage="No group activities found"
          onRowClick={a => navigate(`/rostering?date=${a.serviceDate}&activity=${a.id}`)}
          pagination={{ page, pageSize: PAGE_SIZE, totalCount: data?.totalCount ?? rows.length, onPageChange: setPage }}
        />
      )}
    </div>
  )
}
