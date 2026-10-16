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
}

/** The landing form's size bands (SHAPE §6) as the API stores them, with the words the form shows. */
export const ORGANISATION_SIZE_LABELS: Record<string, string> = {
  'under-10': 'Fewer than 10 staff',
  '10-49': '10 to 49 staff',
  '50-199': '50 to 199 staff',
  '200-plus': '200 staff or more',
}
