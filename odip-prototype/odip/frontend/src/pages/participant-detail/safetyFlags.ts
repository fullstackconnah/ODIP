import type { ParticipantDetailDto } from '@/api/types/participants'
import type { FactChipTone } from '@/components/FactBar'
import { meansNothing } from './recorded'
import type { ParticipantTabKey } from './participantTabs'

export type SafetyFlag = {
  key: string
  label: string
  tone: FactChipTone
  tab: ParticipantTabKey
  hash: string
  /** Where the fact lives, for "See {section}". */
  section: string
  /** The full recorded text, shown on Overview. */
  detail: string
}

type Source = Pick<ParticipantDetailDto, 'isAnaphylaxisRisk' | 'allergiesDetail' | 'chokingRiskMealDetail' | 'fallsRiskRating' | 'behaviourRiskRating' | 'hasRestrictivePracticeFlag'>

/** The header's flag chips, severity first. Free text counts as "nothing" only as a whole value (`meansNothing`); a missed swallowing risk is the dangerous error. */
export function safetyFlags(p: Source): SafetyFlag[] {
  const flags: SafetyFlag[] = []
  if (p.isAnaphylaxisRisk === true) {
    flags.push({ key: 'anaphylaxis', label: 'Anaphylaxis risk', tone: 'danger', tab: 'health', hash: 'medical', section: 'Medical', detail: meansNothing(p.allergiesDetail) ? 'Anaphylaxis risk recorded' : p.allergiesDetail!.trim() })
  } else if (!meansNothing(p.allergiesDetail)) {
    flags.push({ key: 'allergies', label: 'Allergies', tone: 'warning', tab: 'health', hash: 'medical', section: 'Medical', detail: p.allergiesDetail!.trim() })
  }
  if (!meansNothing(p.chokingRiskMealDetail)) {
    flags.push({ key: 'choking', label: 'Choking risk', tone: 'warning', tab: 'daily', hash: 'meals', section: 'Meals & Diet', detail: p.chokingRiskMealDetail!.trim() })
  }
  // The house tones as literals (lib/tone.ts: high is the danger tone; Critical reads one step stronger than High).
  const rating = (key: string, name: string, value: string | null | undefined, tab: ParticipantTabKey, hash: string, section: string) => {
    if (value !== 'High' && value !== 'Critical') return
    flags.push({ key, label: `${name}: ${value}`, tone: value === 'Critical' ? 'danger' : 'negative', tab, hash, section, detail: `${name} rated ${value}` })
  }
  rating('falls', 'Falls risk', p.fallsRiskRating, 'daily', 'mobility-and-personal-care', 'Mobility and personal care')
  rating('behaviour', 'Behaviour risk', p.behaviourRiskRating, 'health', 'behaviour-and-communication', 'Behaviour & Communication')
  if (p.hasRestrictivePracticeFlag) {
    flags.push({ key: 'restrictive', label: 'Restrictive practices', tone: 'warning', tab: 'health', hash: 'restrictive-practices', section: 'Restrictive Practices', detail: 'Restrictive practices in place' })
  }
  return flags
}

const blank = (t?: string | null) => (t ?? '').trim() === ''

/** The safety fields nobody has answered yet. They show "Not recorded", never a safe state. "Nil" counts as answered. */
export function unansweredSafetyFields(p: Source): string[] {
  return [
    p.isAnaphylaxisRisk == null && 'Anaphylaxis risk',
    blank(p.allergiesDetail) && 'Allergies',
    blank(p.chokingRiskMealDetail) && 'Choking risk',
    p.fallsRiskRating == null && 'Falls risk',
    p.behaviourRiskRating == null && 'Behaviour risk',
  ].filter((x): x is string => !!x)
}
