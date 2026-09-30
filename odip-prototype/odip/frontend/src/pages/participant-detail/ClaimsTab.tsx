import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { useParticipantClaims, usePreviewShiftClaim, useGenerateShiftClaim } from '@/api/hooks'
import { Card } from '@/components/Card'
import { DataTable } from '@/components/DataTable'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { extractErrorMessage, formatCurrency, formatDateAu } from '@/lib/utils'
import type { TripClaimListDto, ShiftClaimPreviewResponseDto } from '@/api/types'

// Distinct from trip-detail/ClaimsTab.tsx (same name, different directory — see the
// shift-completion design spec §4 "Claims entry point"). This tab lists BOTH kinds of claim a
// participant may have (a Trip claim generated from one of their trip bookings, or a Shift claim
// generated below) rather than only shift claims, so a coordinator has one place to see all of a
// participant's NDIS claims.
const KIND_COLOR_MAP: Record<string, string> = {
  trip: 'bg-blue-100 text-blue-700',
  shift: 'bg-purple-100 text-purple-700',
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

const buttonClass = 'px-4 py-2 text-sm rounded-full font-medium transition-all disabled:opacity-50'
const primaryButtonClass = `${buttonClass} bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90`
const secondaryButtonClass = `${buttonClass} border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]`

export default function ClaimsTab({ participantId, canWrite }: { participantId: string; canWrite: boolean }) {
  const { data: claims = [], isLoading } = useParticipantClaims(participantId)
  const [showGenerateModal, setShowGenerateModal] = useState(false)

  return (
    <Card
      title="NDIS Claims"
      action={
        canWrite ? (
          <button type="button" onClick={() => setShowGenerateModal(true)} className={primaryButtonClass}>
            Generate from shifts
          </button>
        ) : undefined
      }
    >
      {isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
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
  const [step, setStep] = useState<'input' | 'preview'>('input')
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [previewData, setPreviewData] = useState<ShiftClaimPreviewResponseDto | null>(null)
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
        onSuccess: (claim) => navigate(`/claims/${claim.id}`),
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
      title={step === 'input' ? 'Generate claim from shifts' : 'Claim preview'}
      size="lg"
      footer={
        step === 'input' ? (
          <>
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="button" onClick={handlePreview} disabled={previewShiftClaim.isPending} className={primaryButtonClass}>
              {previewShiftClaim.isPending ? 'Loading…' : 'Preview →'}
            </button>
          </>
        ) : (
          <div className="flex w-full justify-between">
            <button
              type="button"
              onClick={() => { setStep('input'); setError(null) }}
              className={secondaryButtonClass}
            >
              &larr; Back
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className={secondaryButtonClass}>
                Cancel
              </button>
              <button type="button" onClick={handleGenerate} disabled={generateShiftClaim.isPending} className={primaryButtonClass}>
                {generateShiftClaim.isPending ? 'Generating…' : 'Confirm & Generate'}
              </button>
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
              { key: 'dayTypeLabel', header: 'Day type' },
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
        </>
      )}
    </Modal>
  )
}
