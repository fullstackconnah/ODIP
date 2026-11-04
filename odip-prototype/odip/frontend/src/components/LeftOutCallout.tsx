import type { ReactNode } from 'react'
import { Callout } from '@/components/Callout'
import { noBreakRefs } from '@/lib/noBreakRef'

export interface LeftOutItem {
  key: string
  /** What leads the line (a shift's date); a trip claim has none. */
  lead?: ReactNode
  description: string
  reason: string
  /** What the row offers beside its reason (a link to the claim holding the shift). */
  action?: ReactNode
  /** Extra time left out of a shift that IS claimed: it is not counted as a left-out shift, and the footer says the shift was claimed. */
  extraTime?: boolean
}

/** The footer of a shift claim's left-out list: the shifts stay waiting. */
export const SHIFT_LEFT_OUT_FOOTER = 'They stay completed and unclaimed. Nothing here is billed for them.'

export const EXTRA_TIME_LEFT_OUT_HEADING = 'Extra time left out'
export const EXTRA_TIME_LEFT_OUT_FOOTER = 'The shifts are claimed at their held hours. Add the extra time as a manual claim if the budget allows.'

/** What a claim leaves out and why: the same warning in the shift claim and the trip claim, so nothing is dropped silently. Callers count whole shifts only in `heading`; extra-time entries change the wording when they are all there is. */
export function LeftOutCallout({ items, heading, footer }: { items: LeftOutItem[]; heading: string; footer: string }) {
  const extraOnly = items.length > 0 && items.every(item => item.extraTime)
  const someExtra = !extraOnly && items.some(item => item.extraTime)
  return (
    <Callout tone="warning">
      <p className="font-medium">{extraOnly ? EXTRA_TIME_LEFT_OUT_HEADING : heading}</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {items.map(item => (
          <li key={item.key} className="break-words">
            {item.lead != null && <>{item.lead} · </>}{item.description} · {noBreakRefs(item.reason)}{item.action != null && <> · {item.action}</>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px]">{extraOnly ? EXTRA_TIME_LEFT_OUT_FOOTER : someExtra ? `${footer} A shift whose extra time is left out is claimed at its held hours.` : footer}</p>
    </Callout>
  )
}
