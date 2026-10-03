import { Check } from 'lucide-react'
import { Button } from '@/components/Button'
import { CheckboxField } from '@/components/CheckboxField'
import { FormField } from '@/components/FormField'
import { formGrid, span } from '@/lib/formGrid'
import {
  DAY_SHORT, PLAN_DAYS, canOfferSleepover, clock, defaultSleepoverWindow, durationMinutes, endsNextDay, formatDuration, fromClock, needsSleepoverWindow, sleepoverMinutes,
} from '@/lib/planBlocks'
import type { PlanBlock, PlanDayName } from '@/api/types'
import { BandPreview } from './BandPreview'
import { NumberField } from './NumberField'
import { fieldError, type StepProps } from './stepTypes'

/**
 * Days and times: which days, from when to when, where the prices change inside that, and (only when the block could be one) a sleepover. "Ends the next day" is never a
 * checkbox: it is worked out from the two times and said in words, because it is what the times mean.
 */
export function TimesStep({ entry, onChange, problems }: StepProps) {
  const { block } = entry
  const patch = (changes: Partial<PlanBlock>) => onChange({ ...entry, block: { ...block, ...changes } })
  const toggleDay = (day: PlanDayName) => patch({ days: PLAN_DAYS.filter(d => (d === day ? !block.days.includes(day) : block.days.includes(d))) })

  const minutes = durationMinutes(block)
  const hasTimes = minutes > 0 && clock(block.start) !== '' && clock(block.end) !== ''
  const sameTime = clock(block.start) !== '' && clock(block.start) === clock(block.end)
  const daysError = fieldError(problems, 'days')
  const window = block.sleepoverWindow

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <fieldset className="min-w-0" aria-describedby={daysError ? 'plan-days-error' : undefined}>
        <legend className="mb-1 text-[13px] font-medium text-[var(--color-muted-foreground)]">Days</legend>
        <div className="flex flex-wrap gap-2">
          {PLAN_DAYS.map(day => {
            const on = block.days.includes(day)
            return (
              <Button key={day} variant={on ? 'primary' : 'secondary'} aria-pressed={on} aria-label={day} onClick={() => toggleDay(day)} className="min-w-[3.25rem]">
                {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{DAY_SHORT[day]}
              </Button>
            )
          })}
        </div>
        {daysError && <p id="plan-days-error" role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">{daysError}</p>}
      </fieldset>

      <div className={formGrid}>
        <FormField label="Starts" className={span.short} error={fieldError(problems, 'start')}>
          <input type="time" value={clock(block.start)} onChange={event => patch({ start: fromClock(event.target.value) })} />
        </FormField>
        <FormField label="Ends" className={span.short} error={fieldError(problems, 'end')}>
          <input type="time" value={clock(block.end)} onChange={event => patch({ end: fromClock(event.target.value) })} />
        </FormField>
      </div>

      <p aria-live="polite" className="text-sm">
        {!hasTimes ? <span className="text-[var(--color-muted-foreground)]">Enter a start and an end time.</span> : sameTime ? (
          <><span className="font-medium">Ends the next day.</span> The same time twice is a 24 hour block.</>
        ) : endsNextDay(block) ? (
          <><span className="font-medium">Ends the next day</span> at {clock(block.end)}: {formatDuration(minutes)} in all.</>
        ) : (
          <>Ends the same day at {clock(block.end)}: {formatDuration(minutes)} in all.</>
        )}
      </p>

      {hasTimes && <BandPreview block={block} />}

      {canOfferSleepover(block) && (
        <section className="flex flex-col gap-[var(--field-gap-y)] border-t border-[var(--color-border)] pt-[var(--section-gap)]" aria-label="Sleepover">
          <CheckboxField
            label="A worker may sleep during this block (a sleepover)"
            hint="Priced as one sleepover item, whatever the day, and not as eight hours of support. Active hours beyond the first two are priced by the hour."
            checked={block.workerMaySleep}
            onChange={event => patch(event.target.checked
              ? { workerMaySleep: true, ...(needsSleepoverWindow({ ...block, workerMaySleep: true }) ? { sleepoverWindow: defaultSleepoverWindow(block) } : {}) }
              : { workerMaySleep: false, sleepoverWindow: undefined, sleepoverActiveHours: 0 })}
          />
          {block.workerMaySleep && (
            <div className={formGrid}>
              {needsSleepoverWindow(block) && window && (
                <>
                  <FormField label="Sleeping from" className={span.short} error={fieldError(problems, 'sleepoverFrom')}>
                    <input type="time" value={clock(window.from)} onChange={event => patch({ sleepoverWindow: { ...window, from: fromClock(event.target.value) } })} />
                  </FormField>
                  <FormField label="Sleeping until" className={span.short}>
                    <input type="time" value={clock(window.to)} onChange={event => patch({ sleepoverWindow: { ...window, to: fromClock(event.target.value) } })} />
                  </FormField>
                </>
              )}
              <NumberField
                label="Active hours in the night"
                className={span.short}
                value={block.sleepoverActiveHours}
                min={0}
                max={sleepoverMinutes(block) / 60}
                step={0.25}
                inputMode="decimal"
                hint="Hours the worker is expected to be awake and working."
                error={fieldError(problems, 'sleepoverActiveHours')}
                onChange={value => patch({ sleepoverActiveHours: value })}
              />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
