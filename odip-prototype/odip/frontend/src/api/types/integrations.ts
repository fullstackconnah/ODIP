/** Settings → Integrations → Employment Hero. There is never an API-key field: the key is write-only. */
export type EmploymentHeroAttentionKind = 'NotLinked' | 'FixInEmploymentHero' | 'FixInOdip' | 'MissingFromEmploymentHero'

export interface EmploymentHeroAttentionDto {
  id: string
  kind: EmploymentHeroAttentionKind
  userId: string | null
  /** The EH employee the item is about or, on a NotLinked item, the same-name match to suggest. */
  employeeId: string | null
  name: string
  reason: string
}

export interface EmploymentHeroStatusDto {
  /** False when the server has no INTEGRATIONS_MASTER_KEY: connecting is refused. */
  configured: boolean
  connected: boolean
  businessId: string | null
  businessName: string | null
  connectedAt: string | null
  connectedByName: string | null
  lastSyncAt: string | null
  /** Why the last sync failed, in words for the Admin; null when it worked. */
  lastSyncError: string | null
  staffLinked: number
  staffNotLinked: number
  attention: EmploymentHeroAttentionDto[]
}

export interface EmploymentHeroBusinessDto { id: string; name: string }
/** addedBySync: linked to someone the sync added who has never signed in; Link moves the id to the chosen person and archives that duplicate. */
export interface EmploymentHeroEmployeeDto { id: string; name: string; email: string | null; addedBySync?: boolean }
