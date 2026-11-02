import type { DropdownItem } from '@/components/Dropdown'

/** The NDIA's four cancellation reasons: the no-show claim and the short-notice cancellation claim ask the same question. */
export const CANCELLATION_REASONS: DropdownItem[] = [
  { value: 'NSDH', label: 'No show – health reason' },
  { value: 'NSDF', label: 'No show – family issues' },
  { value: 'NSDT', label: 'No show – transport unavailable' },
  { value: 'NSDO', label: 'Other' },
]
