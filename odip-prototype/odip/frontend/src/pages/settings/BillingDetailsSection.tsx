import { Link } from 'react-router-dom'
import { CheckboxField } from '@/components/CheckboxField'
import { NumberField } from '@/components/NumberField'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { labelClass } from '@/components/FormField'
import { formatRatio } from '@/lib/format'
import { formGrid, span } from '@/lib/formGrid'
import { usePermissions } from '@/lib/permissions'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { useProviderRow } from './providerRow'

// The starting-number hint, also the invisible reserve that keeps its cell one height in both states.
const START_HINT = "Carry on from your old system's numbers. It can't change once an invoice is issued."

/** Billing details and Safety checks are saved with the profile's four required fields, so until those are filled in they say so here. */
export function IncompleteProfileNote() {
  return (
    <Callout
      tone="info"
      announce={false}
      className="max-w-prose"
      actions={<Link to="/settings?section=organisation" className="whitespace-nowrap font-medium text-[var(--color-primary)] underline underline-offset-2">Open Organisation profile</Link>}
    >
      Fill in the organisation profile first. These settings are saved with it.
    </Callout>
  )
}

/** What a numbering prefix may be (SHAPE section 4, N1): the server's rule too. */
function prefixProblem(value: string) {
  if (!value.trim()) return 'Enter a prefix, such as INV-.'
  if (/\s/.test(value)) return 'No spaces.'
  if (value.length > 10) return '10 characters at most.'
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return 'Use letters, digits, - _ or . only.'
  return undefined
}

const WORDING_MAX = 2000
const WORDING_OVER = 'Enter 2,000 characters or fewer.'
const wordingBlurb = (section: number) => `Printed as section ${section} of the service agreement. Leave blank to print the standard draft wording.`

/** One agreement wording field: no maxLength (a pasted clause is never cut without a word, it is blocked instead), and a count from 1,800 trimmed characters, as the witness statement does. */
function WordingField({ id, label, hint, value, error, readOnly, onChange }: { id: string; label: string; hint?: string; value: string; error?: string; readOnly: boolean; onChange: (v: string) => void }) {
  const used = value.trim().length
  const shown = (n: number) => n.toLocaleString('en-AU')
  const ratio = formatRatio(shown(used), shown(WORDING_MAX))
  const countId = `${id}-count`
  // The screen-reader copy changes only at 1,800, 1,950 and 2,000, so it is not read on every key; over the limit the error speaks.
  const step = [1800, 1950].filter(n => used >= n).pop()
  const live = used > WORDING_MAX ? '' : used === WORDING_MAX ? `${ratio}. That's the limit.` : step ? `At least ${formatRatio(shown(step), shown(WORDING_MAX))}` : ''
  const count = !readOnly && used >= 1800 ? ratio : ''
  return (
    <div>
      <TextAreaField label={label} rows={6} hint={hint} error={error} value={value} readOnly={readOnly} descriptionId={countId} onChange={e => onChange(e.target.value)} />
      <span id={countId} className={`block text-xs tabular-nums text-[var(--color-on-warning-container)] ${count ? 'mt-1' : ''}`}>{count}</span>
      <span aria-live="polite" className="sr-only">{readOnly ? '' : live}</span>
    </div>
  )
}

const wholeFrom = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max

