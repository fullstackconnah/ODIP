import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { NdiaRejection } from '@/api/types'
import { writtenDay } from '@/lib/fundingPlan'
import { TONE } from '@/lib/tone'

/**
 * The NDIA's own word that a pool has run out (budget phase 2b): a claim it refused for want of funds (V17, V18, V27 or V28). A provider cannot see a participant's budget in the NDIA's portal, so this
 * is the only direct sign. It is there on the pool the claim's lines belong to for as long as the funding period those lines fall in is the one running, and it carries no money: the figures beside it
 * are still ODIP's own.
 */
export function NdiaRejectionNote({ rejection }: { rejection: NdiaRejection }) {
  return (
    <p className={`mt-3 flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm ${TONE.danger.solid}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        NDIA rejected a claim on {writtenDay(rejection.date)}: not enough funds ({rejection.code}).{' '}
        <Link to={`/claims/${rejection.claimId}`} className="font-medium underline">Claim {rejection.claimReference}</Link>
      </span>
    </p>
  )
}
