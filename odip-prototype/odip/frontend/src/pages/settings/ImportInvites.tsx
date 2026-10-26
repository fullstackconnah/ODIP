import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Callout } from '@/components/Callout'
import { useImportInvites } from '@/api/hooks'
import type { ImportInviteDto } from '@/api/types'
import { describeEmailOutcome, sendSetPasswordEmailFor, type EmailOutcome } from '@/lib/signInEmail'
import { extractErrorMessage } from '@/lib/utils'

/** What a press of "Send sign-in invites" came to: one outcome per person, or the request's own refusal. */
export type InviteResult = { outcomes: EmailOutcome[]; left: number } | { problem: string }

const NO_INVITES = 'Everyone in this import has signed in already, so no invites were sent.'

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
  const line = (o: EmailOutcome) => <li key={o.email} className="break-words">{describeEmailOutcome(o, 'use Send sign-in invites again').message}</li>
  return (
    <Callout tone={failed.length > 0 ? 'warning' : 'success'} title={inviteTitle(outcomes, lead)} announce={!auto}>
      {auto ? (
        <>
          {failed.length > 0 && <ul className="list-disc pl-5">{failed.map(line)}</ul>}
          {afterFailures}
          {sent.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer min-h-[var(--control-h)] flex items-center">{`Show the ${sent.length} sent`}</summary>
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
  const [phase, setPhase] = useState<'sending' | 'paused' | 'finished' | 'problem'>('sending')
  const [outcomes, setOutcomes] = useState<EmailOutcome[]>([])
  const [failedPeople, setFailedPeople] = useState<ImportInviteDto[]>([])
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
    try {
      for (;;) {
        if (queue.length === 0) {
          if (!first && !cursor) break
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
    for (const person of retryable) next.push(await sendSetPasswordEmailFor(person.email, person.firebaseAccount!))
    const again = new Set(retryable.map(p => p.email))
    setOutcomes(o => [...o.filter(x => !again.has(x.email)), ...next])
    setFailedPeople(f => f.filter(p => !p.firebaseAccount || next.some(n => !n.ok && n.email === p.email)))
    running.current = false
    onSendingChange?.(false)
    setPhase('finished')
  }

  // One live region for the whole run, mounted before the first line is written: the sending lines and the end are announced from here.
  const announcement = phase === 'sending' ? `Sending sign-in invites: ${outcomes.length} of ${count}`
    : phase === 'paused' ? `Sending paused: the email service asked us to slow down. ${left} still to invite.`
    : phase === 'finished' ? (outcomes.length === 0 ? NO_INVITES : inviteTitle(outcomes))
    : '' // a refused request is the error Callout's own alert

  return (
    <div className="flex flex-col gap-3">
      <AnnouncementRegion message={announcement} />
      {phase === 'sending' && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="tabular-nums">{`Sending sign-in invites: ${outcomes.length} of ${count}`}</p>
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

/**
 * "Send sign-in invites (N)" for an imported staff batch: the server makes sure each account exists (the Staff page's own step), then this
 * browser asks Firebase for each set-password email in turn. The results show under the button, or wherever `onResult` puts them (the Import
 * history shows them above its table, never inside a row).
 */
function ManualInvites({ batchId, count, onResult }: { batchId: string; count: number; onResult?: (result: InviteResult) => void }) {
  const invites = useImportInvites()
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<InviteResult | null>(null)
  // Where the next press carries on (the server's cursor) and how many are left, while a batch goes 100 at a time. Null: start at the top.
  const [next, setNext] = useState<{ after: string; left: number } | null>(null)

  async function send() {
    if (sending) return
    setSending(true)
    let answer: InviteResult
    try {
      const { invites: people, left, next: after } = await invites.mutateAsync(next ? { batchId, after: next.after } : { batchId })
      const outcomes: EmailOutcome[] = []
      // One at a time: Firebase limits how fast one browser may ask for emails, and the outcome says when it does.
      for (const person of people) {
        outcomes.push(person.firebaseAccount
          ? await sendSetPasswordEmailFor(person.email, person.firebaseAccount)
          : { ok: false, email: person.email, reason: 'account', detail: person.error ?? undefined })
      }
      setNext(left > 0 && after ? { after, left } : null)
      answer = { outcomes, left }
    } catch (err) {
      answer = { problem: extractErrorMessage(err, 'The invites could not be sent.') }
    }
    setSending(false)
    if (onResult) onResult(answer)
    else setResult(answer)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        {/* aria-disabled, not disabled, while sending: disabling the button just pressed can drop keyboard focus (see SignInEmailOutcome). */}
        <Button
          variant="secondary"
          size="sm"
          onClick={send}
          disabled={(next?.left ?? count) === 0}
          aria-disabled={sending || undefined}
          className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
        >
          {sending ? 'Sending invites...' : `Send sign-in invites (${next?.left ?? count})`}
        </Button>
      </div>
      {result && <InviteResults result={result} />}
    </div>
  )
}
