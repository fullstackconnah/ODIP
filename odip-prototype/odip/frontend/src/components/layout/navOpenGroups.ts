import { NAV_GROUP_IDS } from '@/components/layout/navConfig'

const STORAGE_KEY = 'odip_nav_open_groups'

/**
 * The groups the user chose to keep open, from localStorage. A group id this build does not know (a group renamed or removed since
 * the layout was saved) is dropped, so an old saved layout can never break a newer menu. Storage that throws or holds junk reads as
 * "nothing saved": the menu still renders, with only the group that holds the current page open.
 */
export function readStoredOpenGroups(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && NAV_GROUP_IDS.has(id)) : [])
  } catch {
    return new Set()
  }
}

/**
 * Records that the user opened or closed one group. It changes what is STORED, not what this tab shows: a group that opened itself
 * because the current page is inside it was never a choice, and saving it would slowly leave every group open.
 */
export function storeGroupOpen(id: string, open: boolean): void {
  try {
    const stored = readStoredOpenGroups()
    if (open) stored.add(id)
    else stored.delete(id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...stored]))
  } catch {
    // Private browsing or a full quota: the group still toggles for this session.
  }
}
