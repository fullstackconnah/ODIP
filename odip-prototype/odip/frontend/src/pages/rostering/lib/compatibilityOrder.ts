import type { CompatibilityLevel } from '@/api/types'

/** The tiers a coordinator orders by hand: Preferred, then Backup, then Emergency. */
export const RANKED_LEVELS = ['Preferred', 'Backup', 'Emergency'] as const satisfies readonly CompatibilityLevel[]

const TIER: Record<CompatibilityLevel, number> = { Preferred: 0, Backup: 1, Emergency: 2, Allowed: 3, Excluded: 4 }

/** 0 Preferred, 1 Backup, 2 Emergency, 3 unlisted (Allowed, or no row), 4 No (Excluded). */
export const compatibilityTier = (level?: CompatibilityLevel): number => (level ? TIER[level] : 3)

type Keyed = { level?: CompatibilityLevel; rank?: number; name: string }

/** Mirrors the server's CompatibilityOrder: tier, then rank (0 or less goes last in its tier), then name. */
export function compareCompatibility(a: Keyed, b: Keyed): number {
  const byTier = compatibilityTier(a.level) - compatibilityTier(b.level)
  if (byTier !== 0) return byTier
  const rank = (k: Keyed) => (k.rank && k.rank > 0 ? k.rank : Number.MAX_SAFE_INTEGER)
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()]
  return x < y ? -1 : x > y ? 1 : 0
}
