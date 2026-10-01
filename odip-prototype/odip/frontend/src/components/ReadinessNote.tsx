import { AlertTriangle } from 'lucide-react'
import { TONE } from '@/lib/tone'
import { cn } from '@/lib/utils'

export type ReadinessNoteVariant = 'chip' | 'line'

export type ReadinessNoteProps = {
  /** What is still missing, in the server's own words ("Intake not complete"). Renders nothing while this is empty, null or undefined. */
  issues?: readonly string[] | null
  /** `line` (default): a quiet line under a field. `chip`: a small pill for a table row or a header's meta row. */
  variant?: ReadinessNoteVariant
  className?: string
}

// The chip is StatusBadge's own 12px pill in the warning tone's solid pair. `min-w-0 max-w-full` plus the `truncate` text let it
// give way in a narrow row (an ellipsis, with the whole text in `title`) instead of pushing its neighbours.
//
// The text is all-or-nothing, never a sliver. It has a small flex-basis (`basis-12`) inside a wrapping, clipped, one-line box
// (`flex-wrap overflow-hidden h-5`, and a row gap taller than the box): while at least that much room is left it shows, and
// truncates with an ellipsis; below it the text wraps out of the clipped box and the icon is centred in the pill. Without this a
// chip squeezed to ~30px drew its icon and a 1px fragment of the first letter. The words stay in the DOM either way (clipped, not
// removed), so assistive tech still reads them, and `title` still carries them.
const CHIP = `inline-flex h-5 min-w-0 max-w-full flex-wrap content-start items-center justify-center gap-x-1 gap-y-5 overflow-hidden rounded-full px-2 py-0.5 text-xs ${TONE.warning.solid}`
// The line is the tone's ink on the card, no wash: it should read as a note, not as a banner asking for action. It wraps (up to
// three lines) rather than cutting at one, because on a touch screen the `title` is not reachable and this is where the detail shows.
const LINE = `flex min-w-0 items-start gap-1.5 text-xs font-medium ${TONE.warning.ink}`

/**
 * A quiet, never-blocking note that a participant is not fully ready yet: "Not ready: Intake not complete · No signed service agreement".
 * In Warn mode the server lets rostering, booking and activation go ahead and reports what is missing; this is how that shows.
 *
 * It is informational. It is not an alert (no `role="alert"`), it never disables or hides a control, and colour is not its only cue
 * (the words are always printed). It draws nothing when there is nothing missing, so a ready participant looks exactly as before.
 */
export function ReadinessNote({ issues, variant = 'line', className }: ReadinessNoteProps) {
  if (!issues || issues.length === 0) return null

  const text = `Not ready: ${issues.join(' · ')}`
  const isChip = variant === 'chip'
  const Tag = isChip ? 'span' : 'p'

  return (
    <Tag
      title={text}
      // A line appears when the user picks a participant, so it is announced politely; a chip is part of a row or a header and is not.
      role={isChip ? undefined : 'status'}
      className={cn(isChip ? CHIP : LINE, className)}
    >
      <AlertTriangle aria-hidden="true" className={isChip ? 'h-3 w-3 shrink-0' : 'mt-px h-3.5 w-3.5 shrink-0'} />
      <span className={isChip ? 'min-w-0 flex-1 basis-12 truncate' : 'line-clamp-3 min-w-0 break-words'}>{text}</span>
    </Tag>
  )
}
