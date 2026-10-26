import type { ScalarGroupKey } from '@/api/types/participant-patch'
import { apiErrorCode, apiErrorStatus, apiErrorData } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'

export const SECTION_CHANGED = 'participant-section-changed'

/** The 409 PATCH /participants/{id} answers when a section moved since the editor opened it. */
export const isSectionChanged = (err: unknown) => apiErrorStatus(err) === 409 && apiErrorCode(err) === SECTION_CHANGED

/** The current revisions the 409 carries (empty when it carries none). */
export const sectionChangedRevisions = (err: unknown): Partial<Record<ScalarGroupKey, number>> =>
  apiErrorData<{ groupRevisions?: Partial<Record<ScalarGroupKey, number>> }>(err)?.groupRevisions ?? {}

/** The section-changed 409 travels to SectionEditPanel intact; anything else keeps the section's own message. */
export function rethrowSectionError(err: unknown, fallback: string): never {
  throw isSectionChanged(err) ? err : new Error(extractErrorMessage(err, fallback))
}
