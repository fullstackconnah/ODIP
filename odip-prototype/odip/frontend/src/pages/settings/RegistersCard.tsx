import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { SelectField } from '@/components/SelectField'
import { TextField } from '@/components/TextField'
import { downloadFile } from '@/lib/downloadFile'
import { localIsoDate } from '@/lib/dateOnly'
import { addMonthsIso } from '@/lib/fundingPeriods'

const muted = 'text-[var(--color-muted-foreground)]'

/** `route` is the segment after /registers/ and the file-name word; a snapshot register has no date range. */
const REGISTERS = [
  { route: 'incidents', label: 'Incidents', snapshot: false },
  { route: 'complaints', label: 'Complaints', snapshot: false },
  { route: 'restrictive-practices', label: 'Restrictive practices', snapshot: false },
  { route: 'risks', label: 'Risks', snapshot: true },
  { route: 'staff-credentials', label: 'Staff credentials', snapshot: true },
]

/**
 * Settings → Data export → Registers for auditors (B9). One register as a CSV, for a date range or, for Risks and Staff credentials, as it stands today.
 * - RegistersController admits the office roles; Complaints only an Admin (or a SuperAdmin viewing an organisation), so `canComplaints` hides that option.
 * - The busy button is aria-disabled, not disabled, so focus stays on it (as the full export's does). A refusal shows the server's own sentence.
 */
export function RegistersCard({ canComplaints }: { canComplaints: boolean }) {
  const today = localIsoDate()
  const [route, setRoute] = useState('incidents')
  const [from, setFrom] = useState(() => addMonthsIso(today, -12))
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [rangeError, setRangeError] = useState<string | undefined>()

  const register = REGISTERS.find(r => r.route === route)!
  const backwards = !register.snapshot && !!from && !!to && from > to

  const start = async () => {
    if (busy) return
    setFailure(null)
    if (backwards) return setRangeError('The end date must be on or after the start date.')
    setRangeError(undefined)
    setBusy(true)
    try {
      await (register.snapshot
        ? downloadFile(`/registers/${route}`, `bunya-support-${route}-${today}.csv`)
        : downloadFile(`/registers/${route}?from=${from}&to=${to}`, `bunya-support-${route}-${from}-to-${to}.csv`))
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Couldn't download the file. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="registers-heading" className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id="registers-heading" className="text-base font-semibold">Registers for auditors</h3>
        <p className={`text-sm ${muted}`}>Download one register as a CSV file, with names, labels and dates in your organisation's time. Each download is recorded.</p>
      </div>
      <div className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
        <SelectField
          label="Register"
          value={route}
          onChange={e => { setRoute(e.target.value); setRangeError(undefined); setFailure(null) }}
          options={REGISTERS.filter(r => canComplaints || r.route !== 'complaints').map(r => ({ value: r.route, label: r.label }))}
        />
        {register.snapshot ? (
          <p className={`text-sm ${muted}`}>Shows the register as it stands today, so there are no dates to choose.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="From" type="date" value={from} onChange={e => { setFrom(e.target.value); setRangeError(undefined) }} />
            <TextField label="To" type="date" value={to} error={rangeError} onChange={e => { setTo(e.target.value); setRangeError(undefined) }} />
          </div>
        )}
        <Button size="lg" className="w-full sm:w-auto sm:self-start" onClick={start} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
          {busy ? 'Downloading…' : 'Download CSV'}
        </Button>
        {failure && <Callout tone="danger" title="Couldn't download the register">{failure}</Callout>}
      </div>
    </section>
  )
}
