import { useState } from 'react'
import { Check } from 'lucide-react'
import { CheckboxField } from '@/components/CheckboxField'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import { TONE } from '@/lib/tone'

/** My account › Appearance: kept the moment it changes, on this device only, so there is no Save; a line says it was kept. */
export default function AppearanceSection() {
  const { prefs, setPref } = useUiPreferences()
  const [changed, setChanged] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <CheckboxField
        label="Show lines between table columns"
        hint="Applies to every table in ODIP."
        checked={prefs.tableVerticalDividers}
        onChange={e => { setPref('tableVerticalDividers', e.target.checked); setChanged(true) }}
      />
      <p role="status" className={`inline-flex items-center gap-1 text-[13px] ${TONE.success.ink}`}>
        {changed && <><Check className="h-4 w-4" aria-hidden="true" />Saved on this device</>}
      </p>
    </div>
  )
}
