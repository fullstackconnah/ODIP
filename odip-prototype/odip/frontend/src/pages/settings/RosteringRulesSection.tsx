import { useState } from 'react'
import { useSettings, useUpdateSettings } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { retryingAfterError } from '@/lib/queryPhase'
import { formGrid, span } from '@/lib/formGrid'
import { SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

const whole = (text: string, max: number) => /^[0-9]+$/.test(text) && Number(text) >= 1 && Number(text) <= max

/**
 * Organisation › Rostering rules: the weekly-hours warning and how far a finished shift may drift from the roster before it goes to review.
 * Only an Admin or a SuperAdmin changes them (SettingsController PUT); a Coordinator sees them locked.
 */
export default function RosteringRulesSection(frame: SectionFrame) {
  const settingsQuery = useSettings()
  const { data: settings, refetch } = settingsQuery
  const isError = settingsQuery.isError || retryingAfterError(settingsQuery)
  const update = useUpdateSettings()
  const [hours, setHours] = useState<string | null>(null)
  const [savedHours, setSavedHours] = useState<string | null>(null)
  const [minutes, setMinutes] = useState<string | null>(null)
  const [savedMinutes, setSavedMinutes] = useState<string | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (settings && hours === null) {
    const h = String(settings.weeklyHoursWarning ?? 38)
    const m = String(settings.varianceReviewMinutes ?? 15)
    setHours(h); setSavedHours(h); setMinutes(m); setSavedMinutes(m)
  }
  const hoursValid = hours !== null && whole(hours, 100)
  const minutesValid = minutes !== null && whole(minutes, 240)
  const dirty = hours !== savedHours || minutes !== savedMinutes
  const problems = (hoursValid ? 0 : 1) + (minutesValid ? 0 : 1)

  const save = () => {
    if (hours === null || minutes === null || problems > 0) return
    setResult(null)
    update.mutate({ weeklyHoursWarning: Number(hours), varianceReviewMinutes: Number(minutes) }, {
      onSuccess: () => { setSavedHours(hours); setSavedMinutes(minutes); setResult('saved') },
      onError: e => setResult({ error: notSavedText(e) }),
    })
  }

  return (
    <SettingsSection {...frame} save={hours === null ? undefined : { dirty, problems, pending: update.isPending, result, onSave: save }}>
      {hours === null ? (
        isError ? <PageState kind="error" noun="rostering rules section" onRetry={() => refetch()} /> : <PageState kind="loading" noun="rostering rules section" />
      ) : (
        <div className={formGrid}>
          <FormField label="Weekly hours" error={hoursValid ? undefined : 'Enter a whole number from 1 to 100.'} hint="Warn on the roster when a worker is rostered more than this many hours in a week. 38 unless you change it." keepHint className={span.medium}>
            <input type="number" inputMode="numeric" min={1} max={100} step={1} value={hours} onChange={e => setHours(e.target.value)} readOnly={frame.readOnly} />
          </FormField>
          <FormField label="Shift review minutes" error={minutesValid ? undefined : 'Enter a whole number from 1 to 240.'} hint="Send a finished shift to review when its start or finish is more than this many minutes from the roster. 15 unless you change it." keepHint className={span.medium}>
            <input type="number" inputMode="numeric" min={1} max={240} step={1} value={minutes ?? ''} onChange={e => setMinutes(e.target.value)} readOnly={frame.readOnly} />
          </FormField>
        </div>
      )}
    </SettingsSection>
  )
}
