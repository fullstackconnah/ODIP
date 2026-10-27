import { useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
import { ToggleGroup } from '@/components/ToggleGroup'
import { useNotices } from '@/hooks/useNotices'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { useConfirmIntakeBooking, useConvertParticipantInquiry, useParticipantInquiries } from '@/api/hooks'
import type { CancelIntakeBookingResultDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { queryPhase, retryingAfterError } from '@/lib/queryPhase'
import { cancelNotice, DEFAULT_DURATION, FALLBACK_ZONE, invitee, isPastVisit, refusalOf, visitDay, type EnquiryNotice } from '@/lib/intakeBooking'
import { convertRefusal, fullName, startIntakeReason } from '@/lib/inquiryDetails'
import { CLOSE_OUTCOME_LABELS, closedNotice, reopenedNotice } from '@/lib/inquiryClose'
import { CloseInquiryDialog } from './inquiries/CloseInquiryDialog'
import { ContactCell } from './inquiries/ContactCell'
import { ReopenInquiryDialog } from './inquiries/ReopenInquiryDialog'
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

const DISABLED_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'
// Wraps at 15rem, so the longest reason never sets the Actions column's width (SHAPE numeric check 5); on a coarse pointer its own box is 44px tall,
// so the cell's tap pad never reaches over the buttons above it.
const REASON_LINK = 'self-start max-w-[15rem] md:whitespace-normal text-xs text-[var(--color-muted-foreground)] underline underline-offset-2 hover:text-[var(--color-primary)] pointer-coarse:py-3.5'

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
      {screen.showToolbar && <div className="flex flex-wrap items-center gap-3 mb-4">{screen.toolbar}</div>}
      {screen.body}
    </>
  )
}

