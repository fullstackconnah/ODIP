/** GET /data-retention/due: one archived participant whose 7 years have run out, with what a purge would delete. */
export interface RetentionDueDto {
  participantId: string
  firstName: string
  lastName: string
  /** Calendar dates (yyyy-MM-dd): read them with parseDateOnly, never as UTC instants. */
  startsOn: string
  /** True when the start was worked out from the change history (archived before archive dates were recorded). */
  startEstimated: boolean
  dueOn: string
  /** Rows per table the purge would delete, by table name. */
  rowCounts: Record<string, number>
}

/** POST /data-retention/{id}/purge: what stays after a purge (no name, no details). */
export interface PurgeRecordDto {
  id: string
  participantId: string
  confirmedByName: string
  confirmedAt: string
  reason: string
  retentionStartsOn: string
  retentionStartEstimated: boolean
  dueOn: string
  rowCounts: Record<string, number>
  claimBatchFilesCleared: number
}

export interface PurgeRequest {
  lastName: string
  reason: string
}
