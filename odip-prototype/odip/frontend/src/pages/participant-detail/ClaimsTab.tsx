import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useParticipantClaims, usePreviewShiftClaim, useGenerateShiftClaim } from '@/api/hooks'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { Card } from '@/components/Card'
import { DataTable } from '@/components/DataTable'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { plural } from '@/lib/format'
import { extractErrorMessage, formatCurrency, formatDateAu } from '@/lib/utils'
import type { TripClaimListDto, ShiftClaimFlaggedDto, ShiftClaimGeneratedDto, ShiftClaimLeftOutDto, ShiftClaimPreviewLineItemDto, ShiftClaimPreviewResponseDto } from '@/api/types'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import type { Tone } from '@/lib/tone'
import { Button } from '@/components/Button'

// Distinct from trip-detail/ClaimsTab.tsx (same name, different directory — see the
// shift-completion design spec §4 "Claims entry point"). This tab lists BOTH kinds of claim a
// participant may have (a Trip claim generated from one of their trip bookings, or a Shift claim
// generated below) rather than only shift claims, so a coordinator has one place to see all of a
// participant's NDIS claims.
const KIND_COLOR_MAP: Record<string, Tone> = {
  trip: 'info',
  shift: 'accessible',
}

/** yyyy-MM-dd in the viewer's local time — never UTC, which can silently shift the date near
 * midnight (see parseApiDate's own note on the same hazard for API-supplied timestamps). */
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Default date range for "Generate from shifts": the 14 days ending yesterday — the most
 * recently completed full fortnight, so a shift finished today is never silently excluded by an
 * end date that already includes it just because "today" isn't over yet. */
function lastFullFortnight(today = new Date()): { from: string; to: string } {
  const to = new Date(today)
  to.setDate(to.getDate() - 1)
  const from = new Date(to)
  from.setDate(from.getDate() - 13)
  return { from: toIsoDate(from), to: toIsoDate(to) }
}


export default function ClaimsTab({ participantId, canWrite }: { participantId: string; canWrite: boolean }) {
  const claimsQuery = useParticipantClaims(participantId)
  const claims = claimsQuery.data ?? []
  // A failed or paused request is not an empty list: "No claims yet" is only for one that succeeded and came back empty.
  const phase = queryPhase(claimsQuery)
  const [showGenerateModal, setShowGenerateModal] = useState(false)

  return (
    <Card
      title="NDIS Claims"
      action={
        canWrite ? (
          <Button onClick={() => setShowGenerateModal(true)}>
            Generate from shifts
          </Button>
        ) : undefined
      }
    >
      {phase === 'loading' ? (
        <PageState kind="loading" noun="claim list" />
      ) : phase === 'error' ? (
        <PageState kind="error" noun="claim list" onRetry={() => claimsQuery.refetch()} />
      ) : claims.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No claims yet"
          description="Generate a claim once this participant has completed, unclaimed shifts — or from a trip's own Claims tab."
        />
      ) : (
        <DataTable
          data={claims}
          keyField="id"
          sortable
          emptyMessage="No claims yet"
          columns={[
            {
              key: 'kind',
              header: 'Kind',
              sortable: true,
              render: (c: TripClaimListDto) => <StatusBadge status={c.kind} colorMap={KIND_COLOR_MAP} />,
            },
            { key: 'claimReference', header: 'Reference', sortable: true, className: 'font-medium font-mono text-sm' },
            {
              key: 'tripName',
              header: 'Trip / Period',
              render: (c: TripClaimListDto) =>
                c.kind === 'Shift' ? (
                  <span className="text-[var(--color-muted-foreground)]">
                    {formatDateAu(c.periodFrom)} – {formatDateAu(c.periodTo)}
                  </span>
                ) : c.tripInstanceId ? (
                  <Link to={`/trips/${c.tripInstanceId}`} className="text-[var(--color-primary)] hover:underline">
                    {c.tripName}
                  </Link>
                ) : (
                  <span>{c.tripName || '—'}</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              sortable: true,
              render: (c: TripClaimListDto) => <StatusBadge status={c.status} />,
            },
            {
              key: 'totalAmount',
              header: 'Total',
              type: 'currency',
              sortable: true,
              align: 'right',
              className: 'font-medium tabular-nums',
            },
            { key: 'createdAt', header: 'Created', type: 'date', sortable: true },
            {
              key: 'actions',
              header: '',
              render: (c: TripClaimListDto) => (
                <Link to={`/claims/${c.id}`} className="text-xs text-[var(--color-primary)] hover:underline">
                  View
                </Link>
              ),
            },
          ]}
        />
      )}

      {showGenerateModal && (
        <GenerateShiftClaimModal participantId={participantId} onClose={() => setShowGenerateModal(false)} />
      )}
    </Card>
  )
}

