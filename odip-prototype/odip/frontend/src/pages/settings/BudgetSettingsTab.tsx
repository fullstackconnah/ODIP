import { useState } from 'react'
import { useBudgetSettings, useUpdateBudgetSettings } from '@/api/hooks'
import type { BudgetLimitMode, UpdateBudgetSettingsDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { PageState } from '@/components/PageState'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'

const MODE_OPTIONS: { key: BudgetLimitMode; label: string }[] = [
  { key: 'Warn', label: 'Warn only' },
  { key: 'HardLimit', label: 'Hard limit for ad-hoc shifts' },
]

const MODE_WORDS: Record<BudgetLimitMode, string> = {
  Warn: "Shows a warning when a one-off roster shift would take a participant's forecast past their budget for the funding period. The shift is still saved.",
  HardLimit: "Refuses a one-off roster shift that would take a participant's forecast past their budget for the funding period, unless an Admin overrides it with a reason. Emergency or safety bookings are always allowed and reviewed by an Admin afterwards.",
}

const PERCENT_ITEMS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map(percent => ({ value: String(percent), label: `${percent}%` }))

/** A choice made on a control, with the server value it was made against. */
type Pick<T> = { value: T; base: T }

/**
 * Settings, Budgets (Admin and SuperAdmin; budget phase 1): what a budget check does about a one-off roster shift that would take a participant past their budget, and the percentage of the budget
 * used at which a participant counts as approaching it. Phase 1 only STORES the choice for the checks a later release brings, and says so.
 *
 * It copies Provider Settings' stale-form protection. The mode and the percentage are kept out of any form state: only a value the person deliberately picked that differs from the server's is ever
 * sent, so a stale tab can never push an old choice back over a newer one (the settings change only for a field that is sent). A pick is good only while the server still holds the value it was
 * made against: once that moves (our own save landed, or another admin changed it) the pick is dropped for good, not even revived when the server later returns to the value it was made against.
 */
export default function BudgetSettingsTab() {
  const query = useBudgetSettings()
  const update = useUpdateBudgetSettings()
  const settings = query.data
  const [modePick, setModePick] = useState<Pick<BudgetLimitMode> | null>(null)
  const [percentPick, setPercentPick] = useState<Pick<number> | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const serverMode: BudgetLimitMode = settings?.mode ?? 'Warn'
  const serverPercent = settings?.approachingPercent ?? 80
  if (modePick && modePick.base !== serverMode) setModePick(null)
  if (percentPick && percentPick.base !== serverPercent) setPercentPick(null)
  const shownMode = modePick && modePick.base === serverMode ? modePick.value : serverMode
  const shownPercent = percentPick && percentPick.base === serverPercent ? percentPick.value : serverPercent

  const changes: UpdateBudgetSettingsDto = {}
  if (shownMode !== serverMode) changes.mode = shownMode
  if (shownPercent !== serverPercent) changes.approachingPercent = shownPercent
  const dirty = Object.keys(changes).length > 0
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(dirty)

  if (query.isLoading) return <PageState kind="loading" noun="budget settings" />
  if (!settings) {
    // A SuperAdmin who has not chosen an organisation to view as is told so by the server (a 400): that is an instruction, not a failure, and Try again cannot fix it.
    const told = apiErrorStatus(query.error) === 400 ? extractErrorMessage(query.error, '') : ''
    return told ? <Callout tone="info" className="max-w-prose">{told}</Callout> : <PageState kind="error" noun="budget settings" onRetry={() => { void query.refetch() }} />
  }

  const save = () => update.mutate(changes, {
    onSuccess: () => { setModePick(null); setPercentPick(null); setMessage({ tone: 'success', text: 'Budget settings saved.' }) },
    onError: (error: unknown) => setMessage({ tone: 'error', text: extractErrorMessage(error, 'The settings were not saved. Check your connection and try again.') }),
  })

  return (
    <div className="flex max-w-2xl flex-col gap-[var(--section-gap)]">
      {unsavedChangesDialog}
      {settings.isDefault && <Callout tone="info" className="max-w-prose">Nothing has been saved yet: these are the defaults (Warn only, and approaching at 80%).</Callout>}

      <section className="flex flex-col gap-[var(--field-gap-y)]" aria-labelledby="budget-mode-heading">
        <h2 id="budget-mode-heading" className="font-semibold">When a one-off shift would go over a participant&rsquo;s budget</h2>
        <ToggleGroup
          className="flex-wrap"
          ariaLabel="Budget check mode"
          options={MODE_OPTIONS}
          value={shownMode}
          onChange={key => { setModePick({ value: key as BudgetLimitMode, base: serverMode }); setMessage(null) }}
        />
        <ul className="flex flex-col gap-1 text-sm">
          {MODE_OPTIONS.map(option => (
            <li key={option.key} className={option.key === shownMode ? 'text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]'}>
              <span className="font-medium">{option.label}.</span> {MODE_WORDS[option.key]}
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">Budget checks arrive in a later release; this choice is saved for them.</p>
      </section>

      <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="budget-percent-heading">
        <h2 id="budget-percent-heading" className="font-semibold">When a participant is approaching their budget</h2>
        <FormField label="Warn when used reaches" className="max-w-xs">
          <Dropdown
            variant="form"
            value={String(shownPercent)}
            onChange={value => { setPercentPick({ value: Number(value), base: serverPercent }); setMessage(null) }}
            items={PERCENT_ITEMS}
          />
        </FormField>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">The share of a participant&rsquo;s budget for the funding period that has been used. From 50% to 95%, in steps of 5.</p>
      </section>

      {message && <Callout tone={message.tone === 'success' ? 'success' : 'danger'} className="max-w-prose">{message.text}</Callout>}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!dirty || update.isPending}>{update.isPending ? 'Saving…' : 'Save settings'}</Button>
        {dirty && <span className="text-[13px] text-[var(--color-muted-foreground)]">Unsaved changes</span>}
      </div>
    </div>
  )
}
