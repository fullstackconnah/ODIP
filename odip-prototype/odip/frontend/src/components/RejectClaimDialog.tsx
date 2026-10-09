import { useState } from 'react'
import { NDIA_FUNDS_CODES } from '@/lib/ndiaCodes'
import { ConfirmDialog } from './ConfirmDialog'
import { SelectField } from './SelectField'
import { TextField } from './TextField'

/** The longest a code may be: the server's limit too (TripClaim.RejectionCode). */
export const NDIA_CODE_MAX_LENGTH = 10

const NOT_GIVEN = ''
const OTHER = 'Other'

/** The codes the NDIA gives when the money is not there, in the words the budget uses (lib/ndiaCodes.ts, which the claim page prints from too). Anything else is typed under Other. */
const CODE_OPTIONS = [
  { value: NOT_GIVEN, label: 'Not given' },
  ...NDIA_FUNDS_CODES.map(entry => ({ value: entry.code, label: `${entry.code}: ${entry.meaning}` })),
  { value: OTHER, label: 'Other' },
]

type RejectClaimDialogProps = {
  /** The server's refusal of the last try, said in the dialog. */
  error?: string | null
  loading?: boolean
  /** How many claims are being marked Rejected at once (the trip's Claims tab can do several): one code is sent with all of them, and the field says so. Default one. */
  count?: number
  /**
   * The claim is already rejected and only its code is being recorded (the reason often arrives after the status was set): the dialog asks only for the code, which is then required, and says
   * "Save the code". Default off, which is the rejection itself, with the code optional.
   */
  recordOnly?: boolean
  onCancel: () => void
  /** The NDIA's code, or null when none was given. The caller sends it with the Rejected status (or alone, when only recording it). */
  onConfirm: (code: string | null) => void
}

/**
 * "Mark as rejected?", asking, optionally, for the NDIA's code. A code that says the funds ran out (V17, V18, V27, V28) is the only direct sign a provider gets that a participant's pool is empty
 * (the NDIA's portal does not show a budget), so it raises a warning on the participant's budget; any other code is kept as it was typed. Nothing here is required: a rejection with no code is still a
 * rejection. With several claims the one code goes to all of them, and the field is named for that.
 */
export function RejectClaimDialog({ error, loading, count = 1, recordOnly = false, onCancel, onConfirm }: RejectClaimDialogProps) {
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
    // Recording a code is only worth sending if there is one.
    if (recordOnly && choice === NOT_GIVEN) { setMissing(true); return }
    onConfirm(choice === NOT_GIVEN ? null : choice)
  }

  const several = count > 1
  const label = recordOnly ? 'NDIA rejection code' : several ? `NDIA rejection code, applied to all ${count} claims (optional)` : 'NDIA rejection code (optional)'
  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={confirm}
      title={recordOnly ? 'Record the NDIA code' : 'Mark as rejected?'}
      confirmLabel={recordOnly ? 'Save the code' : 'Mark as Rejected'}
      variant={recordOnly ? 'default' : 'danger'}
      loading={loading}
      message={
        <>
          <p>
            {recordOnly
              ? 'Which code did the NDIA give for this claim?'
              : several ? `Mark these ${count} claims as rejected? This cannot be undone.` : 'Mark this claim as rejected? This cannot be undone.'}
          </p>
          <SelectField
            label={label}
            value={choice}
            options={recordOnly ? CODE_OPTIONS.filter(option => option.value !== NOT_GIVEN) : CODE_OPTIONS}
            placeholder={recordOnly ? 'Choose the code' : undefined}
            onChange={event => { setChoice(event.target.value); setMissing(false) }}
            error={recordOnly && missing && choice === NOT_GIVEN ? 'Choose the code the NDIA gave.' : undefined}
            hint={`V17, V18, V27 and V28 say the funds ran out, and raise a warning on ${several ? 'each participant\'s' : 'the participant\'s'} budget.`}
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
              error={missing ? (recordOnly ? 'Type the code the NDIA gave.' : 'Type the code the NDIA gave, or choose Not given.') : undefined}
            />
          )}
          {error && <p role="alert" className="text-[var(--color-destructive)]">{error}</p>}
        </>
      }
    />
  )
}