function GenerateShiftClaimModal({ participantId, onClose }: { participantId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const defaultRange = useMemo(() => lastFullFortnight(), [])
  const [step, setStep] = useState<'input' | 'preview' | 'done'>('input')
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [previewData, setPreviewData] = useState<ShiftClaimPreviewResponseDto | null>(null)
  // The claim that was made, kept only when it left shifts out: the person is told which and why before being taken to it.
  const [generated, setGenerated] = useState<ShiftClaimGeneratedDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewShiftClaim = usePreviewShiftClaim()
  const generateShiftClaim = useGenerateShiftClaim()

  function handlePreview() {
    setError(null)
    previewShiftClaim.mutate(
      { participantId, data: { from, to } },
      {
        onSuccess: (data) => {
          setPreviewData(data)
          setStep('preview')
        },
        onError: (err: unknown) => {
          setError(extractErrorMessage(err, 'Failed to preview this claim. Check the date range and try again.'))
        },
      },
    )
  }

  function handleGenerate() {
    setError(null)
    generateShiftClaim.mutate(
      { participantId, data: { from, to } },
      {
        onSuccess: (claim) => {
          // A shift the claim could not price was left out and is still waiting, and a shift priced with a caveat (an overnight shift: evening and night rates are not applied yet) keeps that
          // caveat nowhere on the claim line: say both before leaving the screen, so neither is lost between the preview and the claim.
          if ((claim.leftOut?.length ?? 0) > 0 || (claim.flagged?.length ?? 0) > 0) {
            setGenerated(claim)
            setStep('done')
            return
          }
          navigate(`/claims/${claim.id}`)
        },
        onError: (err: unknown) => {
          setError(extractErrorMessage(err, 'Failed to generate this claim. Please try again.'))
        },
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'input' ? 'Generate claim from shifts' : step === 'preview' ? 'Claim preview' : 'Claim generated'}
      size="lg"
      footer={
        step === 'done' && generated ? (
          <div className="flex w-full justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => navigate(`/claims/${generated.id}`)}>
              View claim
            </Button>
          </div>
        ) : step === 'input' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handlePreview} disabled={previewShiftClaim.isPending}>
              {previewShiftClaim.isPending ? 'Loading…' : 'Preview →'}
            </Button>
          </>
        ) : (
          <div className="flex w-full justify-between">
            <Button variant="secondary" onClick={() => { setStep('input'); setError(null) }}>
              &larr; Back
            </Button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={generateShiftClaim.isPending}>
                {generateShiftClaim.isPending ? 'Generating…' : 'Confirm & Generate'}
              </Button>
            </div>
          </div>
        )
      }
    >
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-error-container)] bg-[var(--color-error-container)]/40 px-4 py-3 text-sm text-[var(--color-on-error-container)]">
          <span className="mt-0.5">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {step === 'input' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="From">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To">
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </FormField>
        </div>
      )}

      {step === 'preview' && previewData && (
        <>
          <div className="mb-5 flex items-baseline justify-between rounded-xl bg-[var(--color-surface)] p-4">
            <span className="text-sm text-[var(--color-muted-foreground)]">Total</span>
            <span className="tabular-nums text-xl font-semibold">{formatCurrency(previewData.totalAmount)}</span>
          </div>
          <DataTable
            data={previewData.lineItems.map((l, i) => ({ ...l, _idx: i }))}
            keyField="_idx"
            columns={[
              { key: 'serviceDate', header: 'Date', type: 'date' },
              {
                key: 'dayTypeLabel',
                header: 'Day type',
                // A line that is priced but not worked out fully says so beside its day type (an overnight shift: evening and night rates are not applied yet).
                render: (l: ShiftClaimPreviewLineItemDto & { _idx: number }) => (
                  <span>
                    {l.dayTypeLabel}
                    {l.note && <span className="block text-xs text-[var(--color-on-warning-container)]">{l.note}</span>}
                  </span>
                ),
              },
              { key: 'supportItemCode', header: 'Item', className: 'font-mono text-xs' },
              { key: 'hours', header: 'Hours', align: 'right' },
              { key: 'unitPrice', header: 'Unit price', type: 'currency', align: 'right' },
              {
                key: 'totalAmount',
                header: 'Total',
                type: 'currency',
                align: 'right',
                className: 'tabular-nums font-medium',
              },
            ]}
            footer={
              <tr>
                <td colSpan={5} className="p-3 text-right font-semibold text-[var(--color-foreground)]">Total</td>
                <td className="p-3 tabular-nums font-bold text-[var(--color-foreground)]">
                  {formatCurrency(previewData.totalAmount)}
                </td>
              </tr>
            }
          />

          {/* A completed shift this claim cannot price is left out and stays waiting: never dropped silently. */}
          {previewData.leftOut && previewData.leftOut.length > 0 && (
            <div className="mt-[var(--section-gap)]">
              <LeftOutShifts shifts={previewData.leftOut} heading={`${plural(previewData.leftOut.length, 'shift')} will be left out of this claim`} />
            </div>
          )}

          {/* What this claim would use of the participant's recorded plan: a warning, never a block. Absent when they have no plan that has started. */}
          <div className="mt-[var(--section-gap)]">
            <ClaimBudgetBlock budget={previewData.budget} />
          </div>
        </>
      )}

      {step === 'done' && generated && (
        <div className="flex flex-col gap-[var(--section-gap)]">
          <p className="text-sm">
            {generated.claimReference ? `Claim ${generated.claimReference} was made` : 'The claim was made'}
            {generated.totalAmount != null ? ` for ${formatCurrency(generated.totalAmount)}` : ''}
            {/* "From the shifts that could be priced" is only true when some could not: a claim whose only note is a caveat has every shift of the range in it. */}
            {(generated.leftOut?.length ?? 0) > 0 ? ', from the shifts that could be priced' : ''}.
          </p>
          {generated.leftOut && generated.leftOut.length > 0 && (
            <LeftOutShifts shifts={generated.leftOut} heading={`${plural(generated.leftOut.length, 'shift')} ${generated.leftOut.length === 1 ? 'was' : 'were'} left out of the claim`} />
          )}
          {generated.flagged && generated.flagged.length > 0 && <FlaggedShifts shifts={generated.flagged} />}
        </div>
      )}
    </Modal>
  )
}

