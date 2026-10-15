/** The field errors of a ValidationProblemDetails answer, keyed by field ("signedOn", "startsAt"): the first message of each. */
export function fieldErrors(error: unknown): Record<string, string | undefined> {
  const errors = (error as { response?: { data?: { errors?: unknown } } } | null)?.response?.data?.errors
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return {}
  return Object.fromEntries(Object.entries(errors as Record<string, string[]>).map(([key, messages]) => [key, messages?.[0]]))
}
