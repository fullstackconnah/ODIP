import type { AxiosError } from 'axios'

/** The HTTP status of a failed API call, or `undefined` when the error is not a response (a network failure, a thrown string, nothing at all). */
export function httpStatusOf(error: unknown): number | undefined {
  return (error as AxiosError | null | undefined)?.response?.status
}

/**
 * True when the API answered 404, which for a record's own page means "there is no such record", not "the request failed". The detail
 * endpoints return 404 for an unknown id (`NotFound(... "Trip not found")`), react-query reports it as an error, and `PageState` has to
 * tell it apart from a 500 or a dropped connection, where "Try again" is the right offer.
 */
export function isNotFoundError(error: unknown): boolean {
  return httpStatusOf(error) === 404
}
