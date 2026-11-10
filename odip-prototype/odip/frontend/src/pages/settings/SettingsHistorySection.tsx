import AuditHistoryTab, { AuditHistorySkeleton } from '@/components/AuditHistoryTab'
import { PageState } from '@/components/PageState'
import { useProviderSettings } from '@/api/hooks'
import { MODE_OPTIONS } from './safetyModes'
import { ZONES } from './timeZones'

// The ProviderSettings fields the server audits, by the name Settings shows for each (the bank ones say "Bank" because the history mixes sections).
const SETTING_LABELS: Record<string, string> = {
  RegistrationNumber: 'NDIS registration number', ABN: 'ABN', State: 'State', TimeZoneId: 'Time zone',
  GSTRegistered: 'Registered for GST', IsPaceProvider: 'PACE provider',
  BankAccountName: 'Bank account name', BSB: 'BSB', AccountNumber: 'Bank account number',
  InvoiceNumberPrefix: 'Invoice prefix', CreditNotePrefix: 'Credit note prefix', InvoiceStartNumber: 'First invoice number', PaymentTermsDays: 'Days to pay',
  ParticipantReadinessMode: 'Participant readiness check', MedicationCompetencyMode: 'Medication competency check', OnboardingItemModes: 'Onboarding checklist',
}

// The words Settings shows for a stored value, taken from the same option lists its forms use. A field not listed here (State, the free-text and number fields) shows as stored; True and False read Yes and No in the history itself.
const MODE_WORDS = Object.fromEntries(MODE_OPTIONS.map(o => [o.key, o.label]))
const VALUE_LABELS = {
  ParticipantReadinessMode: MODE_WORDS, MedicationCompetencyMode: MODE_WORDS,
  TimeZoneId: Object.fromEntries(ZONES.map(z => [z.value, z.label])),
}
// The server writes the Onboarding checklist as one line ("complaints=Required, rights=Optional, ..."); it reads one item per line here. shortcut: a semicolon or comma inside an item would split it, fine while the writer has neither.
const VALUE_FORMAT = { OnboardingItemModes: (value: string) => value.split(/[;,]/).map(item => item.trim()).filter(Boolean) }

/** Settings → Settings history (Admin): who changed the organisation's provider settings, when, and from what to what. */
export default function SettingsHistorySection() {
  const settings = useProviderSettings()
  if (settings.isError) return <PageState kind="error" noun="history" onRetry={() => settings.refetch()} />
  if (settings.isPending) return <AuditHistorySkeleton />
  // An organisation with no settings row has no id: the history stays unrequested and says there is none.
  return <AuditHistoryTab entityType="ProviderSettings" entityId={settings.data?.id ?? ''} fieldLabels={SETTING_LABELS} valueLabels={VALUE_LABELS} valueFormat={VALUE_FORMAT} />
}
