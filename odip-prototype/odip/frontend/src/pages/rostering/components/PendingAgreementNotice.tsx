import { Link } from 'react-router-dom'
import type { PendingAgreementDto } from '@/api/types'
import { SlideOver } from '@/components/SlideOver'

/**
 * Why agreed shifts are missing (spec 2026-10-15, decision A; L10), behind the status line's "N agreements waiting" button (roster declutter, 2026-11-03). Shifts from a service agreement appear once it is approved for rostering and the
 * week is started (2026-10-16), and these participants' newest agreements are not approved. Each name opens that agreement, one per line.
 * - A participant whose services have not started has no row and gets no shifts even once approved. The panel says so after their name and in one more sentence.
 * - The page mounts it only while open, as ExceptionsDrawer.
 */
export function PendingAgreementsPanel({ waiting, onClose }: { waiting: PendingAgreementDto[]; onClose: () => void }) {
  return (
    <SlideOver open onClose={onClose} title="Agreements waiting for approval">
      <p className="text-sm text-muted-foreground">Shifts from a service agreement appear on the board once it's approved for rostering.</p>
      <ul className="mt-3 space-y-2 text-sm">
        {waiting.map(p => (
          <li key={p.participantId}>
            <Link to={`/participants/${p.participantId}/agreement-draft`} aria-label={`${p.displayName} v${p.version}: open the service agreement`} className="font-medium text-primary hover:underline">
              {p.displayName} v{p.version}
            </Link>
            {p.canReceiveServices ? null : ' (not active yet)'}
          </li>
        ))}
      </ul>
      {waiting.some(p => !p.canReceiveServices) && <p className="mt-3 text-sm text-muted-foreground">Start a participant's services before their agreement's shifts can be rostered.</p>}
    </SlideOver>
  )
}
