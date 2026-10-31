import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'
import { formGrid, span } from '@/lib/formGrid'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { useProviderRow } from './providerRow'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map(s => ({ key: s, label: s }))

/** The 7 zones the server accepts (StateTimeZoneMap.Zones), in picker order; `states` = the States each is the default for. */
const ZONES = [
  { value: 'Australia/Sydney', label: 'Sydney (NSW, ACT)', states: ['NSW', 'ACT'] },
  { value: 'Australia/Melbourne', label: 'Melbourne (VIC)', states: ['VIC'] },
  { value: 'Australia/Hobart', label: 'Hobart (TAS)', states: ['TAS'] },
  { value: 'Australia/Brisbane', label: 'Brisbane (QLD)', states: ['QLD'] },
  { value: 'Australia/Adelaide', label: 'Adelaide (SA)', states: ['SA'] },
  { value: 'Australia/Perth', label: 'Perth (WA)', states: ['WA'] },
  { value: 'Australia/Darwin', label: 'Darwin (NT)', states: ['NT'] },
]
const ZONE_HINT = 'Changing this moves what counts as today for rosters, the portal and reminders. Times already saved stay the same.'
// The server's fallback: a blank or unknown State is Sydney.
const defaultZoneFor = (state?: string | null) => ZONES.find(z => z.states.includes(state ?? ''))?.value ?? 'Australia/Sydney'

/** Organisation › Organisation profile: the legal identity and address that NDIS claims, bulk payment files and invoices carry, and the time zone rosters, the portal and reminders follow. */
export default function OrganisationProfileSection(frame: SectionFrame) {
  const p = useProviderRow(row => ({
    organisationName: row?.organisationName ?? '',
    abn: row?.abn ?? '',
    registrationNumber: row?.registrationNumber ?? '',
    address: row?.address ?? '',
    state: row?.state ?? '',
    // A row with no saved zone shows its State's default. The seed is also the base, so the form is not dirty and an untouched save echoes the row's null.
    timeZoneId: row?.timeZoneId ?? defaultZoneFor(row?.state),
    managerName: row?.managerName ?? '',
    managerPhone: row?.managerPhone ?? '',
  }))
  const { readOnly } = frame
  // The zone follows the State only while it is still the old State's default; a zone chosen on purpose stays put.
  const pickState = (state: string) => p.edit(p.form?.timeZoneId === defaultZoneFor(p.form?.state) ? { state, timeZoneId: defaultZoneFor(state) } : { state })

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
            <SettingsGroup title="Address and time zone">
              <div className={formGrid}>
                <TextField label="Address" hint={p.hint('address')} className={span.long} value={p.form.address} readOnly={readOnly} onChange={e => p.edit({ address: e.target.value })} />
                <FormField label="State" required hint={p.hint('state')} error={p.dirty && !p.form.state ? "Choose the organisation's state." : undefined} className={span.medium}>
                  <ToggleGroup className="flex-wrap" options={STATES} value={p.form.state} onChange={pickState} disabled={readOnly} />
                </FormField>
                <SelectField label="Time zone" hint={p.hint('timeZoneId', ZONE_HINT)} className={span.medium} options={ZONES} value={p.form.timeZoneId} disabled={readOnly} onChange={e => p.edit({ timeZoneId: e.target.value })} />
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
