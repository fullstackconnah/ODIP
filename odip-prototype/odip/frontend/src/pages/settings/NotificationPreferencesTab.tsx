import { useState } from 'react'
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/api/hooks'
import {
  NOTIFICATION_EVENT_TYPE_GROUPS,
  NOTIFICATION_EVENT_TYPE_LABELS,
  type NotificationEventType,
  type NotificationPreferenceRowDto,
  type UpdateNotificationPreferenceDto,
} from '@/api/types'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/lib/utils'
import { Button } from '@/components/Button'

type EmailPrefsState = Partial<Record<NotificationEventType, boolean>>

/** Only the Email column is ever editable/sent — SMS always renders disabled (ruling 1, no
 * provider in v1), so its rows never need client-side state at all. */
function buildEmailState(rows: NotificationPreferenceRowDto[]): EmailPrefsState {
  const state: EmailPrefsState = {}
  for (const row of rows) {
    if (row.channel === 'Email') state[row.eventType] = row.enabled
  }
  return state
}

/**
 * Settings → Notifications. Every signed-in user sees this (§6) — the per-event-type x channel
 * grid, grouped by area, with Email toggles editable and SMS rendered disabled. Dirty tracking
 * gates the Save button and the unsaved-changes warning; a 400 ("Unknown event type or channel.")
 * is shown inline rather than thrown.
 */
export default function NotificationPreferencesTab() {
  const { data, isLoading, isError, refetch } = useNotificationPreferences()
  const updatePreferences = useUpdateNotificationPreferences()

  const [emailPrefs, setEmailPrefs] = useState<EmailPrefsState | null>(null)
  const [initialPrefs, setInitialPrefs] = useState<EmailPrefsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Adjusting state during render (React's documented pattern for "derive state from a prop the
  // first time it arrives") rather than a useEffect — avoids the extra render-then-effect
  // round trip and the react-hooks/set-state-in-effect lint rule, same technique
  // ProviderSettingsTab's own `if (settings && !init) { setForm(settings); setInit(true) }` uses
  // just above in this file.
  if (data && !emailPrefs) {
    const state = buildEmailState(data.rows)
    setEmailPrefs(state)
    setInitialPrefs(state)
  }

  const isDirty =
    !!emailPrefs &&
    !!initialPrefs &&
    Object.keys(emailPrefs).some(
      key => emailPrefs[key as NotificationEventType] !== initialPrefs[key as NotificationEventType],
    )
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  function toggle(eventType: NotificationEventType) {
    setEmailPrefs(prev => (prev ? { ...prev, [eventType]: !prev[eventType] } : prev))
  }

  function handleSave() {
    if (!emailPrefs) return
    setError(null)
    const payload: UpdateNotificationPreferenceDto[] = Object.entries(emailPrefs).map(([eventType, enabled]) => ({
      eventType,
      channel: 'Email',
      enabled: enabled ?? true,
    }))
    updatePreferences.mutate(payload, {
      onSuccess: result => {
        const state = buildEmailState(result.rows)
        setEmailPrefs(state)
        setInitialPrefs(state)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
      onError: err => {
        setError(extractErrorMessage(err, 'Failed to save preferences. Please try again.'))
      },
    })
  }

  if (isLoading || !emailPrefs) {
    return (
      <div role="status" className="py-10 text-sm text-[var(--color-muted-foreground)]">
        Loading notification preferences...
      </div>
    )
  }

  if (isError) {
    return (
      <div className="py-10 text-sm text-[var(--color-muted-foreground)]">
        Couldn't load notification preferences.{' '}
        <button type="button" onClick={() => refetch()} className="underline">
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] max-w-2xl">
      {unsavedChangesDialog}
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Notification Preferences</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Choose which events email you. SMS support is on the roadmap — see the SMS column below.
        </p>
      </div>

      <div className="flex flex-col gap-[var(--section-gap)]">
        {NOTIFICATION_EVENT_TYPE_GROUPS.map(group => (
          <div key={group.label}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">
              {group.label}
            </h3>
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-card)]">
                  <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                    <th className="px-[var(--cell-px)] py-[6px] font-medium">Event</th>
                    <th className="px-[var(--cell-px)] py-[6px] font-medium w-20 text-center">Email</th>
                    <th className="px-[var(--cell-px)] py-[6px] font-medium w-32 text-center">SMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {group.eventTypes.map(eventType => (
                    <tr key={eventType}>
                      <td className="px-[var(--cell-px)] py-[7px] text-[var(--color-foreground)]">{NOTIFICATION_EVENT_TYPE_LABELS[eventType]}</td>
                      <td className="px-[var(--cell-px)] py-[7px] text-center">
                        <input
                          type="checkbox"
                          checked={emailPrefs[eventType] ?? true}
                          onChange={() => toggle(eventType)}
                          aria-label={`Email — ${NOTIFICATION_EVENT_TYPE_LABELS[eventType]}`}
                          className="w-4 h-4 accent-[var(--color-primary)]"
                        />
                      </td>
                      <td className="px-[var(--cell-px)] py-[7px] text-center">
                        <input
                          type="checkbox"
                          checked={false}
                          disabled
                          aria-label={`SMS — ${NOTIFICATION_EVENT_TYPE_LABELS[eventType]} — Not available yet`}
                          className="w-4 h-4"
                        />
                        <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">Not available yet</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" className="bg-[var(--color-error-container)] border border-[var(--color-destructive)]/20 rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-error-container)]">
          {error}
        </div>
      )}

      <Button
        onClick={handleSave}
        disabled={!isDirty || updatePreferences.isPending}
        size="md"
      >
        {updatePreferences.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Preferences'}
      </Button>
    </div>
  )
}
