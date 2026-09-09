import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField, labelClass } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { SectionEditPanel } from './SectionEditPanel'
import { HIDPA_SUPPORT_CATEGORIES } from '@/api/types/enums'
import {
  DIAGNOSIS_OPTIONS, DIAGNOSIS_OTHER_SENTINEL, HIDPA_CATEGORY_LABELS, HIDPA_CATEGORY_TITLES,
  parseHidpaCategories, formatHidpaCategories,
} from '@/api/types/participants'
import type { HidpaSupportCategory } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

const YES_NO_UNANSWERED_OPTIONS = [
  { key: 'true', label: 'Yes' },
  { key: 'false', label: 'No' },
  { key: '', label: 'Not recorded' },
]
function triToKey(v: boolean | null | undefined): string {
  return v === true ? 'true' : v === false ? 'false' : ''
}
function keyToTri(k: string): boolean | null {
  return k === 'true' ? true : k === 'false' ? false : null
}

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
      {label}
    </span>
  )
}

/** PD-7: Medical card — CORE-02's `medical` group, fully rendered (all 8 fields, no merge needed). */
type MedicalDraft = {
  primaryDiagnosis: string; primaryDiagnosisOther: string
  otherDiagnoses: string[]
  hidpaSupportCategories: HidpaSupportCategory[]
  hidpaNotes: string; medicalSummary: string
  allergiesDetail: string; isAnaphylaxisRisk: string; allergyManagementNotes: string
}

function readMedical(p: ParticipantDetailDto): MedicalDraft {
  const curated: readonly string[] = DIAGNOSIS_OPTIONS
  const isCurated = !!p.primaryDiagnosis && curated.includes(p.primaryDiagnosis)
  return {
    primaryDiagnosis: p.primaryDiagnosis ? (isCurated ? p.primaryDiagnosis : DIAGNOSIS_OTHER_SENTINEL) : '',
    primaryDiagnosisOther: p.primaryDiagnosis && !isCurated ? p.primaryDiagnosis : '',
    otherDiagnoses: p.otherDiagnoses ?? [],
    hidpaSupportCategories: parseHidpaCategories(p.hidpaSupportCategories),
    hidpaNotes: p.hidpaNotes ?? '', medicalSummary: p.medicalSummary ?? '',
    allergiesDetail: p.allergiesDetail ?? '', isAnaphylaxisRisk: triToKey(p.isAnaphylaxisRisk), allergyManagementNotes: p.allergyManagementNotes ?? '',
  }
}

