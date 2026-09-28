import { useCallback, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { Tabs, type TabItem } from '@/components/Tabs'
import { ParticipantsTable } from './ParticipantsPage'
import { OnboardingTable } from './OnboardingPage'
import { InquiriesTable } from './InquiriesPage'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
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

function readTabFromUrl(search: string): TabId {
  const raw = new URLSearchParams(search).get('tab')
  return TABS.some(t => t.id === raw) ? (raw as TabId) : DEFAULT_TAB
}

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
  // Read the tab from the ROUTER's location, never window.location: this keeps the page correct
  // under MemoryRouter in tests and under BrowserRouter in the app, with no cross-test leakage.
  const location = useLocation()
  const navigate = useNavigate()
  const { canManageParticipantLifecycle } = usePermissions()
  const [activeId, setActiveId] = useState<TabId>(() => readTabFromUrl(location.search))
  const activeMeta = TABS.find(t => t.id === activeId) ?? TABS[2]

  // Mirror the active tab into the URL (?tab=…) so a stage is shareable/bookmarkable. Uses the
  // router's history so the entry belongs to the same history stack the app navigates with.
  const selectTab = useCallback((id: string) => {
    setActiveId(id as TabId)
    const params = new URLSearchParams(location.search)
    if (id === DEFAULT_TAB) params.delete('tab')
    else params.set('tab', id)
    const query = params.toString()
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true })
  }, [location.pathname, location.search, navigate])

  // Each body export renders its own PageHeader via its standalone page wrapper
  // (e.g. ParticipantsPage), but inside the hub we only want ONE h1 / document
  // title. The hub provides the single PageHeader and each tab panel renders the
  // *Table body export instead, which deliberately omits the per-page PageHeader.
  // The document title reflects the active stage so the browser tab still gives
  // the user per-stage orientation even though there's one route behind it all.
  useDocumentTitle(activeMeta.title)

  const items: TabItem[] = useMemo(
    () => TABS.map(t => ({
      id: t.id,
      label: t.label,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-muted-foreground)]">{t.description}</p>
          {t.id === 'enquiries' && <InquiriesTable />}
          {t.id === 'onboarding' && <OnboardingTable />}
          {t.id === 'active' && <ParticipantsTable />}
        </div>
      ),
    })),
    [],
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Participants"
        subtitle="Enquiries, onboarding and active participants — one view, three stages."
        action={canManageParticipantLifecycle ? (
          <Button to="/participants/new-inquiry" size="lg">
            <Plus className="w-4 h-4" /> New enquiry
          </Button>
        ) : undefined}
      />
      <Tabs tabs={items} active={activeId} onChange={selectTab} ariaLabel="Lifecycle stages" />
    </div>
  )
}