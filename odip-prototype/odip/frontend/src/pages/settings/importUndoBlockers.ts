import type { ImportUndoBlockerDto } from '@/api/types'

/** A 409 from POST /imports/{id}/undo carries the records that changed since the import in its `data`. */
export function undoBlockers(err: unknown): ImportUndoBlockerDto[] {
  const data = (err as { response?: { data?: { data?: unknown } } } | null)?.response?.data?.data
  return Array.isArray(data) ? (data as ImportUndoBlockerDto[]) : []
}

/** Plans hold their participants (ImportUntouched's "has a funding plan"), so a refused participants undo says which undo goes first. */
export const undoFirst = (blockers: ImportUndoBlockerDto[]) =>
  blockers.some(b => b.reason === 'has a funding plan') ? 'Undo the funding plans import first, then undo this one.' : null
