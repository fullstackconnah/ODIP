import { Link } from 'react-router-dom'
import { CheckboxField } from '@/components/CheckboxField'
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

/** Organisation › Billing details: the bank account on invoices (hidden from Coordinators here; invoices still print it), GST and PACE, and the invoice note. */
export default function BillingDetailsSection(frame: SectionFrame) {
  const { showBankDetails } = usePermissions()
  const p = useProviderRow(row => ({
    bankAccountName: row?.bankAccountName ?? '',
    bsb: row?.bsb ?? '',
    accountNumber: row?.accountNumber ?? '',
    gstRegistered: row?.gstRegistered ?? false,
    isPaceProvider: row?.isPaceProvider ?? false,
    invoiceFooterNotes: row?.invoiceFooterNotes ?? '',
  }))
  // Nothing here can be saved until the profile is complete, so the fields are locked as well as the foot left off.
  const locked = frame.readOnly || p.incomplete

  return (
    <SettingsSection {...frame} save={p.form && !p.incomplete ? { dirty: p.dirty, pending: p.pending, result: p.result, onSave: () => p.save() } : undefined}>
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
