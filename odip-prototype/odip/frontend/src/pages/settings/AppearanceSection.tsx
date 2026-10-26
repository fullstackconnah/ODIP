import { useId, useState } from 'react'
import { Check } from 'lucide-react'
import { CheckboxField } from '@/components/CheckboxField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import type { ThemePreference } from '@/lib/uiPreferences'
import { TONE } from '@/lib/tone'

const THEME_OPTIONS: { key: ThemePreference; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
]

/** My account › Appearance: kept the moment it changes, on this device only, so there is no Save; a line says it was kept. */
export default function AppearanceSection() {
  const { prefs, setPref } = useUiPreferences()
  const [changed, setChanged] = useState(false)
  const labelId = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-[var(--field-gap-y)]">
      <div>
        <p id={labelId} className="text-sm text-[var(--color-foreground)] mb-1">Theme</p>
        <ToggleGroup
          options={THEME_OPTIONS}
          value={prefs.theme}
          onChange={key => { setPref('theme', key as ThemePreference); setChanged(true) }}
          aria-labelledby={labelId}
          ariaDescribedby={hintId}
        />
        <p id={hintId} className="text-xs text-[var(--color-muted-foreground)] mt-1">System follows your device&apos;s light or dark setting.</p>
      </div>
      <CheckboxField
        label="Show lines between table columns"
        hint="Applies to every table in Bunya Support."
        checked={prefs.tableVerticalDividers}
        onChange={e => { setPref('tableVerticalDividers', e.target.checked); setChanged(true) }}
      />
      <p role="status" className={`inline-flex items-center gap-1 text-[13px] ${TONE.success.ink}`}>
        {changed && <><Check className="h-4 w-4" aria-hidden="true" />Saved on this device</>}
      </p>
    </div>
  )
}
