import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Modal } from '@/components/Modal'
import { useQueueRecords } from '@/api/hooks/portal'
import { offlineQueue, type QueueRecord } from '@/lib/offline/queue'
import { clockTime, reasonFor } from '@/lib/offline/reasons'

const KIND: Record<QueueRecord['kind'], string> = { start: 'Start', note: 'Note', breakStart: 'Break', breakEnd: 'Break', tick: 'Check', untick: 'Check', ack: 'Handover read', finish: 'Finish' }
const NOUN: Record<QueueRecord['kind'], string> = { start: 'start', note: 'note', breakStart: 'break', breakEnd: 'break', tick: 'check', untick: 'check', ack: 'handover read', finish: 'Finish' }

const dayLabel = (serviceDate: string) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${serviceDate.slice(0, 10)}T00:00:00Z`))

const kindLine = (r: QueueRecord) => (r.kind === 'tick' || r.kind === 'untick' ? `Check: ${r.label.routine ?? 'routine'}` : KIND[r.kind])

function Content({ r }: { r: QueueRecord }) {
  if (r.kind === 'note') return <p className="text-sm line-clamp-3 select-text whitespace-pre-wrap">{(r.body as { body?: string }).body}</p>
  if (r.kind === 'breakStart') return <p className="text-sm">Started {clockTime(r.clientTime)}</p>
  if (r.kind === 'breakEnd') return <p className="text-sm">Ended {clockTime(r.clientTime)}</p>
  if (r.kind === 'untick') return <p className="text-sm">Marked not done</p>
  return null
}

/**
 * The changes Bunya Support did not accept (SHAPE 4c): grouped by shift, current shift first, each with the reason and a Discard. They stay on this phone until discarded.
 * shortcut: a break's Start and End are listed (and discarded) separately, not as one "2:30 pm to 2:55 pm" row; pair them if workers find that confusing.
 */
export function NotSentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const records = useQueueRecords()
  const current = useParams().id
  const [discarding, setDiscarding] = useState<QueueRecord | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const items = records.filter((r) => r.status === 'notSent')
  const waiting = records.length - items.length
  const shifts = [...new Set(items.map((r) => r.shiftId))].sort((a, b) => Number(b === current) - Number(a === current))

  useEffect(() => {
    if (focusId === null) return
    const el = document.querySelector<HTMLElement>(`[data-discard-id="${focusId}"]`) ?? closeRef.current
    el?.focus()
    setFocusId(null)
  }, [focusId, records])

  const discard = () => {
    if (!discarding) return
    const order = items.map((r) => r.id)
    const at = order.indexOf(discarding.id)
    const next = order[at + 1] ?? order[at - 1] ?? 'close'
    offlineQueue.discard(discarding.id)
    setDiscarding(null)
    setFocusId(next)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Not sent"
        footer={(
          <>
            <Button ref={closeRef} variant="secondary" onClick={onClose}>Close</Button>
            {waiting > 0 && <Button onClick={() => { void offlineQueue.replay() }}>Send now</Button>}
          </>
        )}
      >
        {items.length === 0 ? <p className="text-sm">Nothing left here.</p> : (
          <div className="space-y-5">
            <p className="text-sm text-[var(--color-muted-foreground)]">Bunya Support didn&rsquo;t accept these. They stay on this phone until you discard them. Tell your coordinator about anything that still matters.</p>
            {shifts.map((shiftId) => {
              const group = items.filter((r) => r.shiftId === shiftId)
              const l = group[0].label
              return (
                <section key={shiftId} aria-labelledby={`ns-${shiftId}`} className="space-y-2">
                  <h3 id={`ns-${shiftId}`} className="text-sm font-semibold break-words">{[l.participant, l.serviceDate && dayLabel(l.serviceDate), l.rostered].filter(Boolean).join(' · ')}</h3>
                  <ul className="space-y-2">
                    {group.map((r) => (
                      <li key={r.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 space-y-1">
                        <p className="text-sm font-medium">{kindLine(r)}</p>
                        <Content r={r} />
                        <p className="text-xs text-[var(--color-muted-foreground)]">Recorded on this phone at {clockTime(r.clientTime)}</p>
                        <p className="text-sm">{reasonFor(r)}</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button variant="ghost-danger" size="sm" data-discard-id={r.id} onClick={() => setDiscarding(r)}>Discard</Button>
                          {r.kind === 'finish' && r.blockers?.length ? (
                            <>
                              <Button variant="secondary" size="sm" onClick={() => { void offlineQueue.retry(r.id) }}>Try again</Button>
                              <Button variant="secondary" size="sm" to={`/portal/shifts/${r.shiftId}`} onClick={onClose}>Open shift</Button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!discarding}
        title={`Discard this ${discarding ? NOUN[discarding.kind] : 'change'}?`}
        message="It was never sent to Bunya Support, and it will be deleted from this phone. You can't undo this."
        confirmLabel="Discard"
        cancelLabel="Keep it"
        variant="danger"
        focusCancel
        onCancel={() => setDiscarding(null)}
        onConfirm={discard}
      />
    </>
  )
}
