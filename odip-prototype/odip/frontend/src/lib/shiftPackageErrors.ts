import type { AdministrationDto, PortalFinishBlockerDto, PortalShiftDetailDto } from '@/api/types'
import { SHIFT_PACKAGE_ERROR_CODES } from '@/api/types'

/**
 * Helpers for reading a FAILED shift-package call. A failed request rejects with an axios error whose `response.data` is the
 * server's ApiResponse envelope: `{ success: false, errors, code, data }`. The package relies on three things in it:
 *  - `code`   — a machine-readable reason (SHIFT_PACKAGE_ERROR_CODES) so the UI branches on the kind, not on message text;
 *  - `errors` — plain-language messages, safe to show;
 *  - `data`   — sometimes a payload worth using: the refreshed shift detail on 422 SHIFT_FINISH_BLOCKED and 409
 *               SHIFT_HANDOVER_CHANGED, the EXISTING record on 409 ADMINISTRATION_ALREADY_RECORDED.
 *
 * One failure does NOT use the envelope: a request the framework rejects before the action runs (a handover note over its 2000-character limit,
 * say) is an ASP.NET `ValidationProblemDetails` 400 with no `success` and no `code`, where `errors` is an OBJECT keyed by field name
 * (`{ HandoverText: ['The field HandoverText must be ...'] }`), not a list. `apiErrorMessages` reads both shapes.
 */
interface ApiErrorBody<T = unknown> {
  success?: boolean
  code?: string | null
  /** The envelope's list of messages, or the framework's object of messages keyed by field name. */
  errors?: string[] | Record<string, string[] | string> | null
  message?: string | null
  data?: T | null
}

function bodyOf<T = unknown>(error: unknown): ApiErrorBody<T> | undefined {
  const response = (error as { response?: { data?: ApiErrorBody<T> } } | null | undefined)?.response
  return response?.data
}

/** HTTP status of a failed call, or undefined for a network failure (no response). */
export function apiErrorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null | undefined)?.response?.status
}

/** The machine-readable `code` of a failed call (see SHIFT_PACKAGE_ERROR_CODES), or undefined. */
export function apiErrorCode(error: unknown): string | undefined {
  return bodyOf(error)?.code ?? undefined
}

/**
 * Every plain-language message the server returned (empty when there is none). Reads the envelope's `errors` list, the framework's
 * ValidationProblemDetails `errors` object (every field's messages, in the order the server sent them), and falls back to the top-level `message`.
 */
export function apiErrorMessages(error: unknown): string[] {
  const body = bodyOf(error)
  const errors = body?.errors
  if (Array.isArray(errors)) {
    if (errors.length) return errors
  } else if (errors && typeof errors === 'object') {
    const messages = Object.values(errors)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((message): message is string => typeof message === 'string' && message.length > 0)
    if (messages.length) return messages
  }
  return body?.message ? [body.message] : []
}

/** True when the failed call carries this `code`. */
export function hasApiErrorCode(error: unknown, code: string): boolean {
  return apiErrorCode(error) === code
}

/** Finish rejected with 422 SHIFT_FINISH_BLOCKED: the list of what must be cleared first (empty for any other error). */
export function finishBlockersFromError(error: unknown): PortalFinishBlockerDto[] {
  if (!hasApiErrorCode(error, SHIFT_PACKAGE_ERROR_CODES.finishBlocked)) return []
  return bodyOf<PortalShiftDetailDto>(error)?.data?.finishBlockers ?? []
}

/** The refreshed shift detail a 422 SHIFT_FINISH_BLOCKED or 409 SHIFT_HANDOVER_CHANGED carries, to replace the cached one. */
export function shiftDetailFromError(error: unknown): PortalShiftDetailDto | undefined {
  const code = apiErrorCode(error)
  if (code !== SHIFT_PACKAGE_ERROR_CODES.finishBlocked && code !== SHIFT_PACKAGE_ERROR_CODES.handoverChanged) return undefined
  return bodyOf<PortalShiftDetailDto>(error)?.data ?? undefined
}

/** A dose that was already recorded (409 ADMINISTRATION_ALREADY_RECORDED): the EXISTING record, so the UI can say who recorded it. */
export function existingAdministrationFromError(error: unknown): AdministrationDto | undefined {
  if (!hasApiErrorCode(error, SHIFT_PACKAGE_ERROR_CODES.administrationAlreadyRecorded)) return undefined
  return bodyOf<AdministrationDto>(error)?.data ?? undefined
}

/**
 * A dose time the server refused (422): charted more than 60 minutes before its slot (ADMINISTRATION_TOO_EARLY), or an `administeredAt`
 * outside [the earliest the shift allows, now + 15 min] (ADMINISTRATION_TIME_OUT_OF_RANGE). The message says what to change; the dose can be sent again once the
 * time is fixed (or, for too early, once the slot is within the hour).
 */
export function isDoseTimeError(error: unknown): boolean {
  const code = apiErrorCode(error)
  return apiErrorStatus(error) === 422
    && (code === SHIFT_PACKAGE_ERROR_CODES.administrationTooEarly || code === SHIFT_PACKAGE_ERROR_CODES.administrationTimeOutOfRange)
}

/** The worker has no current Medication Competency (403 MEDICATION_COMPETENCY_*): a permission problem, not a retryable one. */
export function isCompetencyError(error: unknown): boolean {
  const code = apiErrorCode(error)
  return apiErrorStatus(error) === 403
    && (code === SHIFT_PACKAGE_ERROR_CODES.competencyMissing
      || code === SHIFT_PACKAGE_ERROR_CODES.competencyExpired
      || code === SHIFT_PACKAGE_ERROR_CODES.competencyUnverifiable)
}
