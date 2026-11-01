import { useMemo } from 'react'
import { FormField } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useSupportCatalogue } from '@/api/hooks'
import { formatServiceDate } from '@/lib/format'
import type { SupportActivityGroupDto } from '@/api/types'

const COMMUNITY_LABEL = 'Community access (default)'
const EMPTY_CATALOGUE = 'The catalogue has no hourly support types. Import it under Support catalogue.'

/** Whether the group has an hourly row priced on that day (the claim only ever prices hourly rows). */
function hourlyOn(group: SupportActivityGroupDto, date: string): boolean {
  return group.items.some(i => i.unit === 'H' && i.effectiveFrom.slice(0, 10) <= date && (!i.effectiveTo || i.effectiveTo.slice(0, 10) >= date))
}

type SupportTypeFieldProps = {
  /** The chosen group code; '' is community access. */
  value: string
  onChange: (code: string) => void
  /** The day the rate is read on: a shift's service date, or a pattern's later of start and today. */
  date: string
  canWrite: boolean
  /** The claim holding the shift: the type is then fixed. */
  claimReference?: string | null
  /** The line for this state, under the control. */
  hint: string
}

/** The support type a shift (or every shift of a pattern) is billed under, chosen from the catalogue's hourly groups; empty means community access. */
export function SupportTypeField({ value, onChange, date, canWrite, claimReference, hint }: SupportTypeFieldProps) {
  const catalogue = useSupportCatalogue()
  const groups = catalogue.data
  const locked = !!claimReference

  const listed = useMemo(
    () => (groups ?? []).filter(g => hourlyOn(g, date)).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [groups, date],
  )
  const stored = groups?.find(g => g.groupCode === value)
  const name = stored?.displayName ?? value
  const rows = [{ value: '', label: COMMUNITY_LABEL }, ...listed.map(g => ({ value: g.groupCode, label: g.displayName }))]
  // A stored type that is no longer offered still shows, so the control never reads as community access when it is not.
  const items = value && !listed.some(g => g.groupCode === value) ? [...rows, { value, label: name }] : rows

  const failed = catalogue.isError
  const loading = catalogue.isLoading
  const invalid = !!groups && !!value && !(stored && hourlyOn(stored, date))
  // The date is one unbreakable run, so a narrow phone never splits it across lines.
  const error = failed
    ? "Support types didn't load. Close the panel and open it again."
    : invalid
      ? `${name} has no hourly rate on ${formatServiceDate(date).replace(/ /g, ' ')}. Choose another support type, or import the catalogue for that date.`
      : undefined
  const line = locked
    ? `On claim ${claimReference}. Delete that claim to change the support type.`
    : loading ? undefined : groups && listed.length === 0 ? EMPTY_CATALOGUE : hint

  return (
    <FormField label="Support type" hint={line} error={error}>
      <SearchableSelect
        items={items}
        value={value}
        onChange={onChange}
        disabled={!canWrite || locked || loading || failed}
        loading={loading}
        placeholder={loading ? 'Loading support types…' : 'Search support types'}
        noMatchMessage="No support type matches."
      />
    </FormField>
  )
}
