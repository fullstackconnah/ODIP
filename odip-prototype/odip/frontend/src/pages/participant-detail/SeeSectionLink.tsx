import { Button } from '@/components/Button'
import type { ParticipantTabKey } from './participantTabs'

/**
 * A pointer to the one home of a fact shown elsewhere: "Edit in Identity" for someone who can edit it there, "See Identity" for anyone else.
 * A route link, so it works with the tab and hash contract (`?tab=` and `#section`).
 */
export function SeeSectionLink({ tab, hash, section, canEdit }: { tab: ParticipantTabKey; hash?: string; section: string; canEdit: boolean }) {
  return (
    <Button variant="ghost" size="sm" className="min-h-[var(--tap-min)]" to={`?tab=${tab}${hash ? `#${hash}` : ''}`}>
      {canEdit ? 'Edit in' : 'See'} {section}
    </Button>
  )
}
