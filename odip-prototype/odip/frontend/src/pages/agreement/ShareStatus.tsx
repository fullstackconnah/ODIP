import type { AgreementShareRowDto } from '@/api/types'
import { formatWithTimeZone } from '@/lib/utils'
import { liveShare, shareExpired } from './shareRows'

const day = (iso: string) => formatWithTimeZone(iso, undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** One line under the send button: who the link went to, when, and whether it has been opened (or that it has expired). */
export function ShareStatus({ shares }: { shares: AgreementShareRowDto[] }) {
  const row = liveShare(shares)
  if (!row) return null
  return (
    <p role="status" className="text-sm">
      {shareExpired(row)
        ? `The link sent to ${row.recipientName} on ${day(row.sentAt)} has expired.`
        : `Sent to ${row.recipientName} on ${day(row.sentAt)} · ${row.openedAt ? `opened ${day(row.openedAt)}` : 'not opened yet'}`}
    </p>
  )
}
