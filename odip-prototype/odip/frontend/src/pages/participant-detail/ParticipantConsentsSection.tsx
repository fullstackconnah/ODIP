import { useState } from 'react'
import { FileCheck2 } from 'lucide-react'
import { useParticipantConsents, useUpsertConsent } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { StatusBadge } from '@/components/StatusBadge'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import { CONSENT_TYPES } from '@/api/types/enums'
import { CONSENT_TYPE_LABELS } from '@/api/types/consents'
import type { ParticipantConsentDto } from '@/api/types/consents'

type ConsentFormState = {
  granted: 'true' | 'false' | ''
  signedByName: string
  signedDate: string
}

const EMPTY_FORM: ConsentFormState = { granted: '', signedByName: '', signedDate: '' }

/**
 * Same status/colour lookup StatusBadge already ships (README: "check the built-in STATUS_COLORS
 * map before adding a one-off inline badge") — "active"/"cancelled"/"draft" give exactly the
 * granted (green)/declined (red)/not-recorded (muted) three-way vocabulary this needs, with
 * `label` overriding the displayed text without touching the colour lookup.
 */
function consentStatus(granted: boolean | null): { status: string; label: string } {
  if (granted === true) return { status: 'active', label: 'Granted' }
  if (granted === false) return { status: 'cancelled', label: 'Declined' }
  return { status: 'draft', label: 'Not recorded' }
}

function ConsentSkeleton() {
  return <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse h-14" />
}

/**
 * INTAKE sub-wave B — a compact section (not a full tab) on the participant detail page's Details
 * tab, mirroring RiskEntriesSection's placement judgement: consents are a short, fixed 7-row list
 * per participant, not enough content to justify further tab-bar crowding. Unlike
 * RiskEntriesSection's free-form add/remove list, this section never creates or deletes rows —
 * ParticipantConsentsController.GetForParticipant always returns exactly one entry per
 * ConsentType (synthesizing an unanswered placeholder for any type with no row yet), so "editing"
 * here always means opening one of the seven fixed rows and upserting it.
 */
export default function ParticipantConsentsSection({ participantId }: { participantId: string | undefined }) {
  const { canWriteConsents } = usePermissions()
  const { data: consents = [], isLoading } = useParticipantConsents(participantId)
  const upsertConsent = useUpsertConsent()

  const [editing, setEditing] = useState<ParticipantConsentDto | null>(null)
  const [form, setForm] = useState<ConsentFormState>(EMPTY_FORM)
  const [modalError, setModalError] = useState<string | null>(null)

  // Stable CONSENT_TYPES order regardless of what order the API returned rows in (and tolerant of
  // the list not having resolved yet — nothing to fall back on before the query settles).
  const ordered = CONSENT_TYPES
    .map((type) => consents.find((c) => c.consentType === type))
    .filter((c): c is ParticipantConsentDto => !!c)

  function openEdit(consent: ParticipantConsentDto) {
    setForm({
      granted: consent.granted === true ? 'true' : consent.granted === false ? 'false' : '',
      signedByName: consent.signedByName ?? '',
      signedDate: consent.signedDate ? consent.signedDate.split('T')[0] : '',
    })
    setModalError(null)
    setEditing(consent)
  }

  function closeModal() {
    setEditing(null)
    setModalError(null)
  }

  async function handleSave() {
    if (!editing || !participantId) return
    setModalError(null)
    const granted = form.granted === 'true' ? true : form.granted === 'false' ? false : null
    try {
      await upsertConsent.mutateAsync({
        participantId,
        consentType: editing.consentType,
        data: {
          granted,
          // Signed-by/date only persist once granted — mirrors the wizard's buildPayload rule.
          signedByName: granted === true ? (form.signedByName.trim() || null) : null,
          signedDate: granted === true ? (form.signedDate || null) : null,
        },
      })
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save consent.'))
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
        <FileCheck2 className="w-4 h-4" /> Consents
      </h3>

      {isLoading ? (
        <div className="space-y-2">
          <ConsentSkeleton />
          <ConsentSkeleton />
        </div>
      ) : (
        <div className="space-y-2">
          {ordered.map((consent) => {
            const { status, label } = consentStatus(consent.granted)
            return (
              <div key={consent.consentType} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--color-border)]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{CONSENT_TYPE_LABELS[consent.consentType]}</p>
                  {consent.granted === true && consent.signedByName && (
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 truncate">
                      Signed by {consent.signedByName}{consent.signedDate ? ` · ${formatDateAu(consent.signedDate)}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={status} label={label} />
                  {canWriteConsents && (
                    <button
                      type="button"
                      onClick={() => openEdit(consent)}
                      className="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1.5 min-h-[44px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={closeModal}
        title={editing ? CONSENT_TYPE_LABELS[editing.consentType] : 'Edit consent'}
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={upsertConsent.isPending}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
            >
              {upsertConsent.isPending ? 'Saving...' : 'Save consent'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {modalError}
            </div>
          )}
          <FormField label="Granted">
            {/* Three options, not two: this is a bool? control (Granted is a tri-state), so it
                must be able to go back to "not recorded" after being answered — see
                YES_NO_UNANSWERED_OPTIONS' doc comment on the wizard side for the full reasoning.
                Not Controller-wrapped here (form.granted is plain useState, not react-hook-form),
                but the same "bare ToggleGroup doesn't read aria-labelledby" gap still applies —
                see ToggleGroup.tsx's ariaLabel doc — so it still needs ariaLabel passed directly. */}
            <ToggleGroup
              options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }, { key: '', label: 'Not recorded' }]}
              value={form.granted}
              onChange={(v) => setForm((f) => ({ ...f, granted: v as 'true' | 'false' | '' }))}
              ariaLabel="Granted"
            />
          </FormField>
          {form.granted === 'true' && (
            <>
              <FormField label="Signed by">
                <input value={form.signedByName} onChange={(e) => setForm((f) => ({ ...f, signedByName: e.target.value }))} placeholder="Full name" autoFocus />
              </FormField>
              <FormField label="Date signed">
                <input type="date" value={form.signedDate} onChange={(e) => setForm((f) => ({ ...f, signedDate: e.target.value }))} />
              </FormField>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
