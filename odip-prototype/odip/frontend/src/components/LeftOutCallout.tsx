import type { ReactNode } from 'react'
import { Callout } from '@/components/Callout'

export interface LeftOutItem {
  key: string
  /** What leads the line (a shift's date); a trip claim has none. */
  lead?: ReactNode
  description: string
  reason: string
}

/** The footer of a shift claim's left-out list: the shifts stay waiting. */
export const SHIFT_LEFT_OUT_FOOTER = 'They stay completed and unclaimed. Nothing here is billed for them.'

/** What a claim leaves out and why: the same warning in the shift claim and the trip claim, so nothing is dropped silently. */
export function LeftOutCallout({ items, heading, footer }: { items: LeftOutItem[]; heading: string; footer: string }) {
  return (
    <Callout tone="warning">
      <p className="font-medium">{heading}</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {items.map(item => (
          <li key={item.key} className="break-words">
            {item.lead != null && <>{item.lead} · </>}{item.description} · {item.reason}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px]">{footer}</p>
    </Callout>
  )
}
