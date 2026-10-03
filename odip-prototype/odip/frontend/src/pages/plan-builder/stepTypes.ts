import type { DraftBlock, PlanPricingSettingsDto } from '@/api/types'
import type { BlockProblem } from '@/lib/planBlocks'

/** What every step of the block stepper is given: the block being built, how to change it, the problems found next to its fields, and the provider's pricing settings. */
export type StepProps = {
  entry: DraftBlock
  onChange: (next: DraftBlock) => void
  /** The problems for this step's fields only. */
  problems: readonly BlockProblem[]
  /** Undefined while they load: nothing about the provider's registration groups is then assumed. */
  settings?: PlanPricingSettingsDto
}

export function fieldError(problems: readonly BlockProblem[], field: string): string | undefined {
  return problems.find(problem => problem.field === field)?.message
}