/** The shifts that are in a claim but were priced with a caveat: each with its date, what it is and what is not worked out. The claim line cannot keep the caveat, so this is where it is read. */
function FlaggedShifts({ shifts }: { shifts: ShiftClaimFlaggedDto[] }) {
  return (
    <Callout tone="info">
      <p className="font-medium">{`${plural(shifts.length, 'shift')} in this claim ${shifts.length === 1 ? 'has' : 'have'} a pricing note`}</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {shifts.map(shift => (
          <li key={shift.shiftId}>
            <span className="tabular-nums">{formatDateAu(shift.serviceDate)}</span> · {shift.description} · {shift.caveat}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px]">Their lines are priced as hours at the day rate. Check them against the hours worked before the claim is submitted.</p>
    </Callout>
  )
}

/** The completed shifts a shift claim leaves out: each with its date, what it is and why. They are not part of the claim, and they stay completed and unclaimed. */
function LeftOutShifts({ shifts, heading }: { shifts: ShiftClaimLeftOutDto[]; heading: string }) {
  return (
    <Callout tone="warning">
      <p className="font-medium">{heading}</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {shifts.map(shift => (
          <li key={shift.shiftId}>
            <span className="tabular-nums">{formatDateAu(shift.serviceDate)}</span> · {shift.description} · {shift.reason}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px]">They stay completed and unclaimed. Nothing here is billed for them.</p>
    </Callout>
  )
}
