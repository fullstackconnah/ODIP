import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { FilePenLine, ListChecks, NotebookPen, Pill, Plus, ShieldAlert, UserPlus, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFundingPlans } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { quickAddSpans } from './quickAddLayout'

// The Overview's Quick add band: one tile per record the office adds all day, each one tap from "go to the section and open its add" (the ?add=1 plumbing in hooks/useQuickAdd).
// A tile the role cannot add with is not drawn; ProfileMapCard already serves "go to" for every tab. The tiles are the Attention band's glance tile behaviour (bordered
// --radius-md tile, 8px between, hover a surface step, press-in on pointer-down) with an icon on the Selected Tint in place of a figure.

type Tile = { key: string; label: string; name: string; icon: LucideIcon; to: string; plus: boolean }

const section = (tab: string, id: string) => `?tab=${tab}&section=${id}`

// 420 tracks: every row length from 1 to 7 divides it, so the tiles of a row span equal shares (the 60 tracks of bandLayout stop at 5 a row).

const TILE_CLASS = 'flex h-full min-w-0 flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 min-h-[var(--tap-min)] transition-[transform,background-color] duration-100 hover:bg-[var(--color-surface-container)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'
const SPAN_CLASS = 'px-1 col-span-(--q0) @min-[36rem]:col-span-(--q1) @min-[56rem]:col-span-(--q2)'

export default function QuickAddBand({ participantId, onGo }: { participantId: string; onGo: (to: string) => void }) {
  const { canWriteNotes, canWriteRoutines, canWriteRestrictivePractices, canManageMedications, canWriteContacts, canManageFunding, canAccessPage } = usePermissions()
  // Only a recorded-nothing participant gets "Record": until the plans answer (or if they fail) the tile just opens the section, never a wrong "Record".
  const plans = useFundingPlans(participantId, canManageFunding)
  const noPlan = plans.isSuccess && (plans.data.plans ?? []).length === 0

  const tiles: Tile[] = [
    canWriteNotes && { key: 'note', label: 'Note', name: 'Add a note', icon: NotebookPen, to: `${section('records', 'notes')}&add=1`, plus: true },
    canWriteRoutines && { key: 'routine', label: 'Routine', name: 'Add a routine', icon: ListChecks, to: `${section('daily', 'routines')}&add=1`, plus: true },
    canWriteRestrictivePractices && { key: 'rp', label: 'Restrictive practice', name: 'Add a restrictive practice', icon: ShieldAlert, to: `${section('health', 'restrictive-practices')}&add=1`, plus: true },
    canManageMedications && { key: 'medication', label: 'Medication', name: 'Add a medication', icon: Pill, to: `/medications/new?participantId=${participantId}`, plus: true },
    canWriteContacts && { key: 'contact', label: 'Contact', name: 'Add a contact', icon: UserPlus, to: `${section('people', 'contacts')}&add=1`, plus: true },
    canManageFunding && {
      key: 'budget', label: 'Plan budget', name: noPlan ? 'Record the plan budget' : 'Open the plan budget', icon: Wallet,
      to: `${section('funding', 'plan-budget')}${noPlan ? '&add=1' : ''}`, plus: noPlan,
    },
    // Agreements: the tab only. A new agreement is the tab's own act, and this tile must never open a second draft of an existing one.
    canAccessPage('agreement-drafts') && { key: 'agreement', label: 'Agreement', name: 'Open agreements', icon: FilePenLine, to: '?tab=agreements', plus: false },
  ].filter((t): t is Tile => !!t)
  if (tiles.length === 0) return null

  const spans = quickAddSpans(tiles.length)
  return (
    <section aria-labelledby="quick-add-heading" className="@container">
      <h2 id="quick-add-heading" className="mb-2 text-base font-semibold">Quick add</h2>
      <ul className="-mx-1 grid list-none grid-cols-420 gap-y-2 p-0">
        {tiles.map((t, i) => (
          <li key={t.key} className={SPAN_CLASS} style={{ '--q0': spans[i][0], '--q1': spans[i][1], '--q2': spans[i][2] } as CSSProperties}>
            <Link
              to={t.to}
              aria-label={t.name}
              className={TILE_CLASS}
              onClick={e => {
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                onGo(t.to)
              }}
            >
              <span aria-hidden="true" className="relative flex h-[var(--control-h)] w-[var(--control-h)] shrink-0 items-center justify-center rounded-md bg-[var(--color-selected)] text-[var(--color-on-selected)]">
                <t.icon className="h-4 w-4" />
                {t.plus && <Plus className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-[var(--color-card)] p-px text-[var(--color-on-selected)]" strokeWidth={3} />}
              </span>
              <span aria-hidden="true" className="min-h-10 text-sm font-semibold leading-5 text-[var(--color-foreground)]">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
