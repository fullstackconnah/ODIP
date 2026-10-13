// Settings → Import data (ImportsController). Shapes follow Odip.Application/DTOs/ImportDTOs.cs.
export type ImportKind = 'participants'
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
  kind: 'Participants'
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
