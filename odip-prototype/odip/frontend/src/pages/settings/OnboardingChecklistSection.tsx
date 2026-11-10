import { useId, useState } from 'react'
import type { OnboardingItemKey, OnboardingItemMode, OnboardingItemModes } from '@/api/types'
import { PageState } from '@/components/PageState'
import { ToggleGroup } from '@/components/ToggleGroup'
import { retryingAfterError } from '@/lib/queryPhase'
import { TONE } from '@/lib/tone'
import { IncompleteProfileNote } from './BillingDetailsSection'
import { SettingsGroup, SettingsSection, type SectionFrame } from './SettingsSection'
import { ITEM_LABELS } from './onboardingItems'
import { useProviderRow } from './providerRow'

const PRACTICE_STANDARDS = 'NDIS-registered providers must record this (Practice Standards).'

/** Each item the organisation can choose: the checklist's own label, the line under it, and the two modes it allows. */
const ITEMS: { key: OnboardingItemKey; label: string; line: string; standards: boolean; off: boolean }[] = [
  { key: 'complaints', label: ITEM_LABELS.complaints, line: PRACTICE_STANDARDS, standards: true, off: false },
  { key: 'rights', label: ITEM_LABELS.rights, line: PRACTICE_STANDARDS, standards: true, off: false },
  { key: 'myProvider', label: ITEM_LABELS.myProvider, line: 'Only for NDIS participants whose funds are agency or plan managed.', standards: false, off: false },
  { key: 'budget', label: ITEM_LABELS.budget, line: "For participants who aren't NDIS-funded. NDIS participants already have the required Funding item.", standards: false, off: true },
]

const options = (off: boolean) => [{ key: off ? 'Off' : 'Required', label: off ? 'Off' : 'Required' }, { key: 'Optional', label: 'Optional' }]

function ItemRow({ item, value, disabled, onChange }: { item: (typeof ITEMS)[number]; value: OnboardingItemMode; disabled: boolean; onChange: (mode: OnboardingItemMode) => void }) {
  const lineId = useId()
  // Loosening never blocks anyone, so the Practice Standards line is a warning only (no confirm), as Safety checks does for loosening.
  const warn = item.standards && value === 'Optional'
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{item.label}</p>
        <p id={lineId} className={`max-w-prose text-sm ${warn ? TONE.warning.ink : 'text-[var(--color-muted-foreground)]'}`}>{item.line}</p>
      </div>
      <ToggleGroup className="shrink-0" ariaLabel={item.label} ariaDescribedby={lineId} options={options(item.off)} value={value} onChange={key => onChange(key as OnboardingItemMode)} disabled={disabled} />
    </li>
  )
}

/**
 * Organisation › Onboarding checklist: which extra items every participant's checklist shows. Optional items are listed apart, never counted and
 * never stop Make active. A pick is kept only until it matches the server again; the whole four-key map is sent, and only after a pick changed it.
 */
export default function OnboardingChecklistSection(frame: SectionFrame) {
  const p = useProviderRow(row => ({ managerName: row?.managerName ?? '' }))
  const [picks, setPicks] = useState<Partial<OnboardingItemModes>>({})
  const server = p.row?.onboardingItemModes
  const shown = (key: OnboardingItemKey): OnboardingItemMode => picks[key] ?? server?.[key] ?? (key === 'budget' ? 'Off' : 'Required')
  const changed = ITEMS.some(i => shown(i.key) !== (server?.[i.key] ?? (i.key === 'budget' ? 'Off' : 'Required')))
  const locked = frame.readOnly || p.incomplete

  const save = () => p.save(changed ? { onboardingItemModes: Object.fromEntries(ITEMS.map(i => [i.key, shown(i.key)])) as OnboardingItemModes } : {})

  return (
    <SettingsSection
      {...frame}
      save={p.form && !p.incomplete ? { dirty: p.dirty || changed, pending: p.pending, result: p.result, onSave: save } : undefined}
    >
      {(p.query.isError || retryingAfterError(p.query)) && !p.form ? <PageState kind="error" noun="onboarding checklist section" onRetry={() => p.query.refetch()} />
        : !p.form ? <PageState kind="loading" noun="onboarding checklist section" />
        : (
          <>
            {p.incomplete && !frame.readOnly && <IncompleteProfileNote />}
            <SettingsGroup title="Items you can choose">
              <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">Optional items show in their own group on the checklist. They aren't counted, and they never stop Make active.</p>
              <ul className="divide-y divide-[var(--color-border)]">
                {ITEMS.map(item => (
                  <ItemRow key={item.key} item={item} value={shown(item.key)} disabled={locked} onChange={mode => setPicks(prev => ({ ...prev, [item.key]: mode }))} />
                ))}
              </ul>
            </SettingsGroup>
          </>
        )}
    </SettingsSection>
  )
}
