import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { labelClass } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { ToggleGroup } from '@/components/ToggleGroup'
import { WizardNavFooter, WizardShell, WizardStepHeading, WizardStepRail, type WizardStepDef } from '@/components/wizard'
import { useCommitImport, useDownloadImportTemplate, usePreviewImport, useUndoImport } from '@/api/hooks'
import type { ImportKind, ImportLanding, ImportPreviewDto, ImportResultDto, ImportRowDto, ImportRowStatus, ImportUndoBlockerDto } from '@/api/types'
import { newCompletionRequestId } from '@/lib/completionRequestId'
import { formatDateTimeAu, plural } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import ImportInvites from './ImportInvites'
import { undoBlockers } from './importUndoBlockers'

const MAX_BYTES = 5 * 1024 * 1024
const BACK_TO = '/settings?tab=import'

type StepKey = 'upload' | 'match' | 'preview' | 'review'
const STEPS: WizardStepDef<Record<string, never>>[] = [
  { key: 'upload', label: 'Upload file', fields: [] },
  { key: 'match', label: 'Match columns', fields: [] },
  { key: 'preview', label: 'Preview', fields: [] },
  { key: 'review', label: 'Import', fields: [] },
]
const ORDER = STEPS.map(s => s.key as StepKey)

/** What each kind imports, as the page words it. Staff is "Import staff", as the nav says, never "staff members"; an undone staff import deletes its accounts. */
const KIND: Record<ImportKind, { noun: string; title: string; listNoun: string; listTo: (landing: ImportLanding | null) => string; undone: string; undoRule: string }> = {
  participants: {
    noun: 'participant', title: 'Import participants', listNoun: 'participants',
    listTo: landing => landing === 'Onboarding' ? '/participants?tab=onboarding' : '/participants?tab=active',
    undone: 'are archived', undoRule: 'none of them has changed since the import',
  },
  staff: {
    noun: 'staff member', title: 'Import staff', listNoun: 'staff', listTo: () => '/staff',
    undone: 'are removed', undoRule: 'none of them has signed in or been rostered',
  },
}

const STATUS: Record<ImportRowStatus, { label: string; tone: 'info' | 'neutral' | 'danger' }> = {
  // Ready is in the pipeline with nothing wrong: info, as DESIGN.md's tone table has it (owner, 2026-10-13).
  Ready: { label: 'Ready', tone: 'info' },
  Skipped: { label: 'Skipped', tone: 'neutral' },
  Invalid: { label: "Can't import", tone: 'danger' },
}

const LANDINGS: { value: ImportLanding; label: string; hint: string }[] = [
  { value: 'Active', label: 'Already receiving services', hint: 'They go straight onto Active participants.' },
  { value: 'Onboarding', label: 'New onboarding', hint: 'They go onto the Onboarding tab, with their intake completed from this file.' },
]

/** The rows of a preview or a result: what each will do, and why. */
function RowsTable({ rows }: { rows: ImportRowDto[] }) {
  const columns: Column<ImportRowDto>[] = [
    // Name first, so it pins and a sideways-scrolled row is never anonymous; the row number finds it in the spreadsheet.
    { key: 'name', header: 'Name', mobile: 'primary' },
    { key: 'rowNumber', header: 'Row', align: 'right', mobile: 'meta', render: r => <><span className="mr-1 md:hidden">Row</span>{r.rowNumber}</> },
    { key: 'status', header: 'Status', mobile: 'status', render: r => <StatusBadge tone={STATUS[r.status].tone} label={STATUS[r.status].label} /> },
    {
      // meta on a phone card: one muted line, and a Ready row with nothing to say shows no empty Details label.
      key: 'details', header: 'Details', wrap: true, mobile: 'meta',
      render: r => {
        const lines = [...(r.skipReason ? [r.skipReason] : []), ...r.reasons, ...r.warnings]
        return lines.length > 0 && <ul className="text-sm">{lines.map(text => <li key={text}>{text}</li>)}</ul>
      },
    },
  ]
  return <DataTable data={rows} columns={columns} keyField="rowNumber" emptyMessage="No rows with this status." />
}

