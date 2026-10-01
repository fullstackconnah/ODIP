import { useState } from 'react'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { useGeneratePattern } from '@/api/hooks'
import type { ShiftPatternDto, GeneratePatternResultDto } from '@/api/types'
import { countPatternOccurrences } from '../lib/roster'
import { plural } from '@/lib/format'

export type GeneratePatternDialogProps = {
  /** Null closes the dialog. Give it a `key` from the caller so state resets between targets. */
  pattern: ShiftPatternDto | null
  onClose: () => void
}

/**
 * Two-step confirm: pick a date range and see what it will do, then see the idempotent result as
 * counts.
 */
export function GeneratePatternDialog({ pattern, onClose }: GeneratePatternDialogProps) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [result, setResult] = useState<GeneratePatternResultDto | null>(null)
  const generatePattern = useGeneratePattern()

  if (!pattern) return null

  const rangeValid = !!from && !!to && from <= to
  const previewCount = rangeValid ? countPatternOccurrences(pattern, from, to) : null

  function handleClose() {
    setResult(null)
    onClose()
  }

  async function handleGenerate() {
    if (!pattern || !rangeValid) return
    const counts = await generatePattern.mutateAsync({ id: pattern.id, from, to })
    setResult(counts)
  }

  if (result) {
    return (
      <ConfirmDialog
        open
        onCancel={handleClose}
        title="Shifts generated"
        message={
          <>
            <p>
              Created <strong className="text-foreground">{result.created}</strong> shift{result.created === 1 ? '' : 's'}.
            </p>
            <p>
              Skipped <strong className="text-foreground">{result.skipped}</strong> — already on the roster from this pattern.
            </p>
            <p className="text-xs opacity-80">Running this again for the same range changes nothing further.</p>
          </>
        }
        footer={
          <Button size="md" onClick={handleClose}>
            Done
          </Button>
        }
      />
    )
  }

  return (
    <ConfirmDialog
      open
      onCancel={handleClose}
      title="Generate shifts"
      message={
        <>
          <p>
            Materialises real shifts for <strong className="text-foreground">{pattern.participantName}</strong>'s {pattern.dayOfWeek} pattern
            over the range below. This is safe to run more than once — dates that already carry a shift from this pattern are skipped, never duplicated.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <FormField label="From" required>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </FormField>
            <FormField label="To" required>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </FormField>
          </div>
          {rangeValid && (
            <p className="text-xs text-muted-foreground">
              {previewCount === 0
                ? "No matching dates in this range — nothing will be generated."
                : `Up to ${plural(previewCount ?? 0, 'shift')} — fewer if some are already on the roster.`}
            </p>
          )}
        </>
      }
      footer={
        <>
          <Button variant="secondary" size="md" onClick={handleClose}>
            Cancel
          </Button>
          <Button size="md" disabled={!rangeValid || generatePattern.isPending} onClick={handleGenerate}>
            {generatePattern.isPending ? 'Generating…' : 'Generate'}
          </Button>
        </>
      }
    />
  )
}
