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
 * Organisation › Alert windows. PR 1 holds the qualification warning window (AppSettings); PR 3 puts the plan-expiry window beside it; the roster's weekly-hours warning sits with them.
 * Only an Admin or a SuperAdmin changes it (SettingsController PUT); a Coordinator sees it locked.
 */
export default function AlertWindowsSection(frame: SectionFrame) {
  const settingsQuery = useSettings()
  const { data: settings, refetch } = settingsQuery
  const isError = settingsQuery.isError || retryingAfterError(settingsQuery)
  const update = useUpdateSettings()
  const [days, setDays] = useState<number | null>(null)
  const [savedDays, setSavedDays] = useState<number | null>(null)
  const [hours, setHours] = useState<string | null>(null)
  const [savedHours, setSavedHours] = useState<string | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (settings && days === null) {
    const stored = String(settings.weeklyHoursWarning ?? 38)
    setDays(settings.qualificationWarningDays); setSavedDays(settings.qualificationWarningDays); setHours(stored); setSavedHours(stored)
  }
  const hoursValid = hours !== null && /^[0-9]+$/.test(hours) && Number(hours) >= 1 && Number(hours) <= 100
  const dirty = days !== savedDays || hours !== savedHours

  const save = () => {
    if (days === null || hours === null || !hoursValid) return
    setResult(null)
    update.mutate({ qualificationWarningDays: days, weeklyHoursWarning: Number(hours) }, {
      onSuccess: () => { setSavedDays(days); setSavedHours(hours); setResult('saved') },
      onError: e => setResult({ error: notSavedText(e) }),
    })
  }

  return (
    <SettingsSection {...frame} save={days === null ? undefined : { dirty: dirty && hoursValid, pending: update.isPending, result, onSave: save }}>
      {days === null ? (
        isError ? <PageState kind="error" noun="alert windows section" onRetry={() => refetch()} /> : <PageState kind="loading" noun="alert windows section" />
      ) : (
        <div className={formGrid}>
          <FormField label="Staff qualifications" hint="Warn this many days before a qualification expires. Shown on Qualifications and the dashboard." className={span.medium}>
            <Dropdown variant="form" value={String(days)} onChange={v => setDays(Number(v))} items={WINDOW_ITEMS} disabled={frame.readOnly} />
          </FormField>
          <FormField label="Weekly hours" error={hoursValid ? undefined : 'Enter a whole number from 1 to 100.'} hint="Warn on the roster when a worker is rostered more than this many hours in a week. 38 unless you change it." keepHint className={span.medium}>
            <input type="number" inputMode="numeric" min={1} max={100} step={1} value={hours ?? ''} onChange={e => setHours(e.target.value)} readOnly={frame.readOnly} />
          </FormField>
        </div>
      )}
    </SettingsSection>
  )
}
