import { useState } from 'react'
import { Users } from 'lucide-react'
import { useUpsertCompatibility } from '@/api/hooks'
import type { CompatibilityLevel } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { EmptyState } from '@/components/EmptyState'
import { SearchInput } from '@/components/SearchInput'
import { SlideOver } from '@/components/SlideOver'
import { extractErrorMessage } from '@/lib/utils'

type Person = { id: string; fullName: string }

/**
 * Pick several staff for one tier in one go. They are written one at a time in tick order, each with no rank, so the server
 * puts each at the end of the tier (the tier is renumbered per write, which is why the writes never overlap).
 */
export function StaffChecklist({ tier, participantId, participantName, candidates, onClose, onDone }: {
  tier: Exclude<CompatibilityLevel, 'Allowed' | 'Excluded'>
  participantId: string
  participantName: string
  candidates: Person[]
  onClose: () => void
  /** Everyone ticked was added; the caller announces it. */
  onDone: (added: number) => void
}) {
  const upsert = useUpsertCompatibility()
  const [ticked, setTicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  // Added people leave the list at once, before the refetch brings the new candidates.
  const remaining = candidates.filter(c => !done.includes(c.id))
  const shown = q ? remaining.filter(c => c.fullName.toLowerCase().includes(q)) : remaining
  const saving = progress !== null
  const nameOf = (id: string) => candidates.find(c => c.id === id)?.fullName ?? ''

  function toggle(id: string) {
    setTicked(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]))
  }

  async function submit() {
    const queue = ticked
    let added = 0
    setFailure(null)
    for (const staffId of queue) {
      setProgress({ i: added + 1, n: queue.length })
      try {
        await upsert.mutateAsync({ staffId, participantId, level: tier, reason: null })
      } catch (err) {
        const rest = queue.slice(added)
        setFailure(`Added ${added} of ${queue.length} as ${tier}. Couldn't add ${rest.map(nameOf).join(', ')}: ${extractErrorMessage(err, 'Please try again.')}`)
        setProgress(null)
        return
      }
      added++
      setTicked(t => t.filter(x => x !== staffId))
      setDone(d => [...d, staffId])
    }
    setProgress(null)
    onDone(added)
    onClose()
  }

  const label = saving
    ? `Adding ${progress.i} of ${progress.n}…`
    : failure ? `Try ${ticked.length} again` : ticked.length ? `Add ${ticked.length} as ${tier}` : `Add as ${tier}`

  return (
    <SlideOver
      open
      onClose={onClose}
      size="md"
      title={`Add to ${tier} for ${participantName}`}
      description={`Tick staff in the order you want them. They join the end of ${tier}.`}
      dirty={ticked.length > 0 && !saving}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={ticked.length === 0 || saving} aria-busy={saving} onClick={submit}>{label}</Button>
        </div>
      }
    >
      {remaining.length === 0 ? (
        <EmptyState icon={Users} size="inline" title="Everyone active is already listed or marked No." />
      ) : (
        <div className="space-y-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search staff" className="w-full" />
          {failure && <Callout tone="error">{failure}</Callout>}
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff match “{query.trim()}”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map(c => {
                const order = ticked.indexOf(c.id) + 1
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <CheckboxField label={c.fullName} checked={order > 0} disabled={saving} onChange={() => toggle(c.id)} />
                    </div>
                    {order > 0 && (
                      <span data-testid={`tick-order-${c.id}`} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-xs tabular-nums">{order}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </SlideOver>
  )
}
