import type { AgreementShareRowDto } from '@/api/types'

/**
 * The link worth telling the person about: the newest send that went (no error) and was not revoked. A send that failed was never a link, and a revoked one (replaced, or its revision
 * approved) no longer opens, so neither is shown. The list is newest first.
 */
export const liveShare = (shares: AgreementShareRowDto[]) => shares.find(row => !row.sendError && !row.revokedAt)

export const shareExpired = (row: AgreementShareRowDto) => new Date(row.expiresAt).getTime() <= Date.now()
