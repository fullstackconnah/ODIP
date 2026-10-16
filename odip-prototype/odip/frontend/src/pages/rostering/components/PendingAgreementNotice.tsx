import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { Hourglass } from 'lucide-react'
import type { PendingAgreementDto } from '@/api/types'
import { Callout } from '@/components/Callout'

/** Names past this many become "and N more"; those with a row are marked in it (the brief, section 6). */
const NAMED = 3

/**
 * Why agreed shifts are missing (spec 2026-10-15, decision A; L10). Shifts from a service agreement appear once it is approved for rostering and the week is started (2026-10-16), and these participants' newest agreements are
 * not approved. Each name opens that agreement.
 * - A participant whose services have not started has no row and gets no shifts even once approved. The notice says so after their name, in parentheses so the list's commas stay clear (L12), and in one more sentence.
 * - It is a standing explanation, not news: no live role (announce false), and it cannot be dismissed, because it stays true until somebody acts.
 */
export function PendingAgreementNotice({ waiting }: { waiting: PendingAgreementDto[] }) {
  const items = [
    ...waiting.slice(0, NAMED).map(p => (
      <Fragment key={p.participantId}>
        <Link to={`/participants/${p.participantId}/agreement-draft`} aria-label={`${p.displayName} v${p.version}: open the service agreement`} className="font-medium text-primary hover:underline">
          {p.displayName} v{p.version}
        </Link>
        {p.canReceiveServices ? null : ' (not active yet)'}
      </Fragment>
    )),
    ...(waiting.length > NAMED ? [`${waiting.length - NAMED} more`] : []),
  ]
  return (
    <Callout tone="info" icon={Hourglass} announce={false}>
      {"Shifts from a service agreement appear here once it's approved for rostering and the week is started. Waiting: "}
      {/* "A", "A and B", "A, B and C": no serial comma (DESIGN.md, Attention band). */}
      {items.map((item, i) => <Fragment key={i}>{i === 0 ? null : i === items.length - 1 ? ' and ' : ', '}{item}</Fragment>)}
      .
      {waiting.some(p => !p.canReceiveServices) && " Start a participant's services before their agreement's shifts can be rostered."}
    </Callout>
  )
}
