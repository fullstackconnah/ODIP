import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useCompatibility, useParticipant } from '@/api/hooks'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { TAP_FLOOR } from '@/components/tapArea'
import { usePermissions } from '@/lib/permissions'
import { queryPhase } from '@/lib/queryPhase'
import { CompatibilityReachLine } from '@/pages/rostering/components/CompatibilityReachLine'
import { TierBoard } from '@/pages/rostering/components/TierBoard'

/**
 * Who this participant works best with, in order: the compatibility board in its compact form (same data and writes as the
 * Compatibility page, so the card, the page and the shift panel agree). "No" stays read-only here, because marking it needs the
 * reason dialog on the Compatibility page; the link goes there.
 */
export function StaffPreferencesCard({ participantId }: { participantId: string }) {
  const { canWrite, isAdmin } = usePermissions()
  const compat = useCompatibility(participantId)
  const participantName = useParticipant(participantId).data?.fullName ?? 'this participant'

  const phase = queryPhase(compat)
  if (phase === 'loading') return <Card title="Staff preferences"><PageState kind="loading" noun="staff preferences" /></Card>
  if (phase === 'error') return <Card title="Staff preferences"><PageState kind="error" noun="staff preferences" onRetry={() => compat.refetch()} /></Card>

  // A reader has no Add buttons, so an unlisted participant gets the sentence instead of four empty columns.
  const nothingToShow = !canWrite && (compat.data ?? []).length === 0

  return (
    <Card title="Staff preferences">
      <div className="space-y-4">
        {nothingToShow ? (
          <EmptyState icon={Users} size="inline" title="No staff preferences yet" description="No preferred, backup or emergency staff have been listed." />
        ) : (
          <TierBoard participantId={participantId} participantName={participantName} compact />
        )}
        <CompatibilityReachLine canChange={isAdmin} />
        <Link to={`/rostering/compatibility?participant=${participantId}`} className={`${TAP_FLOOR} text-sm text-[var(--color-primary)] hover:underline`}>
          Open on the Compatibility page
        </Link>
      </div>
    </Card>
  )
}
