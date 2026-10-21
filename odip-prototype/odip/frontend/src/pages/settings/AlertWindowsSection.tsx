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
 * Organisation › Alert windows. PR 1 holds the qualification warning window (AppSettings); PR 3 puts the plan-expiry window beside it.
 * Only an Admin or a SuperAdmin changes it (SettingsController PUT); a Coordinator sees it locked.
 */
export default function AlertWindowsSection(frame: SectionFrame) {
  const settingsQuery = useSettings()
  const { data: settings, refetch } = settingsQuery
  const isError = settingsQuery.isError || retryingAfterError(settingsQuery)
  const update = useUpdateSettings()
  const [days, setDays] = useState<number | null>(null)
  const [savedDays, setSavedDays] = useState<number | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (settings && days === null) { setDays(settings.qualificationWarningDays); setSavedDays(settings.qualificationWarningDays) }
  const dirty = days !== savedDays

  const save = () => {
    if (days === null) return
    setResult(null)
    update.mutate({ qualificationWarningDays: days }, {
      onSuccess: () => { setSavedDays(days); setResult('saved') },
      onError: e => setResult({ error: notSavedText(e) }),
    })
  }

  return (
    <SettingsSection {...frame} save={days === null ? undefined : { dirty, pending: update.isPending, result, onSave: save }}>
      {days === null ? (
        isError ? <PageState kind="error" noun="alert windows section" onRetry={() => refetch()} /> : <PageState kind="loading" noun="alert windows section" />
      ) : (
        <div className={formGrid}>
          <FormField label="Staff qualifications" hint="Warn this many days before a qualification expires. Shown on Qualifications and the dashboard." className={span.medium}>
            <Dropdown variant="form" value={String(days)} onChange={v => setDays(Number(v))} items={WINDOW_ITEMS} disabled={frame.readOnly} />
          </FormField>
        </div>
      )}
    </SettingsSection>
  )
}
