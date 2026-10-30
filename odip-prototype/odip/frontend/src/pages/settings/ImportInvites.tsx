import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/Button'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Callout } from '@/components/Callout'
import { useImportInviteCount, useImportInvites, useRecordInvitesSent } from '@/api/hooks'
import { ChevronDown } from 'lucide-react'
import type { ImportInviteCountDto, ImportInviteDto } from '@/api/types'
import { CheckboxField } from '@/components/CheckboxField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { plural } from '@/lib/format'
import { describeEmailOutcome, sendSetPasswordEmailFor, type EmailOutcome } from '@/lib/signInEmail'
import { extractErrorMessage } from '@/lib/utils'

/** What a press of "Send sign-in invites" came to: one outcome per person, or the request's own refusal. */
export type InviteResult = { outcomes: EmailOutcome[]; left: number } | { problem: string }

const NO_INVITES = 'Everyone in this import has signed in or been invited, so no invites were sent.'

/** The one-line result of a finished run ("Sign-in invites: all 3 sent"), also what the auto run's live region announces. */
function inviteTitle(outcomes: EmailOutcome[], lead = 'Sign-in invites') {
  const failed = outcomes.filter(o => !o.ok).length
  return failed > 0 ? `${lead}: ${outcomes.length - failed} sent, ${failed} not sent` : `${lead}: all ${outcomes.length} sent`
}

/**
 * The invites' results as one Callout: failures first, each line naming the address (lib/signInEmail words it).
 * The staff import's own run (`auto`) keeps the sent lines behind "Show the {n} sent" so a long batch's failures are not lost in the list, puts
 * `afterFailures` (Try again) right under them, and leaves the announcing to its own live region.
 */
export function InviteResults({ result, fileName, auto, afterFailures }: { result: InviteResult; fileName?: string; auto?: boolean; afterFailures?: ReactNode }) {
  const lead = fileName ? `Sign-in invites for ${fileName}` : 'Sign-in invites'
  if ('problem' in result) return <Callout tone="error" title={`${lead}: not sent`}>{result.problem}</Callout>
  const { outcomes, left } = result
  const more = left > 0 && <p>{`${left} more still to invite: press Send sign-in invites again.`}</p>
  if (outcomes.length === 0) return <Callout tone="info" announce={!auto}>{NO_INVITES}</Callout>
  const failed = outcomes.filter(o => !o.ok)
  const sent = outcomes.filter(o => o.ok)
  const line = (o: EmailOutcome) => <li key={o.email} className="break-words">{describeEmailOutcome(o, auto ? null : 'use Send sign-in invites again').message}</li>
  return (
    <Callout tone={failed.length > 0 ? 'warning' : 'success'} title={inviteTitle(outcomes, lead)} announce={!auto}>
      {auto ? (
        <>
          {failed.length > 0 && <ul className="list-disc pl-5">{failed.map(line)}</ul>}
          {afterFailures}
          {sent.length > 0 && (
            <details className="group mt-1">
              <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-center gap-1 font-medium">{`Show the ${sent.length} sent`}<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
              <ul className="list-disc pl-5">{sent.map(line)}</ul>
            </details>
          )}
        </>
      ) : (
        <ul className="list-disc pl-5">{[...failed, ...sent].map(line)}</ul>
      )}
      {more}
    </Callout>
  )
}

// Auto mode runs once per import: the flag outlives a remount (the page re-rendering, the tab navigating back), so a second automatic run never starts.
const sentKey = (batchId: string) => `bunya-invites-sent:${batchId}`
const autoAlreadyRan = (batchId: string) => { try { return sessionStorage.getItem(sentKey(batchId)) !== null } catch { return true } }
const markAutoRan = (batchId: string) => { try { sessionStorage.setItem(sentKey(batchId), '1') } catch { /* the read side treats a blocked store as already run */ } }

type Resume = { queue: ImportInviteDto[]; cursor: { after: string; left: number } | null; first: boolean }

