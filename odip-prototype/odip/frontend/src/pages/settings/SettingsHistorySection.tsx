import AuditHistoryTab, { AuditHistorySkeleton } from '@/components/AuditHistoryTab'
import { PageState } from '@/components/PageState'
import { useProviderSettings } from '@/api/hooks'

// The ProviderSettings fields the server audits, by the name Settings shows for each (the bank ones say "Bank" because the history mixes sections).
const SETTING_LABELS: Record<string, string> = {
  RegistrationNumber: 'NDIS registration number', ABN: 'ABN', State: 'State', TimeZoneId: 'Time zone',
  GSTRegistered: 'Registered for GST', IsPaceProvider: 'PACE provider',
  BankAccountName: 'Bank account name', BSB: 'BSB', AccountNumber: 'Bank account number',
  InvoiceNumberPrefix: 'Invoice prefix', CreditNotePrefix: 'Credit note prefix', InvoiceStartNumber: 'First invoice number', PaymentTermsDays: 'Days to pay',
  ParticipantReadinessMode: 'Participant readiness check', MedicationCompetencyMode: 'Medication competency check', OnboardingItemModes: 'Onboarding checklist',
}

/** Settings → Settings history (Admin): who changed the organisation's provider settings, when, and from what to what. */
export default function SettingsHistorySection() {
  const settings = useProviderSettings()
  if (settings.isError) return <PageState kind="error" noun="history" onRetry={() => settings.refetch()} />
  if (settings.isPending) return <AuditHistorySkeleton />
  // An organisation with no settings row has no id: the history stays unrequested and says there is none.
  return <AuditHistoryTab entityType="ProviderSettings" entityId={settings.data?.id ?? ''} fieldLabels={SETTING_LABELS} />
}
