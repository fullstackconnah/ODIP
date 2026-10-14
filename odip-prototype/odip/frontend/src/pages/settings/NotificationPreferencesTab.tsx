import { useState } from 'react'
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/api/hooks'
import {
  NOTIFICATION_EVENT_TYPE_GROUPS,
  NOTIFICATION_EVENT_TYPE_LABELS,
  type NotificationEventType,
  type NotificationPreferenceRowDto,
  type UpdateNotificationPreferenceDto,
} from '@/api/types'
import { CheckboxField } from '@/components/CheckboxField'
import { PageState } from '@/components/PageState'
import { SettingsGroup, SettingsSection, type SaveResult, type SectionFrame } from './SettingsSection'
import { notSavedText } from './settingsSections'

type EmailPrefsState = Partial<Record<NotificationEventType, boolean>>

/** Only the Email channel is shown or sent. SMS has no provider (ruling 1), so its column is hidden until one exists. */
function buildEmailState(rows: NotificationPreferenceRowDto[]): EmailPrefsState {
  const state: EmailPrefsState = {}
  for (const row of rows) {
    if (row.channel === 'Email') state[row.eventType] = row.enabled
  }
  return state
}

/**
 * My account › Notifications: which events email this person, one tick per event under its area. Their own preferences only.
 * A 400 ("Unknown event type or channel.") is said in the foot.
 */
export default function NotificationPreferencesTab(frame: SectionFrame) {
  const { data, isError, refetch } = useNotificationPreferences()
  const update = useUpdateNotificationPreferences()
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefsState | null>(null)
  const [initialPrefs, setInitialPrefs] = useState<EmailPrefsState | null>(null)
  const [result, setResult] = useState<SaveResult>(null)

  // Seed once from the first answer, during render (React's pattern for deriving state from a prop the first time it arrives).
  if (data && !emailPrefs) {
    const state = buildEmailState(data.rows)
    setEmailPrefs(state)
    setInitialPrefs(state)
  }

  const isDirty =
    !!emailPrefs && !!initialPrefs && Object.keys(emailPrefs).some(key => emailPrefs[key as NotificationEventType] !== initialPrefs[key as NotificationEventType])

  const toggle = (eventType: NotificationEventType) => setEmailPrefs(prev => (prev ? { ...prev, [eventType]: !prev[eventType] } : prev))

  function save() {
    if (!emailPrefs) return
    setResult(null)
    const payload: UpdateNotificationPreferenceDto[] = Object.entries(emailPrefs).map(([eventType, enabled]) => ({ eventType, channel: 'Email', enabled: enabled ?? true }))
    update.mutate(payload, {
      onSuccess: saved => {
        const state = buildEmailState(saved.rows)
        setEmailPrefs(state)
        setInitialPrefs(state)
        setResult('saved')
      },
      onError: e => setResult({ error: notSavedText(e) }),
    })
  }

  return (
    <SettingsSection {...frame} save={emailPrefs ? { dirty: isDirty, pending: update.isPending, result, onSave: save } : undefined}>
      {!emailPrefs ? (
        isError ? <PageState kind="error" noun="notifications section" onRetry={() => { void refetch() }} /> : <PageState kind="loading" noun="notifications section" />
      ) : (
        // One column of ticks per area; the areas flow in two columns from xl.
        <div className="gap-x-[var(--section-gap)] xl:columns-2">
          {NOTIFICATION_EVENT_TYPE_GROUPS.map(group => (
            <div key={group.label} className="mb-[var(--section-gap)] break-inside-avoid">
              <SettingsGroup title={group.label}>
                {group.eventTypes.map(eventType => (
                  <CheckboxField key={eventType} label={NOTIFICATION_EVENT_TYPE_LABELS[eventType]} checked={emailPrefs[eventType] ?? true} onChange={() => toggle(eventType)} />
                ))}
              </SettingsGroup>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  )
}
