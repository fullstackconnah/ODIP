import { useState } from 'react'
import { ClipboardList, BookOpen, FileClock } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'
import { usePermissions } from '@/lib/permissions'
import { MarTab, RegisterTab, ReportTab } from './medications'

type Tab = 'administration' | 'register' | 'report'

export default function MedicationsPage() {
  const { canViewAdministrationReport } = usePermissions()
  const [tab, setTab] = useState<Tab>('administration')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Medications"
        subtitle="Medication administration record and the participant medication register"
      />

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
        onChange={key => setTab(key as Tab)}
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
