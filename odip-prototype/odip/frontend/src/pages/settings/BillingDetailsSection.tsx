import { Link } from 'react-router-dom'
import { CheckboxField } from '@/components/CheckboxField'
import { NumberField } from '@/components/NumberField'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { formGrid, span } from '@/lib/formGrid'
import { usePermissions } from '@/lib/permissions'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { useProviderRow } from './providerRow'

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

const wholeFrom = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max

/** Organisation › Billing details: the bank account on invoices (hidden from Coordinators here; invoices still print it), invoice numbering and payment terms, GST and PACE, and the invoice note. */
export default function BillingDetailsSection(frame: SectionFrame) {
  const { showBankDetails } = usePermissions()
  const p = useProviderRow(row => ({
    bankAccountName: row?.bankAccountName ?? '',
    bsb: row?.bsb ?? '',
    accountNumber: row?.accountNumber ?? '',
    gstRegistered: row?.gstRegistered ?? false,
    isPaceProvider: row?.isPaceProvider ?? false,
    invoiceFooterNotes: row?.invoiceFooterNotes ?? '',
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
                  <TextField label="Account name" className={span.medium} value={p.form.bankAccountName} readOnly={locked} onChange={e => p.edit({ bankAccountName: e.target.value })} />
                  <TextField label="BSB" hint="6 digits." inputMode="numeric" className={span.short} value={p.form.bsb} readOnly={locked} onChange={e => p.edit({ bsb: e.target.value })} />
                  <TextField label="Account number" inputMode="numeric" className={span.short} value={p.form.accountNumber} readOnly={locked} onChange={e => p.edit({ accountNumber: e.target.value })} />
                </div>
              </SettingsGroup>
            )}
            <SettingsGroup title="Invoice numbers">
              <div className={formGrid}>
                <TextField label="Invoice prefix" hint="Printed before the number, as in INV-0042. New invoices only." maxLength={10} className={span.short} value={p.form.invoiceNumberPrefix} error={errors.invoiceNumberPrefix} readOnly={locked} onChange={e => p.edit({ invoiceNumberPrefix: e.target.value })} />
                <TextField label="Credit note prefix" hint="As in CN-0007. New credit notes only." maxLength={10} className={span.short} value={p.form.creditNotePrefix} error={errors.creditNotePrefix} readOnly={locked} onChange={e => p.edit({ creditNotePrefix: e.target.value })} />
                {issued ? (
                  <TextField label="Next invoice" hint="Set by the invoices already issued." className={span.short} value={p.row!.nextInvoiceDisplayNumber} readOnly />
                ) : (
                  <NumberField label="First invoice number" hint="Carry on from your old system's numbers. It can't change once an invoice is issued." min={1} max={99_999_999} step={1} className={span.short} value={p.form.invoiceStartNumber} error={errors.invoiceStartNumber} readOnly={locked} onChange={n => p.edit({ invoiceStartNumber: n })} />
                )}
              </div>
            </SettingsGroup>
            <SettingsGroup title="Payment terms">
              <div className={formGrid}>
                <NumberField label="Days to pay" hint="Each invoice is due this many days after it's issued. 0 means due on issue." min={0} max={365} step={1} className={span.short} value={p.form.paymentTermsDays} error={errors.paymentTermsDays} readOnly={locked} onChange={n => p.edit({ paymentTermsDays: n })} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Tax and claiming">
              <CheckboxField label="Registered for GST" checked={p.form.gstRegistered} disabled={locked} onChange={e => p.edit({ gstRegistered: e.target.checked })} />
              <CheckboxField label="PACE provider" hint="Claim files use the 16-column PACE bulk payment request layout." checked={p.form.isPaceProvider} disabled={locked} onChange={e => p.edit({ isPaceProvider: e.target.checked })} />
            </SettingsGroup>
            <SettingsGroup title="Invoice note">
              <TextAreaField
                label="Note at the foot of every invoice"
                rows={3}
                placeholder="For example: All services are delivered in line with the NDIS Code of Conduct."
                value={p.form.invoiceFooterNotes}
                readOnly={locked}
                onChange={e => p.edit({ invoiceFooterNotes: e.target.value })}
              />
            </SettingsGroup>
          </>
        )}
    </SettingsSection>
  )
}
