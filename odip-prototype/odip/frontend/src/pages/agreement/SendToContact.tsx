import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Send } from 'lucide-react'
import { useSendAgreement } from '@/api/hooks'
import type { AgreementContactDto, AgreementShareRowDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Modal } from '@/components/Modal'
import { SelectField } from '@/components/SelectField'
import { TAP_FLOOR } from '@/components/tapArea'
import { httpStatusOf } from '@/lib/httpStatus'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { liveShare, shareExpired } from './shareRows'

type SendToContactProps = {
  participantId: string
  /** The revision on screen, and the version of it the person is looking at: a newer save refuses the send (409). */
  draftId: string
  version: number
  contacts: AgreementContactDto[]
  shares: AgreementShareRowDto[]
  /** The email went. The page needs nothing: the hook reads the sharing again, which shows the new line. */
  onSent?: () => void
}

type Outcome = { tone: 'danger' | 'warning'; text: string; settings?: boolean }

const NOT_CONFIGURED = "Email isn't set up for your organisation yet. Ask your administrator."
const FAILED = "The email didn't go. Try again, or check with your administrator."

// The participant has no person id; the select needs a value for them.
const keyOf = (contact: AgreementContactDto) => contact.personId ?? 'participant'

function refusal(error: unknown): Outcome {
  if (httpStatusOf(error) === 429) return { tone: 'warning', text: 'Too many requests just now. Wait a moment and try again.' }
  const said = apiErrorMessages(error)[0]
  return said ? { tone: 'danger', text: said, settings: said.includes('in Settings') } : { tone: 'danger', text: FAILED }
}

/**
 * "Send to a contact" (agreement PR3b): emails the saved revision to a guardian, plan nominee or the participant as a link they can read and download. The page offers it only to a role that may
 * approve. The address is shown, never typed: the server reads it from the contact's record. Nothing here copies or shows the link, which exists only in the email.
 */
export function SendToContact({ participantId, draftId, version, contacts, shares, onSent }: SendToContactProps) {
  const send = useSendAgreement()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const usable = contacts.filter(contact => contact.email)
  const pending = send.isPending
  const picked = usable.find(contact => keyOf(contact) === chosen)
  const expired = (() => { const row = liveShare(shares); return !!row && shareExpired(row) })()

  const openDialog = () => {
    setChosen(keyOf(usable.find(contact => contact.isDefault) ?? usable[0] ?? { name: '', roles: '', isDefault: false }))
    setOutcome(null)
    setOpen(true)
  }
  const close = () => { if (!pending) setOpen(false) }
  const submit = () => {
    if (!picked) return
    setOutcome(null)
    send.mutate({ participantId, draftId, personId: picked.personId, expectedVersion: version }, {
      onSuccess: result => {
        if (result.sent) { setOpen(false); onSent?.() }
        else setOutcome(result.error === 'NotConfigured' ? { tone: 'warning', text: NOT_CONFIGURED } : { tone: 'danger', text: FAILED })
      },
      onError: error => setOutcome(refusal(error)),
    })
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog}><Send className="h-4 w-4" aria-hidden="true" />{expired ? 'Send again' : 'Send to a contact'}</Button>
      <Modal
        open={open}
        onClose={close}
        title="Send this agreement to a contact"
        closeOnBackdrop={!pending}
        footer={(
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
            <Button onClick={submit} disabled={pending || !picked}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{pending ? 'Sending…' : 'Send'}
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3 text-sm">
          {usable.length === 0 ? (
            <>
              <p>None of the contacts has an email recorded. Add one on the participant&apos;s page.</p>
              <Link className={`${TAP_FLOOR} self-start font-medium underline`} to={`/participants/${participantId}`}>Open the participant</Link>
            </>
          ) : (
            <>
              <SelectField
                label="Send to"
                value={chosen}
                onChange={event => setChosen(event.target.value)}
                options={contacts.map(contact => ({
                  value: keyOf(contact),
                  label: `${contact.name} (${contact.roles})${contact.email ? '' : ' - No email recorded'}`,
                  disabled: !contact.email,
                }))}
              />
              {picked && <p>The email goes to {picked.email}.</p>}
              <p className="text-[var(--color-muted-foreground)]">The link works for 30 days. Anyone with the link can read the agreement, so it only goes to the one address.</p>
            </>
          )}
          {outcome && (
            <Callout tone={outcome.tone}>
              {outcome.text}
              {outcome.settings && <Link className={`${TAP_FLOOR} mt-1 block font-medium underline`} to="/settings?section=organisation">Open Settings</Link>}
            </Callout>
          )}
        </div>
      </Modal>
    </>
  )
}
