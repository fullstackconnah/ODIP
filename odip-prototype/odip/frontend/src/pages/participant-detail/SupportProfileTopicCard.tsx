import { useState } from 'react'
import { useUpdateSupportProfile } from '@/api/hooks'
import type { SupportProfileDto, UpdateSupportProfileDto } from '@/api/types/participants'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { FactList } from '@/components/FactList'
import { FormField } from '@/components/FormField'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'
import { SectionEditPanel } from './SectionEditPanel'

/** What the page knows about the one support-profile GET: a 404 (no profile yet) arrives as `profile: undefined` with `loading` and `error` both false. */
export type SupportProfileState = {
  profile: SupportProfileDto | undefined
  loading: boolean
  error: boolean
  retry: () => void
}

export type TopicField = keyof UpdateSupportProfileDto

const FIELD_LABEL: Record<TopicField, string> = {
  communicationNotes: 'Communication notes',
  behaviourSupportNotes: 'Behaviour support notes',
  manualHandlingNotes: 'Manual handling notes',
  medicationHealthSummary: 'Medication and health summary',
  emergencyConsiderations: 'Emergency considerations',
  travelSpecificNotes: 'Travel-specific notes',
  reviewDate: 'Review date',
}

/**
 * One support-profile text field as its own small card, next to the topic it belongs to. Saving sends only this field:
 * `useUpdateSupportProfile` builds the whole-record PUT from the cache when the save runs, so the other topics survive.
 * While the profile loads the card shows a placeholder with Edit disabled; a failed load shows the house error with Retry.
 */
export function SupportProfileTopicCard({ title, field, participantId, canEdit, state }: {
  title: string
  field: TopicField
  participantId: string
  canEdit: boolean
  state: SupportProfileState
}) {
  const update = useUpdateSupportProfile()
  const label = FIELD_LABEL[field]
  const isDate = field === 'reviewDate'
  const raw = state.profile?.[field] ?? ''
  const saved = isDate ? raw.split('T')[0] : raw
  const [draft, setDraft] = useState(saved)

  if (state.loading) {
    return (
      <Card title={title} action={canEdit ? <Button variant="ghost" size="sm" disabled>Edit</Button> : undefined}>
        <p role="status" className="text-sm text-[var(--color-muted-foreground)]">Loading {title.toLowerCase()}…</p>
      </Card>
    )
  }
  if (state.error) {
    return (
      <Card title={title} action={canEdit ? <Button variant="ghost" size="sm" disabled>Edit</Button> : undefined}>
        <Callout tone="error">
          Couldn't load {title.toLowerCase()}.{' '}
          <Button variant="ghost" size="sm" onClick={state.retry}>Retry</Button>
        </Callout>
      </Card>
    )
  }

  async function handleSave() {
    try {
      await update.mutateAsync({ id: participantId, fields: { [field]: draft.trim() || undefined } })
    } catch (err) {
      throw new Error(extractErrorMessage(err, `Failed to save ${title.toLowerCase()}.`))
    }
  }

  return (
    <SectionEditPanel title={title} canEdit={canEdit} isDirty={draft !== saved} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <FormField label={label}>
          {isDate
            ? <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
            : <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />}
        </FormField>
      ) : saved ? (
        <p className="whitespace-pre-line text-sm">{isDate ? formatDateAu(saved) : saved}</p>
      ) : (
        <FactList hideEmpty items={[{ label, value: '' }]} onAdd={canEdit ? () => startEdit('first-empty') : undefined} />
      )}
    </SectionEditPanel>
  )
}
