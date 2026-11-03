import { useEffect, useMemo, useRef, useState } from 'react'
import { useParticipant, useParticipants, useProviderSettings, useSupportCatalogue } from '@/api/hooks'
import { useMakeManualClaim, usePreviewManualClaim } from '@/api/hooks/claimHub'
import { SERVICES_BEGUN } from '@/api/types/participants'
import type { ManualClaimRequestDto, SupportCatalogueItemDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import { FormField } from '@/components/FormField'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { ParticipantPicker } from '@/components/ParticipantPicker'
import { SearchableSelect } from '@/components/SearchableSelect'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { formatDateRange, formatDayMonth } from '@/lib/dateRange'
import { localIsoDate } from '@/lib/dateOnly'
import { formatServiceDate } from '@/lib/format'
import { extractErrorMessage, formatCurrency } from '@/lib/utils'

const PARTICIPANT_FIELD_ID = 'manual-claim-participant'
const ITEM_FIELD_ID = 'manual-claim-item'
const PREVIEW_FAILED = "Couldn't load the preview. Check your connection and try again."
const MAKE_FAILED = "Couldn't make the claim. Check your connection and try again."
const NUMBER_STYLE = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const

/** The price column the server reads for a state (`CatalogueStatePrice.For`): the eight state columns, the two loadings, and VIC for anything else. */
function limitIn(item: SupportCatalogueItemDto, state: string): number {
  switch (state.toUpperCase()) {
    case 'ACT': return item.priceLimit_ACT
    case 'NSW': return item.priceLimit_NSW
    case 'NT': return item.priceLimit_NT
    case 'QLD': return item.priceLimit_QLD
    case 'SA': return item.priceLimit_SA
    case 'TAS': return item.priceLimit_TAS
    case 'WA': return item.priceLimit_WA
    case 'REMOTE': return item.priceLimit_Remote
    case 'VERYREMOTE': case 'VERY REMOTE': return item.priceLimit_VeryRemote
    default: return item.priceLimit_VIC
  }
}

/** The cap the server applies: none for a quote item (no national price) or an item with no limit in the state. */
const capOf = (item: SupportCatalogueItemDto | undefined, state: string): number | undefined => {
  if (!item || item.priceNational == null) return undefined
  const limit = limitIn(item, state)
  return limit > 0 ? limit : undefined
}

const moreThanZero = (text: string) => text.trim() !== '' && Number(text) > 0

/**
 * The two steps of "A one-off claim": fill in one participant, one catalogue item, a day, a quantity and a price, then check the claim and make it. A child of the "New claim" chooser, which
 * owns the first step back (`onBack`); making the claim hands its id to `onMade`, and the page opens it. Everything shown as a limit here is a hint: the server decides, and refuses on the
 * check step with its own sentence.
 */
export function ManualClaimSteps({ onBack, onClose, onMade }: { onBack: () => void; onClose: () => void; onMade: (claimId: string) => void }) {
  const [step, setStep] = useState<'fill' | 'check'>('fill')
  const [participantId, setParticipantId] = useState('')
  const [code, setCode] = useState('')
  const [date, setDate] = useState('')
  const [quantity, setQuantity] = useState('')
  const [typedPrice, setTypedPrice] = useState<string | undefined>()   // undefined until the person types: then the item's limit stands in
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const preview = usePreviewManualClaim()
  const make = useMakeManualClaim()
  const previewButton = useRef<HTMLButtonElement>(null)
  const makeButton = useRef<HTMLButtonElement>(null)
  const cameBack = useRef(false)

  const participants = useParticipants(SERVICES_BEGUN)
  const catalogue = useSupportCatalogue()
  const participant = useParticipant(participantId || undefined)
  const provider = useProviderSettings()
  // The send gate's state rule: the participant's own, else the organisation's, else VIC.
  const state = participant.data?.addressState?.trim() || provider.data?.state?.trim() || 'VIC'

  const today = localIsoDate()
  // Items valid on the service day (today until one is chosen), newest version of each number.
  const options = useMemo(() => {
    const on = date || today
    const newest = new Map<string, SupportCatalogueItemDto>()
    for (const g of catalogue.data ?? []) {
      for (const i of g.items) {
        if (i.effectiveFrom.slice(0, 10) > on || (i.effectiveTo && i.effectiveTo.slice(0, 10) < on)) continue
        const seen = newest.get(i.itemNumber)
        if (!seen || seen.effectiveFrom < i.effectiveFrom) newest.set(i.itemNumber, i)
      }
    }
    return [...newest.values()].sort((a, b) => a.itemNumber.localeCompare(b.itemNumber))
  }, [catalogue.data, date, today])
  const item = options.find(i => i.itemNumber === code)
  const limit = capOf(item, state)
  const price = typedPrice ?? (limit !== undefined ? String(limit) : '')

  const errors = {
    date: touched.date && date > today ? "You can't claim for a day that hasn't happened yet." : undefined,
    quantity: touched.quantity && !moreThanZero(quantity) ? 'Enter more than 0.' : undefined,
    price: !touched.price ? undefined : !moreThanZero(price) ? 'Enter more than 0.' : limit !== undefined && Number(price) > limit ? `Over the ${state} limit of ${formatCurrency(limit)}.` : undefined,
  }
  const valid = !!participantId && !!item && !!date && date <= today && moreThanZero(quantity) && moreThanZero(price) && (limit === undefined || Number(price) <= limit)
  const touch = (field: string) => () => setTouched(t => ({ ...t, [field]: true }))

  const request: ManualClaimRequestDto = {
    participantId,
    lines: [{ supportItemCode: code, serviceDate: date, quantity: Number(quantity), unitPrice: Number(price) }],
    ...(notes.trim() ? { notes: notes.trim() } : {}),
  }
  const previewed = preview.data
  const making = make.isPending
  const previewing = preview.isPending

  // Focus follows a step change: the participant on the first render, Make claim once the preview is in, Preview on the way back.
  useEffect(() => {
    if (step !== 'fill') return
    if (cameBack.current) previewButton.current?.focus()
    else document.getElementById(PARTICIPANT_FIELD_ID)?.focus()
  }, [step])
  useEffect(() => {
    if (step === 'check' && previewed) makeButton.current?.focus()
  }, [step, previewed])

  const runPreview = () => {
    if (!valid) return
    setStep('check')
    make.reset()
    preview.mutate(request)
  }
  const makeClaim = () => {
    if (making || !previewed || preview.isError) return
    make.mutate(request, { onSuccess: created => onMade(created.id) })
  }

  if (step === 'fill') {
    return (
      <Modal
        open
        onClose={onClose}
        title="A one-off claim"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={onBack}>Back</Button>
            <Button ref={previewButton} size="md" onClick={runPreview} disabled={!valid}>Preview</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label="Participant">
            {participants.isError
              ? <PageState kind="error" noun="participants" onRetry={() => participants.refetch()} />
              : <ParticipantPicker id={PARTICIPANT_FIELD_ID} value={participantId} onChange={setParticipantId} showNdis openOnFocus={false} />}
          </FormField>
          <FormField label="Support item">
            {catalogue.isError
              ? <PageState kind="error" noun="price guide" onRetry={() => catalogue.refetch()} />
              : (
                <SearchableSelect
                  id={ITEM_FIELD_ID}
                  items={catalogue.isLoading ? [] : options.map(i => {
                    const cap = capOf(i, state)
                    return { value: i.itemNumber, label: `${i.itemNumber} · ${i.description}`, description: `${i.unit} · ${cap !== undefined ? `limit ${formatCurrency(cap)} in ${state}` : 'no price limit'}` }
                  })}
                  value={code}
                  onChange={setCode}
                  loading={catalogue.isLoading}
                  placeholder={catalogue.isLoading ? 'Loading price guide…' : 'Search the price guide'}
                  noMatchMessage="No support item matches."
                />
              )}
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Service date" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} onBlur={touch('date')} error={errors.date} />
            <TextField
              label={item?.unit === 'H' ? 'Hours' : 'Quantity'}
              inputMode="decimal"
              style={NUMBER_STYLE}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              onBlur={touch('quantity')}
              error={errors.quantity}
            />
          </div>
          <TextField
            label="Unit price"
            hint={item ? (limit !== undefined ? `Price guide limit ${formatCurrency(limit)} in ${state}` : 'No price guide limit for this item') : undefined}
            inputMode="decimal"
            style={NUMBER_STYLE}
            value={price}
            onChange={e => setTypedPrice(e.target.value)}
            onBlur={touch('price')}
            error={errors.price}
          />
          <TextAreaField label="Note (optional)" rows={3} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </Modal>
    )
  }

  const line = previewed?.lines[0]
  return (
    <Modal
      open
      onClose={making ? () => undefined : onClose}
      hideClose={making}
      title="Check the claim"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => { cameBack.current = true; setStep('fill') }} disabled={making}>Back</Button>
          <Button ref={makeButton} size="md" onClick={makeClaim} disabled={!previewed || previewing || preview.isError} aria-busy={making || undefined}>{making ? 'Making claim…' : 'Make claim'}</Button>
        </>
      }
    >
      {make.isError && <Callout tone="danger" className="mb-3">{extractErrorMessage(make.error, MAKE_FAILED)}</Callout>}
      {previewing && <PageState kind="loading" noun="claim preview" />}
      {preview.isError && <Callout tone="danger">{extractErrorMessage(preview.error, PREVIEW_FAILED)}</Callout>}
      {previewed && line && (
        <div className="flex flex-col gap-[var(--section-gap)]">
          <p className="text-sm text-[var(--color-muted-foreground)]">{previewed.participantName} · {formatServiceDate(line.date)}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-muted-foreground)]">
                <th className="py-1.5 pr-2 font-medium">Item</th>
                <th className="py-1.5 px-1.5 font-medium">Date</th>
                <th className="py-1.5 px-1.5 text-right font-medium">Quantity</th>
                <th className="py-1.5 px-1.5 text-right font-medium">Rate</th>
                <th className="py-1.5 pl-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {previewed.lines.map((l, i) => (
                <tr key={i} className="border-t border-[var(--color-border)] align-top">
                  <td className="py-2 pr-2">
                    <span className="block">{l.name}</span>
                    <span className="block break-all font-mono text-[13px] text-[var(--color-muted-foreground)]">{l.code}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 px-1.5 tabular-nums">{formatDayMonth(l.date)}</td>
                  <td className="py-2 px-1.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="whitespace-nowrap py-2 px-1.5 text-right tabular-nums">{formatCurrency(l.unitPrice)}</td>
                  <td className="whitespace-nowrap py-2 pl-1.5 text-right font-medium tabular-nums">{formatCurrency(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-baseline justify-between rounded-xl bg-[var(--color-surface)] p-4">
            <span className="text-sm text-[var(--color-muted-foreground)]">Total</span>
            <span className="whitespace-nowrap tabular-nums text-xl font-semibold">{formatCurrency(previewed.total)}</span>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]">{previewed.plan ? `Bills against the plan ${formatDateRange(previewed.plan.start, previewed.plan.end)}` : 'No plan on file, so the budget is not checked.'}</p>
          <ClaimBudgetBlock budget={previewed.budget} />
          {previewed.warnings.length > 0 && (
            <Callout tone="warning">
              <ul className="flex list-disc flex-col gap-1 pl-4">{previewed.warnings.map(w => <li key={w}>{w}</li>)}</ul>
            </Callout>
          )}
        </div>
      )}
    </Modal>
  )
}
