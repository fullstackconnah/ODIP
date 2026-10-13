import type { ImportUndoBlockerDto } from '@/api/types'

/** A 409 from POST /imports/{id}/undo carries the records that changed since the import in its `data`. */
export function undoBlockers(err: unknown): ImportUndoBlockerDto[] {
  const data = (err as { response?: { data?: { data?: unknown } } } | null)?.response?.data?.data
  return Array.isArray(data) ? (data as ImportUndoBlockerDto[]) : []
}
