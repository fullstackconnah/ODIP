import type { PlanBlockRequirements } from '@/api/types'

const SKILL_LABEL: Record<string, string> = {
  FirstAid: 'First aid',
  MedicationCompetent: 'Medication competent',
  ManualHandling: 'Manual handling',
}

/**
 * What an agreement's block (and the roster pattern and shifts made from it) asks of a worker, in the words the plan builder uses: a gender preference, a driver, and the skills, in that order. Nothing for
 * "no preference" and nothing for a requirement that is not there. A skill this does not know is shown as it came, never hidden. Informational: the roster does not check any of it against a worker yet.
 */
export function requirementLabels(requirements: PlanBlockRequirements | null | undefined): string[] {
  if (!requirements) return []
  return [
    requirements.workerGender === 'Female' ? 'Female worker' : requirements.workerGender === 'Male' ? 'Male worker' : null,
    requirements.driver ? 'Driver' : null,
    ...(requirements.skills ?? []).map(skill => SKILL_LABEL[skill] ?? skill),
  ].filter((label): label is string => label !== null)
}