/** The staff import's own invites: sends every page without a press, pausing (not failing) when the email service asks us to slow down. */
function AutoInvites({ batchId, count, onSendingChange }: { batchId: string; count: number; onSendingChange?: (sending: boolean) => void }) {
  const invites = useImportInvites()
  const record = useRecordInvitesSent()
  const [phase, setPhase] = useState<'sending' | 'paused' | 'finished' | 'problem'>('sending')
  const [outcomes, setOutcomes] = useState<EmailOutcome[]>([])
  const [failedPeople, setFailedPeople] = useState<ImportInviteDto[]>([])
  // While "Try the n again" runs, the progress counts that batch (1 of 2), not the whole import.
  const [retrying, setRetrying] = useState<{ done: number; total: number } | null>(null)
  const [problem, setProblem] = useState('')
  const [left, setLeft] = useState(0)
  const resume = useRef<Resume>({ queue: [], cursor: null, first: true })
  const running = useRef(false)

  const emailFor = (person: ImportInviteDto): Promise<EmailOutcome> | EmailOutcome => person.firebaseAccount
    ? sendSetPasswordEmailFor(person.email, person.firebaseAccount)
    : { ok: false, email: person.email, reason: 'account', detail: person.error ?? undefined }

  async function run(from: Resume) {
    if (running.current) return
    running.current = true
    onSendingChange?.(true)
    setPhase('sending')
    let { queue, cursor, first } = from
    // Who was sent to since the last record call; recorded before each page is fetched and once when the run stops, however it stops.
    let sent: string[] = []
    const flush = () => { if (sent.length > 0) record.mutate(sent); sent = [] }
    try {
      for (;;) {
        if (queue.length === 0) {
          if (!first && !cursor) break
          flush()
          const page = await invites.mutateAsync(cursor ? { batchId, after: cursor.after } : { batchId })
          first = false
          queue = page.invites
          cursor = page.left > 0 && page.next ? { after: page.next, left: page.left } : null
          if (queue.length === 0) break
        }
        const person = queue[0]
        const outcome = await emailFor(person)
        if (!outcome.ok && outcome.reason === 'too-many-requests') {
          // The person stays at the head of what is held, so Send the rest tries them first.
          resume.current = { queue, cursor, first }
          setLeft(queue.length + (cursor?.left ?? 0))
          setPhase('paused')
          return
        }
        if (outcome.ok) sent.push(person.staffId)
        if (sent.length >= 10) flush() // a closed tab loses at most 10
        setOutcomes(o => [...o, outcome])
        if (!outcome.ok) setFailedPeople(f => [...f, person])
        queue = queue.slice(1)
      }
      resume.current = { queue: [], cursor: null, first: false }
      setPhase('finished')
    } catch (err) {
      resume.current = { queue, cursor, first }
      setProblem(extractErrorMessage(err, 'The invites could not be sent.'))
      setPhase('problem')
    } finally {
      flush()
      running.current = false
      onSendingChange?.(false)
    }
  }

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    markAutoRan(batchId)
    void run({ queue: [], cursor: null, first: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  // Only the failures that have an account can be sent again; the rest need their email fixed first.
  const retryable = failedPeople.filter(p => p.firebaseAccount)
  const needFix = failedPeople.length > retryable.length
  async function retryFailed() {
    if (running.current) return
    running.current = true
    onSendingChange?.(true)
    setPhase('sending')
    const next: EmailOutcome[] = []
    setRetrying({ done: 0, total: retryable.length })
    for (const person of retryable) {
      next.push(await sendSetPasswordEmailFor(person.email, person.firebaseAccount!))
      setRetrying({ done: next.length, total: retryable.length })
    }
    const again = new Set(retryable.map(p => p.email))
    const nowSent = retryable.filter((_, i) => next[i].ok).map(p => p.staffId)
    if (nowSent.length > 0) record.mutate(nowSent)
    setOutcomes(o => [...o.filter(x => !again.has(x.email)), ...next])
    setFailedPeople(f => f.filter(p => !p.firebaseAccount || next.some(n => !n.ok && n.email === p.email)))
    running.current = false
    onSendingChange?.(false)
    setRetrying(null)
    setPhase('finished')
  }

  // One live region for the whole run, mounted before the first line is written: the sending lines and the end are announced from here.
  const progress = `Sending sign-in invites: ${retrying?.done ?? outcomes.length} of ${retrying?.total ?? count}`
  const announcement = phase === 'sending' ? progress
    : phase === 'paused' ? `Sending paused: the email service asked us to slow down. ${left} still to invite.`
    : phase === 'finished' ? (outcomes.length === 0 ? NO_INVITES : inviteTitle(outcomes))
    : '' // a refused request is the error Callout's own alert

  return (
    <div className="flex flex-col gap-3">
      <AnnouncementRegion message={announcement} />
      {phase === 'sending' && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="tabular-nums">{progress}</p>
          <p className="text-[13px] text-[var(--color-muted-foreground)]">Keep this tab open until the invites finish.</p>
        </div>
      )}
      {phase === 'paused' && (
        <>
          <Callout tone="warning" announce={false}>{`Sending paused: the email service asked us to slow down. ${left} still to invite.`}</Callout>
          <div><Button variant="secondary" size="sm" onClick={() => void run(resume.current)}>{`Send the rest (${left})`}</Button></div>
        </>
      )}
      {phase === 'problem' && (
        <>
          <InviteResults result={{ problem }} />
          <div><Button variant="secondary" size="sm" onClick={() => void run(resume.current)}>Try again</Button></div>
        </>
      )}
      {phase === 'finished' && (
        <InviteResults
          result={{ outcomes, left: 0 }}
          auto
          afterFailures={retryable.length > 0 && (
            <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => void retryFailed()}>{`Try the ${retryable.length} again`}</Button></div>
          )}
        />
      )}
      {phase === 'finished' && needFix && <p className="text-[13px]">Fix their email on the Staff page, then send from Import history.</p>}
    </div>
  )
}

