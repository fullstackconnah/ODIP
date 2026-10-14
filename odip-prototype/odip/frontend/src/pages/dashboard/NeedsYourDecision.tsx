import { Card } from '@/components/Card'
import { AllClearRow } from './AttentionBand'
import { QuickGroup } from './QuickGroup'
import { isPresent, type GroupModel } from './quickGroup'
import type { DecisionState } from './useDecisionState'

/**
 * "Needs your decision" (SHAPE §4, §6). ONE card holds every group that has something (rows, a notice, or no answer yet), a group told from the next by
 * space and its heading. The groups at zero are named in one All clear row at the card's foot. With every group at zero, the row alone.
 */
export function NeedsYourDecision({ groups, state }: { groups: GroupModel[]; state: DecisionState }) {
  const notices = (group: GroupModel) => state.notices.filter((notice) => notice.subject === group.key).length
  const present = groups.filter((group) => isPresent(group, state.gone, notices(group)))
  const clear = groups.filter((group) => !present.includes(group)).map((group) => group.noun)
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Needs your decision</h2>
      {present.length === 0 ? (
        <AllClearRow labels={clear} />
      ) : (
        <Card>
          <div className="flex flex-col gap-[var(--card-pad)]">
            {present.map((group) => <QuickGroup key={group.key} model={group} state={state} />)}
            {clear.length > 0 && <AllClearRow labels={clear} />}
          </div>
        </Card>
      )}
    </div>
  )
}