export function ParticipantMedicalSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const [customDiagnosisInput, setCustomDiagnosisInput] = useState('')
  const hidpaCategories = parseHidpaCategories(p.hidpaSupportCategories)
  const saved = readMedical(p)
  const [draft, setDraft] = useState<MedicalDraft>(saved)
  const isDirty = draft.primaryDiagnosis !== saved.primaryDiagnosis || draft.primaryDiagnosisOther !== saved.primaryDiagnosisOther
    || draft.otherDiagnoses.length !== saved.otherDiagnoses.length || draft.otherDiagnoses.some((v) => !saved.otherDiagnoses.includes(v))
    || draft.hidpaSupportCategories.length !== saved.hidpaSupportCategories.length || draft.hidpaSupportCategories.some((v) => !saved.hidpaSupportCategories.includes(v))
    || draft.hidpaNotes !== saved.hidpaNotes || draft.medicalSummary !== saved.medicalSummary
    || draft.allergiesDetail !== saved.allergiesDetail || draft.isAnaphylaxisRisk !== saved.isAnaphylaxisRisk || draft.allergyManagementNotes !== saved.allergyManagementNotes

  const hasAnyData = !!(p.primaryDiagnosis || p.otherDiagnoses?.length || hidpaCategories.length || p.hidpaNotes || p.medicalSummary
    || p.allergiesDetail || p.isAnaphylaxisRisk != null || p.allergyManagementNotes)

  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    const resolvedPrimary = draft.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL ? draft.primaryDiagnosisOther.trim() : draft.primaryDiagnosis
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          medical: {
            primaryDiagnosis: resolvedPrimary || null,
            otherDiagnoses: draft.otherDiagnoses,
            hidpaSupportCategories: formatHidpaCategories(draft.hidpaSupportCategories),
            hidpaNotes: draft.hidpaNotes.trim() || null,
            medicalSummary: draft.medicalSummary.trim() || null,
            allergiesDetail: draft.allergiesDetail.trim() || null,
            isAnaphylaxisRisk: keyToTri(draft.isAnaphylaxisRisk),
            allergyManagementNotes: draft.allergyManagementNotes.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Medical.'))
    }
  }

  const customEntries = draft.otherDiagnoses.filter((d) => !(DIAGNOSIS_OPTIONS as readonly string[]).includes(d))

  return (
    <SectionEditPanel title="Medical" className="md:col-span-2" canEdit={canEdit} isDirty={isDirty} onEditStart={() => { setDraft(saved); setCustomDiagnosisInput('') }} onCancel={() => { setDraft(saved); setCustomDiagnosisInput('') }} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <FormField label="Primary Diagnosis">
            <select value={draft.primaryDiagnosis} onChange={(e) => setDraft((d) => ({ ...d, primaryDiagnosis: e.target.value }))}>
              <option value="">Select a diagnosis...</option>
              {DIAGNOSIS_OPTIONS.map((dOpt) => <option key={dOpt} value={dOpt}>{dOpt}</option>)}
              <option value={DIAGNOSIS_OTHER_SENTINEL}>{DIAGNOSIS_OTHER_SENTINEL}</option>
            </select>
          </FormField>
          {draft.primaryDiagnosis === DIAGNOSIS_OTHER_SENTINEL && (
            <FormField label="Specify Primary Diagnosis" required>
              <input value={draft.primaryDiagnosisOther} onChange={(e) => setDraft((d) => ({ ...d, primaryDiagnosisOther: e.target.value }))} placeholder="e.g. Rett Syndrome" />
            </FormField>
          )}
          <fieldset className="m-0 p-0 border-0">
            <legend className={labelClass}>Other Diagnoses</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {DIAGNOSIS_OPTIONS.map((option) => {
                const checked = draft.otherDiagnoses.includes(option)
                return (
                  <label key={option} className="flex items-center gap-3 py-1 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        otherDiagnoses: e.target.checked ? [...d.otherDiagnoses, option] : d.otherDiagnoses.filter((v) => v !== option),
                      }))}
                      className="w-4 h-4 rounded border-[var(--color-border)]"
                    />
                    <span className="text-sm text-[var(--color-foreground)]">{option}</span>
                  </label>
                )
              })}
            </div>
            {customEntries.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {customEntries.map((entry) => (
                  <span key={entry} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                    {entry}
                    <button type="button" aria-label={`Remove ${entry}`} onClick={() => setDraft((d) => ({ ...d, otherDiagnoses: d.otherDiagnoses.filter((v) => v !== entry) }))} className="min-w-[20px] min-h-[20px] leading-none font-bold hover:text-[var(--color-foreground)]">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <input
                aria-label="Other — specify a diagnosis to add"
                value={customDiagnosisInput}
                onChange={(e) => setCustomDiagnosisInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const value = customDiagnosisInput.trim()
                  if (value && !draft.otherDiagnoses.includes(value)) setDraft((d) => ({ ...d, otherDiagnoses: [...d.otherDiagnoses, value] }))
                  setCustomDiagnosisInput('')
                }}
                placeholder={DIAGNOSIS_OTHER_SENTINEL}
                className="flex-1"
              />
              <button
                type="button"
                className="px-3 min-h-[44px] rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
                onClick={() => {
                  const value = customDiagnosisInput.trim()
                  if (value && !draft.otherDiagnoses.includes(value)) setDraft((d) => ({ ...d, otherDiagnoses: [...d.otherDiagnoses, value] }))
                  setCustomDiagnosisInput('')
                }}
              >
                Add
              </button>
            </div>
          </fieldset>
          <fieldset className="m-0 p-0 border-0">
            <legend className={labelClass}>HIDPA Support Categories</legend>
            <div className="grid grid-cols-1 gap-x-4">
              {HIDPA_SUPPORT_CATEGORIES.map((category) => {
                const checked = draft.hidpaSupportCategories.includes(category)
                return (
                  <label key={category} className="flex items-center gap-3 py-1 min-h-[44px]" title={HIDPA_CATEGORY_TITLES[category]}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        hidpaSupportCategories: e.target.checked ? [...d.hidpaSupportCategories, category] : d.hidpaSupportCategories.filter((v) => v !== category),
                      }))}
                      className="w-4 h-4 rounded border-[var(--color-border)]"
                    />
                    <span className="text-sm text-[var(--color-foreground)]">{HIDPA_CATEGORY_LABELS[category]}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <FormField label="HIDPA Notes">
            <textarea value={draft.hidpaNotes} onChange={(e) => setDraft((d) => ({ ...d, hidpaNotes: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Medical Summary">
            <textarea value={draft.medicalSummary} onChange={(e) => setDraft((d) => ({ ...d, medicalSummary: e.target.value }))} rows={3} />
          </FormField>
          <FormField label="Allergies">
            <textarea value={draft.allergiesDetail} onChange={(e) => setDraft((d) => ({ ...d, allergiesDetail: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Anaphylaxis Risk" className="mb-0">
            <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isAnaphylaxisRisk} onChange={(v) => setDraft((d) => ({ ...d, isAnaphylaxisRisk: v }))} ariaLabel="Anaphylaxis Risk" />
          </FormField>
          <FormField label="Allergy Management Notes">
            <textarea value={draft.allergyManagementNotes} onChange={(e) => setDraft((d) => ({ ...d, allergyManagementNotes: e.target.value }))} rows={2} />
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">Primary Diagnosis</span>
          <span>{p.primaryDiagnosis || '—'}</span>
          <span className="text-[var(--color-muted-foreground)]">Other Diagnoses</span>
          <span className="flex flex-wrap gap-1">
            {p.otherDiagnoses?.length ? p.otherDiagnoses.map((d) => <Tag key={d} label={d} />) : '—'}
          </span>
          <span className="text-[var(--color-muted-foreground)]">HIDPA Support Categories</span>
          <span className="flex flex-wrap gap-1">
            {hidpaCategories.length ? hidpaCategories.map((c) => <Tag key={c} label={HIDPA_CATEGORY_LABELS[c as HidpaSupportCategory] ?? c} />) : '—'}
          </span>
          {p.hidpaNotes && (<><span className="text-[var(--color-muted-foreground)]">HIDPA Notes</span><span className="whitespace-pre-line">{p.hidpaNotes}</span></>)}
          {p.medicalSummary && (<><span className="text-[var(--color-muted-foreground)]">Medical Summary</span><span className="whitespace-pre-line">{p.medicalSummary}</span></>)}
          {p.allergiesDetail && (<><span className="text-[var(--color-muted-foreground)]">Allergies</span><span className="whitespace-pre-line">{p.allergiesDetail}</span></>)}
          {p.isAnaphylaxisRisk != null && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Anaphylaxis Risk</span>
              <span>{p.isAnaphylaxisRisk
                ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-[var(--color-destructive)]">warning</span> Yes</span>
                : 'No'}</span>
            </>
          )}
          {p.allergyManagementNotes && (<><span className="text-[var(--color-muted-foreground)]">Allergy Management Notes</span><span className="whitespace-pre-line">{p.allergyManagementNotes}</span></>)}
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantMedicalSection
