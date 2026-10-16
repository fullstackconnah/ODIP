import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { fullName } from '@/lib/inquiryDetails'

/**
 * The Enquiries list's Contact cell (SHAPE.md section 12): who the main contact is, then how to reach them, two lines capped at 13rem so the table
 * keeps its width. A row with no contact name (a legacy enquiry, or a role the server withholds names from, L2) shows the phone or email alone.
 */
export function ContactCell({ row }: { row: ParticipantInquiryDto }) {
  const name = row.contactIsParticipant ? 'Their own contact' : fullName(row.contactFirstName, row.contactLastName)
  const reach = row.phone || row.email || ''
  const first = name || reach || 'No contact details'
  const second = name ? reach || 'No phone or email' : null
  return (
    <span className="block max-w-[13rem] max-md:max-w-none">
      <span className="block truncate text-sm" title={first}>{first}</span>
      {second && <span className="block truncate text-[13px] text-[var(--color-muted-foreground)]" title={second}>{second}</span>}
    </span>
  )
}