export default function ImportWizardPage() {
  const { kind: param } = useParams()
  const kind: ImportKind | null = param === 'participants' || param === 'staff' ? param : null
  const preview = usePreviewImport()
  const commit = useCommitImport()
  const undo = useUndoImport()
  const template = useDownloadImportTemplate()
  const [step, setStep] = useState<StepKey>('upload')
  const [visited, setVisited] = useState(() => new Set<string>(['upload']))
  const [file, setFile] = useState<File | null>(null)
  const [data, setData] = useState<ImportPreviewDto | null>(null)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [landing, setLanding] = useState<ImportLanding | null>(null)
  const [filter, setFilter] = useState<'all' | ImportRowStatus>('all')
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ImportResultDto | null>(null)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [undone, setUndone] = useState(false)
  const [blockers, setBlockers] = useState<ImportUndoBlockerDto[]>([])
  // One key per file: a retry after a lost response sends the same key and gets the same batch back, never a second import.
  const idempotencyKey = useRef(newCompletionRequestId())

  if (!kind) return <Navigate to={BACK_TO} replace />
  const { noun, title, listNoun, listTo, undone: undoneWord, undoRule } = KIND[kind]

  const go = (next: StepKey) => {
    setProblem(null)
    setStep(next)
    setVisited(v => new Set(v).add(next))
  }

  async function runPreview(next: StepKey, withMapping?: (string | null)[]) {
    if (!file || !kind) return
    try {
      const answer = await preview.mutateAsync({ kind, file, mapping: withMapping })
      setData(answer)
      if (!withMapping) setMapping(answer.columns.map(c => c.field))
      go(next)
    } catch (err) {
      setProblem(extractErrorMessage(err, 'The file could not be read.'))
    }
  }

  function handleNext() {
    setProblem(null)
    if (step === 'upload') {
      if (!file) return setProblem('Choose a .csv or .xlsx file first.')
      if (file.size > MAX_BYTES) return setProblem('The file is over 5 MB. Split it into smaller files and import each one.')
      void runPreview('match')
      return
    }
    if (step === 'match' && data) {
      const missing = data.fields.filter(f => f.required && !mapping.includes(f.key)).map(f => f.label)
      if (missing.length > 0) return setProblem(`Match a column to ${missing.join(', ')}.`)
      void runPreview('preview', mapping)
      return
    }
    if (step === 'preview' && data) {
      if (kind === 'participants' && !landing) return setProblem('Choose whether these participants are already receiving services or are new onboarding.')
      if (data.readyCount === 0) return setProblem('No rows are ready to import. Fix the file, then upload it again.')
      go('review')
    }
  }

  const back = () => go(ORDER[Math.max(0, ORDER.indexOf(step) - 1)])

  async function runImport() {
    setConfirming(false)
    if (!file || !kind) return
    try {
      setResult(await commit.mutateAsync({ kind, file, mapping, landing: landing ?? undefined, idempotencyKey: idempotencyKey.current }))
    } catch (err) {
      setProblem(extractErrorMessage(err, 'The import failed, so nothing was imported.'))
    }
  }

  async function runUndo() {
    setConfirmUndo(false)
    setProblem(null)
    setBlockers([])
    try {
      await undo.mutateAsync(result!.batchId)
      setUndone(true)
    } catch (err) {
      setProblem(extractErrorMessage(err, 'The import could not be undone.'))
      setBlockers(undoBlockers(err))
    }
  }

  const header = (
    <div className="flex items-start gap-2">
      <BackButton to={BACK_TO} label="import data" variant="icon" history={false} />
      <div className="flex-1 min-w-0"><PageHeader title={title} /></div>
    </div>
  )

  if (result) {
    const failed = result.rows.filter(r => r.status === 'Invalid')
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
        {header}
        {undone ? (
          <Callout tone="info" title="Import undone">{`The ${plural(result.createdCount, noun)} it created ${undoneWord}.`}</Callout>
        ) : (
          <Callout
            tone="success"
            title={`Imported ${plural(result.createdCount, noun)}`}
            actions={<>
              <Button to={listTo(landing)} variant="secondary" size="sm">View {listNoun}</Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmUndo(true)}>Undo import</Button>
            </>}
          >
            {`${result.skippedCount} skipped (already in ODIP), ${result.failedCount} couldn't be imported.`}
          </Callout>
        )}
        {kind === 'staff' && !undone && <ImportInvites batchId={result.batchId} count={result.createdCount} />}
        {problem && (
          <Callout tone="error" title={problem}>
            {blockers.length > 0 && (
              <ul className="list-disc pl-5">
                {blockers.map(b => <li key={b.entityId}>{b.name} {b.reason}</li>)}
              </ul>
            )}
          </Callout>
        )}
        {failed.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="import-failed">
            <h2 id="import-failed" className="text-base font-semibold">Rows that couldn't be imported</h2>
            <RowsTable rows={failed} />
          </section>
        )}
        <div><Button to={BACK_TO} variant="secondary">Back to import data</Button></div>
        <ConfirmDialog
          open={confirmUndo}
          title="Undo this import?"
          message={`The ${plural(result.createdCount, noun)} it created ${undoneWord}. This only works while ${undoRule}.`}
          confirmLabel="Undo import"
          variant="danger"
          loading={undo.isPending}
          onCancel={() => setConfirmUndo(false)}
          onConfirm={runUndo}
        />
      </div>
    )
  }

  const rows = data ? data.rows.filter(r => filter === 'all' || r.status === filter) : []
  const onSubmit = (e: FormEvent) => { e.preventDefault(); setConfirming(true) }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {header}
      <form onSubmit={onSubmit} noValidate>
        <WizardShell
          railLabel="Import steps"
          rail={<WizardStepRail steps={STEPS} visitedSteps={visited} currentKey={step} onSelect={k => visited.has(k) && go(k as StepKey)} ariaLabel="Import steps" filled />}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <WizardStepHeading stepKey={step} label={STEPS.find(s => s.key === step)!.label} />
            {problem && <Callout tone="error">{problem}</Callout>}

            {step === 'upload' && (
              <div className="flex max-w-xl flex-col gap-3">
                <div>
                  <label className={labelClass} htmlFor="import-file">File (.csv or .xlsx)</label>
                  <input
                    id="import-file" type="file" accept=".csv,.xlsx"
                    className="mt-1 block w-full rounded-[var(--radius-sm)] text-sm text-[var(--color-muted-foreground)] file:mr-3 file:h-[var(--control-h)] file:cursor-pointer file:rounded-[var(--radius-sm)] file:border file:border-solid file:border-[var(--color-border)] file:bg-[var(--color-card)] file:px-4 file:text-sm file:font-medium file:text-[var(--color-foreground)] hover:file:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                    onChange={e => {
                      setFile(e.target.files?.[0] ?? null); setData(null); idempotencyKey.current = newCompletionRequestId()
                      // A new file makes the later steps stale: they open again as Next reaches them.
                      setVisited(new Set(['upload'])); setFilter('all')
                    }}
                  />
                </div>
                <p className="text-sm text-[var(--color-muted-foreground)]">Up to 2,000 rows and 5 MB. The file is read to check it and is never stored.</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[var(--color-muted-foreground)]">Not sure how to lay it out?</span>
                  <Button type="button" variant="secondary" onClick={() => template.mutate(kind)}>Download the ODIP template</Button>
                </div>
              </div>
            )}

            {step === 'match' && data && (
              <div className="flex flex-col gap-3">
                <p className="text-sm">Each column in your file is matched to an ODIP field. Change any match, or choose Don't import. Fields marked * are required.</p>
                <DataTable
                  data={data.columns}
                  keyField="index"
                  columns={[
                    { key: 'header', header: 'Column in your file', mobile: 'primary', render: c => <span id={`import-col-${c.index}`}>{c.header}</span> },
                    {
                      key: 'field', header: 'ODIP field',
                      render: c => (
                        <Dropdown
                          variant="form"
                          aria-labelledby={`import-col-${c.index}`}
                          value={mapping[c.index] ?? ''}
                          onChange={value => {
                            setMapping(m => m.map((f, i) => (i === c.index ? value || null : f)))
                            // The preview shown so far was for the old matches.
                            setVisited(new Set(['upload', 'match']))
                          }}
                          items={[{ value: '', label: "Don't import" }, ...data.fields.map(f => ({ value: f.key, label: f.required ? `${f.label} *` : f.label }))]}
                        />
                      ),
                    },
                    { key: 'note', header: '', mobile: 'meta', render: c => c.note && <span className="text-sm text-[var(--color-muted-foreground)]">{c.note}</span> },
                  ]}
                />
              </div>
            )}

            {step === 'preview' && data && (
              <div className="flex flex-col gap-4">
                {data.previouslyImportedAt && (
                  <Callout tone="warning">{`This exact file was imported on ${formatDateTimeAu(data.previouslyImportedAt)}. Rows already in ODIP are skipped, but check before importing it again.`}</Callout>
                )}
                {kind === 'participants' && (
                  <fieldset className="grid gap-2 md:grid-cols-2">
                    <legend className={`${labelClass} mb-1`}>Where do these participants go?</legend>
                    {LANDINGS.map(option => (
                      <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)] text-sm has-[:checked]:border-[var(--color-primary)]">
                        <input className="mt-0.5 accent-[var(--color-primary)]" type="radio" name="landing" value={option.value} checked={landing === option.value} onChange={() => setLanding(option.value)} />
                        <span>
                          <span className="font-medium">{option.label}</span>
                          <span className="block text-[var(--color-muted-foreground)]">{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <ToggleGroup
                  className="flex-wrap [&>button]:whitespace-nowrap"
                  ariaLabel="Show rows"
                  value={filter}
                  onChange={key => setFilter(key as typeof filter)}
                  options={[
                    { key: 'all', label: `All (${data.rows.length})` },
                    { key: 'Ready', label: `Ready (${data.readyCount})` },
                    { key: 'Skipped', label: `Skipped (${data.skippedCount})` },
                    { key: 'Invalid', label: `Can't import (${data.invalidCount})` },
                  ]}
                />
                <RowsTable rows={rows} />
              </div>
            )}

            {step === 'review' && data && (
              <div className="flex max-w-xl flex-col gap-2 text-sm">
                <p>{`${plural(data.readyCount, noun)} will be created${landing ? `, ${LANDINGS.find(l => l.value === landing)!.label.toLowerCase()}` : ''}.`}</p>
                {data.skippedCount > 0 && <p>{`Skipped, already in ODIP: ${data.skippedCount}.`}</p>}
                {data.invalidCount > 0 && <p>{`Can't be imported: ${data.invalidCount}. Fix them in the file and import it again afterwards.`}</p>}
                {kind === 'staff' && <p>Nobody is emailed yet: send sign-in invites after the import, now or later from Import history.</p>}
                <p>Every row is checked again as it is imported. You can undo the whole import while nothing has been added to its records.</p>
              </div>
            )}

            <WizardNavFooter
              showBack={step !== 'upload'}
              onBack={back}
              onNext={handleNext}
              isReviewStep={step === 'review'}
              secondaryActions={[]}
              cancelTo={BACK_TO}
              history={false}
              submitLabel={`Import ${plural(data?.readyCount ?? 0, noun)}`}
              isSubmitting={commit.isPending}
              summary={commit.isPending ? <p className="text-sm text-[var(--color-muted-foreground)]">Large files can take up to a minute.</p> : undefined}
            />
          </div>
        </WizardShell>
      </form>
      <ConfirmDialog
        open={confirming}
        title={`Import ${plural(data?.readyCount ?? 0, noun)}?`}
        message={`${plural(data?.readyCount ?? 0, noun)} will be created. Rows skipped or that can't be imported are left out.`}
        confirmLabel="Import"
        loading={commit.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={runImport}
      />
    </div>
  )
}
