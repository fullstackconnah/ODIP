import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { TextField } from '@/components/TextField'
import { formGrid, span } from '@/lib/formGrid'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { useProviderRow } from './providerRow'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map(s => ({ value: s, label: s }))

/** Organisation › Organisation profile: the legal identity and address that NDIS claims, bulk payment files and invoices carry. */
export default function OrganisationProfileSection(frame: SectionFrame) {
  const p = useProviderRow(row => ({
    organisationName: row?.organisationName ?? '',
    abn: row?.abn ?? '',
    registrationNumber: row?.registrationNumber ?? '',
    address: row?.address ?? '',
    state: row?.state ?? 'VIC',
  }))
  const { readOnly } = frame

  return (
    <SettingsSection {...frame} save={p.form ? { dirty: p.dirty, pending: p.pending, result: p.result, onSave: () => p.save() } : undefined}>
      {p.query.isError && !p.form ? <PageState kind="error" noun="organisation profile" onRetry={() => p.query.refetch()} />
        : !p.form ? <PageState kind="loading" noun="organisation profile" />
        : (
          <>
            <SettingsGroup title="Name and registration">
              <div className={formGrid}>
                <TextField label="Organisation name" className={span.medium} value={p.form.organisationName} readOnly={readOnly} onChange={e => p.edit({ organisationName: e.target.value })} />
                <TextField label="ABN" hint="11 digits." inputMode="numeric" className={span.short} value={p.form.abn} readOnly={readOnly} onChange={e => p.edit({ abn: e.target.value })} />
                <TextField label="NDIS registration number" className={span.short} value={p.form.registrationNumber} readOnly={readOnly} onChange={e => p.edit({ registrationNumber: e.target.value })} />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Address">
              <div className={formGrid}>
                <TextField label="Address" className={span.long} value={p.form.address} readOnly={readOnly} onChange={e => p.edit({ address: e.target.value })} />
                <FormField label="State" className={span.short}>
                  <Dropdown variant="form" value={p.form.state} onChange={v => p.edit({ state: v })} items={STATES} disabled={readOnly} />
                </FormField>
              </div>
            </SettingsGroup>
          </>
        )}
    </SettingsSection>
  )
}
