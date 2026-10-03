import { useMemo, useState, type FormEvent } from 'react'
import type { AgreementState, DraftBlock, PlanBlock, PlanIssue, PlanPriceZone, PlanPricingSettingsDto } from '@/api/types'
import { Button } from '@/components/Button'
import { WizardShell, WizardStepHeading, WizardStepRail, type WizardStepDef } from '@/components/wizard'
import { PLAN_STEPS, blockProblems, normaliseBlock, stampLocation, type PlanStepKey } from '@/lib/planBlocks'
import type { ReferenceWeek } from '@/lib/planQuote'
import type { PlanTemplate } from '@/lib/planTemplates'
import { RequirementsStep } from './RequirementsStep'
import { ReviewStep } from './ReviewStep'
import { TemplateCards } from './TemplateCards'
import { TimesStep } from './TimesStep'
import { TravelStep } from './TravelStep'

type NoFields = Record<string, never>
const RAIL_STEPS: WizardStepDef<NoFields>[] = PLAN_STEPS.map(step => ({ key: step.key, label: step.label, fields: [] }))

type PlanStepperProps = {
  /** `new`: a block being added (it joins the plan on the Review step). `edit`: a copy of a block already in the plan. */
  mode: 'new' | 'edit'
  entry: DraftBlock
  /** The template the block started from, when it started from one (it is only shown selected; a block never remembers it). */
  templateKey: string | null
  /** A block exists: every step is then one click away on the rail. Before one does, only the Template step is. */
  hasBlock: boolean
  step: PlanStepKey
  onStepChange: (step: PlanStepKey) => void
  onChange: (next: DraftBlock) => void
  onChooseTemplate: (template: PlanTemplate) => void
  onCancel: () => void
  onSave: () => void
  settings?: PlanPricingSettingsDto
  /** The plan's other blocks. */
  others: readonly PlanBlock[]
  from: string
  to: string
  state: AgreementState
  zone: PlanPriceZone
  week: ReferenceWeek | null
  planIssues: readonly PlanIssue[]
}

/**
 * The five steps that turn a template into a priced block: Template, Days and times, Requirements, Travel and transport, Review. The rail on the left (a "Step 2 of 5 · Days and
 * times" line on a phone) is every step once a block exists; Back and Next move one at a time, and Enter in a field is Next. A step's problems appear next to its fields once
 * somebody tries to leave it, and the block cannot be added until it has none. The block is only ever a copy: Cancel leaves the plan as it was.
 */
export function PlanStepper({ mode, entry, templateKey, hasBlock, step, onStepChange, onChange, onChooseTemplate, onCancel, onSave, settings, others, from, to, state, zone, week, planIssues }: PlanStepperProps) {
  const [attempted, setAttempted] = useState<ReadonlySet<PlanStepKey>>(() => new Set())
  const stepIndex = PLAN_STEPS.findIndex(candidate => candidate.key === step)
  const current = PLAN_STEPS[stepIndex]
  const visited = useMemo(() => new Set<string>(hasBlock ? PLAN_STEPS.map(candidate => candidate.key) : ['template']), [hasBlock])
  const problems = useMemo(
    () => blockProblems(entry.block, { groupsHeld: settings?.registrationGroupsHeld, groupOutings: settings?.groupOutings, claimProviderTravel: settings?.claimProviderTravel }),
    [entry.block, settings],
  )
  const stepProblems = problems.filter(problem => problem.step === step)
  const shown = attempted.has(step) ? stepProblems : []
  const quoted = useMemo(() => stampLocation(entry.block, state, zone), [entry.block, state, zone])
  const isReview = step === 'review'
  const isTemplate = step === 'template'

  const change = (next: DraftBlock) => onChange({ ...next, block: normaliseBlock(next.block) })
  const go = (next: PlanStepKey) => onStepChange(next)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isTemplate && !hasBlock) return
    if (!isReview) {
      if (stepProblems.length > 0) { setAttempted(previous => new Set(previous).add(step)); return }
      go(PLAN_STEPS[stepIndex + 1].key)
      return
    }
    if (problems.length === 0) onSave()
  }

  const body = (() => {
    switch (step) {
      case 'template':
        return (
          <div className="flex flex-col gap-2">
            <TemplateCards mode="radio" selectedKey={templateKey} onChoose={onChooseTemplate} state={state} zone={zone} legend={mode === 'edit' ? 'Start again from a template' : 'Choose a template to start from'} />
            {mode === 'edit' && <p className="text-[13px] text-[var(--color-muted-foreground)]">Choosing a template replaces this block&apos;s days, times and requirements. Cancel keeps the plan as it was.</p>}
            {mode === 'new' && !hasBlock && <p className="text-[13px] text-[var(--color-muted-foreground)]">Every template can be changed on the next steps. Blank starts from nothing.</p>}
          </div>
        )
      case 'times': return <TimesStep entry={entry} onChange={change} problems={shown} settings={settings} />
      case 'requirements': return <RequirementsStep entry={entry} onChange={change} problems={shown} settings={settings} />
      case 'travel': return <TravelStep entry={entry} onChange={change} problems={shown} settings={settings} />
      default: return <ReviewStep entry={entry} quoted={quoted} others={others} from={from} to={to} week={week} planIssues={planIssues} problems={problems} onChange={change} onGoTo={go} />
    }
  })()

  return (
    <WizardShell
      railLabel="Block steps"
      railClassName="hidden lg:block"
      rail={<WizardStepRail steps={RAIL_STEPS} visitedSteps={visited} currentKey={step} onSelect={key => go(key as PlanStepKey)} orientation="vertical" ariaLabel="Block steps" />}
    >
      <p className="mb-2 text-sm font-medium text-[var(--color-muted-foreground)] lg:hidden">Step {stepIndex + 1} of {PLAN_STEPS.length} · {current.label}</p>
      <form onSubmit={submit} noValidate aria-label={`${mode === 'new' ? 'New block' : 'Edit block'}: ${current.label}`}>
        <WizardStepHeading stepKey={step} label={current.label} />
        <div className="mt-2">{body}</div>
        <div className="mt-[var(--section-gap)] flex w-full min-w-0 flex-col gap-3 border-t border-[var(--color-border)] pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            {stepIndex > 0 && <Button variant="secondary" onClick={() => go(PLAN_STEPS[stepIndex - 1].key)}>Back</Button>}
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-3">
            {mode === 'edit' && !isReview && !isTemplate && <Button variant="secondary" disabled={problems.length > 0} onClick={onSave}>Save block</Button>}
            {isReview
              ? <Button type="submit" disabled={problems.length > 0}>{mode === 'new' ? 'Add to plan' : 'Save block'}</Button>
              : <Button type="submit" disabled={isTemplate && !hasBlock}>Next</Button>}
          </div>
        </div>
      </form>
    </WizardShell>
  )
}
