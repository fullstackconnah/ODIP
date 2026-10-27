import { useParams, Link } from 'react-router-dom'
import { useClaim, useUpdateClaim, useUpdateClaimLineItem } from '@/api/hooks'
import type { TripClaimStatus, ClaimLineItemDto } from '@/api/types'
import { PLAN_TYPE_LABELS, type PlanType } from '@/api/types/enums'
import { Download, Check, DollarSign, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NoShowModal } from '@/components/NoShowModal'
import { DataTable } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SubmitClaimDialog } from '@/components/SubmitClaimDialog'
import { RejectClaimDialog } from '@/components/RejectClaimDialog'
import { ndiaCodeMeaning } from '@/lib/ndiaCodes'
import { extractErrorMessage, formatCurrency, formatDateAu } from '@/lib/utils'
import { formatInstantDateAu } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { PageState } from '@/components/PageState'
import { Callout } from '@/components/Callout'
import { isNotFoundError } from '@/lib/httpStatus'
import { FactBar } from '@/components/FactBar'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import { retryingAfterError } from '@/lib/queryPhase'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { downloadFile } from '@/lib/downloadFile'
import { InvoicesSection } from './claim-detail/InvoicesSection'
import { FormField } from '@/components/FormField'


/** The API sends the enum name ('AgencyManaged'); this page once mapped a spelling it never sends ('NdiaManaged') and printed the raw name. */
function planTypeLabel(planType: string) {
  return PLAN_TYPE_LABELS[planType as PlanType] ?? planType
}

