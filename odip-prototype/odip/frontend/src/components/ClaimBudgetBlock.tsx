import type { ClaimBudgetDto, ClaimBudgetRowDto } from '@/api/types'
import { claimBudgetLine } from '@/lib/budgetLedger'

// What a claim does to each participant's budget (budget feature, phase 2a), shown in the two generate-claim previews and on the claim's own page. One row per affected pool and period:
// what the claim uses, what would be left after, and whether that leaves the period over. A warning, never a block (the owner's decision: nothing about a budget stops a claim being
// generated, in any mode), so the over line is a warning tone and the word "Generate" stays enabled.

/** One participant's rows, under their name when the claim covers more than one. */
function ParticipantRows({ name, showName, rows }: { name: string; showName: boolean; rows: ClaimBudgetRowDto[] }) {
  return (
    <div className="flex flex-col gap-1">
      {showName && <p className="text-xs font-medium text-[var(--color-muted-foreground)]">{name}</p>}
      {rows.map((row, i) => {
        const { text, over } = claimBudgetLine(row)
        return (
          <p key={`${row.poolName}-${row.periodStart ?? i}-${i}`} className={over ? 'text-sm text-[var(--color-on-warning-container)]' : 'text-sm text-[var(--color-muted-foreground)]'}>
            {text}
          </p>
        )
      })}
    </div>
  )
}

/**
 * The budget block of a claim preview or a claim, or nothing at all when it is absent: the server leaves it out when none of the participants has a plan that has started, and an
 * absent block means "no figure to show", not "nothing left". `heading` names what the block is on each screen.
 */
export function ClaimBudgetBlock({ budget, heading = 'Budget' }: { budget?: ClaimBudgetDto | null; heading?: string }) {
  if (!budget || budget.participants.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={heading}>
      <h4 className="text-sm font-medium text-[var(--color-muted-foreground)]">{heading}</h4>
      {budget.participants.map(participant => (
        <ParticipantRows key={participant.participantId} name={participant.participantName} showName={budget.participants.length > 1} rows={participant.rows} />
      ))}
      <p className="text-[13px] text-[var(--color-muted-foreground)]">
        A budget never stops a claim being generated. These figures are what the claim would use of the plan recorded here.
      </p>
    </section>
  )
}
