import { Check } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formGrid, span } from '@/lib/formGrid'
import { INTENSITY_LABEL, REGISTRATION_GROUP_NAME, SETTING_LABEL, SUPPORT_LABEL, SUPPORT_TYPES, offeredSupportTypes, ratioSentence, registrationGroupFor } from '@/lib/planBlocks'
import type { PlanBlock, PlanBlockRequirements, PlanSetting, PlanSkill, PlanSupportIntensity, PlanSupportType, PlanWorkerGender } from '@/api/types'
import { NumberField } from './NumberField'
import { fieldError, type StepProps } from './stepTypes'

const GENDER_OPTIONS: { key: PlanWorkerGender; label: string }[] = [
  { key: 'NoPreference', label: 'No preference' },
  { key: 'Female', label: 'Female worker' },
  { key: 'Male', label: 'Male worker' },
]

const SKILLS: { key: PlanSkill; label: string }[] = [
  { key: 'FirstAid', label: 'First aid' },
  { key: 'MedicationCompetent', label: 'Medication competent' },
  { key: 'ManualHandling', label: 'Manual handling' },
]

const INTENSITY_OPTIONS = (['Standard', 'HighIntensity'] as const).map(key => ({ key, label: INTENSITY_LABEL[key] }))
const SETTING_OPTIONS = (['Community', 'Centre', 'AtHome', 'Accommodation'] as const).map(key => ({ key, label: SETTING_LABEL[key] }))

/**
 * Requirements: what kind of support, how intense, how many workers for how many participants, where it is delivered, and what the shifts will ask of a worker. Only the support
 * types the provider holds a registration group for are offered. Worker requirements are chips and never names: the roster patterns an approved agreement creates carry them.
 */
export function RequirementsStep({ entry, onChange, problems, settings }: StepProps) {
  const { block, requirements } = entry
  const patch = (changes: Partial<PlanBlock>) => onChange({ ...entry, block: { ...block, ...changes } })
  const patchRequirements = (changes: Partial<PlanBlockRequirements>) => onChange({ ...entry, requirements: { ...requirements, ...changes } })

  const offered = settings ? offeredSupportTypes(settings.registrationGroupsHeld, settings.groupOutings) : [...SUPPORT_TYPES]
  const shown: PlanSupportType[] = SUPPORT_TYPES.filter(type => offered.includes(type) || type === block.supportType)
  const group = registrationGroupFor(block, settings?.groupOutings)
  const supportError = fieldError(problems, 'supportType')
  const intensityError = fieldError(problems, 'intensity')
  const toggleSkill = (skill: PlanSkill) => patchRequirements({ skills: requirements.skills.includes(skill) ? requirements.skills.filter(s => s !== skill) : [...requirements.skills, skill] })

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className={formGrid}>
        <FormField label="Support type" className={span.medium} error={supportError} hint={supportError ? undefined : `Registration group ${group}: ${REGISTRATION_GROUP_NAME[group] ?? ''}`}>
          <Dropdown
            variant="form"
            value={block.supportType}
            onChange={value => patch({ supportType: value as PlanSupportType })}
            items={shown.map(type => ({ value: type, label: SUPPORT_LABEL[type] }))}
            label="Choose a support type"
          />
        </FormField>
        <FormField label="Intensity" className={span.medium} error={intensityError} hint={intensityError ? undefined : 'High intensity needs a worker with the high intensity skills.'}>
          <ToggleGroup className="flex-wrap" ariaLabel="Intensity" options={INTENSITY_OPTIONS} value={block.intensity === 'Icbs' ? 'Standard' : block.intensity} onChange={value => patch({ intensity: value as PlanSupportIntensity })} />
        </FormField>
      </div>

      <div className={formGrid}>
        <NumberField label="Workers" className={span.short} value={block.workers} min={1} max={10} error={fieldError(problems, 'workers')} onChange={value => patch({ workers: value })} />
        <NumberField label="Participants present" className={span.short} value={block.participantsPresent} min={1} max={40} error={fieldError(problems, 'participantsPresent')} onChange={value => patch({ participantsPresent: value })} />
        <p aria-live="polite" className="text-sm text-[var(--color-muted-foreground)] md:col-span-2 xl:col-span-6 xl:self-end xl:pb-1.5">{ratioSentence(block.workers, block.participantsPresent)}</p>
      </div>

      <FormField label="Setting" hint={block.setting === 'Centre' ? 'A centre adds the centre capital cost for community access and group activities.' : undefined}>
        <ToggleGroup className="flex-wrap" ariaLabel="Setting" options={SETTING_OPTIONS} value={block.setting} onChange={value => patch({ setting: value as PlanSetting })} />
      </FormField>

      <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="plan-asks-heading">
        <div>
          <h3 id="plan-asks-heading" className="text-sm font-semibold">What the shifts ask of a worker</h3>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">Requirements only, never names. They go with the shifts this block becomes on the roster.</p>
        </div>
        <FormField label="Worker gender">
          <ToggleGroup className="flex-wrap" ariaLabel="Worker gender" options={GENDER_OPTIONS} value={requirements.workerGender} onChange={value => patchRequirements({ workerGender: value as PlanWorkerGender })} />
        </FormField>
        <div role="group" aria-label="Worker skills" className="flex flex-wrap gap-2">
          <Button variant={requirements.driver ? 'primary' : 'secondary'} aria-pressed={requirements.driver} onClick={() => patchRequirements({ driver: !requirements.driver })}>
            {requirements.driver && <Check className="h-3.5 w-3.5" aria-hidden="true" />}Driver
          </Button>
          {SKILLS.map(skill => {
            const on = requirements.skills.includes(skill.key)
            return (
              <Button key={skill.key} variant={on ? 'primary' : 'secondary'} aria-pressed={on} onClick={() => toggleSkill(skill.key)}>
                {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{skill.label}
              </Button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
