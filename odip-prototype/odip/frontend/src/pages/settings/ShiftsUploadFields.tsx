import { Dropdown } from '@/components/Dropdown'
import { FormField, labelClass } from '@/components/FormField'
import type { ImportShiftShape } from '@/api/types'
import { datedLimit, maxFrom, sayDay, spanLine } from './upcomingShifts'

const SHAPES: { value: ImportShiftShape; label: string; hint: string }[] = [
  { value: 'dated', label: 'Dated shifts', hint: 'One row per shift, with its date. Usually an export from your old platform.' },
  { value: 'pattern', label: 'A weekly pattern', hint: 'One row per regular shift, with its weekday. Repeated each week for the weeks you choose.' },
]
const WEEK_ITEMS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 week' : `${i + 1} weeks` }))

type Props = {
  shape: ImportShiftShape | null
  onShape: (shape: ImportShiftShape) => void
  from: string
  onFrom: (from: string) => void
  weeks: number
  onWeeks: (weeks: number) => void
  /** Today as yyyy-MM-dd; the server re-checks every date against the organisation's own today. */
  today: string
}

/** The Upload step's extra fields for the upcoming-shifts import: what the file holds, and for a pattern where and how long it repeats. */
export default function ShiftsUploadFields({ shape, onShape, from, onFrom, weeks, onWeeks, today }: Props) {
  return (
    <>
      <fieldset className="grid gap-2 md:grid-cols-2">
        <legend className={`${labelClass} mb-1`}>What's in your file?</legend>
        {SHAPES.map(option => (
          <label key={option.value} className="flex min-h-[var(--control-h)] cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] text-sm has-[:checked]:border-[var(--color-primary)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-ring)]">
            <input className="mt-0.5" type="radio" name="shape" value={option.value} checked={shape === option.value} onChange={() => onShape(option.value)} />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-[var(--color-muted-foreground)]">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {shape === 'pattern' && (
        <>
          <div className="grid gap-3 md:grid-cols-[auto_auto] md:justify-start">
            <FormField label="Starts from">
              <input type="date" value={from} min={today} max={maxFrom(today)} onChange={e => onFrom(e.target.value)} />
            </FormField>
            <FormField label="For">
              <Dropdown variant="form" value={String(weeks)} onChange={v => onWeeks(Number(v))} items={WEEK_ITEMS} />
            </FormField>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)]" aria-live="polite">{from ? spanLine(from, weeks) : ''}</p>
        </>
      )}
      {shape === 'dated' && (
        <p className="text-sm text-[var(--color-muted-foreground)]">{`Rows dated before today or more than 12 weeks ahead (after ${sayDay(datedLimit(today))}) can't be imported.`}</p>
      )}
    </>
  )
}
