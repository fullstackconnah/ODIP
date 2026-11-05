import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLodgeRpReport, useUndoRpReport } from '@/api/hooks'
import { RP_REPORT_TYPE_LABELS, RP_VARIED_KIND_LABELS, RESTRICTIVE_PRACTICE_TYPE_LABELS, rpReportTypesFor } from '@/api/types/restrictive-practices'
import type { RpReportLine, RpReportType, RpVariedKind } from '@/api/types/restrictive-practices'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Callout } from '@/components/Callout'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { ToggleGroup } from '@/components/ToggleGroup'
import { FactList } from '@/components/FactList'
import { FormField, textareaClass } from '@/components/FormField'
import { TAP_FLOOR } from '@/components/tapArea'
import { useProviderToday } from '@/hooks/useProviderToday'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'
import { longDate, monthLabel, nextMonthStart, usedAtLabel } from './rpReportFormat'

type Props = {
  /** The month to lodge or view; null keeps the dialog closed. A line with a report opens read-only. */
  line: RpReportLine | null
  /** Lodge mode: the type to start on (the deactivate prompt offers Eliminated). */
  presetType?: RpReportType
  onClose: () => void
  /** The caller's refetch: a 409 means the month was lodged elsewhere, so Reload shows it as it now stands. */
  onReload: () => void
}

export function MonthlyReportModal({ line, presetType, onClose, onReload }: Props) {
  // Keyed per month, so reopening on another line starts clean.
  if (!line) return null
  const key = `${line.restrictivePracticeId}:${line.month}`
  return line.report
    ? <ViewBody key={key} line={line} onClose={onClose} />
    : <LodgeBody key={key} line={line} presetType={presetType} onClose={onClose} onReload={onReload} />
}

function ContextRow({ line }: { line: RpReportLine }) {
  return (
    <div className="space-y-0.5 text-sm">
      <p className="font-medium text-[var(--color-foreground)]">{line.participantName} · {RESTRICTIVE_PRACTICE_TYPE_LABELS[line.practiceType]} · {monthLabel(line.month)}</p>
      <p className="text-[var(--color-muted-foreground)]">Due by {longDate(line.dueOn)}</p>
    </div>
  )
}

type Errors = { type?: string; variedKind?: string; alsoUnauthorised?: string; lodgedOn?: string }