function useInquiriesScreen() {
  const navigate = useNavigate()
  const belowMd = useIsBelowMd()
  const { canManageParticipantLifecycle } = usePermissions()
  // Open | Closed (spec addendum E4, lead decision 6): the house status filter, in the URL beside tab=enquiries.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') === 'closed' ? 'closed' : 'open'
  const inquiriesQuery = useParticipantInquiries(view)
  const { data: inquiries = [], isError, refetch } = inquiriesQuery
  // A request that has not run (paused while the browser reports offline: isLoading false, isError false, data undefined) is loading, not an
  // empty list: "No open enquiries" follows only a request that succeeded.
  const isLoading = queryPhase(inquiriesQuery) === 'loading' || retryingAfterError(inquiriesQuery)
  const convert = useConvertParticipantInquiry()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const confirmVisit = useConfirmIntakeBooking()
  const { notices, notify, dismiss } = useNotices()
  const location = useLocation()
  // The enquiry form's summary of what its save did (SHAPE.md section 6), shown once: the ref survives StrictMode's second effect run, and the
  // state is cleared so a reload or Back does not show it again.
  const shownFor = useRef<string | null>(null)
  useEffect(() => {
    const notice = (location.state as { enquiryNotice?: EnquiryNotice } | null)?.enquiryNotice
    if (!notice || shownFor.current === location.key) return
    shownFor.current = location.key
    notify(notice.tone, notice.title, notice.message, notice.subject)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location, navigate, notify])
  const [booking, setBooking] = useState<{ id: string; focusDate: boolean } | null>(null)
  const [cancelling, setCancelling] = useState<ParticipantInquiryDto | null>(null)
  const [closing, setClosing] = useState<ParticipantInquiryDto | null>(null)
  const [reopening, setReopening] = useState<ParticipantInquiryDto | null>(null)
  // After a close or a reopen the row has left this view, so focus goes into the new notice: its Dismiss, or its link to the reopened enquiry.
  const focusNotice = useRef<string | null>(null)
  useEffect(() => {
    const selector = focusNotice.current
    if (!selector) return
    focusNotice.current = null
    const found = document.querySelectorAll<HTMLElement>(selector)
    found[found.length - 1]?.focus()
  })
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
  const nameOf = (row: ParticipantInquiryDto) => fullName(row.firstName, row.lastName)
  const bookingRow = booking ? inquiries.find(r => r.id === booking.id) ?? null : null
  const openBooking = (row: ParticipantInquiryDto, focusDate = false) => setBooking({ id: row.id, focusDate })
  const closeBooking = () => {
    if (booking) focusIntake.current = booking.id
    setBooking(null)
  }

  async function markConfirmed(row: ParticipantInquiryDto, confirmed: boolean) {
    try {
      await confirmVisit.mutateAsync({ id: row.id, confirmed, expectedUpdatedAt: row.updatedAt })
      notify('success', confirmed ? 'Visit confirmed' : 'Marked not confirmed',
        confirmed ? `${nameOf(row)}'s intake visit is marked confirmed.` : `${nameOf(row)}'s intake visit is no longer marked confirmed.`, row.id)
    } catch (error) {
      notify('danger', "Couldn't update the visit", refusalOf(error, `${nameOf(row)}'s visit wasn't changed. Try again.`), row.id)
    }
  }
  const onCancelled = (row: ParticipantInquiryDto, email: CancelIntakeBookingResultDto['cancellationEmail']) => {
    const notice = cancelNotice(email, invitee(row))
    setCancelling(null)
    setBooking(null)
    notify(notice.tone, notice.title, notice.message, row.id)
    focusIntake.current = row.id
  }
  // Only an enquiry that hasn't started intake can close (the server refuses the rest); a direct intake has no enquiry to close.
  const canClose = (row: ParticipantInquiryDto) => !row.participantId && !row.isDirectIntake
  const closeItem = (row: ParticipantInquiryDto) => (canClose(row) ? [{ value: 'close', label: 'Close enquiry' }] : [])
  // Below md the booking's secondary actions sit behind More (SHAPE.md section 1); Close enquiry is the menu's last item at any width (section 11).
  const menuItems = (row: ParticipantInquiryDto) => {
    const upcoming = !isPastVisit(row.intakeStartsAt!, row.intakeDurationMinutes ?? DEFAULT_DURATION)
    return [
      { value: 'reschedule', label: 'Reschedule' },
      ...(upcoming ? [{ value: 'confirm', label: row.intakeConfirmedAt ? 'Mark not confirmed' : 'Mark confirmed' }] : []),
      { value: 'edit', label: 'Edit enquiry' },
      ...(upcoming ? [{ value: 'cancel', label: 'Cancel visit' }] : []),
      ...closeItem(row),
    ]
  }
  const onMenu = (row: ParticipantInquiryDto, value: string) => {
    if (value === 'reschedule') openBooking(row, true)
    else if (value === 'confirm') void markConfirmed(row, !row.intakeConfirmedAt)
    else if (value === 'edit') editExisting(row)
    else if (value === 'cancel') setCancelling(row)
    else if (value === 'close') setClosing(row)
  }
  const onClosed = (row: ParticipantInquiryDto, result: Parameters<typeof closedNotice>[0]) => {
    const notice = closedNotice(result)
    setClosing(null)
    notify(notice.tone, notice.title, notice.message, row.id)
    focusNotice.current = '[data-dismiss-notice]'
  }
  const onReopened = (answer: ParticipantInquiryDto) => {
    const notice = reopenedNotice(answer)
    const to = `/participants/new-inquiry?id=${encodeURIComponent(answer.id)}`
    setReopening(null)
    notify(notice.tone, notice.title, notice.message, answer.id, { label: 'Open enquiry', to })
    focusNotice.current = `a[href="${to}"]`
  }
  const setView = (next: string) => setSearchParams(p => { if (next === 'closed') p.set('view', 'closed'); else p.delete('view'); return p })
  const moreMenu = (row: ParticipantInquiryDto, items: { value: string; label: string }[], className?: string) => (
    // The menu's items are portaled to <body>, but React still bubbles their clicks to the row, whose click opens the enquiry form or
    // the wizard. A menu inside a clickable row stops its clicks here, as TripsPage's pill menu does.
    <div className={className} onClick={e => e.stopPropagation()}>
      <Dropdown
        variant="icon"
        align={belowMd ? 'left' : 'right'}
        label={`More actions for ${nameOf(row)}`}
        icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
        items={items}
        onSelect={value => onMenu(row, value)}
      />
    </div>
  )
  const editExisting = (row: ParticipantInquiryDto) => navigate(`/participants/new-inquiry?id=${encodeURIComponent(row.id)}`)
  const startIntake = (row: ParticipantInquiryDto) => {
    setError(null)
    convert.mutate(
      { id: row.id },
      {
        onSuccess: (inquiry: ParticipantInquiryDto) => {
          if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`)
        },
        // The address or the contact's name went after the list loaded (L5, D1): say which, not "could not start".
        onError: err => setError(convertRefusal(err, nameOf(row))
          ?? (isAxiosError(err) && err.response?.status === 409 ? `${nameOf(row)}'s intake didn't start. ${extractErrorMessage(err, 'Please try again.')}` : extractErrorMessage(err, 'Could not start intake. Please try again.'))),
      },
    )
  }
  // The /inquiries endpoint takes no query parameters, so the stage and the search are client-side over the already-fetched tenant-scoped list
  // (the server owns the tenant predicate, and which drafts are direct intakes). An enquiry whose intake is complete is not listed: its participant
  // is on the Onboarding tab, and once finalised on Active participants.
  // The closed view lists what the server sent (closed enquiries only), newest close first.
  const open = view === 'closed'
    ? [...inquiries].sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
    : inquiries.filter(row => isOpen(stageOf(row)))
  const filtered = open.filter(row => {
    if (!search.trim()) return true
    const term = search.trim().toLowerCase()
    const fields = view === 'closed'
      // The note only where it shows: the server withholds it from roles without lifecycle rights.
      ? [row.firstName, row.lastName, row.contactFirstName, row.contactLastName, row.phone, row.email, row.closeOutcome && CLOSE_OUTCOME_LABELS[row.closeOutcome], row.closeNote]
      : [row.firstName, row.lastName, row.contactFirstName, row.contactLastName, row.phone, row.email, sourceLabel(row), row.provenance]
    return fields.filter(Boolean).some(field => String(field).toLowerCase().includes(term))
  })

  // Only open enquiries are listed, so a row is New (no participant yet) or Draft intake (intake started, not complete).
  const statusBadge = (row: ParticipantInquiryDto) => stageOf(row) === 'new'
    ? <StatusBadge status="new" label="New" />
    : <StatusBadge status="draftintake" label="Draft intake" />
  // The one next step that is real for each stage. Resuming an intake that is complete led to the L2-03 data loss, which is why such a row is not listed.
  // A row opens where its own buttons lead: a New enquiry's form, or a Draft intake's intake (starting an intake converts, so the row never does that).
  const openRow = (row: ParticipantInquiryDto) => stageOf(row) === 'new' ? editExisting(row) : navigate(`/participants/${row.participantId}/intake`)
  // Start intake waits for the full address and a named main contact (L5, D1): the button stays, focusable and described by its reason, and does nothing.
  const reasonOf = (row: ParticipantInquiryDto) => (stageOf(row) === 'new' && !row.isDirectIntake ? startIntakeReason(row) : null)
  const primaryAction = (row: ParticipantInquiryDto) => {
    if (stageOf(row) !== 'new') return <Button size="sm" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake<span className="sr-only"> for {nameOf(row)}</span></Button>
    const reason = reasonOf(row)
    return reason
      ? <Button size="sm" aria-disabled="true" aria-describedby={`start-reason-${row.id}`} className={DISABLED_LOOK} onClick={() => {}}>Start intake<span className="sr-only"> for {nameOf(row)}</span></Button>
      : <Button size="sm" disabled={convert.isPending} onClick={() => startIntake(row)}>Start intake<span className="sr-only"> for {nameOf(row)}</span></Button>
  }
  // The reason is a link to the field that fixes it, on its own line under the buttons (SHAPE section 12). DataTable ignores clicks on links.
  const reasonLink = (row: ParticipantInquiryDto) => {
    const reason = reasonOf(row)
    return reason && <Link id={`start-reason-${row.id}`} to={reason.to} className={REASON_LINK}>{reason.text}</Link>
  }

  // Below 1440 the Open table is wider than its box (1280: 1006 px), so Actions take two lines and Contact and Provenance truncate harder; phone cards and 1440+ keep their composition.
  const columns: Column<ParticipantInquiryDto>[] = [
    // wrap: a long name (W) takes two lines rather than widening the table past its box at 1440.
    { key: 'firstName', header: 'Participant', sortable: true, wrap: true, render: row => nameOf(row) },
    { key: 'phone', header: 'Contact', render: row => <ContactCell row={row} className="md:max-[1440px]:max-w-36" /> },
    { key: 'source', header: 'Source', sortable: true, render: sourceLabel },
    {
      key: 'provenance',
      header: 'Provenance',
      render: row => {
        const text = row.provenance || '—'
        if (!row.provenance) return <span>{text}</span>
        return (
          <span
            className="block max-w-[8rem] md:max-[1440px]:max-w-20 truncate text-sm text-[var(--color-muted-foreground)]"
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
      // 14rem holds line 1 ("Fri 16 Oct, 10:00 am · Callum") unbroken; with Provenance capped at 8rem (9.5rem until the row menu joined Actions) the whole table, one-row Actions
      // included, still fits its box at 1440.
      minWidth: '14rem',
      // ISO instants sort in time order. An empty cell sorts last on the ascending sort.
      sortFn: (a, b) => (a.intakeStartsAt ?? '9999').localeCompare(b.intakeStartsAt ?? '9999'),
      render: row => <IntakeCell row={row} canManage={canManageParticipantLifecycle} onOpen={r => openBooking(r)} />,
    },
    {
      key: 'id', header: 'Actions', type: 'custom', pin: 'end', wrap: true,
      render: row => canManageParticipantLifecycle ? (
        <div className="flex flex-col gap-1">
          <div className={`flex flex-wrap whitespace-nowrap md:max-[1440px]:w-40 min-[1440px]:flex-nowrap items-center gap-2 ${ROW_ACTIONS_CARD}`}>
            {primaryAction(row)}
            {/* A direct intake has no enquiry record, so there is nothing to edit as one. On a booked row's phone card, Edit enquiry moves into More. */}
            {!row.isDirectIntake && (
              <Button size="sm" variant="secondary" className={row.intakeStartsAt ? 'max-md:hidden' : undefined} onClick={() => editExisting(row)}>
                Edit enquiry<span className="sr-only"> for {nameOf(row)}</span>
              </Button>
            )}
            {/* A booked row's phone menu holds its visit actions too; elsewhere the menu holds Close enquiry alone. */}
            {!row.isDirectIntake && row.intakeStartsAt && moreMenu(row, menuItems(row), 'md:hidden')}
            {canClose(row) && moreMenu(row, closeItem(row), row.intakeStartsAt ? 'max-md:hidden' : undefined)}
          </div>
          {reasonLink(row)}
        </div>
      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span>,
    },
  ]
  const zoneOf = (row: ParticipantInquiryDto) => row.timeZoneId || FALLBACK_ZONE
  // The Closed view (SHAPE section 11): why and when, and Reopen. No "closed by" on the row (lead decision 7); the audit trail keeps who.
  // The server withholds the note from roles without lifecycle rights, so they get no Note column at all: "—" would read as "no note" (SHAPE 11).
  const noteColumn: Column<ParticipantInquiryDto> = {
    key: 'closeNote', header: 'Note',
    render: row => (row.closeNote
      ? <span className="block max-w-[9.5rem] max-md:max-w-none truncate max-md:whitespace-normal text-sm text-[var(--color-muted-foreground)]" title={row.closeNote}>{row.closeNote}</span>
      : <span>—</span>),
  }
  const closedColumns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Participant', sortable: true, mobile: 'primary', render: row => nameOf(row) },
    { key: 'phone', header: 'Contact', render: row => <ContactCell row={row} /> },
    { key: 'closeOutcome', header: 'Outcome', mobile: 'meta', render: row => (row.closeOutcome ? CLOSE_OUTCOME_LABELS[row.closeOutcome] : '') },
    ...(canManageParticipantLifecycle ? [noteColumn] : []),
    {
      key: 'closedAt', header: 'Closed', sortable: true, mobile: 'meta',
      sortFn: (a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''),
      render: row => (row.closedAt ? visitDay(row.closedAt, zoneOf(row)) : ''),
    },
    {
      key: 'id', header: 'Actions', type: 'custom', pin: 'end',
      render: row => canManageParticipantLifecycle ? (
        <div className={`flex items-center gap-2 ${ROW_ACTIONS_CARD}`} onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="secondary" onClick={() => setReopening(row)}>Reopen<span className="sr-only"> {nameOf(row)}</span></Button>
        </div>
      ) : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span>,
    },
  ]
  const showEmptyState = !isError && !isLoading && open.length === 0
  const showTable = !isError && !showEmptyState && (open.length > 0 || isLoading)
  const showToolbar = !isError

  const toolbar = (
    <>
      <ToggleGroup
        ariaLabel="Show open or closed enquiries"
        options={[{ key: 'open', label: 'Open' }, { key: 'closed', label: 'Closed' }]}
        value={view}
        onChange={setView}
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search enquiries..." />
    </>
  )

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
      {!canManageParticipantLifecycle && <p role="status" className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">You can review enquiries, but your role cannot capture, edit, or start participant intake.</p>}
      {error && <Callout tone="error">{error}</Callout>}
      {showEmptyState && view === 'closed' && <EmptyState icon={ClipboardPlus} title="No closed enquiries" description="Enquiries you close show here, with why and when. You can reopen one." />}
      {showEmptyState && view === 'open' && <EmptyState icon={ClipboardPlus} title="No open enquiries" description="Capture an enquiry when someone first contacts the service, then start their intake. Once an intake is complete, the participant moves to the Onboarding tab." />}
      {showTable && !isLoading && filtered.length === 0
        ? <EmptyState icon={Search} title="No enquiries match your search" description={`Try a different search term, or clear the search to see every ${view} enquiry.`} action={{ label: 'Clear search', onClick: () => setSearch('') }} />
        : showTable && (view === 'closed'
          ? <DataTable data={filtered} columns={closedColumns} keyField="id" loading={isLoading} sortable emptyMessage="No closed enquiries." onRowClick={canManageParticipantLifecycle ? editExisting : undefined} />
          : <DataTable data={filtered} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No open enquiries." onRowClick={canManageParticipantLifecycle ? openRow : undefined} />)}
      <IntakeBookingPanel row={bookingRow} focusDate={booking?.focusDate} onClose={closeBooking} onRequestCancel={setCancelling} />
      <IntakeCancelDialog row={cancelling && (inquiries.find(r => r.id === cancelling.id) ?? cancelling)} onCancel={() => setCancelling(null)} onDone={onCancelled} />
      {closing && <CloseInquiryDialog row={closing} onCancel={() => setClosing(null)} onDone={onClosed} />}
      {reopening && <ReopenInquiryDialog row={reopening} onCancel={() => setReopening(null)} onDone={onReopened} />}
    </>
  )

  return { toolbar, showToolbar, body }
}
