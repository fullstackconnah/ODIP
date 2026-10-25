import type { WhatsNewRole } from '@/api/types'
import { formatWithTimeZone } from '@/lib/utils'

/** `25 Oct 2026`, in Sydney time. en-AU prints September as "Sept": no test may hard-code a September date. */
export const formatWhatsNewDate = (iso: string) => formatWithTimeZone(iso, 'Australia/Sydney', { day: 'numeric', month: 'short', year: 'numeric' })

/** House order: the order the roles are saved and listed in. */
export const WHATS_NEW_ROLES: { role: WhatsNewRole; label: string }[] = [
  { role: 'Admin', label: 'Admin' },
  { role: 'Coordinator', label: 'Coordinator' },
  { role: 'SupportWorker', label: 'Support worker' },
  { role: 'ReadOnly', label: 'Read-only' },
]
