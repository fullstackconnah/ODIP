import type { ReactNode } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import type { AgreementIssue } from '@/lib/agreementIssues'
import { joinList } from '@/lib/format'

type SaveStepProps = {
  /** Somebody who may not change agreements: the step offers the PDF and nothing else. */
  readOnly: boolean
  /** The newest save was approved for rostering and nobody has started a new revision. */
  locked: boolean
  /** Something has been saved for this participant. */
  hasSaved: boolean
  /** The schedule on screen has changes nobody has saved. */
  dirty: boolean
  /** What the last save said when it did not go through, and what it said when it did. */
  notices: ReactNode
  saved: string | null
  /** What must be fixed before it can be saved: the Check step's `fix` items. */
  blocking: AgreementIssue[]
  onGoToCheck: () => void
  history: string[]
  onDownload: () => void
  downloading: boolean
  downloadFailed: boolean
  /** Undefined when the agreement cannot be approved from here (nothing saved, already approved, a role that may not). */
  approval?: { mayApprove: boolean; approverRoles?: string[]; notReady: boolean; onOpen: () => void }
  /** From onboarding: confirms the saved service needs. Undefined anywhere else. */
  onboarding?: { onConfirm: () => void; pending: boolean; done: boolean; failed: boolean }
}

const SECTION = 'flex flex-col gap-2'

/**
 * Step 4: save, get the one PDF, hand the agreement to rostering. The footer holds Save; this step says what saving did and what comes next. Approval is "Mark approved for rostering" (its
 * dialog carries the budget warnings of phase 3); it needs a saved agreement with no unsaved changes. Nothing here signs anything.
 */
export function SaveStep({ readOnly, locked, hasSaved, dirty, notices, saved, blocking, onGoToCheck, history, onDownload, downloading, downloadFailed, approval, onboarding }: SaveStepProps) {
  return (
    <div className="flex max-w-4xl flex-col gap-[var(--section-gap)]">
      {notices}
      {blocking.length > 0 && !readOnly && !locked && (
        <Callout tone="warning" className="max-w-prose" title="Fix these before saving" actions={<Button variant="secondary" size="sm" onClick={onGoToCheck}>Go to Check</Button>}>
          <ul className="list-disc pl-5">{blocking.map(issue => <li key={issue.key}>{issue.title}</li>)}</ul>
        </Callout>
      )}
      <div role="status" className="text-sm">
        {saved && <p className="font-medium">{saved}</p>}
        {!readOnly && !locked && dirty && hasSaved && <p id="save-unsaved" className="text-[var(--color-muted-foreground)]">You have changes that are not saved. Save the agreement first: the PDF and the approval are of the saved agreement.</p>}
        {!readOnly && !locked && !hasSaved && blocking.length === 0 && <p className="text-[var(--color-muted-foreground)]">Save the agreement to get its PDF and to approve it.</p>}
      </div>

      {hasSaved && (
        <section aria-labelledby="save-pdf" className={SECTION}>
          <h3 id="save-pdf" className="text-sm font-semibold">Agreement PDF</h3>
          <p className="text-[13px] text-[var(--color-muted-foreground)]">The weekly schedule and what it costs.</p>
          <p className="flex gap-2 text-xs text-[var(--color-muted-foreground)]"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" /> Draft PDFs are informational only — not signed and not billing authority.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={onDownload} disabled={downloading || dirty} aria-describedby={dirty ? 'save-unsaved' : undefined}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}Download agreement PDF
            </Button>
          </div>
          {downloadFailed && <Callout tone="error" className="max-w-prose">Could not download the PDF. Try again.</Callout>}
        </section>
      )}

      {approval && (
        <section aria-labelledby="save-approve" className={SECTION}>
          <h3 id="save-approve" className="text-sm font-semibold">Rostering</h3>
          {approval.mayApprove ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant={approval.notReady ? 'secondary' : 'primary'} onClick={approval.onOpen} disabled={dirty} aria-describedby={dirty ? 'save-unsaved' : undefined}>Mark approved for rostering</Button>
              {dirty
                ? null
                : approval.notReady
                  ? <p className="text-sm text-[var(--color-on-warning-container)]">Not ready yet: some lines need fixing or a decision. Select to see which.</p>
                  : <p className="text-[13px] text-[var(--color-muted-foreground)]">Makes this schedule&apos;s weekly roster patterns and unfilled shifts. Separate from signing.</p>}
            </div>
          ) : approval.approverRoles && (
            <p className="text-sm text-[var(--color-muted-foreground)]">Your organisation lets only {joinList(approval.approverRoles)} approve agreements.</p>
          )}
        </section>
      )}

      {onboarding && !readOnly && hasSaved && (
        <section aria-labelledby="save-onboarding" className={SECTION}>
          <h3 id="save-onboarding" className="text-sm font-semibold">Onboarding</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={onboarding.onConfirm} disabled={onboarding.pending || dirty}>{onboarding.pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Confirm service needs</Button>
            {onboarding.done && <p role="status" className="text-sm font-medium">Service needs confirmed.</p>}
            {onboarding.failed && <p role="alert" className="text-sm text-[var(--color-destructive)]">Could not confirm. Check that the saved agreement sits inside the NDIS plan dates, then try again.</p>}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="save-history" className={SECTION}>
          <h3 id="save-history" className="text-sm font-semibold">History</h3>
          <ul className="flex flex-col gap-0.5 text-sm">{history.map(line => <li key={line}>{line}</li>)}</ul>
        </section>
      )}
    </div>
  )
}
