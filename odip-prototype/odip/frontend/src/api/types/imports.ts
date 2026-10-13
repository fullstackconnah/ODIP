// Settings → Import data (ImportsController). Shapes follow Odip.Application/DTOs/ImportDTOs.cs.
import type { FirebaseAccountState } from './users'

export type ImportKind = 'participants' | 'staff'
export type ImportLanding = 'Active' | 'Onboarding'
export type ImportRowStatus = 'Ready' | 'Skipped' | 'Invalid'

export interface ImportFieldDto { key: string; label: string; required: boolean }
export interface ImportColumnDto { index: number; header: string; field: string | null; note: string | null }
export interface ImportRowDto { rowNumber: number; name: string; status: ImportRowStatus; reasons: string[]; warnings: string[]; skipReason: string | null }

export interface ImportPreviewDto {
  fields: ImportFieldDto[]
  columns: ImportColumnDto[]
  rows: ImportRowDto[]
  readyCount: number
  skippedCount: number
  invalidCount: number
  previouslyImportedAt: string | null
}

export interface ImportResultDto { batchId: string; createdCount: number; skippedCount: number; failedCount: number; rows: ImportRowDto[]; replayed: boolean }

export interface ImportBatchDto {
  id: string
  kind: 'Participants' | 'Staff'
  fileName: string
  createdByName: string
  createdAt: string
  rowCount: number
  createdCount: number
  skippedCount: number
  failedCount: number
  undoneAt: string | null
  undoneByName: string | null
}

export interface ImportUndoBlockerDto { entityId: string; name: string; reason: string }

/** One staff member's sign-in invite: the account made or found, or why there is none (the server's own sentence). */
export interface ImportInviteDto { staffId: string; name: string; email: string; firebaseAccount: FirebaseAccountState | null; error: string | null }

/** One press of Send sign-in invites (at most 100 people) and how many never-signed-in staff are still after them. */
export interface ImportInvitesDto { invites: ImportInviteDto[]; left: number }
