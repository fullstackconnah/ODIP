/** One alpha sign-up from the landing page (GET /admin/early-access, SuperAdmin only). Optional answers are absent when not given. */
export interface EarlyAccessSignupDto {
  id: string
  name: string
  organisation: string
  email: string
  role?: string
  phone?: string
  /** A key of ORGANISATION_SIZE_LABELS; absent when not given (the old form asked no size), shown as "Not given". */
  organisationSize?: string
  message?: string
  createdAtUtc: string
  lastRequestedAtUtc: string
  requestCount: number
  /** Repeat sign-ups whose answers differed from the ones above, newest last; the server keeps the first 10. */
  laterSubmissions: EarlyAccessLaterSubmissionDto[]
  /** Distinct repeats sent after those 10 were full. Only the newest is kept, in lastOverLimit. */
  overLimitCount: number
  lastOverLimit?: EarlyAccessLaterSubmissionDto
}

/** What a repeat sign-up said. The stored sign-up keeps its first answers; the tab shows only the fields here that differ from them. */
export interface EarlyAccessLaterSubmissionDto {
  id: string
  receivedAtUtc: string
  name: string
  organisation: string
  role?: string
  phone?: string
  organisationSize?: string
  message?: string
}

/** The landing form's size bands (SHAPE §6) as the API stores them, with the words the form shows. */
export const ORGANISATION_SIZE_LABELS: Record<string, string> = {
  'under-10': 'Fewer than 10 staff',
  '10-49': '10 to 49 staff',
  '50-199': '50 to 199 staff',
  '200-plus': '200 staff or more',
}