function LodgeBody({ line, presetType, onClose, onReload }: { line: RpReportLine; presetType?: RpReportType; onClose: () => void; onReload: () => void }) {
  const today = useProviderToday()
  const lodge = useLodgeRpReport()
  const prn = line.useKind === 'Prn'
  const [type, setType] = useState<RpReportType | ''>(presetType ?? (prn ? line.suggestedType ?? '' : ''))
  const [variedKind, setVariedKind] = useState<RpVariedKind | ''>('')
  const [alsoUnauthorised, setAlsoUnauthorised] = useState<'true' | 'false' | ''>('')
  // Follows the provider day (the browser's day until it loads) until the user types a date.
  const [typedOn, setLodgedOn] = useState<string | null>(null)
  const lodgedOn = typedOn ?? today
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<{ message: string; conflict: boolean } | null>(null)
  const month = monthLabel(line.month)
  const varied = type === 'VariedUse'
  const earliest = nextMonthStart(line.month)

  async function submit() {
    // The server's own checks and sentences, so a mistake shows before the round trip; the server stays authoritative.
    const next: Errors = {}
    if (!type) next.type = 'Choose a report type.'
    if (varied && !variedKind) next.variedKind = 'Choose how the use was varied.'
    if (varied && !alsoUnauthorised) next.alsoUnauthorised = 'Say whether the varied use was also unauthorised.'
    if (!lodgedOn) next.lodgedOn = 'Add the date you lodged it.'
    else if (lodgedOn > today) next.lodgedOn = "The lodged date can't be in the future."
    else if (lodgedOn < earliest) next.lodgedOn = 'The lodged date must be after the month ends.'
    setErrors(next)
    if (Object.keys(next).length > 0 || !type) return
    setServerError(null)
    try {
      await lodge.mutateAsync({
        restrictivePracticeId: line.restrictivePracticeId, month: line.month, reportType: type,
        variedKind: varied ? (variedKind || null) : null, variedAlsoUnauthorised: varied ? alsoUnauthorised === 'true' : null,
        note: note.trim() || null, lodgedOn,
      })
      onClose()
    } catch (err) {
      const conflict = apiErrorStatus(err) === 409
      setServerError({ message: conflict ? 'This month has already been lodged. Reload to see it.' : extractErrorMessage(err, "Couldn't record the report. Try again."), conflict })
    }
  }

  const pending = lodge.isPending
  return (
    <Modal
      open
      onClose={onClose}
      title="Lodge monthly report"
      size="md"
      stickyFooter
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Lodging…' : 'Lodge report'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ContextRow line={line} />
        <p className="text-sm text-[var(--color-muted-foreground)]">Lodge it in the NDIS Commission portal first, then record it here. Bunya Support doesn't send it.</p>
        {prn && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Uses in {month} ({line.uses.length})</h4>
            {line.uses.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No uses recorded in {month}.</p>
            ) : (
              <ul className="space-y-0.5 text-sm text-[var(--color-muted-foreground)]">
                {line.uses.map((u, i) => (
                  <li key={i}>
                    {u.incidentReportId
                      ? <Link to={`/incidents/${u.incidentReportId}`} className={`${TAP_FLOOR} text-[var(--color-primary)] underline underline-offset-2`}>{usedAtLabel(u.localDateTime)}</Link>
                      : usedAtLabel(u.localDateTime)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <FormField label="Report type" required error={errors.type}>
          <Dropdown
            variant="form"
            label="Choose a report type"
            value={type}
            onChange={v => setType(v as RpReportType)}
            items={rpReportTypesFor(line.useKind).map(t => ({ value: t, label: RP_REPORT_TYPE_LABELS[t] }))}
          />
        </FormField>
        {varied && (
          <>
            <FormField label="How was the use varied?" required error={errors.variedKind}>
              <ToggleGroup
                ariaLabel="How was the use varied?"
                options={(Object.keys(RP_VARIED_KIND_LABELS) as RpVariedKind[]).map(k => ({ key: k, label: RP_VARIED_KIND_LABELS[k] }))}
                value={variedKind}
                onChange={k => setVariedKind(k as RpVariedKind)}
              />
            </FormField>
            <FormField label="Was it also an unauthorised use?" required error={errors.alsoUnauthorised}>
              <ToggleGroup
                ariaLabel="Was it also an unauthorised use?"
                options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }]}
                value={alsoUnauthorised}
                onChange={k => setAlsoUnauthorised(k as 'true' | 'false')}
              />
            </FormField>
          </>
        )}
        {(type === 'Eliminated' || type === 'ServiceCeased') && (
          <Callout tone="info">No more monthly reports are listed for this practice after {month}.</Callout>
        )}
        <FormField label="Lodged in the portal on" required error={errors.lodgedOn}>
          <input type="date" value={lodgedOn} min={earliest} max={today} onChange={e => setLodgedOn(e.target.value)} />
        </FormField>
        <FormField label="Note (optional)">
          <textarea className={textareaClass} rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
        {serverError && (
          <Callout
            tone="danger"
            actions={serverError.conflict ? <Button variant="secondary" size="sm" onClick={() => { onReload(); onClose() }}>Reload</Button> : undefined}
          >
            {serverError.message}
          </Callout>
        )}
      </div>
    </Modal>
  )
}

function ViewBody({ line, onClose }: { line: RpReportLine; onClose: () => void }) {
  const undo = useUndoRpReport()
  const today = useProviderToday()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const report = line.report!
  const yesNo = (v: boolean | null) => (v == null ? null : v ? 'Yes' : 'No')

  async function confirmUndo() {
    setError(null)
    try {
      await undo.mutateAsync(report.id)
      onClose()
    } catch (err) {
      setConfirming(false)
      setError(extractErrorMessage(err, "Couldn't undo the report. Try again."))
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Monthly report, ${monthLabel(line.month)}`}
        size="md"
        stickyFooter
        footer={
          <>
            <Button variant="ghost-danger" className="mr-auto" onClick={() => setConfirming(true)}>Undo lodging</Button>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </>
        }
      >
        <div className="space-y-4">
          <ContextRow line={line} />
          <FactList
            hideEmpty
            items={[
              { label: 'Report type', value: RP_REPORT_TYPE_LABELS[report.reportType] },
              { label: 'Varied', value: report.variedKind ? RP_VARIED_KIND_LABELS[report.variedKind] : null },
              { label: 'Also unauthorised', value: yesNo(report.variedAlsoUnauthorised) },
              { label: 'Uses at lodging', value: report.useCount == null ? null : String(report.useCount) },
              { label: 'Lodged in the portal on', value: formatDateAu(report.lodgedOn) },
              { label: 'Recorded by', value: report.lodgedByName },
              { label: 'Note', value: report.note },
            ]}
          />
          {error && <Callout tone="danger">{error}</Callout>}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmUndo}
        title="Undo this lodged report?"
        message={`${monthLabel(line.month)} goes back to ${line.dueOn < today ? 'Overdue' : 'Due'} in Bunya Support. Nothing changes in the NDIS Commission portal.`}
        confirmLabel="Undo lodging"
        variant="danger"
        loading={undo.isPending}
      />
    </>
  )
}
