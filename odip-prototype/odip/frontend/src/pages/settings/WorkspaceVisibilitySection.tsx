import { useState } from 'react'
import { useModuleVisibility, useUpdateModuleVisibility } from '@/api/hooks'
import type { ModuleVisibilityDto } from '@/api/types'
import { CheckboxField } from '@/components/CheckboxField'
import { PageState } from '@/components/PageState'
import { SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

export default function WorkspaceVisibilitySection(frame: SectionFrame) {
  const query = useModuleVisibility()
  const update = useUpdateModuleVisibility()
  const [draft, setDraft] = useState<ModuleVisibilityDto | null>(null)
  const [saved, setSaved] = useState<ModuleVisibilityDto | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  const dirty = draft?.hiddenAccommodation !== saved?.hiddenAccommodation || draft?.hiddenVehicles !== saved?.hiddenVehicles
  if (query.data && !query.isError && !query.isFetching && !dirty && query.data !== saved) { setDraft(query.data); setSaved(query.data) }
  const save = () => {
    if (!draft) return
    setResult(null)
    update.mutate(draft, {
      onSuccess: () => { setSaved(draft); setResult('saved') },
      onError: error => setResult({ error: notSavedText(error) }),
    })
  }
  const moved = [draft?.hiddenAccommodation && 'Accommodation', draft?.hiddenVehicles && 'Vehicles'].filter(Boolean)
  return (
    <SettingsSection {...frame} save={draft ? { dirty, pending: update.isPending, result, onSave: save } : undefined}>
      {!draft ? (
        query.isError ? <PageState kind="error" noun="workspace visibility settings" onRetry={() => query.refetch()} /> : <PageState kind="loading" noun="workspace visibility settings" />
      ) : (
        <>
          <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">These choices change the usual menu for everyone in your organisation. Hidden workspaces stay available under Other workspaces in the menu. Existing records, links, tasks and alerts stay available.</p>
          <div className="flex flex-col gap-[var(--field-gap-y)]">
            <CheckboxField label="Show Accommodation" hint="Trip accommodation and reservations stay available even when this menu link is hidden." checked={!draft.hiddenAccommodation} disabled={update.isPending} onChange={e => { setDraft({ ...draft, hiddenAccommodation: !e.target.checked }); setResult(null) }} />
            <CheckboxField label="Show Vehicles" hint="Schedule assignments and vehicle warnings stay available even when this menu link is hidden." checked={!draft.hiddenVehicles} disabled={update.isPending} onChange={e => { setDraft({ ...draft, hiddenVehicles: !e.target.checked }); setResult(null) }} />
          </div>
          <p role="status" className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">{moved.length ? `After saving, ${moved.join(' and ')} will move to Other workspaces. You can show them here again at any time.` : 'After saving, both workspaces will appear in the usual menu.'}</p>
        </>
      )}
    </SettingsSection>
  )
}
