import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { SelectField } from './SelectField'
import { TextField } from './TextField'

/** The longest a code may be: the server's limit too (TripClaim.RejectionCode). */
export const NDIA_CODE_MAX_LENGTH = 10

const NOT_GIVEN = ''
const OTHER = 'Other'

/** The codes the NDIA gives when the money is not there, in the words the budget uses: the plan, or the funding period. Anything else is typed under Other. */
const CODE_OPTIONS = [
  { value: NOT_GIVEN, label: 'Not given' },
  { value: 'V17', label: 'V17: not enough in the plan' },
  { value: 'V18', label: 'V18: not enough in the plan' },
  { value: 'V27', label: 'V27: not enough in the funding period' },
  { value: 'V28', label: 'V28: not enough in the funding period' },
  { value: OTHER, label: 'Other' },
]

type RejectClaimDialogProps = {
  /** The server's refusal of the last try, said in the dialog. */
  error?: string | null
  loading?: boolean
  /** How many claims are being marked Rejected at once (the trip's Claims tab can do several): one code is sent with all of them. Default one. */
  count?: number
  onCancel: () => void
  /** The NDIA's code, or null when none was given. The caller sends it with the Rejected status. */
  onConfirm: (code: string | null) => void
}

/**
 * "Mark as rejected?", asking, optionally, for the NDIA's code. A code that says the funds ran out (V17, V18, V27, V28) is the only direct sign a provider gets that a participant's pool is empty
 * (the NDIA's portal does not show a budget), so it warns on the participant's budget; any other code is kept as it was typed. Nothing here is required: a rejection with no code is still a rejection.
 */
export function RejectClaimDialog({ error, loading, count = 1, onCancel, onConfirm }: RejectClaimDialogProps) {
  const [choice, setChoice] = useState(NOT_GIVEN)
  const [typed, setTyped] = useState('')
  const [missing, setMissing] = useState(false)

  function confirm() {
    if (choice === OTHER) {
      const code = typed.trim()
      if (code === '') { setMissing(true); return }
      onConfirm(code)
      return
    }
    onConfirm(choice === NOT_GIVEN ? null : choice)
  }

  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={confirm}
      title="Mark as rejected?"
      confirmLabel="Mark as Rejected"
      variant="danger"
      loading={loading}
      message={
        <>
          <p>{count > 1 ? `Mark these ${count} claims as rejected? This cannot be undone.` : 'Mark this claim as rejected? This cannot be undone.'}</p>
          <SelectField
            label="NDIA rejection code (optional)"
            value={choice}
            options={CODE_OPTIONS}
            onChange={event => { setChoice(event.target.value); setMissing(false) }}
            hint="V17, V18, V27 and V28 say the funds ran out, and warn on the participant's budget."
          />
          {choice === OTHER && (
            <TextField
              label="The code the NDIA gave"
              value={typed}
              maxLength={NDIA_CODE_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              onChange={event => { setTyped(event.target.value); setMissing(false) }}
              hint={`Up to ${NDIA_CODE_MAX_LENGTH} characters.`}
              error={missing ? 'Type the code the NDIA gave, or choose Not given.' : undefined}
            />
          )}
          {error && <p role="alert" className="text-[var(--color-destructive)]">{error}</p>}
        </>
      }
    />
  )
}
