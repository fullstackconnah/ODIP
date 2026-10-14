/** GET /data-export/last: the organisation's newest full export, or null when it has never been exported. */
export interface DataExportLastDto {
  /** An instant (UTC with Z): read it with parseApiDate or formatDateTimeAu. */
  exportedAt: string
  exportedByName: string | null
}

/** What a finished download saved. */
export interface DataExportSaved {
  fileName: string
  bytes: number
}

/** Why a download failed, in the words the tab shows (SHAPE section 3). */
export interface DataExportFailure {
  title: string
  body: string
}
