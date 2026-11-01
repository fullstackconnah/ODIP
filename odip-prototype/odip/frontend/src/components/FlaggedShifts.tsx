import { Callout } from '@/components/Callout'
import { plural } from '@/lib/format'
import { formatDateAu } from '@/lib/utils'
import type { ShiftClaimFlaggedDto } from '@/api/types'

/** The shifts that are in a claim but were priced with a caveat: each with its date, what it is and what is not worked out. The claim line cannot keep the caveat, so this is where it is read.
 * The claim run names the participant on each, and says "these claims". */
export function FlaggedShifts({ shifts, scope = 'this claim' }: { shifts: (ShiftClaimFlaggedDto & { participantName?: string })[]; scope?: string }) {
  return (
    <Callout tone="info">
      <p className="font-medium">{`${plural(shifts.length, 'shift')} in ${scope} ${shifts.length === 1 ? 'has' : 'have'} a pricing note`}</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {shifts.map(shift => (
          <li key={shift.shiftId} className="break-words">
            {shift.participantName && <>{shift.participantName} · </>}<span className="tabular-nums">{formatDateAu(shift.serviceDate)}</span> · {shift.description} · {shift.caveat}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px]">Their lines are priced as hours at the day rate. Check them against the hours worked before the claim is submitted.</p>
    </Callout>
  )
}
