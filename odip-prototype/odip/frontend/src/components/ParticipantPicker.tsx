import { useParticipants } from '@/api/hooks'
import { SearchableSelect, type SearchableSelectItem } from '@/components/SearchableSelect'
import type { ParticipantListDto } from '@/api/types/participants'

export type ParticipantPickerProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** Renders a leading '' / 'None' item for optional-participant use cases. Default false. */
  allowNone?: boolean
  noneLabel?: string
  /** INTAKE-08 convention: exclude draft participants. Default true. */
  excludeDrafts?: boolean
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}

/**
 * IN-2 extraction: owns the `useParticipants()` fetch and its mapping to `SearchableSelect`
 * items, so callers pass a `value`/`onChange` (and optionally `onBlur`, for an RHF `Controller`)
 * rather than wiring the fetch + label-mapping pipeline themselves. This is a data-fetching
 * wrapper around `SearchableSelect`, not a redesign — it forwards every labelling prop exactly
 * as `SearchableSelect` does today, so it drops into `FormField` (or a raw `id`/`aria-labelledby`
 * pairing, for call sites that don't use `FormField`) the same way.
 *
 * Loading/empty states pass straight through to `SearchableSelect`'s own `loading`/`emptyMessage`,
 * driven by the query's `isLoading`/`data`.
 */
export function ParticipantPicker({
  value,
  onChange,
  onBlur,
  allowNone = false,
  noneLabel = 'None',
  excludeDrafts = true,
  placeholder,
  disabled,
  id,
  'aria-labelledby': ariaLabelledBy,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ParticipantPickerProps) {
  const { data: participants = [], isLoading } = useParticipants(excludeDrafts ? { isDraft: 'false' } : undefined)

  const items: SearchableSelectItem[] = [
    ...(allowNone ? [{ value: '', label: noneLabel }] : []),
    ...participants.map((p: ParticipantListDto) => ({ value: p.id, label: p.fullName || `${p.firstName} ${p.lastName}` })),
  ]

  return (
    <SearchableSelect
      id={id}
      aria-labelledby={ariaLabelledBy}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      disabled={disabled}
      loading={isLoading}
      placeholder={placeholder}
      emptyMessage="No participants available"
      items={items}
    />
  )
}
