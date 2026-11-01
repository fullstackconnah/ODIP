import { useState } from 'react'
import { useSettings, useUpdateSettings } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { formGrid, span } from '@/lib/formGrid'
import { SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

const WINDOW_ITEMS = [7, 14, 30, 60, 90].map(days => ({ value: String(days), label: `${days} days` }))

/**
 * Organisation › Alert windows: how early we warn before a staff qualification or a participant's plan expires (AppSettings).
 * Only an Admin or a SuperAdmin changes them (SettingsController PUT); a Coordinator sees them locked.
 */
export default function AlertWindowsSection(frame: SectionFrame) {
  const settingsQuery = useSettings()
  const { data: settings, refetch } = settingsQuery
  const isError = settingsQuery.isError || retryingAfterError(settingsQuery)
  const update = useUpdateSettings()
  const [days, setDays] = useState<number | null>(null)
  const [savedDays, setSavedDays] = useState<number | null>(null)
  const [planDays, setPlanDays] = useState<number | null>(null)
  const [savedPlanDays, setSavedPlanDays] = useState<number | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (settings && days === null) {
    const plan = settings.planExpiryWarningDays ?? 30
    setDays(settings.qualificationWarningDays); setSavedDays(settings.qualificationWarningDays); setPlanDays(plan); setSavedPlanDays(plan)
  }
  const dirty = days !== savedDays || planDays !== savedPlanDays

  const save = () => {
    if (days === null || planDays === null) return
    setResult(null)
    update.mutate({ qualificationWarningDays: days, planExpiryWarningDays: planDays }, {
      onSuccess: () => { setSavedDays(days); setSavedPlanDays(planDays); setResult('saved') },
      onError: e => setResult({ error: notSavedText(e) }),
    })
  }

  return (
    <SettingsSection {...frame} save={days === null ? undefined : { dirty, pending: update.isPending, result, onSave: save }}>
      {days === null || planDays === null ? (
        isError ? <PageState kind="error" noun="alert windows section" onRetry={() => refetch()} /> : <PageState kind="loading" noun="alert windows section" />
      ) : (
        <div className={formGrid}>
          <FormField label="Staff qualifications" hint="Warn this many days before a qualification expires. Shown on Qualifications and the dashboard." className={span.medium}>
            <Dropdown variant="form" value={String(days)} onChange={v => setDays(Number(v))} items={WINDOW_ITEMS} disabled={frame.readOnly} />
          </FormField>
          <FormField label="Participant plans" hint="Warn this many days before a participant's plan ends. Shown on Participants and the dashboard." className={span.medium}>
            <Dropdown variant="form" value={String(planDays)} onChange={v => setPlanDays(Number(v))} items={WINDOW_ITEMS} disabled={frame.readOnly} />
          </FormField>
        </div>
      )}
    </SettingsSection>
  )
}
