import { useState } from 'react'
import { useSettings, useUpdateSecuritySettings } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { formGrid, span } from '@/lib/formGrid'
import { retryingAfterError } from '@/lib/queryPhase'
import { SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

// "No limit" is the value 'none': a Dropdown value is a string, and null (no limit) is what the server stores.
const NO_LIMIT = 'none'
const LIMITS: Array<[number, string]> = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours']]

const toValue = (minutes: number | null) => (minutes === null ? NO_LIMIT : String(minutes))
const toMinutes = (value: string) => (value === NO_LIMIT ? null : Number(value))
/** No limit is the longest there is. */
const minutesOrForever = (minutes: number | null) => minutes ?? Number.POSITIVE_INFINITY

/**
 * Organisation › Security: how long a sign-in lasts (AppSettings.SessionLengthMinutes). Only an Admin or a SuperAdmin changes it
 * (SettingsController PUT security); a Coordinator sees it locked.
 */
export default function SecuritySection(frame: SectionFrame) {
  const settingsQuery = useSettings()
  const { data: settings, refetch } = settingsQuery
  const isError = settingsQuery.isError || retryingAfterError(settingsQuery)
  const update = useUpdateSecuritySettings()
  const [minutes, setMinutes] = useState<number | null | undefined>(undefined)
  const [saved, setSaved] = useState<number | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (settings && minutes === undefined) {
    const stored = settings.sessionLengthMinutes ?? null
    setMinutes(stored); setSaved(stored)
  }
  const loaded = minutes !== undefined
  const dirty = loaded && minutes !== saved
  // A stored value outside the list (only possible by hand) shows as its own item rather than changing silently.
  const items = [
    ...LIMITS.map(([value, label]) => ({ value: String(value), label })),
    ...(minutes != null && !LIMITS.some(([value]) => value === minutes) ? [{ value: String(minutes), label: `${minutes} minutes` }] : []),
    { value: NO_LIMIT, label: 'No limit' },
  ].sort((a, b) => minutesOrForever(toMinutes(a.value)) - minutesOrForever(toMinutes(b.value)))
  const shorter = dirty && minutes !== null && minutesOrForever(minutes) < minutesOrForever(saved)

  const save = () => {
    if (!loaded) return
    setResult(null)
    update.mutate({ sessionLengthMinutes: minutes }, {
      onSuccess: () => { setSaved(minutes); setResult('saved') },
      onError: e => setResult({ error: notSavedText(e) }),
    })
  }

  return (
    <SettingsSection {...frame} save={loaded ? { dirty, pending: update.isPending, result, onSave: save } : undefined}>
      {!loaded ? (
        isError ? <PageState kind="error" noun="security section" onRetry={() => refetch()} /> : <PageState kind="loading" noun="security section" />
      ) : (
        <div className={formGrid}>
          <FormField
            label="Session length"
            hint="Counted from when someone signs in. When it ends, they sign in again. Microsoft sign-ins end after 12 hours at most."
            className={span.medium}
          >
            <Dropdown variant="form" value={toValue(minutes)} onChange={v => setMinutes(toMinutes(v))} items={items} disabled={frame.readOnly} />
          </FormField>
          {shorter && (
            <p className={`${span.long} max-w-prose text-[13px] text-[var(--color-muted-foreground)]`}>
              People signed in for longer than this will be asked to sign in again within 30 minutes.
            </p>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
