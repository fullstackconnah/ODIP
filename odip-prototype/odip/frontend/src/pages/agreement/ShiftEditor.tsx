import { Check, ChevronDown } from 'lucide-react'
import type { DraftBlock, PlanBlock, PlanBlockRequirements, PlanPricingSettingsDto, PlanSetting, PlanSkill, PlanSupportIntensity, PlanSupportType, PlanWorkerGender } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { EDITOR_GRID } from './editorGrid'
import { plural } from '@/lib/format'
import type { Shift } from '@/lib/agreementShifts'
import {
  INTENSITY_LABEL, SETTING_LABEL, SUPPORT_LABEL, SUPPORT_TYPES, blockProblems, canOfferSleepover, clock, defaultSleepoverWindow, durationMinutes, endsNextDay, formatDuration, fromClock,
  needsSleepoverWindow, offeredSupportTypes, ratioLabel, sleepoverMinutes,
} from '@/lib/planBlocks'
import { NumberField } from '@/components/NumberField'
import { fieldError } from './stepTypes'
import { TravelOptions } from './TravelOptions'

export type ShiftPatch = { block?: Partial<Shift['block']>; requirements?: Partial<PlanBlockRequirements> }

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
const HOLIDAY_OPTIONS = [{ key: 'Charge', label: 'Charge the holiday rate' }, { key: 'Skip', label: 'Skip the shift' }]

/** The fields of `next` that differ from `prev`, as a patch (a field that went away is set to undefined). */
function changes<T extends object>(prev: T, next: T): Partial<T> {
  const patch: Partial<T> = {}
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof T>) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) patch[key] = next[key]
  }
  return patch
}

type ShiftEditorProps = {
  /** The selected shifts, in week order, at least one. */
  shifts: readonly Shift[]
  onPatch: (patch: ShiftPatch) => void
  onRemove: () => void
  onDone: () => void
  /** Undefined while they load: nothing about the provider's registration groups is then assumed. */
  settings?: PlanPricingSettingsDto
  /** A limit the whole week is over, said where the editing happens. */
  limitNotice: string | null
}

/**
 * The one editor of the Week step. It edits the first selected shift and applies every change to all the selected ones, so setting the times of five weekdays is one edit. What most
 * shifts need (times, support type, ratio) is shown; the rest is under More options. Mixed selections show the first shift's values and say so.
 */
