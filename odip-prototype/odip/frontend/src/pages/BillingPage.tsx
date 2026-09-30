import { useState } from 'react'
import {
  Layers, Plus, Pencil, Lock, Wallet, Receipt, ClipboardList, Filter, FileStack,
} from 'lucide-react'
import {
  useFundingSources, useUpdateFundingSource,
  useServiceBookings,
  useBillableEvents,
  useParticipants,
} from '@/api/hooks'
import type { FundingSourceDto, ServiceBookingListDto, BillableEventDto } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState, type EmptyStateProps } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { Dropdown } from '@/components/Dropdown'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'

import { TableSkeleton } from './billing/TableSkeleton'
import { BalanceIndicator } from './billing/BalanceIndicator'
import { balanceRowClassName } from './billing/balanceUtils'
import FundingSourceFormPanel from './billing/FundingSourceFormPanel'
import ServiceBookingFormPanel from './billing/ServiceBookingFormPanel'
import ServiceBookingDetailModal from './billing/ServiceBookingDetailModal'
import BillableEventFormPanel from './billing/BillableEventFormPanel'
import {
  FUNDING_ROUTE_TYPES,
  FUNDING_ROUTE_TYPE_LABELS,
  FUNDING_ROUTE_TYPE_COLORS,
  BILLABLE_EVENT_STATUSES,
  BILLABLE_EVENT_STATUS_COLORS,
  INCOME_STREAMS,
  INCOME_STREAM_LABELS,
  isBillableEventLocked,
} from './billing/constants'

const ACTIVE_STATUS_ITEMS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
]

const ACTIVE_STATUS_COLORS: Record<string, string> = {
  Active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  Inactive: 'bg-[var(--color-error-container)] text-[var(--color-destructive)]',
}

function formatHours(hours: number): string {
  return `${hours.toFixed(2)}h`
}

/** Converts a FundingSourceDto (API read shape, nullable fields) into the
 *  update payload shape (optional fields) the write endpoint expects. */
function toUpdateFundingSourcePayload(fs: FundingSourceDto, isActive: boolean) {
  return {
    participantId: fs.participantId,
    routeType: fs.routeType,
    budgetCategory: fs.budgetCategory ?? undefined,
    ndisPlanNumber: fs.ndisPlanNumber ?? undefined,
    planStartDate: fs.planStartDate ?? undefined,
    planEndDate: fs.planEndDate ?? undefined,
    budget: fs.budget ?? undefined,
    payerName: fs.payerName ?? undefined,
    payerEmail: fs.payerEmail ?? undefined,
    isActive,
  }
}

const filterSelectWrapClass = 'w-44'

/**
 * An EmptyState whose call to action is a real `<Button size="md">`. EmptyState's own `action` slot draws a
 * hand-rolled `min-h-[44px] rounded-lg` text button that ignores the density tokens (44px on a mouse); this
 * leaves that slot unset and puts the Button directly under the empty state instead — 32px on a fine
 * pointer, 44px on a coarse one, both from the tokens — at the spacing the slot used (gap-3 + mt-2 = 20px).
 * `secondary`, because every tab's toolbar above already carries the primary "New …" button. Delete this
 * once EmptyState's action renders through Button.
 */
