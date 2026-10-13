import { useState } from 'react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { useImportInvites } from '@/api/hooks'
import { describeEmailOutcome, sendSetPasswordEmailFor, type EmailOutcome } from '@/lib/signInEmail'
import { extractErrorMessage } from '@/lib/utils'

/** What a press of "Send sign-in invites" came to: one outcome per person, or the request's own refusal. */
export type InviteResult = { outcomes: EmailOutcome[]; left: number } | { problem: string }

/** The invites' results as one Callout: failures first, each line naming the address (lib/signInEmail words it). */
export function InviteResults({ result, fileName }: { result: InviteResult; fileName?: string }) {
  const lead = fileName ? `Sign-in invites for ${fileName}` : 'Sign-in invites'
  if ('problem' in result) return <Callout tone="error" title={`${lead}: not sent`}>{result.problem}</Callout>
  const { outcomes, left } = result
  const more = left > 0 && <p>{`${left} more still to invite: press Send sign-in invites again.`}</p>
  if (outcomes.length === 0) return <Callout tone="info">Everyone in this import has signed in already, so no invites were sent.</Callout>
  const failed = outcomes.filter(o => !o.ok)
  const sent = outcomes.filter(o => o.ok)
  return (
    <Callout tone={failed.length > 0 ? 'warning' : 'success'} title={failed.length > 0 ? `${lead}: ${sent.length} sent, ${failed.length} not sent` : `${lead}: all ${sent.length} sent`}>
      <ul className="list-disc pl-5">
        {[...failed, ...sent].map(o => <li key={o.email} className="break-words">{describeEmailOutcome(o, 'use Send sign-in invites again').message}</li>)}
      </ul>
      {more}
    </Callout>
  )
}

/**
 * "Send sign-in invites (N)" for an imported staff batch: the server makes sure each account exists (the Staff page's own step), then this
 * browser asks Firebase for each set-password email in turn. The results show under the button, or wherever `onResult` puts them (the Import
 * history shows them above its table, never inside a row).
 */
export default function ImportInvites({ batchId, count, onResult }: { batchId: string; count: number; onResult?: (result: InviteResult) => void }) {
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
