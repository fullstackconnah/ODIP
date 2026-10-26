import { useState, type ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { usePatchParticipant } from '@/api/hooks'
import { rethrowSectionError } from '@/lib/sectionConflict'
import { FormField, labelClass } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { FactList } from '@/components/FactList'
import { ToggleGroup } from '@/components/ToggleGroup'
import { SectionEditPanel } from './SectionEditPanel'
import {
  MOBILITY_SUPPORT_OPTIONS, OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS,
  AMBULANT_STATUS_LABELS, PERSONAL_CARE_LEVEL_LABELS, RISK_RATING_LEVEL_LABELS,
} from '@/api/types/participants'
import { OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS, AMBULANT_STATUSES, PERSONAL_CARE_LEVELS, RISK_RATING_LEVELS } from '@/api/types/enums'
import type { AmbulantStatus, PersonalCareLevel, RiskRatingLevel, OvernightSupportType, SupportRatio } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'
import type { PatchParticipantDto } from '@/api/types/participant-patch'
import type { PatchSupportNeedsMobilityDto } from '@/api/types/participant-patch'

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
      {label}
    </span>
  )
}

/** A FactList value made of Tag chips — min-h-6 centres the chips in the list's 24px row pitch. */
function TagList({ labels }: { labels: string[] }) {
  return (
    <span className="flex min-h-6 flex-wrap items-center gap-1">
      {labels.map((label) => <Tag key={label} label={label} />)}
    </span>
  )
}

// Same tri-state idiom as the wizard's YES_NO_UNANSWERED_OPTIONS (the retired single-step wizard) —
// duplicated locally per this codebase's own per-file-helper convention (see extractErrorMessage
// above and every other participant-detail/*.tsx section).
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

const NOT_RECORDED = ''

/**
 * PD-6: the `supportNeedsMobility` CORE-02 field group is ONE group shared across all 6 cards
 * below (see SPEC-00's CORE-02 field-group partition table) — atomicity is enforced at the GROUP
 * level, not the card level, so a present group's PATCH payload must carry every one of the
 * group's member fields. This snapshot supplies the OTHER cards' current, unedited values so that
 * saving any single card never silently clears a sibling card's data (the group has no way to
 * express "leave this field untouched" short of resending its current value).
 */
function snmSnapshot(p: ParticipantDetailDto): PatchSupportNeedsMobilityDto {
  return {
    isHighSupport: p.isHighSupport,
    isIntensiveSupport: p.isIntensiveSupport,
    supportRatio: p.supportRatio,
    mobilityAidWheelchair: p.mobilityAidWheelchair,
    mobilityAidWalker: p.mobilityAidWalker,
    mobilitySupportOptions: p.mobilitySupportOptions ?? [],
    overnightSupport: p.overnightSupport,
    overnightRatio: p.overnightRatio,
    requiresHiLoBed: p.requiresHiLoBed,
    requiresHoist: p.requiresHoist,
    requiresShowerChair: p.requiresShowerChair,
    requiresCommode: p.requiresCommode,
    requiresStandingMachine: p.requiresStandingMachine,
    mobilityNotes: p.mobilityNotes,
    equipmentRequirements: p.equipmentRequirements,
    transportRequirements: p.transportRequirements,
    ambulantStatus: p.ambulantStatus,
    fallsRiskRating: p.fallsRiskRating,
    unevenGroundFlag: p.unevenGroundFlag,
    levelOfPersonalCare: p.levelOfPersonalCare,
    orthotics: p.orthotics,
    continenceSupportDetail: p.continenceSupportDetail,
    bowelCareDetail: p.bowelCareDetail,
    menstruationSupport: p.menstruationSupport,
    skinIntegrity: p.skinIntegrity,
  }
}

/**
 * Saves one card's slice of the shared supportNeedsMobility group. The group is rebuilt from the LATEST cached participant when the
 * save runs (not from the props the card rendered with), and the save stays pending until the refetch lands (usePatchParticipant awaits it when expectedRevisions is
 * sent), so a second card saved straight after the first would otherwise put the first card's old value back.
 * shortcut: two cards saved within one refetch of each other can still race; upgrade to a page-level save queue if users hit it.
 */
