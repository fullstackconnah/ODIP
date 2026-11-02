import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { usePopulatePreview, usePopulateRoster } from '@/api/hooks'
import type { PopulateResultDto } from '@/api/types'
import { BudgetWarnings } from '@/components/BudgetWarnings'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { SelectField } from '@/components/SelectField'
import { formatServiceDate, plural } from '@/lib/format'
import { httpStatusOf } from '@/lib/httpStatus'
import { retryingAfterError } from '@/lib/queryPhase'

/** What the server said when it refused, or one sentence of our own. */
function failureMessage(error: unknown): string {
  if (httpStatusOf(error) === 429) return 'Too many requests just now. Wait a moment and try again.'
  const data = (error as { response?: { data?: { errors?: string[]; message?: string } } } | null)?.response?.data
  return data?.errors?.[0] ?? data?.message ?? 'The server could not populate the roster. Check your connection and try again; nothing was changed.'
}

type PopulateDialogProps = {
  open: boolean
  participantId: string
  /** The approved revision whose shifts are made. */
  draftId: string
  onClose: () => void
  /** The server made the week's shifts (possibly none new): the page says what happened. */
  onPopulated: (result: PopulateResultDto) => void
}

/**
 * "Populate roster" (S11): adds an approved revision's open shifts to ONE started week, chosen here. The server says what each started week is missing; the dialog opens on the earliest week that is
 * missing shifts (else the first started week), says what pressing the button adds, and never offers a week that has not been started. Repeating it is safe: shifts already there, cancelled ones too, are skipped.
 * While the request is on its way nothing closes it; a refusal stays in the dialog and keeps focus on the button.
 */
export function PopulateDialog({ open, participantId, draftId, onClose, onPopulated }: PopulateDialogProps) {
  const preview = usePopulatePreview(participantId, draftId, open)
  const populate = usePopulateRoster()
  const [chosen, setChosen] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // A dialog that is opened again starts clean.
  const [seenOpen, setSeenOpen] = useState(open)
  if (seenOpen !== open) {
    setSeenOpen(open)
    if (!open) { setChosen(null); setFailure(null) }
  }

  const data = preview.data
  const weeks = data?.weeks ?? []
  const week = weeks.find(entry => entry.weekStart === chosen) ?? weeks.find(entry => entry.toAdd > 0) ?? weeks[0]
  const pending = populate.isPending
  const close = () => { if (!pending) onClose() }

  const submit = () => {
    if (!week) return
    setFailure(null)
    populate.mutate({ participantId, draftId, weekStart: week.weekStart }, {
      onSuccess: onPopulated,
      onError: error => setFailure(failureMessage(error)),
    })
  }

  const cancel = <Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
  const footer = !week ? <Button variant="secondary" onClick={close}>Close</Button> : (
    <>
      {cancel}
      <Button onClick={submit} disabled={pending || week.toAdd === 0}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{pending ? 'Populating…' : 'Populate roster'}
      </Button>
    </>
  )

  return (
    <Modal open={open} onClose={close} title="Populate roster" size="md" footer={footer} closeOnBackdrop={!pending} stickyFooter>
      <div className="flex flex-col gap-3 text-sm">
        {preview.isLoading && !retryingAfterError(preview) && <PageState kind="loading" noun="roster summary" />}
        {(preview.isError || retryingAfterError(preview)) && !data && <PageState kind="error" noun="roster summary" onRetry={() => preview.refetch()} />}
        {data?.note && <Callout tone="warning" announce={false}>{data.note}</Callout>}
        {data && !data.note && !week && <p>No week of this agreement has been started on the roster yet. Start a week first, then populate it.</p>}
        {week && (
          <>
            <p className="text-[var(--color-muted-foreground)]">Adds this agreement&apos;s unfilled shifts to one week that has been started. Shifts already there are left alone, so it is safe to repeat.</p>
            <SelectField
              label="Week"
              value={week.weekStart}
              disabled={pending}
              onChange={event => { setChosen(event.target.value); setFailure(null) }}
              options={weeks.map(entry => ({ value: entry.weekStart, label: `${formatServiceDate(entry.weekStart)} · ${entry.toAdd === 0 ? 'nothing to add' : `${plural(entry.toAdd, 'shift')} to add`}` }))}
            />
            <p className="font-medium">{week.toAdd === 0
              ? `Nothing to add. All ${plural(week.alreadyThere, 'shift')} of this week ${week.alreadyThere === 1 ? 'is' : 'are'} already there.`
              : `Adds ${plural(week.toAdd, 'unfilled shift')} to the week of ${formatServiceDate(week.weekStart)}. ${week.alreadyThere === 0 ? 'None' : week.alreadyThere} ${week.alreadyThere === 1 ? 'is' : 'are'} already there.`}</p>
            <BudgetWarnings warnings={week.budgetWarnings} note="This is a warning only. Populating is not blocked." announce={false} />
          </>
        )}
        {failure && <Callout tone="danger" title="Not populated">{failure}</Callout>}
      </div>
    </Modal>
  )
}
