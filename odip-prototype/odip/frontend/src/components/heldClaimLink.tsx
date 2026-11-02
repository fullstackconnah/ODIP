import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TAP_AREA } from '@/components/tapArea'

/** The "Open {ref}" link of a shift held by a rejected or cancelled claim, where Claim again is; nothing for any other row. Keyed on the id the server sends, never on the sentence. */
export function heldClaimLink(row: { heldByClaimId?: string | null; heldByClaimReference?: string | null }): ReactNode {
  if (!row.heldByClaimId) return undefined
  return <Link to={`/claims/${row.heldByClaimId}`} className={`${TAP_AREA} whitespace-nowrap text-[var(--color-primary)] hover:underline`}>Open {row.heldByClaimReference ?? 'the claim'}</Link>
}
