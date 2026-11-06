import type { IncidentType } from '@/api/types/enums'

export type CommonIncident = { key: string; title: string; incidentType?: IncidentType; prompts: readonly string[] }

/**
 * The incident form's "Common incident" list: what a worker picks to fill the title, the type and a few prompts.
 * Death, SexualAbuse, Abuse and Neglect are left out on purpose: a serious allegation is chosen by hand, not from a one-tap template.
 */
export const COMMON_INCIDENTS: readonly CommonIncident[] = [
  { key: 'upset', title: 'Upset, yelling or threatening', incidentType: 'BehaviourOfConcern', prompts: ['What happened just before:', 'What they said or did:', 'What you did to help them feel calm:', 'Was anyone hurt or anything damaged:'] },
  { key: 'hit-out', title: 'Hit, kicked or pushed someone', incidentType: 'BehaviourOfConcern', prompts: ['What happened just before:', 'Who was involved, and was anyone hurt:', 'What you did to keep everyone safe:'] },
  // "and was hurt": Injury needs at least one injury row, so a fall with no injury goes through Something else.
  { key: 'fall', title: 'Fell and was hurt', incidentType: 'Injury', prompts: ['Where they fell and what they were doing:', 'Where they were hurt:', 'How you helped them, and who you told:'] },
  { key: 'hurt', title: 'Cut, bruise, burn or other injury', incidentType: 'Injury', prompts: ['How it happened:', 'What first aid you gave:', 'Who you told:'] },
  { key: 'unwell', title: 'Became unwell', incidentType: 'Illness', prompts: ['Signs you noticed, and when they started:', 'What you did (rest, fluids, GP, ambulance):', 'How they are now:'] },
  { key: 'seizure', title: 'Had a seizure', incidentType: 'Illness', prompts: ['When it started and how long it lasted:', 'What you saw during it:', 'What you did, and whether their seizure plan was followed:', 'How they were afterwards:'] },
  { key: 'med-missed', title: 'Medication missed or refused', incidentType: 'MedicationError', prompts: ['Which medication, and when it was due:', 'What happened:', 'Who you told (nurse, coordinator, family):'] },
  { key: 'med-wrong', title: 'Wrong medication or dose given', incidentType: 'MedicationError', prompts: ['What was given, and what should have been:', 'How they are now:', 'Who you told, and any advice you were given:'] },
  { key: 'missing', title: "Couldn't find the participant", incidentType: 'MissingPerson', prompts: ['When and where you last saw them:', 'Where you looked, and who you called:', 'When and where they were found:'] },
  { key: 'damage', title: 'Something was broken or damaged', incidentType: 'PropertyDamage', prompts: ['What was damaged, and who owns it:', 'How it happened:', 'Was anyone hurt:'] },
  // No prompts: the Restrictive practice step adds its own description skeleton.
  { key: 'rp', title: 'Restrictive practice used', incidentType: 'RestrictivePracticeUse', prompts: [] },
  { key: 'something-else', title: 'Something else', prompts: [] },
]

/** The prompts as description text: each on its own line with a blank line under it to type on. */
export function promptsText(entry: CommonIncident): string {
  return entry.prompts.map((p) => p + '\n').join('\n')
}

export type CommonIncidentCurrent = {
  title: string
  incidentType: string
  description: string
  /** The prompts the last pick placed in the description (form-only); '' once the text is the worker's own. */
  pickedPrompts: string
  injuriesCount: number
  /** Any restrictive practice type, linked practice or unapproved-practice text is entered. */
  rpData: boolean
}
/** What the last pick actually placed, or null where it placed nothing. */
export type CommonIncidentApplied = { title: string | null; incidentType: string | null }
export type CommonIncidentField = 'title' | 'type' | 'prompts'
export type CommonIncidentResult = {
  set: Partial<{ title: string; incidentType: string; description: string; pickedPrompts: string }>
  filled: CommonIncidentField[]
  kept: CommonIncidentField[]
  applied: CommonIncidentApplied
}

/**
 * A pick fills only what is blank or still the previous pick's untouched text; anything the worker typed or chose is kept.
 * A type is also kept once injury rows or restrictive-practice data hang on it, because changing it would wipe them. Severity is never touched.
 */
export function applyCommonIncident(current: CommonIncidentCurrent, applied: CommonIncidentApplied, entry: CommonIncident): CommonIncidentResult {
  if (!entry.incidentType) return { set: {}, filled: [], kept: [], applied }
  const set: CommonIncidentResult['set'] = {}
  const filled: CommonIncidentField[] = []
  const kept: CommonIncidentField[] = []
  const next: CommonIncidentApplied = { title: null, incidentType: null }

  const title = current.title.trim()
  if (title === '' || (applied.title !== null && title === applied.title.trim())) {
    set.title = entry.title
    filled.push('title')
    next.title = entry.title
  } else kept.push('title')

  const canChangeType = current.injuriesCount === 0 && !current.rpData
  if ((current.incidentType === '' || current.incidentType === applied.incidentType) && canChangeType) {
    set.incidentType = entry.incidentType
    filled.push('type')
    next.incidentType = entry.incidentType
  } else kept.push('type')

  const description = current.description.trim()
  const pickedPrompts = current.pickedPrompts.trim()
  const hasPrompts = entry.prompts.length > 0
  if (description === '' || (pickedPrompts !== '' && description === pickedPrompts)) {
    set.description = promptsText(entry)
    set.pickedPrompts = set.description
    if (hasPrompts) filled.push('prompts')
  } else {
    set.pickedPrompts = ''
    if (hasPrompts) kept.push('prompts')
  }
  return { set, filled, kept, applied: next }
}

const FIELD_WORDS: Record<CommonIncidentField, string> = { title: 'title', type: 'type', prompts: 'description prompts' }

/** The polite line under the picker; empty for Something else, which changes nothing. */
export function commonIncidentStatus(key: string, filled: readonly CommonIncidentField[], kept: readonly CommonIncidentField[]): string {
  if (key === 'something-else') return ''
  if (filled.length === 0) return 'Nothing changed. Kept what was already there.'
  const words = filled.map((f) => FIELD_WORDS[f])
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
  return `Filled in the ${list}.${kept.length ? ' Kept what was already there.' : ''}`
}
