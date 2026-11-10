import type { CompatibilityLevel, CompatibilityRowDto } from '@/api/types'
import type { DropdownItem } from '@/components/Dropdown'

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

/** "Backup #2" for a ranked tier, the bare level for an unranked one. */
export const tierPlace = (level: string, rank: number) => (rank > 0 ? `${level} #${rank}` : level)

/**
 * The items of a worker picker for one participant (the shift's Staff, the pattern's Regular): a ranked worker says where they stand, a worker marked No is greyed out and says why,
 * and the order is the one above with the caller's own order kept inside a tier. keepStaffId, the worker already on the record, stays pickable so the field keeps showing them;
 * the server still lets the record be reassigned, unassigned or cancelled.
 */
export function compatibleStaffItems(staffOptions: { value: string; label: string }[], rows: CompatibilityRowDto[], keepStaffId?: string | null): DropdownItem[] {
  const byStaffId = new Map(rows.map(row => [row.staffId, row]))
  return staffOptions
    .map(option => {
      const compat = byStaffId.get(option.value)
      const level = compat?.level
      return {
        ...option,
        description: compat && (level === 'Preferred' || level === 'Backup' || level === 'Emergency') ? `${tierPlace(level, compat.rank)} for this participant`
          : level === 'Excluded' ? 'Can’t be rostered: marked No for this participant'
          : undefined,
        disabled: (level === 'Excluded' && option.value !== keepStaffId),
      }
    })
    .sort((a, b) => compareCompatibility({ ...byStaffId.get(a.value), name: '' }, { ...byStaffId.get(b.value), name: '' }))
}
