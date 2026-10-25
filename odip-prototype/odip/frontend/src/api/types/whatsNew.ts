/** One release note, GET api/v1/whats-new. `title` and `body` are plain text written by Bunya Support: render them as text, never as HTML. */
export interface WhatsNewEntry {
  id: string
  title: string
  body: string
  important: boolean
  publishedAtUtc: string
}

/** GET api/v1/whats-new: the caller's entries newest first (at most 50), how many are unread, and the important unread ones for the pop-up. */
export interface WhatsNewFeed {
  entries: WhatsNewEntry[]
  unreadCount: number
  popup: WhatsNewEntry[]
}

export type WhatsNewRole = 'Admin' | 'Coordinator' | 'SupportWorker' | 'ReadOnly'

/** One row of GET api/v1/admin/whats-new. The API omits nulls, so `archivedAtUtc` is absent on live rows: test it with `!!row.archivedAtUtc`. */
export interface AdminWhatsNewEntry extends WhatsNewEntry {
  key: string
  roles: WhatsNewRole[]
  archivedAtUtc?: string
  updatedAt: string
}

/** POST / PUT api/v1/admin/whats-new. */
export interface SaveWhatsNewEntry {
  title: string
  body: string
  roles: WhatsNewRole[]
  important: boolean
}
