import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPlus, MoreVertical, Search } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { SearchInput } from '@/components/SearchInput'
import { NoticesRegion } from '@/components/NoticesRegion'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { useNotices } from '@/hooks/useNotices'
import { useConfirmIntakeBooking, useConvertParticipantInquiry, useParticipantInquiries } from '@/api/hooks'
import type { CancelIntakeBookingResultDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { queryPhase } from '@/lib/queryPhase'
import { cancelNotice, DEFAULT_DURATION, isPastVisit } from '@/lib/intakeBooking'
import { IntakeBookingPanel } from './inquiries/IntakeBookingPanel'
import { IntakeCell } from './inquiries/IntakeCell'
import { IntakeCancelDialog } from './inquiries/IntakeCancelDialog'

/**
 * Where an enquiry has got to. `new`: no participant yet. `draftintake`: a draft participant whose intake is still open. `intakecomplete`:
 * intake done, so the participant is on the Onboarding tab. `participant`: finalised, so they are on the Active participants tab. Only the
 * first two are open enquiries, and only those are listed here. An API that does not send the participant's state (an older server) leaves the
 * first two to tell apart as before: any converted enquiry is a draft intake.
 */
type Stage = 'new' | 'draftintake' | 'intakecomplete' | 'participant'

function stageOf(row: ParticipantInquiryDto): Stage {
  if (!row.participantId) return 'new'
  if (row.participantIsDraft === false) return 'participant'
  return row.participantIntakeCompletedAt ? 'intakecomplete' : 'draftintake'
}

const isOpen = (stage: Stage) => stage === 'new' || stage === 'draftintake'

/** A direct intake has no enquiry behind it, so no source: the cell says how it started instead of showing nothing. */
const sourceLabel = (row: ParticipantInquiryDto) => (row.isDirectIntake ? 'Direct intake' : row.source)

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns
 * one PageHeader. The standalone /inquiries route is redirected to /participants?tab=enquiries.
 *
 * Capture/edit lives on its own routed page at /participants/new-inquiry — see
 * InquiryFormPage. Edit and Start-intake remain row-level actions here. The search renders above the table: the hub used to show the body
 * alone, which left it with nowhere to live (L2-02). There is no status filter: the tab IS the stage filter.
 */
export function InquiriesTable() {
  const screen = useInquiriesScreen()
  return (
    <>
      {screen.showTable && <div className="flex flex-wrap items-center gap-3 mb-4">{screen.toolbar}</div>}
      {screen.body}
    </>
  )
}

function useInquiriesScreen() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle } = usePermissions()
  const inquiriesQuery = useParticipantInquiries()
  const { data: inquiries = [], isError, refetch } = inquiriesQuery
  // A request that has not run (paused while the browser reports offline: isLoading false, isError false, data undefined) is loading, not an
  // empty list: "No open enquiries" follows only a request that succeeded.
  const isLoading = queryPhase(inquiriesQuery) === 'loading'
  const convert = useConvertParticipantInquiry()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const confirmVisit = useConfirmIntakeBooking()
  const { notices, notify, dismiss } = useNotices()
  const [booking, setBooking] = useState<{ id: string; focusDate: boolean } | null>(null)
  const [cancelling, setCancelling] = useState<ParticipantInquiryDto | null>(null)
  const intakeControl = (id: string) => document.querySelector<HTMLElement>(`[data-intake-control="${id}"]`)
  // The row whose Intake control takes focus after the next render. The control that opened the panel may be gone by then (Book intake
  // becomes line 1 after a first booking, and the reverse after a cancel), so focus goes to the row's control as it is now, never the body.
  const focusIntake = useRef<string | null>(null)
  useEffect(() => {
    const id = focusIntake.current
    if (!id) return
    focusIntake.current = null
    intakeControl(id)?.focus()
  })
  const nameOf = (row: ParticipantInquiryDto) => `${row.firstName} ${row.lastName}`
  const bookingRow = booking ? inquiries.find(r => r.id === booking.id) ?? null : null
  const openBooking = (row: ParticipantInquiryDto, focusDate = false) => setBooking({ id: row.id, focusDate })
  const closeBooking = () => {
    if (booking) focusIntake.current = booking.id
    setBooking(null)
  }

  async function markConfirmed(row: ParticipantInquiryDto, confirmed: boolean) {
    try {
      await confirmVisit.mutateAsync({ id: row.id, confirmed })
      notify('success', confirmed ? 'Visit confirmed' : 'Marked not confirmed',
        confirmed ? `${nameOf(row)}'s intake visit is marked confirmed.` : `${nameOf(row)}'s intake visit is no longer marked confirmed.`, row.id)
    } catch {
      notify('danger', "Couldn't update the visit", `${nameOf(row)}'s visit wasn't changed. Try again.`, row.id)
    }
  }
  const onCancelled = (row: ParticipantInquiryDto, email: CancelIntakeBookingResultDto['cancellationEmail']) => {
    const notice = cancelNotice(email, nameOf(row))
    setCancelling(null)
    setBooking(null)
    notify(notice.tone, notice.title, notice.message, row.id)
    focusIntake.current = row.id
  }
  // Below md the booking's secondary actions sit behind More (SHAPE.md section 1); a row with no booking keeps its two visible buttons.
  const menuItems = (row: ParticipantInquiryDto) => {
    const upcoming = !isPastVisit(row.intakeStartsAt!, row.intakeDurationMinutes ?? DEFAULT_DURATION)
    return [
      { value: 'reschedule', label: 'Reschedule' },
      ...(upcoming ? [{ value: 'confirm', label: row.intakeConfirmedAt ? 'Mark not confirmed' : 'Mark confirmed' }] : []),
      { value: 'edit', label: 'Edit enquiry' },
      ...(upcoming ? [{ value: 'cancel', label: 'Cancel visit' }] : []),
    ]
  }
  const onMenu = (row: ParticipantInquiryDto, value: string) => {
    if (value === 'reschedule') openBooking(row, true)
    else if (value === 'confirm') void markConfirmed(row, !row.intakeConfirmedAt)
    else if (value === 'edit') editExisting(row)
    else if (value === 'cancel') setCancelling(row)
  }
  const editExisting = (row: ParticipantInquiryDto) => navigate(`/participants/new-inquiry?id=${encodeURIComponent(row.id)}`)
  const startIntake = (id: string) => {
    setError(null)
    convert.mutate(
      { id },
      {
        onSuccess: (inquiry: ParticipantInquiryDto) => {
          if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`)
        },
        onError: err => setError(extractErrorMessage(err, 'Could not start intake. Please try again.')),
      },
    )
  }
  // The /inquiries endpoint takes no query parameters, so the stage and the search are client-side over the already-fetched tenant-scoped list
  // (the server owns the tenant predicate, and which drafts are direct intakes). An enquiry whose intake is complete is not listed: its participant
  // is on the Onboarding tab, and once finalised on Active participants.
  const open = inquiries.filter(row => isOpen(stageOf(row)))
  const filtered = open.filter(row => {
    if (!search.trim()) return true
    const term = search.trim().toLowerCase()
    return [row.firstName, row.lastName, row.phone, row.email, sourceLabel(row), row.provenance]
      .filter(Boolean)
      .some(field => String(field).toLowerCase().includes(term))
  })

  // Only open enquiries are listed, so a row is New (no participant yet) or Draft intake (intake started, not complete).
  const statusBadge = (row: ParticipantInquiryDto) => stageOf(row) === 'new'
    ? <StatusBadge status="new" label="New" />
    : <StatusBadge status="draftintake" label="Draft intake" />
  // The one next step that is real for each stage. Resuming an intake that is complete led to the L2-03 data loss, which is why such a row is not listed.
  // A row opens where its own buttons lead: a New enquiry's form, or a Draft intake's intake (starting an intake converts, so the row never does that).
  const openRow = (row: ParticipantInquiryDto) => stageOf(row) === 'new' ? editExisting(row) : navigate(`/participants/${row.participantId}/intake`)
  const primaryAction = (row: ParticipantInquiryDto) => stageOf(row) === 'new'
    ? <Button size="sm" disabled={convert.isPending} onClick={() => startIntake(row.id)}>Start intake<span className="sr-only"> for {nameOf(row)}</span></Button>
    : <Button size="sm" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake<span className="sr-only"> for {nameOf(row)}</span></Button>

  const columns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Name', sortable: true, render: row => `${row.firstName} ${row.lastName}` },
    { key: 'phone', header: 'Contact', render: row => row.phone || row.email || 'No contact details' },
    { key: 'source', header: 'Source', sortable: true, render: sourceLabel },
    {
      key: 'provenance',
      header: 'Provenance',
      render: row => {
        const text = row.provenance || '—'
        if (!row.provenance) return <span>{text}</span>
        return (
          <span
            className="block max-w-[12rem] truncate text-sm text-[var(--color-muted-foreground)]"
            title={row.provenance}
          >
            {text}
          </span>
        )
      },
    },
    { key: 'participantId', header: 'Status', render: statusBadge },
    {
      key: 'intakeStartsAt', header: 'Intake', sortable: true, wrap: true,
      // Room for the date and time unbroken; a narrower window scrolls the table in its box (the Column Rule) rather than crushing the cell.
      // With Provenance capped at 12rem this keeps the whole table, one-row Actions included, inside its box at 1440.
      minWidth: '11rem',
      // ISO instants sort in time order. An empty cell sorts last on the ascending sort.
      sortFn: (a, b) => (a.intakeStartsAt ?? '9999').localeCompare(b.intakeStartsAt ?? '9999'),
      render: row => <IntakeCell row={row} canManage={canManageParticipantLifecycle} onOpen={r => openBooking(r)} />,
    },
    {
      key: 'id', header: 'Actions', type: 'custom', pin: 'end',
      render: row => canManageParticipantLifecycle ? (
        <div className={`flex flex-wrap md:flex-nowrap items-center gap-2 ${ROW_ACTIONS_CARD}`}>
          {primaryAction(row)}
          {/* A direct intake has no enquiry record, so there is nothing to edit as one. On a booked row's phone card, Edit enquiry moves into More. */}
          {!row.isDirectIntake && (
            <Button size="sm" variant="secondary" className={row.intakeStartsAt ? 'max-md:hidden' : undefined} onClick={() => editExisting(row)}>
              Edit enquiry<span className="sr-only"> for {nameOf(row)}</span>
            </Button>
          )}
          {!row.isDirectIntake && row.intakeStartsAt && (
            // The menu's items are portaled to <body>, but React still bubbles their clicks to the row, whose click opens the enquiry form or
            // the wizard. A menu inside a clickable row stops its clicks here, as TripsPage's pill menu does.
            <div className="md:hidden" onClick={e => e.stopPropagation()}>
              <Dropdown
                variant="icon"
                align="left"
                label={`More actions for ${nameOf(row)}`}
                icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
                items={menuItems(row)}
                onSelect={value => onMenu(row, value)}
              />
            </div>
          )}
        </div>
      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span>,
    },
  ]
  const showEmptyState = !isError && !isLoading && open.length === 0
  const showTable = !isError && !showEmptyState && (open.length > 0 || isLoading)

  const toolbar = <SearchInput value={search} onChange={setSearch} placeholder="Search enquiries..." />

  const body = (
    <>
      <NoticesRegion
        notices={notices}
        onDismiss={dismiss}
        focusAfterDismiss={notice => (notice.subject ? intakeControl(notice.subject) : null)}
        className="mb-4 empty:mb-0"
      />
      {isError && (
        <Callout
          tone="error"
          actions={<button type="button" className="font-medium underline shrink-0" onClick={() => refetch()}>Retry</button>}
        >
          Could not load enquiries. Please try again.
        </Callout>
      )}
      {!canManageParticipantLifecycle && <p role="status" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">You can review enquiries, but your role cannot capture, edit, or start participant intake.</p>}
      {error && <Callout tone="error">{error}</Callout>}
      {showEmptyState && <EmptyState icon={ClipboardPlus} title="No open enquiries" description="Capture an enquiry when someone first contacts the service, then start their intake. Once an intake is complete, the participant moves to the Onboarding tab." />}
      {showTable && !isLoading && filtered.length === 0
        ? <EmptyState icon={Search} title="No enquiries match your search" description="Try a different search term, or clear the search to see every open enquiry." action={{ label: 'Clear search', onClick: () => setSearch('') }} />
        : showTable && <DataTable data={filtered} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No open enquiries." onRowClick={canManageParticipantLifecycle ? openRow : undefined} />}
      <IntakeBookingPanel row={bookingRow} focusDate={booking?.focusDate} onClose={closeBooking} onRequestCancel={setCancelling} />
      <IntakeCancelDialog row={cancelling} onCancel={() => setCancelling(null)} onDone={onCancelled} />
    </>
  )

  return { toolbar, showTable, body }
}
