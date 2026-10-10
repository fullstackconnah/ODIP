import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, PillBottle } from 'lucide-react'
import { useMedicationRegister } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { SearchInput } from '@/components/SearchInput'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { isPastDue } from '@/lib/deadline'
import { ComplianceFlagChips } from './MedicationBadges'
import { DRUG_SCHEDULE_LABELS, SUPPORT_LEVEL_LABELS, MEDICATION_TYPE_LABELS, PACKAGING_LABELS } from '@/api/types/medications'
import type { MedicationListDto } from '@/api/types/medications'

// Matches MedicationsController.GetRegister's own PagingParams.DefaultPageSize (backend house
// convention: default 50, ceiling 200) — kept in sync manually since paging params cross the API
// boundary as plain query strings, not a shared type.
const REGISTER_PAGE_SIZE = 50

const STATUS_ITEMS = [
  { value: '', label: 'All' },
  { value: 'Active', label: 'Active' },
  { value: 'OnHold', label: 'On hold' },
  { value: 'Ceased', label: 'Ceased' },
]

export default function RegisterTab() {
  const { canManageMedications } = usePermissions()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const queryParams: Record<string, string> = { page: String(page), pageSize: String(REGISTER_PAGE_SIZE) }
  if (search) queryParams.search = search
  if (status) queryParams.status = status

  const { data: medications = [], isLoading } = useMedicationRegister(queryParams)
  // `medications` is normally a TruncatableList (see pagedList.ts), but the `= []` default used
  // while loading is a plain array without that extra field — read it as optional, same pattern
  // as IncidentsPage/ParticipantPicker.
  const { totalCount = medications.length } = medications as Partial<TruncatableList<MedicationListDto>>

  // A search/status change can leave `page` pointing past the end of the new, smaller result
  // set — reset to page 1 whenever the query's own filters change. Adjusted during render
  // (React's documented pattern for "resetting state when a dependency changes",
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than in a useEffect, which would call setState synchronously in an effect body —
  // copies IncidentsPage's identical fix for the set-state-in-effect lint rule.
  const filterResetKey = `${search}|${status}`
  const [prevFilterResetKey, setPrevFilterResetKey] = useState(filterResetKey)
  if (filterResetKey !== prevFilterResetKey) {
    setPrevFilterResetKey(filterResetKey)
    setPage(1)
  }

  // NextReviewDue is a date held in a DateTime ("2026-10-03T00:00:00"): overdue from the day AFTER, not from local midnight on the due day.
  const isReviewOverdue = (dateStr: string | null) => isPastDue(dateStr)

  // Column budget (density §4): nine columns with an uncapped medication and dose need ~1300px against a ~1006px box at 1280, which
  // pushed Status off-screen. The three text columns are capped (ellipsis, full text in the tooltip); Type, Support level and Schedule
  // stay, and the table scrolls in its box with the first column and the actions pinned (DataTable's column rule). The compliance flags
  // wrap in their own cell, so they never widen the table.
  const columns: Column<MedicationListDto>[] = useMemo(() => [
    { key: 'participantName', header: 'Participant', className: 'font-medium', maxWidth: '9rem' },
    {
      key: 'name',
      header: 'Medication',
      render: m => (
        <CellText className="md:max-w-[12rem]" title={m.strength ? `${m.name} ${m.strength}` : m.name}>
          {m.name}
          {m.strength && <span className="text-[var(--color-muted-foreground)]"> {m.strength}</span>}
        </CellText>
      ),
    },
    {
      key: 'doseDescription',
      header: 'Dose',
      render: m => (
        <div>
          <CellText className="md:max-w-[10rem]" title={m.doseDescription || undefined}>{m.doseDescription || '—'}</CellText>
          {m.packaging !== 'OriginalPackaging' && (
            <div className="text-xs text-[var(--color-muted-foreground)] md:max-w-[10rem] md:truncate">{PACKAGING_LABELS[m.packaging]}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: m => (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.type === 'Prn' ? 'bg-[var(--color-secondary-container)] text-[var(--color-foreground)]' : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'}`}>
          {MEDICATION_TYPE_LABELS[m.type]}
        </span>
      ),
    },
    {
      key: 'drugSchedule',
      header: 'Schedule',
      render: m => (m.drugSchedule === 'Schedule4' || m.drugSchedule === 'Schedule8')
        ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] whitespace-nowrap">{DRUG_SCHEDULE_LABELS[m.drugSchedule]}</span>
        : <span className="text-[var(--color-muted-foreground)]">—</span>,
    },
    { key: 'supportLevel', header: 'Support level', render: m => SUPPORT_LEVEL_LABELS[m.supportLevel] },
    { key: 'complianceFlags', header: 'Flags', render: m => <ComplianceFlagChips flags={m.complianceFlags} /> },
    {
      key: 'nextReviewDue',
      header: 'Next review',
      render: m => (
        <span className={isReviewOverdue(m.nextReviewDue) ? 'text-[var(--color-destructive)] font-medium' : ''}>
          {formatDateAu(m.nextReviewDue)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: m => <StatusBadge status={m.status} /> },
  ], [])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search medications or participants..." />
          <div className="w-40">
            <Dropdown
              variant="form"
              value={status}
              onChange={setStatus}
              items={STATUS_ITEMS}
              label="All"
            />
          </div>
        </div>
        {canManageMedications && (
          <Button to="/medications/new" size="md">
            <Plus className="w-4 h-4" /> New medication
          </Button>
        )}
      </div>

      {!isLoading && medications.length === 0 ? (
        <EmptyState
          icon={PillBottle}
          title={search || status ? 'No medications match your filters' : 'No medications in the register yet'}
          description={search || status ? 'Try a different search term or status filter.' : "Medications are added from a participant's Medications tab."}
          action={search || status ? { label: 'Clear filters', onClick: () => { setSearch(''); setStatus('') } } : undefined}
        />
      ) : (
        <DataTable
          data={medications}
          columns={columns}
          keyField="id"
          loading={isLoading}
          onRowClick={m => navigate(`/medications/${m.id}/edit`)}
          emptyMessage="No medications found"
          pagination={{
            page,
            pageSize: REGISTER_PAGE_SIZE,
            totalCount,
            onPageChange: setPage,
          }}
        />
      )}

      <p className="text-xs text-[var(--color-muted-foreground)] px-1">
        Medication scope of practice varies by state and territory — verify tasks against your jurisdiction's medicines and poisons legislation.
      </p>
    </div>
  )
}
