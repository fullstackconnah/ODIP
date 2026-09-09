import type { PagedResult } from '../types'

/**
 * A plain array carrying two extra properties so that a `PagedResult`-backed hook can keep
 * returning "just an array" (every existing call site destructures one, e.g.
 * `const { data: participants = [] } = useParticipants()`) while still letting a caller that
 * cares — e.g. `ParticipantPicker` — check whether the list was truncated to the server's
 * page-size ceiling. Chosen over a companion hook: dozens of tests mock the `@/api/hooks` barrel
 * wholesale, so any component calling a new hook would need every one of those mocks updated to
 * define it or it throws. Extra properties on the same returned array break nothing that doesn't
 * opt in to reading them.
 */
export type TruncatableList<T> = T[] & { totalCount: number; isTruncated: boolean }

export function toTruncatableList<T>(result: PagedResult<T>): TruncatableList<T> {
  // Copy rather than mutate `result.items` in place — the source array may be reused elsewhere
  // (e.g. by the caller that built the mocked/deserialized response), and this hook has no
  // business changing it out from under them.
  const list = [...result.items] as TruncatableList<T>
  list.totalCount = result.totalCount
  list.isTruncated = result.items.length < result.totalCount
  return list
}
