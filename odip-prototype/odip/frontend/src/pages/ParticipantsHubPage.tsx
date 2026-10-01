import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { Tabs, type TabItem } from '@/components/Tabs'
import { ParticipantsTable } from './ParticipantsPage'
import { OnboardingTable } from './OnboardingPage'
import { InquiriesTable } from './InquiriesPage'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useTabParam } from '@/hooks/useTabParam'
import { usePermissions } from '@/lib/permissions'

/** Canonical order for the lifecycle-stage tabs. */
type TabId = 'enquiries' | 'onboarding' | 'active'

const TABS: { id: TabId; label: string; title: string; description: string }[] = [
  {
    id: 'enquiries',
    label: 'Enquiries',
    title: 'Enquiries',
    description: 'Lightweight capture of new prospects before intake.',
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    title: 'Onboarding',
    description: 'Worklist of participants mid-onboarding — gate progress and blockers.',
  },
  {
    id: 'active',
    label: 'Active participants',
    title: 'Active participants',
    description: 'The operational register — participants you can roster and book.',
  },
]

const DEFAULT_TAB: TabId = 'active'

const TAB_KEYS: TabId[] = TABS.map(t => t.id)

/**
 * Hub page that unifies the Enquiries, Onboarding and Active participants routes
 * behind one shared PageHeader and one accessible Tabs primitive. Each tab mounts
 * the same body content as the corresponding standalone page; the standalone
 * /inquiries, /onboarding and /participants routes continue to work for deep links.
 *
 * The New enquiry button lives in the hub's PageHeader `action` slot so it's
 * visible on every stage (enquiries / onboarding / active) for users with the
 * participant-lifecycle mutation capability, and routes to the dedicated
 * /participants/new-inquiry page.
 */
export default function ParticipantsHubPage() {
  const { canManageParticipantLifecycle } = usePermissions()
  // The stage is `?tab=` (shareable and bookmarkable; the default drops the param) and the URL is its only source, read from the ROUTER's
  // location so the page is correct under MemoryRouter in tests and BrowserRouter in the app.
  const [activeId, selectTab] = useTabParam(TAB_KEYS, DEFAULT_TAB)
  const activeMeta = TABS.find(t => t.id === activeId) ?? TABS[2]

  // Each body export renders its own PageHeader via its standalone page wrapper
  // (e.g. ParticipantsPage), but inside the hub we only want ONE h1 / document
  // title. The hub provides the single PageHeader and each tab panel renders the
  // *Table body export instead, which deliberately omits the per-page PageHeader.
  // The document title reflects the active stage so the browser tab still gives
  // the user per-stage orientation even though there's one route behind it all.
  useDocumentTitle(activeMeta.title)

  // The stage's one-line description used to sit in its own row inside every panel (20px + 16px of
  // spacing) under a generic page subtitle that just restated the three tab labels. It now IS the
  // inline subtitle beside the H1 (see `subtitle` below), so a panel is only its table.
  const items: TabItem[] = useMemo(
    () => TABS.map(t => ({
      id: t.id,
      label: t.label,
      content: (
        <>
          {t.id === 'enquiries' && <InquiriesTable />}
          {t.id === 'onboarding' && <OnboardingTable />}
          {t.id === 'active' && <ParticipantsTable />}
        </>
      ),
    })),
    [],
  )

  // Block flow, not a flex column with a section gap: the title row (32px) and the tab strip (40px
  // + its 1px rule) sit directly on each other, 73px in all, where the old markup spent 32 + 16 +
  // 41 and then a 36px description row before the table.
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Participants"
        subtitle={activeMeta.description}
        action={canManageParticipantLifecycle ? (
          <Button to="/participants/new-inquiry" size="md">
            <Plus className="w-4 h-4" /> New enquiry
          </Button>
        ) : undefined}
      />
      <Tabs tabs={items} active={activeId} onChange={selectTab} ariaLabel="Lifecycle stages" />
    </div>
  )
}