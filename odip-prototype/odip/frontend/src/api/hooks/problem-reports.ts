import { useMutation } from '@tanstack/react-query'
import { apiPost } from '../client'

// ══════════════════════════════════════════════════════════════
// REPORT A PROBLEM — mirrors ProblemReportsController (api/v1/problem-reports)
// ══════════════════════════════════════════════════════════════

/** All the browser sends; the server adds the reporter, organisation and browser itself. */
export type ProblemReportBody = { text: string; pagePath: string; appVersion: string }

/** `Sent`: the Work Board card exists. `Saved`: the note is kept and goes out shortly. */
export type ProblemReportCreated = { id: string; status: 'Sent' | 'Saved' }

export function useSendProblemReport() {
  return useMutation({
    mutationFn: (body: ProblemReportBody) => apiPost<ProblemReportCreated>('/problem-reports', body),
  })
}