/** The server's own words for why it refused a change of status or of the NDIA code, else a sentence of ours. */
function refusalOf(err: unknown): string {
  return extractErrorMessage(err, "Couldn't update the claim status. Please try again.")
}

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>()
  const pageQuery = useClaim(id)
  const { data: claim, isLoading, isError, error, refetch } = pageQuery
  const updateClaim = useUpdateClaim()
  const updateLineItem = useUpdateClaimLineItem()
  const [noShowTarget, setNoShowTarget] = useState<ClaimLineItemDto | null>(null)
  const [notes, setNotes] = useState('')
  const [notesInit, setNotesInit] = useState(false)
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [notesEditorShown, setNotesEditorShown] = useState(false)
  const [saved, setSaved] = useState(false)
  const [statusConfirmTarget, setStatusConfirmTarget] = useState<TripClaimStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  // Recording the NDIA's code on a claim that is already rejected (the reason often arrives after the status was set): the same dialog, asking only for the code.
  const [recordingCode, setRecordingCode] = useState(false)
  // The page's one polite announcement (invoice void and credit outcomes; the submit notice).
  const [announcement, setAnnouncement] = useState('')
  const invoicesHeadingRef = useRef<HTMLHeadingElement>(null)
  const [submitting, setSubmitting] = useState(false)
  // After a submit the Invoices heading takes focus, once the dialog has gone (its own cleanup hands focus back to the opener first).
  // A ref, not state: the submit's own setSubmitting(false) is the render this waits for (react-hooks/set-state-in-effect).
  const focusInvoices = useRef(false)
  useEffect(() => {
    if (!focusInvoices.current) return
    focusInvoices.current = false
    invoicesHeadingRef.current?.focus()
  })
  // "Saved!" puts the label back after two seconds. The timer is kept so a newer save can replace it and leaving the page can cancel it: left
  // running it fires setSaved into a tree that is gone.
  const savedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    return () => {
      if (savedResetTimer.current) clearTimeout(savedResetTimer.current)
    }
  }, [])
  useEffect(() => {
    if (notesExpanded) notesRef.current?.focus()
  }, [notesExpanded])

  if (!notesInit && claim) {
    setNotes(claim.notes || '')
    setNotesEditorShown(!!claim.notes)
    setNotesInit(true)
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(!!claim && notes !== (claim.notes || ''))

  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="claim" />
  if (!claim) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="claim" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="claim" backTo="/trips" backLabel="trips" />
  }

  const totalAmount = (claim.lineItems ?? []).reduce((sum: number, l: ClaimLineItemDto) => sum + (l.totalAmount ?? 0), 0)

  function handleSaveNotes() {
    if (!id) return
    updateClaim.mutate({ claimId: id, data: { notes } }, {
      onSuccess: () => {
        setSaved(true)
        if (savedResetTimer.current) clearTimeout(savedResetTimer.current)
        savedResetTimer.current = setTimeout(() => setSaved(false), 2000)
      }
    })
  }

  function handleStatusChange(status: TripClaimStatus, rejectionCode?: string | null) {
    if (!id) return
    setStatusError(null)
    // The NDIA's code goes with a rejection only, and only when somebody gave one: any other status change carries no code, so the server's "only with a rejected claim" rule cannot trip.
    updateClaim.mutate({ claimId: id, data: rejectionCode ? { status, rejectionCode } : { status } }, {
      onSuccess: () => setStatusConfirmTarget(null),
      onError: (err) => setStatusError(refusalOf(err)),
    })
  }

  // The code on its own, with no status in the request: the claim stays as it is, and the server accepts a code only on a claim that is rejected.
  function handleRecordCode(code: string | null) {
    if (!id || !code) return
    setStatusError(null)
    updateClaim.mutate({ claimId: id, data: { rejectionCode: code } }, {
      onSuccess: () => setRecordingCode(false),
      onError: (err) => setStatusError(refusalOf(err)),
    })
  }

  function statusConfirmCopy(status: TripClaimStatus | null) {
    switch (status) {
      case 'Paid':
        return { title: 'Mark as paid?', message: 'Mark this claim as paid? This cannot be undone.', confirmLabel: 'Mark as Paid', variant: 'default' as const }
      default:
        return null
    }
  }

  function handleRevertToConfirmed(item: ClaimLineItemDto) {
    if (!id) return
    setStatusError(null)
    updateLineItem.mutate({ claimId: id, itemId: item.id, data: { claimType: 'Standard' } }, { onError: err => setStatusError(refusalOf(err)) })
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <AnnouncementRegion message={announcement} />
      {/* Breadcrumb — for Kind === 'Shift' claims there is no trip to link to (design spec §1/§2,
          PR 3: tripInstanceId is unset), so the period stands in place of the trip link. */}
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Link to="/trips" className="hover:text-[var(--color-primary)]">Trips</Link>
        <span>/</span>
        {claim.kind === 'Shift' ? (
          <>
            <span>{formatDateAu(claim.periodFrom)} – {formatDateAu(claim.periodTo)}</span>
            <span>/</span>
          </>
        ) : (
          claim.tripInstanceId && (
            <>
              <Link to={`/trips/${claim.tripInstanceId}`} className="hover:text-[var(--color-primary)]">{claim.tripName || 'Trip'}</Link>
              <span>/</span>
            </>
          )
        )}
        <span className="font-medium">Claim {claim.claimReference}</span>
      </div>

      <PageHeader
        title={`Claim ${claim.claimReference}`}
        subtitle={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={claim.status} />
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-container-low)] text-[var(--color-muted-foreground)] font-medium">
              {claim.kind === 'Shift' ? 'Shift claim' : 'Trip claim'}
            </span>
          </div>
        }
        action={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => downloadFile(`/claims/${id}/bpr-csv`, `${claim.claimReference}-bpr.csv`, "Couldn't download the BPR CSV. Try again.").catch((err: Error) => setStatusError(err.message))}
            >
              <Download className="w-4 h-4" />
              BPR CSV
            </Button>
            {/* The moves CanMove allows; from Rejected it is the reissue path, and a shift claim has no other way back. */}
            {(claim.status === 'Draft' || claim.status === 'Ready' || claim.status === 'Rejected') && (
              <Button
                variant="primary"
                size="md"
                onClick={() => { setStatusError(null); setSubmitting(true) }}
                disabled={updateClaim.isPending}
              >
                <Check className="w-4 h-4" />
                Mark as Submitted
              </Button>
            )}
            {claim.status === 'Submitted' && (
              <>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => { setStatusError(null); setStatusConfirmTarget('Paid') }}
                  disabled={updateClaim.isPending}
                >
                  <DollarSign className="w-4 h-4" />
                  Mark as Paid
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => { setStatusError(null); setStatusConfirmTarget('Rejected') }}
                  disabled={updateClaim.isPending}
                >
                  <XCircle className="w-4 h-4" />
                  Mark as Rejected
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* A refused Mark Confirmed (the claim moved on while this page was open) says why; the dialogs show their own refusals. */}
      {statusError && !statusConfirmTarget && !recordingCode && <Callout tone="error">{statusError}</Callout>}

      <FactBar
        segments={[
          { label: 'Total Amount', value: <span className="tabular-nums">{formatCurrency(totalAmount)}</span> },
          claim.kind === 'Shift'
            ? { label: 'Period', value: <span className="tabular-nums">{`${formatDateAu(claim.periodFrom)} – ${formatDateAu(claim.periodTo)}`}</span> }
            : { label: 'Trip', value: claim.tripName || '—' },
          { label: 'Created', value: <span className="tabular-nums">{formatInstantDateAu(claim.createdAt)}</span> },
          { label: 'Submitted', value: <span className="tabular-nums">{formatInstantDateAu(claim.submittedDate)}</span> },
          // What the NDIA said, once it has refused the claim: when, and the code it gave (V17, V18, V27 and V28 say the funds ran out). Nothing is said of a claim that is not rejected.
          ...(claim.status === 'Rejected'
            ? [{
              label: 'Rejected',
              value: (
                <>
                  <span className="tabular-nums">
                    {formatInstantDateAu(claim.rejectedDate)}
                    {' · '}{claim.rejectionCode ? `NDIA code ${claim.rejectionCode}${ndiaCodeMeaning(claim.rejectionCode) ? ` (${ndiaCodeMeaning(claim.rejectionCode)})` : ''}` : 'no NDIA code recorded'}
                  </span>
                  {/* The code is the one input that switches the budget warning on, and the reason often arrives after the status is set: a claim rejected with none can be given one here. */}
                  {!claim.rejectionCode && <Button variant="secondary" size="sm" className="ml-2" onClick={() => { setStatusError(null); setRecordingCode(true) }}>Record the NDIA code</Button>}
                </>
              ),
            }]
            : []),
        ]}
      />

      {/* What this claim did to each participant's recorded plan, as of now. Absent when none of them has a plan that has started: no figure, not a zero. */}
      <ClaimBudgetBlock budget={claim.budget} />

      <InvoicesSection claim={claim} onAnnounce={setAnnouncement} headingRef={invoicesHeadingRef} />

      {/* Empty notes stay available without taking attention from the claim's line items. */}
      {(notes || notesExpanded || notesEditorShown) ? <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] space-y-2">
        <FormField label="Notes"><textarea
          id="claim-notes"
          ref={notesRef}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Add claim notes..."
          className="resize-none" /></FormField>
        <div className="flex justify-end">
          <Button variant="primary" size="md" onClick={handleSaveNotes} disabled={updateClaim.isPending}>
            {saved ? 'Saved!' : 'Save Notes'}
          </Button>
        </div>
      </div> : <button type="button" onClick={() => setNotesExpanded(true)} className="self-start min-h-11 text-sm font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded">Add notes</button>}

      {/* Line items */}
      <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
        <div className="px-[var(--card-pad)] py-2 bg-[var(--color-surface-container-low)] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--color-muted-foreground)]">Line Items</h2>
          <span className="text-xs text-[var(--color-muted-foreground)]">{(claim.lineItems ?? []).length} items</span>
        </div>
        <DataTable
          data={claim.lineItems ?? []}
          keyField="id"
          sortable
          columns={[
            {
              key: 'participantName',
              header: 'Participant',
              sortable: true,
              render: (item: ClaimLineItemDto) => (
                <div>
                  {item.participantId ? (
                    <Link to={`/participants/${item.participantId}`} className="font-medium text-[var(--color-primary)] hover:underline">
                      {item.participantName}
                    </Link>
                  ) : (
                    <p className="font-medium text-[var(--color-foreground)]">{item.participantName}</p>
                  )}
                  <p className="text-xs text-[var(--color-muted-foreground)] font-mono tabular-nums">{item.ndisNumber}</p>
                  <StatusBadge status={item.planType} label={planTypeLabel(item.planType)} />
                </div>
              ),
            },
            {
              key: 'supportItemCode',
              header: 'Support Item',
              sortable: true,
              className: 'font-mono text-sm tabular-nums text-[var(--color-muted-foreground)]',
            },
            {
              key: 'dayType',
              header: 'Day Type',
              sortable: true,
              render: (item: ClaimLineItemDto) => (
                <span className="text-[var(--color-muted-foreground)]">{item.dayType}</span>
              ),
            },
            {
              key: 'supportsDeliveredFrom',
              header: 'Dates',
              sortable: true,
              // Shift-kind lines (design spec §1/§3, PR 3) always carry the same value in both
              // supportsDeliveredFrom/To — a single shift's service date, not a booking window —
              // so show it once rather than as a redundant "date – same date" range.
              render: (item: ClaimLineItemDto) => (
                <span className="text-sm tabular-nums text-[var(--color-muted-foreground)] whitespace-nowrap">
                  {item.shiftId ? item.supportsDeliveredFrom : `${item.supportsDeliveredFrom} – ${item.supportsDeliveredTo}`}
                </span>
              ),
            },
            {
              key: 'hours',
              header: 'Hours',
              align: 'right' as const,
              render: (item: ClaimLineItemDto) => (
                <span className="tabular-nums text-[var(--color-muted-foreground)]">{item.hours}h</span>
              ),
            },
            {
              key: 'unitPrice',
              header: 'Unit Price',
              type: 'currency' as const,
              align: 'right' as const,
            },
            {
              key: 'totalAmount',
              header: 'Total',
              type: 'currency' as const,
              align: 'right' as const,
              sortable: true,
              className: 'font-medium tabular-nums',
            },
            {
              key: 'status',
              header: 'Status',
              render: (item: ClaimLineItemDto) => (
                <StatusBadge status={item.status} />
              ),
            },
            {
              key: 'actions',
              header: '',
              // Shift-kind lines (design spec §1/§3, PR 3) have no ParticipantBookingId — No
              // Show/Mark Confirmed toggle a booking's cancellation state, and Invoice downloads
              // by bookingId (invoice export is explicitly out of scope for shift claims) — none
              // of that applies here, so show a plain "Shift" label instead.
              render: (item: ClaimLineItemDto) =>
                item.shiftId ? (
                  <span className="text-xs text-[var(--color-muted-foreground)]">Shift</span>
                ) : (
                  <div className="flex flex-col gap-1.5 items-start">
                    {item.claimType === 'Cancellation' ? (
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] font-medium whitespace-nowrap">
                          No Show · {item.cancellationReason}
                        </span>
                        {/* A line's type is part of what was sent to the NDIA, so only a draft claim can change it (the server refuses it otherwise). */}
                        {claim.status === 'Draft' && (
                          <button
                            onClick={() => handleRevertToConfirmed(item as ClaimLineItemDto)}
                            disabled={updateLineItem.isPending}
                            className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] hover:underline disabled:opacity-50"
                          >
                            Mark Confirmed
                          </button>
                        )}
                      </div>
                    ) : claim.status === 'Draft' && (
                      <button
                        onClick={() => setNoShowTarget(item as ClaimLineItemDto)}
                        className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)] hover:underline"
                      >
                        No Show
                      </button>
                    )}
                  </div>
                ),
            },
          ]}
          footer={
            <tr>
              <td colSpan={6} className="p-2 text-right font-semibold text-[var(--color-foreground)]">Total</td>
              <td className="p-2 font-bold tabular-nums text-[var(--color-foreground)]">{formatCurrency(totalAmount)}</td>
              <td colSpan={2} />
            </tr>
          }
          className="overflow-x-auto"
        />
      </div>
      {noShowTarget && id && (
        <NoShowModal
          claimId={id}
          lineItem={noShowTarget}
          onClose={() => setNoShowTarget(null)}
          onSuccess={() => setNoShowTarget(null)}
        />
      )}
      {/* A rejection asks, optionally, for the NDIA's code (V17, V18, V27, V28 or another): the codes that say the funds ran out warn on the participant's budget. */}
      {statusConfirmTarget === 'Rejected' && (
        <RejectClaimDialog
          error={statusError}
          loading={updateClaim.isPending}
          onCancel={() => { if (!updateClaim.isPending) setStatusConfirmTarget(null) }}
          onConfirm={code => handleStatusChange('Rejected', code)}
        />
      )}
      {submitting && id && (
        <SubmitClaimDialog
          claimId={id}
          onCancel={() => setSubmitting(false)}
          onSubmitted={announcement => { setSubmitting(false); setAnnouncement(announcement); focusInvoices.current = true }}
        />
      )}
      {recordingCode && (
        <RejectClaimDialog
          recordOnly
          error={statusError}
          loading={updateClaim.isPending}
          onCancel={() => { if (!updateClaim.isPending) setRecordingCode(false) }}
          onConfirm={handleRecordCode}
        />
      )}
      {statusConfirmTarget && statusConfirmTarget !== 'Rejected' && (() => {
        const copy = statusConfirmCopy(statusConfirmTarget)!
        return (
          <ConfirmDialog
            open
            onCancel={() => { if (!updateClaim.isPending) setStatusConfirmTarget(null) }}
            onConfirm={() => handleStatusChange(statusConfirmTarget)}
            title={copy.title}
            confirmLabel={copy.confirmLabel}
            variant={copy.variant}
            loading={updateClaim.isPending}
            message={
              <>
                <p>{copy.message}</p>
                {statusError && (
                  <p role="alert" className="text-[var(--color-destructive)]">{statusError}</p>
                )}
              </>
            }
          />
        )
      })()}
      {unsavedChangesDialog}
    </div>
  )
}
