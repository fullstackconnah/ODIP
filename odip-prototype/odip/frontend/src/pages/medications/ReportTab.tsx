import { useMemo, useState } from 'react'
import { FileClock } from 'lucide-react'
import { useAdministrationsReport, useParticipants } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { WITNESS_STATUS_LABELS } from '@/api/types/medications'
import type { AdministrationDto } from '@/api/types/medications'
import { formatWithTimeZone } from '@/lib/utils'

const ADMIN_STATUS_COLOR_MAP: Record<string, string> = {
  administered: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  refused: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  withheld: 'bg-amber-100 text-amber-800',
  missed: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  wrongmedication: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

const WITNESS_STATUS_COLOR_MAP: Record<string, string> = {
  notrequired: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  declined: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

/**
 * Medication administration report (task 6b): every administration, filterable by participant
 * and date range, ordered by when the dose was given (most recent first) — backed by
 * GET /medications/administrations/report.
 */
export default function ReportTab() {
  const [participantId, setParticipantId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const rangeInvalid = Boolean(from && to && from > to)

  // INTAKE-08: the medication picker excludes drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const { data: report, isLoading } = useAdministrationsReport({
    participantId: participantId || undefined,
    from: from || undefined,
    to: to || undefined,
    pageSize: 200,
  })

  const participantItems = useMemo(() => [
    { value: '', label: 'All participants' },
    ...participants.map(p => ({ value: p.id, label: p.fullName })),
  ], [participants])

  const items = report?.items ?? []

  const columns: Column<AdministrationDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium' },
    {
      key: 'medicationName',
      header: 'Medication',
      render: a => (
        <div>
          <span>{a.medicationName}</span>
          {a.doseDescription && <p className="text-xs text-[var(--color-muted-foreground)]">{a.doseDescription}</p>}
        </div>
      ),
    },
    { key: 'doseGiven', header: 'Dose Given', render: a => a.doseGiven || '—' },
    {
      key: 'administeredAt',
      header: 'When Given',
      sortable: true,
      render: a => formatWithTimeZone(a.administeredAt ?? a.scheduledAt, a.administeredAtTimeZone, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
    },
    { key: 'recordedByName', header: 'Staff', render: a => a.recordedByName || '—' },
    {
      key: 'witnessStatus',
      header: 'Witness',
      render: a => a.witnessStatus === 'NotRequired'
        ? <span className="text-[var(--color-muted-foreground)]">—</span>
        : (
          <div className="space-y-0.5">
            <StatusBadge status={a.witnessStatus} label={WITNESS_STATUS_LABELS[a.witnessStatus]} colorMap={WITNESS_STATUS_COLOR_MAP} />
            {a.witnessName && <p className="text-xs text-[var(--color-muted-foreground)]">{a.witnessName}</p>}
          </div>
        ),
    },
    { key: 'status', header: 'Status', render: a => <StatusBadge status={a.status} colorMap={ADMIN_STATUS_COLOR_MAP} /> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <label className="block text-xs font-medium mb-1 text-[var(--color-muted-foreground)]" htmlFor="report-participant">Participant</label>
          <Dropdown id="report-participant" variant="form" value={participantId} onChange={setParticipantId} items={participantItems} searchable label="All participants" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--color-muted-foreground)]" htmlFor="report-from">From</label>
          <input id="report-from" type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-[var(--color-muted-foreground)]" htmlFor="report-to">To</label>
          <input id="report-to" type="date" value={to} onChange={e => setTo(e.target.value)}
            aria-invalid={rangeInvalid || undefined}
            aria-describedby={rangeInvalid ? 'report-range-error' : undefined}
            className={`px-3 py-2 rounded-lg bg-[var(--color-input)] border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] ${rangeInvalid ? 'border-[var(--color-destructive)]' : 'border-[var(--color-border)]'}`} />
        </div>
        {report && !rangeInvalid && (
          <span className="text-sm text-[var(--color-muted-foreground)] ml-auto">
            {report.totalCount} administration{report.totalCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {rangeInvalid && (
        <p id="report-range-error" role="alert" className="text-sm text-[var(--color-destructive)]">
          The "From" date must be on or before the "To" date.
        </p>
      )}

      {rangeInvalid ? null : !isLoading && items.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="No administrations found"
          description="Try a different participant or widen the date range."
        />
      ) : (
        <DataTable
          data={items}
          columns={columns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No administrations found"
        />
      )}
    </div>
  )
}
