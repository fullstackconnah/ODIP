import { useState } from 'react'
import type { AxiosError } from 'axios'
import { CalendarOff, Plus } from 'lucide-react'
import { useMyLeave, useCreateLeaveRequest, useCancelMyLeave, useCreateMyUnavailability, useCancelMyUnavailability } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TabNav } from '@/components/TabNav'
import { LeaveRequestFormModal } from './components/LeaveRequestFormModal'
import { UnavailabilityFormModal } from './components/UnavailabilityFormModal'
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_COLORS } from '@/api/types'
import type { LeaveRequestDto, RecurringUnavailabilityDto, CreateLeaveRequestDto, CreateRecurringUnavailabilityDto } from '@/api/types'
import { formatEffectiveRange } from '@/pages/rostering/lib/roster'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

type WithdrawTarget = { kind: 'leave' | 'unavailability'; id: string }

export default function PortalLeavePage() {
  const { canRequestLeave } = usePermissions()
  const [tab, setTab] = useState<'leave' | 'unavailability'>('leave')
  const { data, isLoading, isError, refetch } = useMyLeave()
  const createLeave = useCreateLeaveRequest()
  const cancelLeave = useCancelMyLeave()
  const createUnavailability = useCreateMyUnavailability()
  const cancelUnavailability = useCancelMyUnavailability()

  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [withdrawTarget, setWithdrawTarget] = useState<WithdrawTarget | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const leave = data?.leave ?? []
  const unavailability = data?.unavailability ?? []

  function openForm() {
    setFormError(null)
    setFormOpen(true)
  }

  async function handleCreateLeave(payload: CreateLeaveRequestDto) {
    setFormError(null)
    try {
      await createLeave.mutateAsync(payload)
      setFormOpen(false)
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not submit this leave request. Please try again.'))
    }
  }

  async function handleCreateUnavailability(payload: CreateRecurringUnavailabilityDto) {
    setFormError(null)
    try {
      await createUnavailability.mutateAsync(payload)
      setFormOpen(false)
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not submit this unavailability request. Please try again.'))
    }
  }

  async function handleWithdraw() {
    if (!withdrawTarget) return
    setActionError(null)
    try {
      if (withdrawTarget.kind === 'leave') await cancelLeave.mutateAsync(withdrawTarget.id)
      else await cancelUnavailability.mutateAsync(withdrawTarget.id)
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not withdraw this request. Please try again.'))
    } finally {
      setWithdrawTarget(null)
    }
  }

  const leaveColumns: Column<LeaveRequestDto>[] = [
    { key: 'leaveType', header: 'Type', render: r => LEAVE_TYPE_LABELS[r.leaveType] ?? r.leaveType },
    { key: 'startDate', header: 'Start', type: 'date' },
    { key: 'endDate', header: 'End', type: 'date' },
    { key: 'status', header: 'Status', render: r => (
      <div>
        <StatusBadge status={r.status} colorMap={LEAVE_STATUS_COLORS} />
        {r.status === 'Declined' && r.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{r.decisionNote}</p>
        )}
      </div>
    ) },
    ...(canRequestLeave ? [{
      key: 'actions', header: '', align: 'right' as const, render: (r: LeaveRequestDto) => r.status === 'Pending' && (
        <button
          type="button"
          onClick={() => setWithdrawTarget({ kind: 'leave', id: r.id })}
          className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline"
        >
          Withdraw
        </button>
      ),
    }] : []),
  ]

  const unavailabilityColumns: Column<RecurringUnavailabilityDto>[] = [
    { key: 'dayOfWeek', header: 'Day' },
    { key: 'window', header: 'Time', render: r => `${r.startTime.slice(0, 5)}–${r.endTime.slice(0, 5)}` },
    { key: 'effectiveRange', header: 'Effective range', render: r => formatEffectiveRange(r.effectiveFrom, r.effectiveTo) },
    { key: 'status', header: 'Status', render: r => (
      <div>
        <StatusBadge status={r.status} colorMap={LEAVE_STATUS_COLORS} />
        {r.status === 'Declined' && r.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{r.decisionNote}</p>
        )}
      </div>
    ) },
    ...(canRequestLeave ? [{
      key: 'actions', header: '', align: 'right' as const, render: (r: RecurringUnavailabilityDto) => r.status === 'Pending' && (
        <button
          type="button"
          onClick={() => setWithdrawTarget({ kind: 'unavailability', id: r.id })}
          className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline"
        >
          Withdraw
        </button>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My leave" subtitle="Request leave or a regular weekly unavailability, and track what's been decided.">
        {canRequestLeave && (
          <button
            type="button"
            onClick={openForm}
            className="flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] shadow-md hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> {tab === 'leave' ? 'Request leave' : 'Add unavailability'}
          </button>
        )}
      </PageHeader>

      {actionError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {actionError}
        </div>
      )}

      <TabNav
        tabs={[{ key: 'leave', label: 'Leave' }, { key: 'unavailability', label: 'Regular unavailability' }]}
        active={tab}
        onChange={key => setTab(key as 'leave' | 'unavailability')}
      />

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : isError ? (
        <EmptyState
          icon={CalendarOff}
          title="Couldn't load your leave"
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: () => refetch() }}
        />
      ) : tab === 'leave' ? (
        leave.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title="No leave requests yet"
            description="Request Annual, Sick, Personal or Other leave and track its status here."
          />
        ) : (
          <DataTable data={leave} columns={leaveColumns} keyField="id" emptyMessage="No leave requests" />
        )
      ) : unavailability.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No regular unavailability set"
          description="Add a standing weekly window you're not available, e.g. every Monday morning."
        />
      ) : (
        <DataTable data={unavailability} columns={unavailabilityColumns} keyField="id" emptyMessage="No regular unavailability" />
      )}

      {tab === 'leave' ? (
        <LeaveRequestFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreateLeave} submitting={createLeave.isPending} errorMessage={formError} />
      ) : (
        <UnavailabilityFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreateUnavailability} submitting={createUnavailability.isPending} errorMessage={formError} />
      )}

      <ConfirmDialog
        open={withdrawTarget !== null}
        onConfirm={handleWithdraw}
        onCancel={() => setWithdrawTarget(null)}
        title="Withdraw request"
        message="This withdraws your pending request. You can submit a new one at any time."
        confirmLabel="Withdraw"
        variant="danger"
        loading={cancelLeave.isPending || cancelUnavailability.isPending}
      />
    </div>
  )
}
