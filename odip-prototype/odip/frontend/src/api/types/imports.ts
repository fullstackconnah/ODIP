// Settings → Import data (ImportsController). Shapes follow Odip.Application/DTOs/ImportDTOs.cs.
import type { FirebaseAccountState } from './users'

export type ImportKind = 'participants' | 'staff' | 'funding-plans' | 'upcoming-shifts'
/** What an upcoming-shifts file holds: one dated row per shift, or a weekly pattern repeated over a span. */
export type ImportShiftShape = 'dated' | 'pattern'
export type ImportLanding = 'Active' | 'Onboarding'
export type ImportRowStatus = 'Ready' | 'Skipped' | 'Invalid'

export interface ImportFieldDto { key: string; label: string; required: boolean }
export interface ImportColumnDto { index: number; header: string; field: string | null; note: string | null }
/** One row's outcome. Warnings want a look before importing; notes only say what the row does; detail is what it will create (funding rows). */
export interface ImportRowDto { rowNumber: number; name: string; status: ImportRowStatus; reasons: string[]; warnings: string[]; notes: string[]; skipReason: string | null; detail: string | null }

export interface ImportPreviewDto {
  fields: ImportFieldDto[]
  columns: ImportColumnDto[]
  rows: ImportRowDto[]
  readyCount: number
  skippedCount: number
  invalidCount: number
  previouslyImportedAt: string | null
  /** What Import would create: the ready rows or, for funding plans, the plans they make (a plan is several rows). */
  createCount: number
  /** Upcoming shifts only (null for the other kinds): shifts with nobody on them, the span of the shifts made (yyyy-MM-dd, null when none), the weeks they touch, and whether the organisation enforces participant readiness. */
  unfilledCount?: number | null
  firstDate?: string | null
  lastDate?: string | null
  weekCount?: number | null
  readinessEnforced?: boolean
}

export interface ImportResultDto { batchId: string; createdCount: number; skippedCount: number; failedCount: number; rows: ImportRowDto[]; replayed: boolean
  /** Upcoming shifts: the Monday of the first week made (null when none). A replayed commit answers firstWeekStart only. */
  firstWeekStart?: string | null; weekCount?: number | null; unfilledCount?: number | null
}

export interface ImportBatchDto {
  id: string
  kind: 'Participants' | 'Staff' | 'FundingPlans' | 'UpcomingShifts'
  fileName: string
  createdByName: string
  createdAt: string
  rowCount: number
  createdCount: number
  skippedCount: number
  failedCount: number
  undoneAt: string | null
  undoneByName: string | null
  /** Upcoming shifts: how many shifts an undo left because they were published or changed (0 after a full undo, null before any undo). */
  keptCount?: number | null
}

export interface ImportUndoBlockerDto { entityId: string; name: string; reason: string }

/** One staff member's sign-in invite: the account made or found, or why there is none (the server's own sentence). */
export interface ImportInviteDto { staffId: string; name: string; email: string; firebaseAccount: FirebaseAccountState | null; error: string | null }

/** One press of Send sign-in invites (at most 100 people), how many never-signed-in staff are still after them, and the cursor for the next press. */
export interface ImportInvitesDto { invites: ImportInviteDto[]; left: number; next: string | null }
