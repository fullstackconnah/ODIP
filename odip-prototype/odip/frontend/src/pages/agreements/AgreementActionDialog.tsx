import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useBulkAgreements, usePriceLists } from '@/api/hooks'
import type { AgreementBulkAction, AgreementBulkResult, AgreementRow } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Modal } from '@/components/Modal'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'
import { localIsoDate } from '@/lib/dateOnly'
import { extractErrorMessage } from '@/lib/utils'
import { formatServiceDate, plural } from '@/lib/format'
import { CHUNK } from '@/lib/runInChunks'
import { addDays, isPricingDate } from '@/lib/planQuote'
import { bulkSkipCount, bulkSkipNotes, latestEnd } from './agreementRows'

/** A run that stopped partway: what the earlier requests answered, and how many items were never sent. `noReply`: the failed request got no answer, so some of its drafts may exist. */
export interface BulkStopped { done: number; total: number; notSent: number; noReply: boolean }
export interface BulkRun { action: AgreementBulkAction; label: string; results: AgreementBulkResult[]; stopped: BulkStopped | null }

interface Props {
  action: AgreementBulkAction
  /** The ticked rows, in the order they are sent. */
  selected: readonly AgreementRow[]
  onClose: () => void
  /** The run finished (or stopped after some answers): the page shows the review. */
  onDone: (run: BulkRun) => void
  /** "Show drafts waiting": the list filtered to the drafts, for when no answer came back. */
  onShowDrafts: () => void
}

const TITLE: Record<AgreementBulkAction, string> = { renew: 'Renew', reprice: 'Reprice', extend: 'Extend' }
const SAVED_AS_DRAFTS = 'They are saved as drafts: nothing changes on the roster until you approve them.'

const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status
/** No HTTP answer at all (timeout, network), or only the proxy's (502, 503, 504): the server may have gone on and made some drafts. */
const noReply = (error: unknown) => { const s = statusOf(error); return s === undefined || [502, 503, 504].includes(s) }

const failureWords = (error: unknown) => {
  const status = statusOf(error)
  return status === 429 ? 'Another save is running for your organisation. Nothing was changed. Try again in a moment.'
    : status === 400 || status === 403 ? `${extractErrorMessage(error, status === 403 ? "Your role can't do this." : 'Something went wrong.')} Nothing was changed.`
    : 'Could not make these drafts. Nothing was changed. Try again.'
}

