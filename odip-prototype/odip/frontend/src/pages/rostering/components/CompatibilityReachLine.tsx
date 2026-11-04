import { Link } from 'react-router-dom'
import { useSettings } from '@/api/hooks'

const FREELY = [
  'Auto-roster places Preferred staff freely.',
  'Auto-roster places Preferred and Backup staff freely.',
  'Auto-roster places Preferred, Backup and Emergency staff freely.',
  'Auto-roster can place anyone not marked No.',
]

/**
 * How far down the tiers auto-roster places staff without a look (Settings > Rostering rules). Reads the setting, so every role that can open the board sees it;
 * only an Admin gets the "Change" link. Until the setting loads it says the shipped sentence, never a stricter claim.
 */
export function CompatibilityReachLine({ canChange }: { canChange: boolean }) {
  const raw = useSettings().data?.autoRosterReach ?? 3
  const reach = Math.min(3, Math.max(0, raw))
  return (
    <p className="text-sm text-[var(--color-muted-foreground)]">
      {FREELY[reach]}
      {reach < 3 && ' Anyone else it suggests, including staff not listed here, waits for you to look.'}
      {canChange && <> <Link to="/settings?section=rostering" className="whitespace-nowrap font-medium text-[var(--color-primary)] underline underline-offset-2">Change</Link></>}
    </p>
  )
}