function EmptyStateWithAction({ action, ...emptyState }: Omit<EmptyStateProps, 'action'> & { action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center gap-5 pb-10">
      {/* pb-0!: the wrapper carries the 40px bottom padding EmptyState's py-10 would otherwise put under the description. */}
      <EmptyState {...emptyState} className="pb-0!" />
      {action && (
        <Button variant="secondary" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

export default function BillingPage() {
  const { canWrite } = usePermissions()
  const [tab, setTab] = useState<'funding' | 'bookings' | 'events'>('funding')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Billing"
        subtitle="Funding sources, service bookings, and billable events"
        action={(
          <div className="flex items-center gap-2">
            <Button to="/billing/claim-batches" variant="secondary" size="md">
              <FileStack className="w-4 h-4" /> View claim batches
            </Button>
            {canWrite && (
              <Button to="/billing/claim-batches/new" size="md">
                <Layers className="w-4 h-4" /> New claim batch
              </Button>
            )}
          </div>
        )}
      />

      <Tabs
        tabs={[
          { id: 'funding', label: 'Funding Sources' },
          { id: 'bookings', label: 'Service Bookings' },
          { id: 'events', label: 'Billable Events' },
        ]}
        active={tab}
        onChange={key => setTab(key as typeof tab)}
        ariaLabel="Billing sections"
      />

      {tab === 'funding' && <FundingSourcesTab />}
      {tab === 'bookings' && <ServiceBookingsTab />}
      {tab === 'events' && <BillableEventsTab />}
    </div>
  )
}

// ── Funding Sources ─────────────────────────────────────────────

function FundingSourcesTab() {
  const { canWrite } = usePermissions()
  // INTAKE-08: claims/billing surfaces exclude drafts — a draft can't have funding
  // sources/bookings/billable events.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const updateFundingSource = useUpdateFundingSource()
  const [participantFilter, setParticipantFilter] = useState('')
  const [routeTypeFilter, setRouteTypeFilter] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<FundingSourceDto | undefined>(undefined)
  const [deactivateTarget, setDeactivateTarget] = useState<FundingSourceDto | null>(null)

  function handleActiveChange(fs: FundingSourceDto, active: boolean) {
    if (!active) {
      setDeactivateTarget(fs)
    } else {
      updateFundingSource.mutate({ id: fs.id, data: toUpdateFundingSourcePayload(fs, true) })
    }
  }

  const hasFilters = !!participantFilter || !!routeTypeFilter
  const queryParams: Record<string, string> = {}
  if (participantFilter) queryParams.participantId = participantFilter
  if (routeTypeFilter) queryParams.routeType = routeTypeFilter

  const { data: fundingSources = [], isLoading } = useFundingSources(queryParams)

  // Column budget (density §4): uncapped this table needs ~1400px and the box at 1280 is ~1006, which pushed Status and the edit action
  // off-screen. Text columns are capped (ellipsis, full text in the tooltip); Budget Category gives way below 2xl (1536) and Payer
  // below 1792. What is left at 1280 is ~960px.
  const columns: Column<FundingSourceDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium', maxWidth: '12rem' },
    {
      key: 'routeType',
      header: 'Route Type',
      sortable: true,
      render: fs => <span className={`text-xs px-2 py-0.5 rounded-full ${FUNDING_ROUTE_TYPE_COLORS[fs.routeType]}`}>{FUNDING_ROUTE_TYPE_LABELS[fs.routeType]}</span>,
    },
    { key: 'budgetCategory', header: 'Budget Category', priority: 'low', maxWidth: '12rem', render: fs => fs.budgetCategory || '—' },
    { key: 'ndisPlanNumber', header: 'NDIS Plan Number', className: 'font-mono text-xs', render: fs => fs.ndisPlanNumber || '—' },
    {
      key: 'planEndDate',
      header: 'Plan Period',
      render: fs => (fs.planStartDate || fs.planEndDate) ? `${formatDateAu(fs.planStartDate)} – ${formatDateAu(fs.planEndDate)}` : '—',
    },
    { key: 'budget', header: 'Budget', align: 'right', type: 'currency' },
    { key: 'payerName', header: 'Payer', priority: 'lowest', maxWidth: '9rem', render: fs => fs.payerName || '—' },
    {
      key: 'isActive',
      header: 'Status',
      sortable: true,
      render: fs => {
        const current = fs.isActive ? 'Active' : 'Inactive'
        return (
          <span onClick={e => e.stopPropagation()}>
            <Dropdown
              variant="pill"
              value={current}
              onChange={val => handleActiveChange(fs, val === 'Active')}
              colorClass={ACTIVE_STATUS_COLORS[current]}
              items={ACTIVE_STATUS_ITEMS}
              disabled={!canWrite}
            />
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: '',
      render: fs => canWrite ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={e => { e.stopPropagation(); setEditing(fs); setPanelOpen(true) }}
          aria-label={`Edit funding source for ${fs.participantName}`}
        >
          <Pencil className="w-4 h-4" />
        </Button>
      ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-[var(--color-muted-foreground)]" aria-hidden="true" />
          <div className={filterSelectWrapClass}>
            <Dropdown
              variant="form"
              value={participantFilter}
              onChange={setParticipantFilter}
              searchable
              label="All Participants"
              items={[{ value: '', label: 'All Participants' }, ...participants.map(p => ({ value: p.id, label: p.fullName }))]}
            />
          </div>
          <div className={filterSelectWrapClass}>
            <Dropdown
              variant="form"
              value={routeTypeFilter}
              onChange={setRouteTypeFilter}
              label="All Route Types"
              items={[{ value: '', label: 'All Route Types' }, ...FUNDING_ROUTE_TYPES.map(rt => ({ value: rt, label: FUNDING_ROUTE_TYPE_LABELS[rt] }))]}
            />
          </div>
        </div>
        {canWrite && (
          <Button onClick={() => { setEditing(undefined); setPanelOpen(true) }} size="md">
            <Plus className="w-4 h-4" /> New Funding Source
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton columns={8} />
      ) : fundingSources.length === 0 ? (
        hasFilters ? (
          <EmptyStateWithAction
            icon={Wallet}
            title="No funding sources match your filters"
            description="Try a different participant or route type, or clear your filters to see all funding sources."
            action={{ label: 'Clear filters', onClick: () => { setParticipantFilter(''); setRouteTypeFilter('') } }}
          />
        ) : (
          <EmptyStateWithAction
            icon={Wallet}
            title="No funding sources yet"
            description="A funding source is a pool of money attached to a participant — an NDIS plan budget category, a private payer, or a B2B customer. Add one to start billing against it."
            action={canWrite ? { label: 'Add funding source', onClick: () => { setEditing(undefined); setPanelOpen(true) } } : undefined}
          />
        )
      ) : (
        <DataTable data={fundingSources} columns={columns} keyField="id" sortable emptyMessage="No funding sources found" />
      )}

      <FundingSourceFormPanel
        key={String(panelOpen)}
        isOpen={panelOpen}
        onClose={() => { setPanelOpen(false); setEditing(undefined) }}
        fundingSource={editing}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (!deactivateTarget) return
          updateFundingSource.mutate(
            { id: deactivateTarget.id, data: toUpdateFundingSourcePayload(deactivateTarget, false) },
            { onSuccess: () => setDeactivateTarget(null) }
          )
        }}
        variant="danger"
        loading={updateFundingSource.isPending}
        title="Deactivate funding source?"
        confirmLabel="Deactivate"
        message={
          <p>
            Mark <strong>{deactivateTarget?.participantName || 'this'}</strong>'s funding source as inactive?
          </p>
        }
      />
    </div>
  )
}

// ── Service Bookings ────────────────────────────────────────────

function ServiceBookingsTab() {
  const { canWrite } = usePermissions()
  // INTAKE-08: claims/billing surfaces exclude drafts — a draft can't have funding
  // sources/bookings/billable events.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const [participantFilter, setParticipantFilter] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null)

  const hasFilters = !!participantFilter || activeOnly
  const queryParams: Record<string, string> = {}
  if (participantFilter) queryParams.participantId = participantFilter
  if (activeOnly) queryParams.activeOnly = 'true'

  const { data: serviceBookings = [], isLoading } = useServiceBookings(queryParams)

  // Column budget (density §4): seven columns need ~1060px at worst, the box at 1280 is ~1006. The two text columns are capped and
  // Claimed (Allocated minus Remaining, so derivable) gives way below 2xl (1536).
  const columns: Column<ServiceBookingListDto>[] = [
    { key: 'prodaBookingReference', header: 'PRODA Reference', sortable: true, className: 'font-mono text-xs', maxWidth: '9rem' },
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium', maxWidth: '10rem' },
    { key: 'endDate', header: 'Period', render: sb => `${formatDateAu(sb.startDate)} – ${formatDateAu(sb.endDate)}` },
    { key: 'claimDeadline', header: 'Claim Deadline', type: 'date', sortable: true },
    { key: 'totalAllocated', header: 'Allocated', align: 'right', type: 'currency' },
    { key: 'totalClaimed', header: 'Claimed', align: 'right', type: 'currency', priority: 'low' },
    {
      key: 'totalRemaining',
      header: 'Remaining Balance',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.totalRemaining - b.totalRemaining,
      render: sb => <BalanceIndicator remaining={sb.totalRemaining} allocated={sb.totalAllocated} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-[var(--color-muted-foreground)]" aria-hidden="true" />
          <div className={filterSelectWrapClass}>
            <Dropdown
              variant="form"
              value={participantFilter}
              onChange={setParticipantFilter}
              searchable
              label="All Participants"
              items={[{ value: '', label: 'All Participants' }, ...participants.map(p => ({ value: p.id, label: p.fullName }))]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-input)] border border-[var(--color-border)] cursor-pointer select-none focus-within:ring-2 focus-within:ring-[var(--color-ring)]">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={e => setActiveOnly(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
            />
            Active only
          </label>
        </div>
        {canWrite && (
          <Button
            onClick={() => setPanelOpen(true)}
            size="md"
          >
            <Plus className="w-4 h-4" /> New Service Booking
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton columns={7} />
      ) : serviceBookings.length === 0 ? (
        hasFilters ? (
          <EmptyStateWithAction
            icon={Receipt}
            title="No service bookings match your filters"
            description="Try a different participant, or turn off the active-only toggle to include expired bookings."
            action={{ label: 'Clear filters', onClick: () => { setParticipantFilter(''); setActiveOnly(false) } }}
          />
        ) : (
          <EmptyStateWithAction
            icon={Receipt}
            title="No service bookings yet"
            description="A service booking mirrors a PRODA service booking for agency-managed funding, with lines that track exactly how much of each support item is left to claim. This is what prevents the #1 cause of claim rejections — claiming more than the remaining balance."
            action={canWrite ? { label: 'Add service booking', onClick: () => setPanelOpen(true) } : undefined}
          />
        )
      ) : (
        <DataTable
          data={serviceBookings}
          columns={columns}
          keyField="id"
          sortable
          onRowClick={sb => setDetailBookingId(sb.id)}
          rowClassName={sb => balanceRowClassName(sb.totalRemaining, sb.totalAllocated)}
          emptyMessage="No service bookings found"
        />
      )}

      <ServiceBookingFormPanel key={String(panelOpen)} isOpen={panelOpen} onClose={() => setPanelOpen(false)} defaultParticipantId={participantFilter || undefined} />
      <ServiceBookingDetailModal bookingId={detailBookingId} onClose={() => setDetailBookingId(null)} />
    </div>
  )
}

// ── Billable Events ─────────────────────────────────────────────

function BillableEventsTab() {
  const { canWrite } = usePermissions()
  // INTAKE-08: claims/billing surfaces exclude drafts — a draft can't have funding
  // sources/bookings/billable events.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const [participantFilter, setParticipantFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [streamFilter, setStreamFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<BillableEventDto | undefined>(undefined)

  const hasFilters = !!(participantFilter || statusFilter || streamFilter || dateFrom || dateTo)
  const queryParams: Record<string, string> = {}
  if (participantFilter) queryParams.participantId = participantFilter
  if (statusFilter) queryParams.status = statusFilter
  if (streamFilter) queryParams.stream = streamFilter
  if (dateFrom) queryParams.from = dateFrom
  if (dateTo) queryParams.to = dateTo

  const { data: events = [], isLoading } = useBillableEvents(queryParams)

  function clearFilters() {
    setParticipantFilter(''); setStatusFilter(''); setStreamFilter(''); setDateFrom(''); setDateTo('')
  }

  function openEdit(event: BillableEventDto) {
    setEditing(event)
    setPanelOpen(true)
  }

  // Column budget (density §4): uncapped (a rejected row's reason line alone is as wide as its text) this table needs ~1300px+ and the
  // box at 1280 is ~1006, which pushed Status and the edit action off-screen. The participant and the rejection reason are capped
  // (ellipsis, full text in the tooltip); Stream gives way below 2xl (1536) and Day Type below 1792.
  const columns: Column<BillableEventDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium', maxWidth: '10rem' },
    {
      key: 'stream',
      header: 'Stream',
      sortable: true,
      priority: 'low',
      render: ev => <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)]">{INCOME_STREAM_LABELS[ev.stream] ?? ev.stream}</span>,
    },
    { key: 'supportItemNumber', header: 'Support Item', className: 'font-mono text-xs' },
    { key: 'supportsDeliveredTo', header: 'Delivered', sortable: true, render: ev => `${formatDateAu(ev.supportsDeliveredFrom)} – ${formatDateAu(ev.supportsDeliveredTo)}` },
    { key: 'dayType', header: 'Day Type', priority: 'lowest' },
    { key: 'unitPrice', header: 'Qty / Hours', align: 'right', render: ev => ev.quantity != null ? String(ev.quantity) : ev.hours != null ? formatHours(ev.hours) : '—' },
    { key: 'totalAmount', header: 'Total', align: 'right', className: 'font-semibold', type: 'currency', sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: ev => (
        <div className="flex flex-col gap-0.5">
          <span title={ev.status === 'Rejected' && ev.rejectionReason ? ev.rejectionReason : undefined}>
            <StatusBadge status={ev.status} colorMap={BILLABLE_EVENT_STATUS_COLORS} />
          </span>
          {ev.status === 'Rejected' && ev.rejectionReason && (
            <span className="block truncate text-xs text-[var(--color-muted-foreground)] md:max-w-[12rem]" title={ev.rejectionReason}>{ev.rejectionReason}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: ev => {
        if (!canWrite) return null
        const locked = isBillableEventLocked(ev.status)
        return (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={e => { e.stopPropagation(); if (!locked) openEdit(ev) }}
            disabled={locked}
            aria-label={locked ? `Edit disabled — this event has status ${ev.status} and can no longer be changed` : `Edit billable event for ${ev.participantName}`}
            title={locked ? `Locked — already ${ev.status.toLowerCase()}` : 'Edit'}
          >
            {locked ? <Lock className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </Button>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-[var(--color-muted-foreground)]" aria-hidden="true" />
          <div className={filterSelectWrapClass}>
            <Dropdown
              variant="form"
              value={participantFilter}
              onChange={setParticipantFilter}
              searchable
              label="All Participants"
              items={[{ value: '', label: 'All Participants' }, ...participants.map(p => ({ value: p.id, label: p.fullName }))]}
            />
          </div>
          <div className={filterSelectWrapClass}>
            <Dropdown
              variant="form"
              value={statusFilter}
              onChange={setStatusFilter}
              label="All Statuses"
              items={[{ value: '', label: 'All Statuses' }, ...BILLABLE_EVENT_STATUSES.map(s => ({ value: s, label: s }))]}
            />
          </div>
          <div className={filterSelectWrapClass}>
            <Dropdown
              variant="form"
              value={streamFilter}
              onChange={setStreamFilter}
              label="All Streams"
              items={[{ value: '', label: 'All Streams' }, ...INCOME_STREAMS.map(s => ({ value: s, label: INCOME_STREAM_LABELS[s] }))]}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              aria-label="Delivered from date"
              className="px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
            <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              aria-label="Delivered to date"
              className="px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          </div>
        </div>
        {canWrite && (
          <Button onClick={() => { setEditing(undefined); setPanelOpen(true) }} size="md">
            <Plus className="w-4 h-4" /> New Billable Event
          </Button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton columns={9} />
      ) : events.length === 0 ? (
        hasFilters ? (
          <EmptyStateWithAction
            icon={ClipboardList}
            title="No billable events match your filters"
            description="Try a different participant, status, stream, or date range, or clear your filters to see all billable events."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        ) : (
          <EmptyStateWithAction
            icon={ClipboardList}
            title="No billable events yet"
            description="A billable event is the universal billing unit — every income stream (trips, shifts, STA nights, training) produces these, and the router turns them into claim lines or invoice lines. Add one to get started."
            action={canWrite ? { label: 'Add billable event', onClick: () => { setEditing(undefined); setPanelOpen(true) } } : undefined}
          />
        )
      ) : (
        <DataTable data={events} columns={columns} keyField="id" sortable emptyMessage="No billable events found" />
      )}

      <BillableEventFormPanel
        key={String(panelOpen)}
        isOpen={panelOpen}
        onClose={() => { setPanelOpen(false); setEditing(undefined) }}
        event={editing}
        defaultParticipantId={participantFilter || undefined}
      />
    </div>
  )
}
