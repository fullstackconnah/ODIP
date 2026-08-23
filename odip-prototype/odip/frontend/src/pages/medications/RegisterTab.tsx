import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, PillBottle } from 'lucide-react'
import { useMedicationRegister } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { SearchInput } from '@/components/SearchInput'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { ComplianceFlagChips } from './MedicationBadges'
import { DRUG_SCHEDULE_LABELS, SUPPORT_LEVEL_LABELS, MEDICATION_TYPE_LABELS } from '@/api/types/medications'
import type { MedicationListDto } from '@/api/types/medications'

const STATUS_ITEMS = [
  { value: '', label: 'All' },
  { value: 'Active', label: 'Active' },
  { value: 'OnHold', label: 'On hold' },
  { value: 'Ceased', label: 'Ceased' },
]

const MED_STATUS_COLOR_MAP: Record<string, string> = {
  active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  onhold: 'bg-amber-100 text-amber-800',
  ceased: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

export default function RegisterTab() {
  const { canManageMedications } = usePermissions()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const { data: medications = [], isLoading } = useMedicationRegister({
    search: search || undefined,
    status: status || undefined,
  })

  const isReviewOverdue = (dateStr: string | null) => !!dateStr && new Date(dateStr).getTime() < Date.now()

  const columns: Column<MedicationListDto>[] = useMemo(() => [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium' },
    {
      key: 'name',
      header: 'Medication',
      sortable: true,
      render: m => (
        <span>
          {m.name}
          {m.strength && <span className="text-[var(--color-muted-foreground)]"> {m.strength}</span>}
        </span>
      ),
    },
    { key: 'doseDescription', header: 'Dose', render: m => m.doseDescription || '—' },
    {
      key: 'type',
      header: 'Type',
      render: m => (
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.type === 'Prn' ? 'bg-[var(--color-secondary-container)] text-[#0d1c2e]' : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'}`}>
          {MEDICATION_TYPE_LABELS[m.type]}
        </span>
      ),
    },
    {
      key: 'drugSchedule',
      header: 'Schedule',
      render: m => (m.drugSchedule === 'Schedule4' || m.drugSchedule === 'Schedule8')
        ? <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">{DRUG_SCHEDULE_LABELS[m.drugSchedule]}</span>
        : <span className="text-[var(--color-muted-foreground)]">—</span>,
    },
    { key: 'supportLevel', header: 'Support level', render: m => SUPPORT_LEVEL_LABELS[m.supportLevel] },
    { key: 'complianceFlags', header: 'Flags', render: m => <ComplianceFlagChips flags={m.complianceFlags} /> },
    {
      key: 'nextReviewDue',
      header: 'Next review',
      sortable: true,
      render: m => (
        <span className={isReviewOverdue(m.nextReviewDue) ? 'text-[var(--color-destructive)] font-medium' : ''}>
          {formatDateAu(m.nextReviewDue)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, render: m => <StatusBadge status={m.status} colorMap={MED_STATUS_COLOR_MAP} /> },
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
          <Link
            to="/medications/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20 transition-all"
          >
            <Plus className="w-4 h-4" /> New medication
          </Link>
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
          sortable
          loading={isLoading}
          onRowClick={m => navigate(`/medications/${m.id}/edit`)}
          emptyMessage="No medications found"
        />
      )}

      <p className="text-xs text-[var(--color-muted-foreground)] px-1">
        Medication scope of practice varies by state and territory — verify tasks against your jurisdiction's medicines and poisons legislation.
      </p>
    </div>
  )
}
