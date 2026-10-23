import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { TextField } from '@/components/TextField'
import { formGrid, span } from '@/lib/formGrid'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { useProviderRow } from './providerRow'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map(s => ({ key: s, label: s }))

/** Organisation › Organisation profile: the legal identity and address that NDIS claims, bulk payment files and invoices carry. */
export default function OrganisationProfileSection(frame: SectionFrame) {
  const p = useProviderRow(row => ({
    organisationName: row?.organisationName ?? '',
    abn: row?.abn ?? '',
    registrationNumber: row?.registrationNumber ?? '',
    address: row?.address ?? '',
    state: row?.state ?? '',
    managerName: row?.managerName ?? '',
    managerPhone: row?.managerPhone ?? '',
  }))
  const { readOnly } = frame

  return (
    <SettingsSection {...frame} save={p.form ? { dirty: p.dirty, pending: p.pending, result: p.result, problems: p.form.state ? 0 : 1, onSave: () => p.save() } : undefined}>
      {(p.query.isError || retryingAfterError(p.query)) && !p.form ? <PageState kind="error" noun="organisation profile" onRetry={() => p.query.refetch()} />
        : !p.form ? <PageState kind="loading" noun="organisation profile" />
        : (
          <>
            <SettingsGroup title="Name and registration">
              <div className={formGrid}>
                <TextField label="Organisation name" hint={p.hint('organisationName')} className={span.medium} value={p.form.organisationName} readOnly={readOnly} onChange={e => p.edit({ organisationName: e.target.value })} />
                <TextField label="ABN" hint={p.hint('abn', '11 digits.')} inputMode="numeric" className={span.short} value={p.form.abn} readOnly={readOnly} onChange={e => p.edit({ abn: e.target.value })} />
                <TextField label="NDIS registration number" hint={p.hint('registrationNumber')} className={span.short} value={p.form.registrationNumber} readOnly={readOnly} onChange={e => p.edit({ registrationNumber: e.target.value })} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Address">
              <div className={formGrid}>
                <TextField label="Address" hint={p.hint('address')} className={span.long} value={p.form.address} readOnly={readOnly} onChange={e => p.edit({ address: e.target.value })} />
                <FormField label="State" required hint={p.hint('state')} error={p.dirty && !p.form.state ? "Choose the organisation's state." : undefined} className={span.medium}>
                  <ToggleGroup className="flex-wrap" options={STATES} value={p.form.state} onChange={v => p.edit({ state: v })} disabled={readOnly} />
                </FormField>
              </div>
            </SettingsGroup>
            {/* The same two fields as under Safety checks (one stored value), here because families and staff ring this person. */}
            <SettingsGroup title="Manager contact">
              <div className={formGrid}>
                <TextField label="Manager name" hint={p.hint('managerName')} placeholder="For example: Priya Sharma" className={span.medium} value={p.form.managerName} readOnly={readOnly} onChange={e => p.edit({ managerName: e.target.value })} />
                <TextField label="Manager phone" hint={p.hint('managerPhone')} placeholder="For example: 0412 345 007" inputMode="tel" className={span.short} value={p.form.managerPhone} readOnly={readOnly} onChange={e => p.edit({ managerPhone: e.target.value })} />
              </div>
            </SettingsGroup>
          </>
        )}
    </SettingsSection>
  )
}
