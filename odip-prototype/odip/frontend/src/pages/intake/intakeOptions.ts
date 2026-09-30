/**
 * Option lists for the Intake wizard's `Dropdown` controls, in one place so the Profile wizard renders
 * the SAME choices, with the same human labels, for the values it lets staff correct after intake
 * (address state, funding source, plan type, support ratio, overnight support/ratio). The Intake
 * steps and the Profile wizard's editable shared fields both import these; a raw enum value such as
 * "PlanManaged" is never shown as the label.
 */
import type { DropdownItem } from '@/components/Dropdown'
import { AU_STATES, FUNDING_SOURCES, OVERNIGHT_SUPPORT_TYPES, SUPPORT_RATIOS } from '@/api/types/enums'
import type { SupportRatio } from '@/api/types/enums'
import { FUNDING_SOURCE_LABELS, OVERNIGHT_RATIO_LABELS, OVERNIGHT_SUPPORT_LABELS } from '@/api/types/participants'

export const ADDRESS_STATE_ITEMS: DropdownItem[] = [
  { value: '', label: 'Not specified' },
  ...AU_STATES.map((s) => ({ value: s, label: s })),
]

export const FUNDING_SOURCE_ITEMS: DropdownItem[] = FUNDING_SOURCES.map((s) => ({ value: s, label: FUNDING_SOURCE_LABELS[s] }))

export const PLAN_TYPE_ITEMS: DropdownItem[] = [
  { value: 'SelfManaged', label: 'Self Managed' },
  { value: 'PlanManaged', label: 'Plan Managed' },
  { value: 'AgencyManaged', label: 'Agency Managed' },
]

/** The five ratios the Support Ratio control offers. `SupportRatio` also has 1:3, 1:4 and 1:5 (valid
 * on the server, selectable only as the overnight ratio) — see {@link itemsIncludingCurrent}. */
export const SUPPORT_RATIO_ITEMS: DropdownItem[] = [
  { value: 'SharedSupport', label: 'Shared Support' },
  { value: 'OneToOne', label: '1:1' },
  { value: 'OneToTwo', label: '1:2' },
  { value: 'TwoToOne', label: '2:1' },
  { value: 'Other', label: 'Other' },
]

export const OVERNIGHT_SUPPORT_ITEMS: DropdownItem[] = OVERNIGHT_SUPPORT_TYPES.map((type) => ({ value: type, label: OVERNIGHT_SUPPORT_LABELS[type] }))

export const OVERNIGHT_RATIO_ITEMS: DropdownItem[] = SUPPORT_RATIOS.map((ratio) => ({ value: ratio, label: OVERNIGHT_RATIO_LABELS[ratio as SupportRatio] }))

/**
 * `items`, plus the participant's stored value when that value is not one of them. A `Dropdown` shows
 * "Select…" for a value it has no item for, which would make a stored, valid value (a support ratio of
 * 1:3, say) look blank the moment it becomes editable. Empty values are left alone.
 */
export function itemsIncludingCurrent(items: DropdownItem[], current: string | null | undefined, labelFor: (value: string) => string | undefined): DropdownItem[] {
  if (!current || items.some((item) => item.value === current)) return items
  return [...items, { value: current, label: labelFor(current) ?? current }]
}