function useSaveSnm(participantId: string, p: ParticipantDetailDto) {
  const qc = useQueryClient()
  const patch = usePatchParticipant()
  return async (draft: Partial<PatchSupportNeedsMobilityDto>, expected: PatchParticipantDto['expectedRevisions']) => {
    const latest = qc.getQueryData<ParticipantDetailDto>(['participant', participantId]) ?? p
    // With expectedRevisions the hook itself waits for the refetch, so the next card saved straight after reads the fresh cache.
    await patch.mutateAsync({ id: participantId, data: { supportNeedsMobility: { ...snmSnapshot(latest), ...draft }, expectedRevisions: expected } })
  }
}

type CommonSectionProps = {
  p: ParticipantDetailDto
  participantId: string
  canEdit: boolean
}

// ─── Support Needs ──────────────────────────────────────────────────────────────────────────

type SupportNeedsDraft = { isHighSupport: boolean; isIntensiveSupport: boolean; supportRatio: SupportRatio }

function readSupportNeeds(p: ParticipantDetailDto): SupportNeedsDraft {
  return { isHighSupport: p.isHighSupport, isIntensiveSupport: p.isIntensiveSupport, supportRatio: p.supportRatio }
}

export function SupportNeedsSection({ p, participantId, canEdit, restrictiveLink }: CommonSectionProps & { restrictiveLink: ReactNode }) {
  const saveSnm = useSaveSnm(participantId, p)
  const saved = readSupportNeeds(p)
  const [draft, setDraft] = useState<SupportNeedsDraft>(saved)
  const isDirty = draft.isHighSupport !== saved.isHighSupport || draft.isIntensiveSupport !== saved.isIntensiveSupport || draft.supportRatio !== saved.supportRatio

  async function handleSave(expected: PatchParticipantDto['expectedRevisions']) {
    try {
      await saveSnm(draft, expected)
    } catch (err) {
      rethrowSectionError(err, 'Failed to save Support Needs.')
    }
  }

  return (
    <SectionEditPanel title="Support Needs" groups={['supportNeedsMobility']} revisions={p.groupRevisions} canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <div className="space-y-4">
          <FormField label="High Support" layout="checkbox">
            <input type="checkbox" checked={draft.isHighSupport} onChange={(e) => setDraft((d) => ({ ...d, isHighSupport: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Intensive Support (NDIS billing)" layout="checkbox">
            <input type="checkbox" checked={draft.isIntensiveSupport} onChange={(e) => setDraft((d) => ({ ...d, isIntensiveSupport: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
          <FormField label="Support Ratio">
            <Dropdown
              variant="form"
              value={draft.supportRatio}
              onChange={(v) => setDraft((d) => ({ ...d, supportRatio: v as SupportRatio }))}
              items={SUPPORT_RATIOS.map((r) => ({ value: r, label: OVERNIGHT_RATIO_LABELS[r] }))}
            />
          </FormField>
        </div>
      ) : (
        <FactList hideEmpty onAdd={canEdit ? () => startEdit('first-empty') : undefined}
          items={[
            { label: 'High Support', value: p.isHighSupport ? 'Yes' : 'No' },
            { label: 'Intensive Support', value: p.isIntensiveSupport ? 'Yes' : 'No' },
            { label: 'Support Ratio', value: OVERNIGHT_RATIO_LABELS[p.supportRatio] },
            // Derived (DTOs.cs: "intentionally NOT here — it is derived") — never editable here;
            // the Restrictive Practices register is its source of truth.
            {
              label: 'Restrictive Practice',
              value: (
                <span className="flex flex-wrap items-center gap-x-2">
                  {p.hasRestrictivePracticeFlag
                    ? <span className="inline-flex items-center gap-1"><ShieldAlert className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" /> Yes</span>
                    : 'No'}
                  {restrictiveLink}
                </span>
              ),
            },
          ]}
        />
      )}
    </SectionEditPanel>
  )
}

// ─── Mobility Aids & Support ────────────────────────────────────────────────────────────────

type MobilityAidsDraft = { mobilityAidWheelchair: boolean; mobilityAidWalker: boolean; mobilitySupportOptions: string[] }

function readMobilityAids(p: ParticipantDetailDto): MobilityAidsDraft {
  return { mobilityAidWheelchair: p.mobilityAidWheelchair, mobilityAidWalker: p.mobilityAidWalker, mobilitySupportOptions: p.mobilitySupportOptions ?? [] }
}

export function MobilityAidsSection({ p, participantId, canEdit }: CommonSectionProps) {
  const saveSnm = useSaveSnm(participantId, p)
  const saved = readMobilityAids(p)
  const [draft, setDraft] = useState<MobilityAidsDraft>(saved)
  const isDirty = draft.mobilityAidWheelchair !== saved.mobilityAidWheelchair
    || draft.mobilityAidWalker !== saved.mobilityAidWalker
    || draft.mobilitySupportOptions.length !== saved.mobilitySupportOptions.length
    || draft.mobilitySupportOptions.some((v) => !saved.mobilitySupportOptions.includes(v))

  async function handleSave(expected: PatchParticipantDto['expectedRevisions']) {
    try {
      await saveSnm(draft, expected)
    } catch (err) {
      rethrowSectionError(err, 'Failed to save Mobility Aids & Support.')
    }
  }

  const mobilityAidBadges = [draft.mobilityAidWheelchair && 'Wheelchair', draft.mobilityAidWalker && 'Walker'].filter((v): v is string => !!v)
  const readMobilityAidBadges = [p.mobilityAidWheelchair && 'Wheelchair', p.mobilityAidWalker && 'Walker'].filter((v): v is string => !!v)

  return (
    <SectionEditPanel title="Mobility Aids & Support" groups={['supportNeedsMobility']} revisions={p.groupRevisions} canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <div className="space-y-4">
          <fieldset className="m-0 p-0 border-0">
            <legend className={labelClass}>Mobility Aids</legend>
            <FormField label="Wheelchair" layout="checkbox">
              <input type="checkbox" checked={draft.mobilityAidWheelchair} onChange={(e) => setDraft((d) => ({ ...d, mobilityAidWheelchair: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
            <FormField label="Walker" layout="checkbox">
              <input type="checkbox" checked={draft.mobilityAidWalker} onChange={(e) => setDraft((d) => ({ ...d, mobilityAidWalker: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
            {mobilityAidBadges.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{mobilityAidBadges.map((b) => <Tag key={b} label={b} />)}</div>}
          </fieldset>
          <fieldset className="m-0 p-0 border-0">
            <legend className={labelClass}>Mobility Support</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {MOBILITY_SUPPORT_OPTIONS.map((option) => {
                const checked = draft.mobilitySupportOptions.includes(option)
                return (
                  <label key={option} className="flex items-center gap-3 py-1 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        mobilitySupportOptions: e.target.checked
                          ? [...d.mobilitySupportOptions, option]
                          : d.mobilitySupportOptions.filter((v) => v !== option),
                      }))}
                      className="w-4 h-4 rounded border-[var(--color-border)]"
                    />
                    <span className="text-sm text-[var(--color-foreground)]">{option}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        </div>
      ) : (
        <FactList hideEmpty onAdd={canEdit ? () => startEdit('first-empty') : undefined}
          items={[
            { label: 'Mobility Aids', value: readMobilityAidBadges.length ? <TagList labels={readMobilityAidBadges} /> : undefined },
            { label: 'Mobility Support', value: p.mobilitySupportOptions?.length ? <TagList labels={p.mobilitySupportOptions} /> : undefined },
          ]}
        />
      )}
    </SectionEditPanel>
  )
}

// ─── Overnight Support ──────────────────────────────────────────────────────────────────────

type OvernightDraft = { overnightSupport: OvernightSupportType; overnightRatio: SupportRatio }

function readOvernight(p: ParticipantDetailDto): OvernightDraft {
  return { overnightSupport: p.overnightSupport, overnightRatio: p.overnightRatio }
}

/**
 * Read-only text for the Overnight Support fact: "None", or "<type> (<ratio>)" once overnight
 * support applies. `overnightSupport` is typed non-optional, but a payload that omits it (an older
 * API build, the mock API) used to print "undefined (undefined)". Now a missing type yields no
 * value (FactList collapses the card to "Not recorded") and a missing ratio drops the parenthetical.
 */
function overnightSupportText(p: ParticipantDetailDto): string | undefined {
  const type = p.overnightSupport as OvernightSupportType | null | undefined
  if (!type) return undefined
  if (type === 'None') return 'None'
  const typeLabel = OVERNIGHT_SUPPORT_LABELS[type]
  const ratio = p.overnightRatio as SupportRatio | null | undefined
  const ratioLabel = ratio ? OVERNIGHT_RATIO_LABELS[ratio] : undefined
  return ratioLabel ? `${typeLabel} (${ratioLabel})` : typeLabel
}

export function OvernightSupportSection({ p, participantId, canEdit }: CommonSectionProps) {
  const saveSnm = useSaveSnm(participantId, p)
  const saved = readOvernight(p)
  const [draft, setDraft] = useState<OvernightDraft>(saved)
  const isDirty = draft.overnightSupport !== saved.overnightSupport || draft.overnightRatio !== saved.overnightRatio

  async function handleSave(expected: PatchParticipantDto['expectedRevisions']) {
    try {
      await saveSnm(draft, expected)
    } catch (err) {
      rethrowSectionError(err, 'Failed to save Overnight Support.')
    }
  }

  return (
    <SectionEditPanel title="Overnight Support" groups={['supportNeedsMobility']} revisions={p.groupRevisions} canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <div className="space-y-4">
          <FormField label="Overnight Support">
            <Dropdown
              variant="form"
              value={draft.overnightSupport}
              onChange={(v) => setDraft((d) => ({ ...d, overnightSupport: v as OvernightSupportType }))}
              items={OVERNIGHT_SUPPORT_TYPES.map((t) => ({ value: t, label: OVERNIGHT_SUPPORT_LABELS[t] }))}
            />
          </FormField>
          {draft.overnightSupport !== 'None' && (
            <FormField label="Overnight Ratio">
              <Dropdown
                variant="form"
                value={draft.overnightRatio}
                onChange={(v) => setDraft((d) => ({ ...d, overnightRatio: v as SupportRatio }))}
                items={SUPPORT_RATIOS.map((r) => ({ value: r, label: OVERNIGHT_RATIO_LABELS[r] }))}
              />
            </FormField>
          )}
        </div>
      ) : (
        <FactList hideEmpty onAdd={canEdit ? () => startEdit('first-empty') : undefined} items={[{ label: 'Overnight Support', value: overnightSupportText(p) }]} />
      )}
    </SectionEditPanel>
  )
}

// ─── Equipment ──────────────────────────────────────────────────────────────────────────────

type EquipmentDraft = {
  requiresHiLoBed: boolean; requiresHoist: boolean; requiresShowerChair: boolean
  requiresCommode: boolean; requiresStandingMachine: boolean
}

function readEquipment(p: ParticipantDetailDto): EquipmentDraft {
  return {
    requiresHiLoBed: p.requiresHiLoBed, requiresHoist: p.requiresHoist, requiresShowerChair: p.requiresShowerChair,
    requiresCommode: p.requiresCommode, requiresStandingMachine: p.requiresStandingMachine,
  }
}

const EQUIPMENT_FIELDS: { key: keyof EquipmentDraft; label: string }[] = [
  { key: 'requiresHiLoBed', label: 'Hi-Lo Bed' },
  { key: 'requiresHoist', label: 'Hoist' },
  { key: 'requiresShowerChair', label: 'Shower Chair' },
  { key: 'requiresCommode', label: 'Commode' },
  { key: 'requiresStandingMachine', label: 'Standing Machine' },
]

export function EquipmentSection({ p, participantId, canEdit }: CommonSectionProps) {
  const saveSnm = useSaveSnm(participantId, p)
  const saved = readEquipment(p)
  const [draft, setDraft] = useState<EquipmentDraft>(saved)
  const isDirty = EQUIPMENT_FIELDS.some((f) => draft[f.key] !== saved[f.key])

  async function handleSave(expected: PatchParticipantDto['expectedRevisions']) {
    try {
      await saveSnm(draft, expected)
    } catch (err) {
      rethrowSectionError(err, 'Failed to save Equipment.')
    }
  }

  const equipmentBadges = EQUIPMENT_FIELDS.filter((f) => p[f.key]).map((f) => f.label)

  return (
    <SectionEditPanel title="Equipment" groups={['supportNeedsMobility']} revisions={p.groupRevisions} canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <fieldset className="m-0 p-0 border-0 space-y-2">
          <legend className="sr-only">Equipment</legend>
          {EQUIPMENT_FIELDS.map((f) => (
            <FormField key={f.key} label={f.label} layout="checkbox">
              <input type="checkbox" checked={draft[f.key]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>
          ))}
        </fieldset>
      ) : (
        <FactList hideEmpty onAdd={canEdit ? () => startEdit('first-empty') : undefined} items={[{ label: 'Equipment', value: equipmentBadges.length ? <TagList labels={equipmentBadges} /> : undefined }]} />
      )}
    </SectionEditPanel>
  )
}

// ─── Support Notes ──────────────────────────────────────────────────────────────────────────

export type SupportNotesField = 'mobilityNotes' | 'equipmentRequirements' | 'transportRequirements'

const SUPPORT_NOTES_CARD: Record<SupportNotesField, { title: string; placeholder: string }> = {
  mobilityNotes: { title: 'Mobility notes', placeholder: 'Any mobility considerations...' },
  equipmentRequirements: { title: 'Equipment notes', placeholder: 'Required equipment...' },
  transportRequirements: { title: 'Transport notes', placeholder: 'Transport needs...' },
}

/** One of the three free-text notes of the supportNeedsMobility group, as its own card. */
export function SupportNotesSection({ p, participantId, canEdit, field }: CommonSectionProps & { field: SupportNotesField }) {
  const saveSnm = useSaveSnm(participantId, p)
  const { title, placeholder } = SUPPORT_NOTES_CARD[field]
  const saved = p[field] ?? ''
  const [draft, setDraft] = useState(saved)

  async function handleSave(expected: PatchParticipantDto['expectedRevisions']) {
    try {
      await saveSnm({ [field]: draft.trim() || null }, expected)
    } catch (err) {
      rethrowSectionError(err, `Failed to save ${title.toLowerCase()}.`)
    }
  }

  return (
    <SectionEditPanel title={title} groups={['supportNeedsMobility']} revisions={p.groupRevisions} canEdit={canEdit} isDirty={draft !== saved} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <FormField label={title}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={placeholder} />
        </FormField>
      ) : saved ? (
        <p className="whitespace-pre-line text-sm">{saved}</p>
      ) : (
        <FactList hideEmpty items={[{ label: title, value: '' }]} onAdd={canEdit ? () => startEdit('first-empty') : undefined} />
      )}
    </SectionEditPanel>
  )
}

// ─── Mobility & Functional ──────────────────────────────────────────────────────────────────

type MobilityFunctionalDraft = {
  ambulantStatus: string
  fallsRiskRating: string
  levelOfPersonalCare: string
  unevenGroundFlag: string
  orthotics: string
  continenceSupportDetail: string
  bowelCareDetail: string
  menstruationSupport: string
  skinIntegrity: string
}

function readMobilityFunctional(p: ParticipantDetailDto): MobilityFunctionalDraft {
  return {
    ambulantStatus: p.ambulantStatus ?? NOT_RECORDED,
    fallsRiskRating: p.fallsRiskRating ?? NOT_RECORDED,
    levelOfPersonalCare: p.levelOfPersonalCare ?? NOT_RECORDED,
    unevenGroundFlag: triToKey(p.unevenGroundFlag),
    orthotics: p.orthotics ?? '',
    continenceSupportDetail: p.continenceSupportDetail ?? '',
    bowelCareDetail: p.bowelCareDetail ?? '',
    menstruationSupport: p.menstruationSupport ?? '',
    skinIntegrity: p.skinIntegrity ?? '',
  }
}

export function MobilityFunctionalSection({ p, participantId, canEdit }: CommonSectionProps) {
  const saveSnm = useSaveSnm(participantId, p)
  const saved = readMobilityFunctional(p)
  const [draft, setDraft] = useState<MobilityFunctionalDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof MobilityFunctionalDraft)[]).some((k) => draft[k] !== saved[k])

  async function handleSave(expected: PatchParticipantDto['expectedRevisions']) {
    try {
      await saveSnm({
        ambulantStatus: (draft.ambulantStatus || null) as AmbulantStatus | null,
        fallsRiskRating: (draft.fallsRiskRating || null) as RiskRatingLevel | null,
        levelOfPersonalCare: (draft.levelOfPersonalCare || null) as PersonalCareLevel | null,
        unevenGroundFlag: keyToTri(draft.unevenGroundFlag),
        orthotics: draft.orthotics.trim() || null,
        continenceSupportDetail: draft.continenceSupportDetail.trim() || null,
        bowelCareDetail: draft.bowelCareDetail.trim() || null,
        menstruationSupport: draft.menstruationSupport.trim() || null,
        skinIntegrity: draft.skinIntegrity.trim() || null,
      }, expected)
    } catch (err) {
      rethrowSectionError(err, 'Failed to save Mobility & Functional.')
    }
  }

  // Every row is a fact; hideEmpty drops the unrecorded ones and names them in the foot line, where Add reaches them.
  const detailItems = [
    { label: 'Orthotics', text: p.orthotics },
    { label: 'Continence Support', text: p.continenceSupportDetail },
    { label: 'Colostomy / Catheter / Enema / Suppository', text: p.bowelCareDetail },
    { label: 'Menstruation Support', text: p.menstruationSupport },
    { label: 'Skin Integrity', text: p.skinIntegrity },
  ]
    .map((d) => ({ label: d.label, value: d.text ? <span className="whitespace-pre-line">{d.text}</span> : undefined }))

  return (
    <SectionEditPanel title="Mobility & Functional" groups={['supportNeedsMobility']} revisions={p.groupRevisions} canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <FormField label="Ambulant Status">
              <Dropdown
                variant="form"
                value={draft.ambulantStatus}
                onChange={(v) => setDraft((d) => ({ ...d, ambulantStatus: v }))}
                items={[{ value: NOT_RECORDED, label: 'Not recorded' }, ...AMBULANT_STATUSES.map((s) => ({ value: s, label: AMBULANT_STATUS_LABELS[s] }))]}
              />
            </FormField>
            <FormField label="Falls Risk Rating">
              <Dropdown
                variant="form"
                value={draft.fallsRiskRating}
                onChange={(v) => setDraft((d) => ({ ...d, fallsRiskRating: v }))}
                items={[{ value: NOT_RECORDED, label: 'Not recorded' }, ...RISK_RATING_LEVELS.map((r) => ({ value: r, label: RISK_RATING_LEVEL_LABELS[r] }))]}
              />
            </FormField>
            <FormField label="Level of Personal Care">
              <Dropdown
                variant="form"
                value={draft.levelOfPersonalCare}
                onChange={(v) => setDraft((d) => ({ ...d, levelOfPersonalCare: v }))}
                items={[{ value: NOT_RECORDED, label: 'Not recorded' }, ...PERSONAL_CARE_LEVELS.map((l) => ({ value: l, label: PERSONAL_CARE_LEVEL_LABELS[l] }))]}
              />
            </FormField>
            <FormField label="Uneven Ground" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.unevenGroundFlag} onChange={(v) => setDraft((d) => ({ ...d, unevenGroundFlag: v }))} ariaLabel="Uneven Ground" />
            </FormField>
          </div>
          <FormField label="Orthotics" hint="Y/N/Plan and equipment list, e.g. 'AFO both feet, worn daily'.">
            <textarea value={draft.orthotics} onChange={(e) => setDraft((d) => ({ ...d, orthotics: e.target.value }))} rows={2} placeholder="Orthotics required, plan, and equipment..." />
          </FormField>
          <FormField label="Continence Support" hint="Support type, aids, and any night routine.">
            <textarea value={draft.continenceSupportDetail} onChange={(e) => setDraft((d) => ({ ...d, continenceSupportDetail: e.target.value }))} rows={2} placeholder="Continence support detail..." />
          </FormField>
          <FormField label="Colostomy / Catheter / Enema / Suppository" hint="Which applies, equipment, support required, and training.">
            <textarea value={draft.bowelCareDetail} onChange={(e) => setDraft((d) => ({ ...d, bowelCareDetail: e.target.value }))} rows={2} placeholder="Bowel/continence care detail..." />
          </FormField>
          <FormField label="Menstruation Support">
            <textarea value={draft.menstruationSupport} onChange={(e) => setDraft((d) => ({ ...d, menstruationSupport: e.target.value }))} rows={2} placeholder="Menstruation support detail..." />
          </FormField>
          <FormField label="Skin Integrity">
            <textarea value={draft.skinIntegrity} onChange={(e) => setDraft((d) => ({ ...d, skinIntegrity: e.target.value }))} rows={2} placeholder="Skin integrity notes..." />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'Ambulant Status', value: p.ambulantStatus ? AMBULANT_STATUS_LABELS[p.ambulantStatus] : undefined },
            { label: 'Falls Risk Rating', value: p.fallsRiskRating ? RISK_RATING_LEVEL_LABELS[p.fallsRiskRating] : undefined },
            { label: 'Uneven Ground', value: p.unevenGroundFlag === true ? 'Yes' : p.unevenGroundFlag === false ? 'No' : undefined },
            { label: 'Level of Personal Care', value: p.levelOfPersonalCare ? PERSONAL_CARE_LEVEL_LABELS[p.levelOfPersonalCare] : undefined },
            ...detailItems,
          ]}
          hideEmpty
          onAdd={canEdit ? () => startEdit('first-empty') : undefined}
        />
      )}
    </SectionEditPanel>
  )
}
