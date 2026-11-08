import { useState } from 'react'
import { useModuleVisibility, useUpdateModuleVisibility } from '@/api/hooks'
import type { ModuleVisibilityDto } from '@/api/types'
import { CheckboxField } from '@/components/CheckboxField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageState } from '@/components/PageState'
import { httpStatusOf } from '@/lib/httpStatus'
import { retryingAfterError } from '@/lib/queryPhase'
import { SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

export default function WorkspaceVisibilitySection(frame: SectionFrame) {
  const query = useModuleVisibility()
  const update = useUpdateModuleVisibility()
  const [draft, setDraft] = useState<ModuleVisibilityDto | null>(null)
  const [saved, setSaved] = useState<ModuleVisibilityDto | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  const [confirmingOff, setConfirmingOff] = useState(false)
  const dirty = draft?.groupActivitiesEnabled !== saved?.groupActivitiesEnabled || draft?.hiddenTrips !== saved?.hiddenTrips || draft?.hiddenAccommodation !== saved?.hiddenAccommodation || draft?.hiddenVehicles !== saved?.hiddenVehicles
  if (query.data && !query.isError && !query.isFetching && !dirty && query.data !== saved) { setDraft(query.data); setSaved(query.data) }
  const save = () => {
    if (!draft) return
    // Turning group activities off hides them from the board, so ask first; turning on needs no confirm.
    if (saved?.groupActivitiesEnabled === true && draft.groupActivitiesEnabled === false && !confirmingOff) { setConfirmingOff(true); return }
    setConfirmingOff(false)
    setResult(null)
    update.mutate(draft, {
      onSuccess: () => { setSaved(draft); setResult('saved') },
      // A 409 means the server refused the switch-off (an activity is still in flight): the saved value stands, so the switch goes back to it.
      onError: error => {
        setResult({ error: notSavedText(error) })
        if (httpStatusOf(error) === 409 && saved) setDraft({ ...draft, groupActivitiesEnabled: saved.groupActivitiesEnabled })
      },
    })
  }
  const moved = [draft?.hiddenTrips && 'Trips and Bookings', draft?.hiddenAccommodation && 'Accommodation', draft?.hiddenVehicles && 'Vehicles'].filter(Boolean) as string[]
  const movedList = moved.length > 1 ? `${moved.slice(0, -1).join(', ')} and ${moved[moved.length - 1]}` : moved.join('')
  // Unticking trips also unticks the other two in the draft; re-ticking puts them back as saved. Each stays editable on its own.
  const toggleTrips = (show: boolean) => {
    if (!draft || !saved) return
    setDraft(show
      ? { ...draft, hiddenTrips: false, hiddenAccommodation: saved.hiddenAccommodation, hiddenVehicles: saved.hiddenVehicles }
      : { ...draft, hiddenTrips: true, hiddenAccommodation: true, hiddenVehicles: true })
    setResult(null)
  }
  return (
    <SettingsSection {...frame} save={draft ? { dirty, pending: update.isPending, result, onSave: save } : undefined}>
      {!draft ? (
        query.isError || retryingAfterError(query) ? <PageState kind="error" noun="workspace visibility settings" onRetry={() => query.refetch()} /> : <PageState kind="loading" noun="workspace visibility settings" />
      ) : (
        <>
          <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">These choices change the usual menu for everyone in your organisation. Hidden workspaces stay available under Other workspaces in the menu. Existing records, links, tasks and alerts stay available.</p>
          <div className="flex flex-col gap-[var(--field-gap-y)]">
            <CheckboxField label="Show trips and holidays" hint="Trips, Bookings, upcoming trips on the dashboard, Event templates and Activity library. Trip records and links stay available." checked={!draft.hiddenTrips} disabled={update.isPending} onChange={e => toggleTrips(e.target.checked)} />
            <CheckboxField label="Show Accommodation" hint="Trip accommodation and reservations stay available even when this menu link is hidden." checked={!draft.hiddenAccommodation} disabled={update.isPending} onChange={e => { setDraft({ ...draft, hiddenAccommodation: !e.target.checked }); setResult(null) }} />
            <CheckboxField label="Show Vehicles" hint="Schedule assignments and vehicle warnings stay available even when this menu link is hidden." checked={!draft.hiddenVehicles} disabled={update.isPending} onChange={e => { setDraft({ ...draft, hiddenVehicles: !e.target.checked }); setResult(null) }} />
            <CheckboxField label="Group activities" hint="Run group sessions on the roster board: several participants and staff in one activity, with ratios, attendance, payroll and billing." checked={draft.groupActivitiesEnabled === true} disabled={update.isPending} onChange={e => { setDraft({ ...draft, groupActivitiesEnabled: e.target.checked }); setResult(null) }} />
          </div>
          <p role="status" className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">{moved.length ? `After saving, ${movedList} will move to Other workspaces.${draft.hiddenTrips ? ' Event templates and Activity library will leave Settings.' : ''}` : 'After saving, every workspace will appear in the usual menu.'}</p>
        </>
      )}
      <ConfirmDialog
        open={confirmingOff}
        variant="danger"
        title="Turn off group activities?"
        confirmLabel="Turn off"
        loading={update.isPending}
        onCancel={() => { setConfirmingOff(false); if (draft) setDraft({ ...draft, groupActivitiesEnabled: true }) }}
        onConfirm={save}
        message="Existing activities are hidden from the board and can't be changed until you turn this back on. Their shifts stay on the roster."
      />
    </SettingsSection>
  )
}