/** Renew, Reprice or Extend for the ticked agreements: the question, the run, and what went wrong. Mounted per action, so each opening starts clean. While requests are in flight nothing closes it. */
export function AgreementActionDialog({ action, selected, onClose, onDone, onShowDrafts }: Props) {
  const count = selected.length
  const [phase, setPhase] = useState<'ask' | 'running'>('ask')
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState<{ words: string; kind: 'refused' | 'noReply' | 'other' } | null>(null)
  const [chosen, setChosen] = useState('')
  const [endDate, setEndDate] = useState('')
  const onProgress = useCallback((done: number) => setProgress(done), [])
  const bulk = useBulkAgreements(onProgress)
  const lists = usePriceLists(action === 'reprice')

  const list = (lists.data ?? []).find(l => l.version === (chosen || lists.data?.[0]?.version))
  const latest = latestEnd(selected)
  const dateTooEarly = !!endDate && latest !== null && endDate <= latest
  const ready = action === 'renew' || (action === 'reprice' ? !!list : isPricingDate(endDate) && !dateTooEarly)
  const notes = bulkSkipNotes(selected, action, list)
  const running = phase === 'running'
  const makeCount = count - bulkSkipCount(selected, action, list)
  const make = makeCount > 0 ? `Make ${plural(makeCount, 'draft')}` : 'Nothing to make'
  const noLists = action === 'reprice' && lists.data?.length === 0
  const dayFrom = list ? formatServiceDate(list.start) : ''

  const run = async () => {
    setPhase('running'); setProgress(0); setFailure(null)
    const result = await bulk.mutateAsync({
      action, participantIds: selected.map(r => r.participantId),
      ...(action === 'extend' && { endDate }), ...(action === 'reprice' && { priceList: list!.version }),
    })
    if (result.stopped && result.results.length === 0) {
      const error = result.stopped.error
      setFailure({ words: noReply(error) ? 'No answer came back. Some drafts may have been made before the connection dropped.' : failureWords(error), kind: noReply(error) ? 'noReply' : statusOf(error) === 403 ? 'refused' : 'other' })
      setPhase('ask')
      return
    }
    onDone({
      action, label: action === 'extend' ? endDate : action === 'reprice' ? list!.version : '', results: result.results,
      stopped: result.stopped ? { done: result.results.length, total: count, notSent: result.stopped.notSent, noReply: noReply(result.stopped.error) } : null,
    })
  }

  return (
    <Modal
      open onClose={running ? () => {} : onClose} closeOnBackdrop={false} hideClose={running} stickyFooter size="md"
      title={`${TITLE[action]} ${plural(count, 'agreement')}`}
      footer={running ? (
        <Button aria-disabled disabled>{`Making ${plural(makeCount, 'draft')}…`}</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={!ready || makeCount === 0 || failure?.kind === 'refused' || failure?.kind === 'noReply'}>{make}</Button>
        </>
      )}
    >
      {running ? (
        <div role="status" className="flex items-start gap-3 text-sm">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{`Making ${plural(makeCount, 'draft')}…`}</p>
            <p className="text-[var(--color-muted-foreground)]">Each agreement is priced and saved in turn, so this can take up to a minute. Keep this page open.</p>
            {count > CHUNK && <p className="tabular-nums text-[var(--color-muted-foreground)]">{`Working… ${progress} of ${plural(count, 'agreement')} checked`}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-[var(--color-muted-foreground)]">
          {action === 'renew' && (
            <p>{`Each agreement gets a new term that starts the day after it ends, with the same supports, priced from the price list in force. ${SAVED_AS_DRAFTS}`}</p>
          )}
          {action === 'reprice' && (
            <>
              <SelectField
                label="Price list" required value={list?.version ?? ''} onChange={e => setChosen(e.target.value)} disabled={!list}
                options={list ? lists.data!.map(l => ({ value: l.version, label: `${l.version} · starts ${formatServiceDate(l.start)}` }))
                  : [{ value: '', label: lists.isError ? "Couldn't load price lists." : noLists ? 'No price lists yet' : 'Loading price lists…' }]}
              />
              {noLists && <p>An Admin can add one in Settings, Plan pricing.</p>}
              {lists.isError && <Button variant="secondary" size="sm" onClick={() => lists.refetch()}>Try again</Button>}
              {list && <p>{`New prices apply from ${dayFrom} to each agreement's end. Days before that keep their prices. If an agreement started after ${dayFrom}, it is repriced from its start.`}</p>}
              <p>{`The supports stay the same. ${SAVED_AS_DRAFTS}`}</p>
              {list && list.start < localIsoDate() && (
                <Callout tone="warning">{`This price list started ${dayFrom}, before today. The draft counts the days since then at the new prices. Shifts already worked and their claims don't change.`}</Callout>
              )}
            </>
          )}
          {action === 'extend' && (
            <>
              <TextField
                label="New end date" type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} min={latest ? addDays(latest, 1) : undefined}
                error={dateTooEarly ? `Choose a date after ${formatServiceDate(latest)}.` : undefined}
              />
              <p>Each agreement keeps its supports and runs on to this date. The added days are priced from the price list in force; the days already agreed keep their prices.</p>
              {latest && <p>{`The date must be after every ticked agreement's end. The latest ends ${formatServiceDate(latest)}.`}</p>}
              <p>{`An agreement whose plan ends before this date isn't extended; record the new plan first. ${SAVED_AS_DRAFTS}`}</p>
            </>
          )}
          {notes.map(note => <p key={note}>{note}</p>)}
          {failure && (
            <Callout
              tone={failure.kind === 'noReply' ? 'warning' : 'danger'}
              actions={failure.kind === 'noReply' ? <Button variant="secondary" size="sm" onClick={onShowDrafts}>Show drafts waiting</Button> : undefined}
            >
              {failure.words}
            </Callout>
          )}
        </div>
      )}
    </Modal>
  )
}