/** Organisation › Billing details: the bank account on invoices (hidden from Coordinators here; invoices still print it), invoice numbering and payment terms, GST status, and the invoice note. */
export default function BillingDetailsSection(frame: SectionFrame) {
  const { showBankDetails } = usePermissions()
  const p = useProviderRow(row => ({
    bankAccountName: row?.bankAccountName ?? '',
    bsb: row?.bsb ?? '',
    accountNumber: row?.accountNumber ?? '',
    gstRegistered: row?.gstRegistered ?? false,
    invoiceFooterNotes: row?.invoiceFooterNotes ?? '',
    agreementResponsibilitiesTerms: row?.agreementResponsibilitiesTerms ?? '',
    agreementComplaintsTerms: row?.agreementComplaintsTerms ?? '',
    invoiceNumberPrefix: row?.invoiceNumberPrefix ?? 'INV-',
    creditNotePrefix: row?.creditNotePrefix ?? 'CN-',
    invoiceStartNumber: row?.invoiceStartNumber ?? 1,
    paymentTermsDays: row?.paymentTermsDays ?? 14,
  }))
  // Once an invoice is issued the starting number is fixed: the cell shows the next number, and a save echoes the row's own value (a changed one is refused).
  const issued = !!p.row?.invoicesIssued
  const errors = p.form ? {
    invoiceNumberPrefix: prefixProblem(p.form.invoiceNumberPrefix),
    creditNotePrefix: prefixProblem(p.form.creditNotePrefix),
    invoiceStartNumber: issued || wholeFrom(p.form.invoiceStartNumber, 1, 99_999_999) ? undefined : 'Enter a whole number from 1 to 99,999,999.',
    paymentTermsDays: wholeFrom(p.form.paymentTermsDays, 0, 365) ? undefined : 'Enter a whole number of days from 0 to 365.',
    agreementResponsibilitiesTerms: p.form.agreementResponsibilitiesTerms.trim().length > WORDING_MAX ? WORDING_OVER : undefined,
    agreementComplaintsTerms: p.form.agreementComplaintsTerms.trim().length > WORDING_MAX ? WORDING_OVER : undefined,
  } : {}
  const problems = Object.values(errors).filter(Boolean).length
  // Nothing here can be saved until the profile is complete, so the fields are locked as well as the foot left off.
  const locked = frame.readOnly || p.incomplete

  return (
    <SettingsSection {...frame} save={p.form && !p.incomplete ? { dirty: p.dirty, pending: p.pending, result: p.result, problems, onSave: () => p.save(issued ? { invoiceStartNumber: p.row!.invoiceStartNumber } : {}) } : undefined}>
      {(p.query.isError || retryingAfterError(p.query)) && !p.form ? <PageState kind="error" noun="billing details section" onRetry={() => p.query.refetch()} />
        : !p.form ? <PageState kind="loading" noun="billing details section" />
        : (
          <>
            {p.incomplete && !frame.readOnly && <IncompleteProfileNote />}
            {showBankDetails && (
              <SettingsGroup title="Bank account">
                <div className={formGrid}>
                  <TextField label="Account name" hint={p.hint('bankAccountName')} className={span.medium} value={p.form.bankAccountName} readOnly={locked} onChange={e => p.edit({ bankAccountName: e.target.value })} />
                  <TextField label="BSB" hint={p.hint('bsb', '6 digits.')} inputMode="numeric" className={span.short} value={p.form.bsb} readOnly={locked} onChange={e => p.edit({ bsb: e.target.value })} />
                  <TextField label="Account number" hint={p.hint('accountNumber')} inputMode="numeric" className={span.short} value={p.form.accountNumber} readOnly={locked} onChange={e => p.edit({ accountNumber: e.target.value })} />
                </div>
              </SettingsGroup>
            )}
            <SettingsGroup title="Invoice numbers">
              <div className={formGrid}>
                <TextField label="Invoice prefix" hint={p.hint('invoiceNumberPrefix', 'Printed before the number, as in INV-0042. New invoices only.')} maxLength={10} className={span.short} value={p.form.invoiceNumberPrefix} error={errors.invoiceNumberPrefix} readOnly={locked} onChange={e => p.edit({ invoiceNumberPrefix: e.target.value })} />
                <TextField label="Credit note prefix" hint={p.hint('creditNotePrefix', 'As in CN-0007. New credit notes only.')} maxLength={10} className={span.short} value={p.form.creditNotePrefix} error={errors.creditNotePrefix} readOnly={locked} onChange={e => p.edit({ creditNotePrefix: e.target.value })} />
                {/* One cell for both states, as tall as the longer hint: the invisible skeleton keeps the height when it flips (SHAPE C10). */}
                <div className={`grid ${span.short}`}>
                  {issued ? (
                    <TextField label="Next invoice" hint="Set by the invoices already issued." className="[grid-area:1/1] [&_input]:bg-transparent" value={p.row!.nextInvoiceDisplayNumber} readOnly />
                  ) : (
                    <NumberField label="First invoice number" hint={p.hint('invoiceStartNumber', START_HINT)} min={1} max={99_999_999} step={1} className="[grid-area:1/1]" value={p.form.invoiceStartNumber} error={errors.invoiceStartNumber} readOnly={locked} onChange={n => p.edit({ invoiceStartNumber: n })} />
                  )}
                  <div aria-hidden="true" className="invisible [grid-area:1/1]">
                    <span className={labelClass}>&nbsp;</span>
                    <div className="h-[var(--control-h)]" />
                    <p className="text-xs mt-1">{START_HINT}</p>
                  </div>
                </div>
              </div>
            </SettingsGroup>
            <SettingsGroup title="Payment terms">
              <div className={formGrid}>
                <NumberField label="Days to pay" hint={p.hint('paymentTermsDays', "Each invoice is due this many days after it's issued. 0 means due on issue.")} min={0} max={365} step={1} className={span.short} value={p.form.paymentTermsDays} error={errors.paymentTermsDays} readOnly={locked} onChange={n => p.edit({ paymentTermsDays: n })} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Tax">
              <CheckboxField label="Registered for GST" hint={p.hint('gstRegistered')} checked={p.form.gstRegistered} disabled={locked} onChange={e => p.edit({ gstRegistered: e.target.checked })} />
            </SettingsGroup>
            <SettingsGroup title="Invoice note">
              <TextAreaField
                label="Note at the foot of every invoice"
                rows={3}
                placeholder="For example: All services are delivered in line with the NDIS Code of Conduct."
                hint={p.hint('invoiceFooterNotes')}
                value={p.form.invoiceFooterNotes}
                readOnly={locked}
                onChange={e => p.edit({ invoiceFooterNotes: e.target.value })}
              />
            </SettingsGroup>
            <SettingsGroup title="Agreement wording">
              <WordingField id="agreement-responsibilities" label="Responsibilities and cancellation" hint={p.hint('agreementResponsibilitiesTerms', wordingBlurb(6))} value={p.form.agreementResponsibilitiesTerms} error={errors.agreementResponsibilitiesTerms} readOnly={locked} onChange={v => p.edit({ agreementResponsibilitiesTerms: v })} />
              <WordingField id="agreement-complaints" label="Concerns and complaints" hint={p.hint('agreementComplaintsTerms', wordingBlurb(7))} value={p.form.agreementComplaintsTerms} error={errors.agreementComplaintsTerms} readOnly={locked} onChange={v => p.edit({ agreementComplaintsTerms: v })} />
            </SettingsGroup>
          </>
        )}
    </SettingsSection>
  )
}