/**
 * The import's invites. With `auto` (the staff import) every page is sent on arrival, once per import; otherwise it is the Send sign-in invites button.
 */
export default function ImportInvites({ batchId, count, onResult, auto, onSendingChange }: {
  batchId: string; count: number; onResult?: (result: InviteResult) => void
  auto?: boolean; onSendingChange?: (sending: boolean) => void
}) {
  const [runsAuto] = useState(() => !!auto && !autoAlreadyRan(batchId))
  return runsAuto
    ? <AutoInvites batchId={batchId} count={count} onSendingChange={onSendingChange} />
    : <ManualInvites batchId={batchId} count={count} onResult={onResult} />
}

/** Most people one press sends (the server's page size); the confirm says so when more are waiting. */
const PAGE = 100

/**
 * "Send sign-in invites (N)" for an imported staff batch: a press asks first (how many are still to invite, how many were invited before and are
 * skipped unless asked), then the server makes sure each account exists (the Staff page's own step) and this browser asks Firebase for each
 * set-password email in turn. The results show under the button, or wherever `onResult` puts them (the Import history shows them above its
 * table, never inside a row). `count` is the fallback figure for while the true count loads or if it cannot be read.
 */
function ManualInvites({ batchId, count, onResult }: { batchId: string; count: number; onResult?: (result: InviteResult) => void }) {
  const invites = useImportInvites()
  const record = useRecordInvitesSent()
  const counts = useImportInviteCount(batchId)
  const c: ImportInviteCountDto | undefined = counts.data
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<InviteResult | null>(null)
  // Where the next press carries on (the server's cursor), how many are left, and whether it is the run that also re-sends to the invited. Null: start at the top.
  const [next, setNext] = useState<{ after: string; left: number; again: boolean } | null>(null)
  // The confirm reads the count as it was at the press, so a count arriving while it is open never changes its words.
  const [confirm, setConfirm] = useState<{ counted: ImportInviteCountDto | null } | null>(null)
  const [again, setAgain] = useState(false)

  const waiting = next?.left ?? c?.toInvite ?? count
  const nobodyLeft = !!c && !next && c.toInvite === 0 && c.invitedBefore === 0
  const cannotSentence = (k: number) => `${k} can't be invited: archived, or no email address.`

  function open() {
    setAgain(next?.again ?? false)
    setConfirm({ counted: c ?? null })
  }

  async function send(withAgain: boolean) {
    if (sending) return
    setSending(true)
    let answer: InviteResult
    try {
      const resume = next && next.again === withAgain ? next : null
      const { invites: people, left, next: after } = await invites.mutateAsync({
        batchId, ...(resume ? { after: resume.after } : {}), ...(withAgain ? { includeInvitedBefore: true } : {}),
      })
      const outcomes: EmailOutcome[] = []
      let sent: string[] = []
      // One at a time: Firebase limits how fast one browser may ask for emails, and the outcome says when it does.
      for (const person of people) {
        const outcome: EmailOutcome = person.firebaseAccount
          ? await sendSetPasswordEmailFor(person.email, person.firebaseAccount)
          : { ok: false, email: person.email, reason: 'account', detail: person.error ?? undefined }
        if (outcome.ok) sent.push(person.staffId)
        if (sent.length >= 10) { record.mutate(sent); sent = [] } // a closed tab loses at most 10
        outcomes.push(outcome)
      }
      if (sent.length > 0) record.mutate(sent)
      setNext(left > 0 && after ? { after, left, again: withAgain } : null)
      answer = { outcomes, left }
    } catch (err) {
      answer = { problem: extractErrorMessage(err, 'The invites could not be sent.') }
    }
    setSending(false)
    setConfirm(null)
    if (onResult) onResult(answer)
    else setResult(answer)
  }

  const counted = confirm?.counted ?? null
  // Carrying on after a cursor sends what is left; a changed box starts again from the top.
  const continuing = !!next && next.again === again
  const total = !counted ? 0 : continuing ? next.left : counted.toInvite + (again ? counted.invitedBefore : 0)
  const shown = Math.min(total, PAGE)
  const sentence = counted && (
    <>
      <p>{counted.toInvite === 0 ? 'Nobody is waiting for a first invite.' : counted.toInvite === 1 ? "1 staff member hasn't been invited yet." : `${counted.toInvite} staff haven't been invited yet.`}</p>
      {counted.invitedBefore > 0 && <p>{`${plural(counted.invitedBefore, 'was', 'were')} invited before but ${counted.invitedBefore === 1 ? "hasn't" : "haven't"} signed in, so ${counted.invitedBefore === 1 ? 'that person is' : "they're"} skipped.`}</p>}
      {counted.cannotInvite > 0 && <p>{cannotSentence(counted.cannotInvite)}</p>}
      {total > PAGE && <p>{`They go ${PAGE} at a time: press Send sign-in invites again for the rest.`}</p>}
    </>
  )

  // In the Import history the row's own flex-wrap lays the button, this reason line and Undo out; alone on the wizard page it stacks.
  return (
    <div className={onResult ? 'contents' : 'flex flex-col gap-3'}>
      <div>
        {/* aria-disabled, not disabled, while sending: disabling the button just pressed can drop keyboard focus (see SignInEmailOutcome). */}
        <Button
          variant="secondary"
          size="sm"
          onClick={open}
          disabled={c ? nobodyLeft : waiting === 0}
          aria-disabled={sending || undefined}
          className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
        >
          {sending ? 'Sending invites...' : c && !next && c.toInvite === 0 && c.invitedBefore > 0 ? `Send sign-in invites again (${c.invitedBefore})` : `Send sign-in invites (${waiting})`}
        </Button>
      </div>
      {nobodyLeft && (
        <p className={`${onResult ? 'basis-full order-last ' : ''}whitespace-normal text-pretty text-[13px] text-[var(--color-muted-foreground)]`}>
          {`Everyone in this import has signed in or been invited.${c.cannotInvite > 0 ? ` ${cannotSentence(c.cannotInvite)}` : ''}`}
        </p>
      )}
      {/* Portalled out of the table's pinned cell, which would right-align and no-wrap the dialog's words. */}
      {createPortal(<ConfirmDialog
        open={!!confirm}
        title="Send sign-in invites?"
        onCancel={() => { if (!sending) setConfirm(null) }}
        onConfirm={() => void send(counted ? again : false)}
        loading={sending}
        confirmDisabled={!!counted && total === 0}
        confirmLabel={counted && total > 0 ? `Send ${plural(shown, 'invite')}` : 'Send invites'}
        message={counted ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">{sentence}</div>
            {counted.invitedBefore > 0 && !next && (
              <CheckboxField label={`Also send again to the ${counted.invitedBefore} invited before`} checked={again} onChange={e => setAgain(e.target.checked)} />
            )}
          </div>
        ) : "Send sign-in invites to staff in this import who haven't been invited yet?"}
      />, document.body)}
      {result && <InviteResults result={result} />}
    </div>
  )
}
