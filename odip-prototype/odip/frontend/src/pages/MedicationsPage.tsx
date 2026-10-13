import { useMemo } from 'react'
import { ClipboardList, BookOpen, FileClock } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'
import { usePermissions } from '@/lib/permissions'
import { useTabParam } from '@/hooks/useTabParam'
import { MarTab, RegisterTab, ReportTab } from './medications'

export default function MedicationsPage() {
  const { canViewAdministrationReport } = usePermissions()
  // The tab is in the URL (?tab=), so the medication form, opened from a Register row, returns to the Register.
  const tabKeys = useMemo(() => (canViewAdministrationReport ? ['administration', 'register', 'report'] : ['administration', 'register']), [canViewAdministrationReport])
  const [tab, setTab] = useTabParam(tabKeys, 'administration')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Medications" />

      <Tabs
        tabs={[
          { id: 'administration', label: 'Administration', icon: ClipboardList },
          { id: 'register', label: 'Register', icon: BookOpen },
          // Hidden for roles the report endpoint itself 403s (server-gated to
          // Admin/Coordinator/SuperAdmin) — otherwise the tab would render a "no
          // administrations found" empty state that's actually a permission denial.
          ...(canViewAdministrationReport ? [{ id: 'report' as const, label: 'Report', icon: FileClock }] : []),
        ]}
        active={tab}
        onChange={setTab}
        ariaLabel="Medications sections"
      />

      <div className="animate-fade-in">
        {tab === 'administration' && <MarTab />}
        {tab === 'register' && <RegisterTab />}
        {tab === 'report' && canViewAdministrationReport && <ReportTab />}
      </div>
    </div>
  )
}
