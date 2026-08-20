import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Layers, Plus, Pencil, Lock, Wallet, Receipt, ClipboardList, Filter,
} from 'lucide-react'
import {
  useFundingSources, useUpdateFundingSource,
  useServiceBookings,
  useBillableEvents,
  useParticipants,
} from '@/api/hooks'
import type { FundingSourceDto, ServiceBookingListDto, BillableEventDto } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { TabNav } from '@/components/TabNav'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { Dropdown } from '@/components/Dropdown'
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

export default function BillingPage() {
  const { canWrite } = usePermissions()
  const [tab, setTab] = useState<'funding' | 'bookings' | 'events'>('funding')

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Billing"
        subtitle="Funding sources, service bookings, and billable events"
        action={canWrite && (
          <Link
            to="/billing/claim-batches/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-all"
          >
            <Layers className="w-4 h-4" /> New claim batch
          </Link>
        )}
      />

      <TabNav
        tabs={[
          { key: 'funding', label: 'Funding Sources' },
          { key: 'bookings', label: 'Service Bookings' },
          { key: 'events', label: 'Billable Events' },
        ]}
        active={tab}
        onChange={key => setTab(key as typeof tab)}
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
  const { data: participants = [] } = useParticipants()
  const updateFundingSource = useUpdateFundingSource()
  const [participantFilter, setParticipantFilter] = useState('')
  const [routeTypeFilter, setRouteTypeFilter] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<FundingSourceDto | undefined>(undefined)

  const hasFilters = !!participantFilter || !!routeTypeFilter
  const queryParams: Record<string, string> = {}
  if (participantFilter) queryParams.participantId = participantFilter
  if (routeTypeFilter) queryParams.routeType = routeTypeFilter

  const { data: fundingSources = [], isLoading } = useFundingSources(queryParams)

  const columns: Column<FundingSourceDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium' },
    {
      key: 'routeType',
      header: 'Route Type',
      sortable: true,
      render: fs => <span className={`text-xs px-2 py-0.5 rounded-full ${FUNDING_ROUTE_TYPE_COLORS[fs.routeType]}`}>{FUNDING_ROUTE_TYPE_LABELS[fs.routeType]}</span>,
    },
    { key: 'budgetCategory', header: 'Budget Category', render: fs => fs.budgetCategory || '—' },
    { key: 'ndisPlanNumber', header: 'NDIS Plan Number', className: 'font-mono text-xs', render: fs => fs.ndisPlanNumber || '—' },
    {
      key: 'planEndDate',
      header: 'Plan Period',
      render: fs => (fs.planStartDate || fs.planEndDate) ? `${formatDateAu(fs.planStartDate)} – ${formatDateAu(fs.planEndDate)}` : '—',
    },
    { key: 'budget', header: 'Budget', align: 'right', type: 'currency' },
    { key: 'payerName', header: 'Payer', render: fs => fs.payerName || '—' },
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
              onChange={val => updateFundingSource.mutate({ id: fs.id, data: toUpdateFundingSourcePayload(fs, val === 'Active') })}
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
        <button
          onClick={e => { e.stopPropagation(); setEditing(fs); setPanelOpen(true) }}
          className="p-1.5 rounded-lg hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          aria-label={`Edit funding source for ${fs.participantName}`}
        >
          <Pencil className="w-4 h-4 text-[var(--color-muted-foreground)]" />
        </button>
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
          <button
            onClick={() => { setEditing(undefined); setPanelOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-all"
          >
            <Plus className="w-4 h-4" /> New Funding Source
          </button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton columns={8} />
      ) : fundingSources.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={Wallet}
            title="No funding sources match your filters"
            description="Try a different participant or route type, or clear your filters to see all funding sources."
            action={{ label: 'Clear filters', onClick: () => { setParticipantFilter(''); setRouteTypeFilter('') } }}
          />
        ) : (
          <EmptyState
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
    </div>
  )
}

// ── Service Bookings ────────────────────────────────────────────

