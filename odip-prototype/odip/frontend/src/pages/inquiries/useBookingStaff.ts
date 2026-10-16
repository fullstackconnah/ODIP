import { useMemo } from 'react'
import { useStaff } from '@/api/hooks'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { staffOptions } from '@/lib/intakeBooking'
import { usePermissions } from '@/lib/permissions'

export type BookingStaff = { items: { value: string; label: string }[]; loading: boolean; defaultStaff: string }

/** Who can go on an intake visit, for the slide-over and the enquiry form (D2). Imports only useStaff: the panel's test mocks @/api/hooks with it. */
export function useBookingStaff(row: Pick<ParticipantInquiryDto, 'intakeStartsAt' | 'intakeStaffUserId' | 'intakeStaffName'> | null): BookingStaff {
  const { id: myId } = usePermissions()
  const staffQuery = useStaff({ isActive: 'true' })
  const items = useMemo(
    () => staffOptions(staffQuery.data ?? [], myId, { id: row?.intakeStaffUserId, name: row?.intakeStaffName }),
    [staffQuery.data, myId, row?.intakeStaffUserId, row?.intakeStaffName],
  )
  // A new booking defaults to the signed-in user when they can go: whoever books often goes, and the choice is visible and changeable.
  const defaultStaff = !row?.intakeStartsAt && myId && items.some(i => i.value === myId) ? myId : ''
  return { items, loading: staffQuery.isLoading, defaultStaff }
}