export function ShiftEditor({ shifts, onPatch, onRemove, onDone, settings, limitNotice }: ShiftEditorProps) {
  const first = shifts[0]
  const entry: DraftBlock = { block: { ...first.block, id: first.id, days: [first.day] } as PlanBlock, requirements: first.requirements }
  const { block, requirements } = entry
  const problems = blockProblems(block, { groupsHeld: settings?.registrationGroupsHeld, groupOutings: settings?.groupOutings, claimProviderTravel: settings?.claimProviderTravel })
  const differ = shifts.some(shift => JSON.stringify([shift.block, shift.requirements]) !== JSON.stringify([first.block, first.requirements]))

  const patch = (next: Partial<PlanBlock>) => onPatch({ block: next })
  const patchRequirements = (next: Partial<PlanBlockRequirements>) => onPatch({ requirements: next })
  // The travel options edit a whole entry; what changed in it is what the selection gets.
  const changeEntry = (next: DraftBlock) => onPatch({ block: changes(block, next.block), requirements: changes(requirements, next.requirements) })

  const minutes = durationMinutes(block)
  const hasTimes = minutes > 0 && clock(block.start) !== '' && clock(block.end) !== ''
  const sameTime = clock(block.start) !== '' && clock(block.start) === clock(block.end)
  const offered = settings ? offeredSupportTypes(settings.registrationGroupsHeld, settings.groupOutings) : [...SUPPORT_TYPES]
  const supportTypes = SUPPORT_TYPES.filter(type => offered.includes(type) || type === block.supportType)
  const window = block.sleepoverWindow
  const toggleSkill = (skill: PlanSkill) => patchRequirements({ skills: requirements.skills.includes(skill) ? requirements.skills.filter(s => s !== skill) : [...requirements.skills, skill] })

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {differ && <p className="text-[13px] text-[var(--color-muted-foreground)]">These {shifts.length} shifts are not all the same. The fields show the first one; changing a field changes all {shifts.length}.</p>}

      <div className={EDITOR_GRID}>
        <FormField label="Starts" error={fieldError(problems, 'start')}>
          <input type="time" value={clock(block.start)} onChange={event => patch({ start: fromClock(event.target.value) })} />
        </FormField>
        <FormField label="Ends" error={fieldError(problems, 'end')}>
          <input type="time" value={clock(block.end)} onChange={event => patch({ end: fromClock(event.target.value) })} />
        </FormField>
      </div>
      <p aria-live="polite" className="text-sm">
        {!hasTimes ? <span className="text-[var(--color-muted-foreground)]">Enter a start and an end time.</span> : sameTime ? (
          <><span className="font-medium">Ends the next day.</span> The same time twice is a 24 hour shift.</>
        ) : endsNextDay(block) ? (
          <><span className="font-medium">Ends the next day</span> at {clock(block.end)}: {formatDuration(minutes)} in all.</>
        ) : (
          <>Ends the same day at {clock(block.end)}: {formatDuration(minutes)} in all.</>
        )}
      </p>

      <div className={EDITOR_GRID}>
        <FormField label="Support type" error={fieldError(problems, 'supportType')}>
          <Dropdown variant="form" value={block.supportType} onChange={value => patch({ supportType: value as PlanSupportType })} items={supportTypes.map(type => ({ value: type, label: SUPPORT_LABEL[type] }))} label="Choose a support type" />
        </FormField>
        <NumberField label="Workers" value={block.workers} min={1} max={10} error={fieldError(problems, 'workers')} onChange={value => patch({ workers: value })} />
        <NumberField label="Participants present" value={block.participantsPresent} min={1} max={40} error={fieldError(problems, 'participantsPresent')} onChange={value => patch({ participantsPresent: value })} />
      </div>
      <p className="text-[13px] text-[var(--color-muted-foreground)]">Ratio {ratioLabel(block)}: each participant pays their share of the hourly price.</p>

      {limitNotice && <Callout tone="warning" className="max-w-prose">{limitNotice}</Callout>}

      <details className="group rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-center justify-between px-3 text-sm font-medium">More options<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
        <div className="flex flex-col gap-[var(--section-gap)] border-t border-[var(--color-border)] p-3">
          <FormField label="Setting" hint={block.setting === 'Centre' ? 'A centre adds the centre capital cost for community access and group activities.' : undefined}>
            <ToggleGroup className="flex-wrap" ariaLabel="Setting" options={SETTING_OPTIONS} value={block.setting} onChange={value => patch({ setting: value as PlanSetting })} />
          </FormField>
          <FormField label="Intensity" hint={block.intensity === 'HighIntensity' ? 'High intensity needs a worker with the high intensity skills.' : undefined} error={fieldError(problems, 'intensity')}>
            <ToggleGroup className="flex-wrap" ariaLabel="Intensity" options={INTENSITY_OPTIONS} value={block.intensity === 'Icbs' ? 'Standard' : block.intensity} onChange={value => patch({ intensity: value as PlanSupportIntensity })} />
          </FormField>
          <FormField label="Public holidays" hint="Shifts on a public holiday are charged at the holiday rate unless you choose to skip them.">
            <ToggleGroup className="flex-wrap" ariaLabel="Public holidays" options={HOLIDAY_OPTIONS} value={block.onPublicHoliday === 'Skip' ? 'Skip' : 'Charge'} onChange={value => patch({ onPublicHoliday: value as 'Charge' | 'Skip' })} />
          </FormField>

          <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-labelledby="shift-asks-heading">
            <div>
              <h4 id="shift-asks-heading" className="text-sm font-semibold">What the shift asks of a worker</h4>
              <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">Requirements only, never names. They go with the shifts on the roster once the agreement is approved.</p>
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

          {canOfferSleepover(block) && (
            <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-label="Sleepover">
              <CheckboxField
                label="A worker may sleep during this shift (a sleepover)"
                hint="Priced as one sleepover item, whatever the day, and not as eight hours of support. Active hours beyond the first two are priced by the hour."
                checked={block.workerMaySleep}
                onChange={event => patch(event.target.checked
                  ? { workerMaySleep: true, ...(needsSleepoverWindow({ ...block, workerMaySleep: true }) ? { sleepoverWindow: defaultSleepoverWindow(block) } : {}) }
                  : { workerMaySleep: false, sleepoverWindow: undefined, sleepoverActiveHours: 0 })}
              />
              {block.workerMaySleep && (
                <div className={EDITOR_GRID}>
                  {needsSleepoverWindow(block) && window && (
                    <>
                      <FormField label="Sleeping from" error={fieldError(problems, 'sleepoverFrom')}>
                        <input type="time" value={clock(window.from)} onChange={event => patch({ sleepoverWindow: { ...window, from: fromClock(event.target.value) } })} />
                      </FormField>
                      <FormField label="Sleeping until">
                        <input type="time" value={clock(window.to)} onChange={event => patch({ sleepoverWindow: { ...window, to: fromClock(event.target.value) } })} />
                      </FormField>
                    </>
                  )}
                  <NumberField
                    label="Active hours in the night" value={block.sleepoverActiveHours} min={0} max={sleepoverMinutes(block) / 60} step={0.25} inputMode="decimal"
                    hint="Hours the worker is expected to be awake and working." error={fieldError(problems, 'sleepoverActiveHours')} onChange={value => patch({ sleepoverActiveHours: value })}
                  />
                </div>
              )}
            </section>
          )}

          <div className="border-t border-[var(--color-border)] pt-[var(--section-gap)]">
            <TravelOptions entry={entry} onChange={changeEntry} problems={problems} settings={settings} />
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
        <Button variant="ghost-danger" onClick={onRemove}>{shifts.length === 1 ? 'Remove this shift' : `Remove ${plural(shifts.length, 'shift')}`}</Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