function ServiceBookingsTab() {
  const { canWrite } = usePermissions()
  const { data: participants = [] } = useParticipants()
  const [participantFilter, setParticipantFilter] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null)

  const hasFilters = !!participantFilter || activeOnly
  const queryParams: Record<string, string> = {}
  if (participantFilter) queryParams.participantId = participantFilter
  if (activeOnly) queryParams.activeOnly = 'true'

  const { data: serviceBookings = [], isLoading } = useServiceBookings(queryParams)

  const columns: Column<ServiceBookingListDto>[] = [
    { key: 'prodaBookingReference', header: 'PRODA Reference', sortable: true, className: 'font-mono text-xs' },
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium' },
    { key: 'endDate', header: 'Period', render: sb => `${formatDateAu(sb.startDate)} – ${formatDateAu(sb.endDate)}` },
    { key: 'claimDeadline', header: 'Claim Deadline', type: 'date', sortable: true },
    { key: 'totalAllocated', header: 'Allocated', align: 'right', type: 'currency' },
    { key: 'totalClaimed', header: 'Claimed', align: 'right', type: 'currency' },
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
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] px-3 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] cursor-pointer select-none focus-within:ring-2 focus-within:ring-[var(--color-ring)]">
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
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-all"
          >
            <Plus className="w-4 h-4" /> New Service Booking
          </button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton columns={7} />
      ) : serviceBookings.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={Receipt}
            title="No service bookings match your filters"
            description="Try a different participant, or turn off the active-only toggle to include expired bookings."
            action={{ label: 'Clear filters', onClick: () => { setParticipantFilter(''); setActiveOnly(false) } }}
          />
        ) : (
          <EmptyState
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
  const { data: participants = [] } = useParticipants()
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

  const columns: Column<BillableEventDto>[] = [
    { key: 'participantName', header: 'Participant', sortable: true, className: 'font-medium' },
    {
      key: 'stream',
      header: 'Stream',
      sortable: true,
      render: ev => <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)]">{INCOME_STREAM_LABELS[ev.stream] ?? ev.stream}</span>,
    },
    { key: 'supportItemNumber', header: 'Support Item', className: 'font-mono text-xs' },
    { key: 'supportsDeliveredTo', header: 'Delivered', sortable: true, render: ev => `${formatDateAu(ev.supportsDeliveredFrom)} – ${formatDateAu(ev.supportsDeliveredTo)}` },
    { key: 'dayType', header: 'Day Type' },
    { key: 'unitPrice', header: 'Qty / Hours', align: 'right', render: ev => ev.quantity != null ? String(ev.quantity) : ev.hours != null ? formatHours(ev.hours) : '—' },
    { key: 'totalAmount', header: 'Total', align: 'right', className: 'font-semibold', type: 'currency', sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: ev => <StatusBadge status={ev.status} colorMap={BILLABLE_EVENT_STATUS_COLORS} />,
    },
    {
      key: 'actions',
      header: '',
      render: ev => {
        if (!canWrite) return null
        const locked = isBillableEventLocked(ev.status)
        return (
          <button
            onClick={e => { e.stopPropagation(); if (!locked) openEdit(ev) }}
            disabled={locked}
            aria-label={locked ? `Edit disabled — this event has status ${ev.status} and can no longer be changed` : `Edit billable event for ${ev.participantName}`}
            title={locked ? `Locked — already ${ev.status.toLowerCase()}` : 'Edit'}
            className="p-1.5 rounded-lg hover:bg-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          >
            {locked ? <Lock className="w-4 h-4 text-[var(--color-muted-foreground)]" /> : <Pencil className="w-4 h-4 text-[var(--color-muted-foreground)]" />}
          </button>
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
              className="px-3 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
            <span className="text-sm text-[var(--color-muted-foreground)]">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              aria-label="Delivered to date"
              className="px-3 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => { setEditing(undefined); setPanelOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-all"
          >
            <Plus className="w-4 h-4" /> New Billable Event
          </button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton columns={9} />
      ) : events.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={ClipboardList}
            title="No billable events match your filters"
            description="Try a different participant, status, stream, or date range, or clear your filters to see all billable events."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        ) : (
          <EmptyState
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
