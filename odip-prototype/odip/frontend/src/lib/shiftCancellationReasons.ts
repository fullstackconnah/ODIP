import type { DropdownItem } from '@/components/Dropdown'
import { SHIFT_CANCELLATION_REASON_VALUES, type ShiftCancellationReason } from '@/api/types/enums'

const LABELS: Record<ShiftCancellationReason, string> = {
  ParticipantUnwell: 'Participant unwell',
  ParticipantFamily: 'Participant family matter',
  ParticipantTransport: 'Participant transport unavailable',
  ParticipantDidNotAttend: 'Participant did not attend',
  ParticipantOther: 'Participant cancelled, other reason',
  StaffUnavailable: 'Staff unavailable',
  ProviderCancelled: 'Cancelled by the provider',
  Weather: 'Weather or emergency',
  RosteredInError: 'Rostered by mistake',
  Other: 'Other',
}

/** Why a shift was cancelled, in the server enum's order (also the report's order). Not the NDIA claim codes in `cancellationReasons.ts`, which are chosen at claim time. */
export const SHIFT_CANCELLATION_REASONS: DropdownItem[] = SHIFT_CANCELLATION_REASON_VALUES.map(value => ({ value, label: LABELS[value] }))

/** A reason's label; a cancelled shift with none recorded (every shift cancelled before reasons existed) reads "Not recorded". */
export const shiftCancellationReasonLabel = (reason: ShiftCancellationReason | null | undefined) => (reason ? LABELS[reason] : 'Not recorded')
