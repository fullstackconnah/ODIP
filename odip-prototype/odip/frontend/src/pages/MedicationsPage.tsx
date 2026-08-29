import { useState } from 'react'
import { ClipboardList, BookOpen, FileClock } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { TabNav } from '@/components/TabNav'
import { usePermissions } from '@/lib/permissions'
import { MarTab, RegisterTab, ReportTab } from './medications'

type Tab = 'administration' | 'register' | 'report'

export default function MedicationsPage() {
  const { canViewAdministrationReport } = usePermissions()
  const [tab, setTab] = useState<Tab>('administration')

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Medications"
        subtitle="Medication administration record and the participant medication register"
      />

      <TabNav
        tabs={[
          { key: 'administration', label: 'Administration', icon: ClipboardList },
          { key: 'register', label: 'Register', icon: BookOpen },
          // Hidden for roles the report endpoint itself 403s (server-gated to
          // Admin/Coordinator/SuperAdmin) — otherwise the tab would render a "no
          // administrations found" empty state that's actually a permission denial.
          ...(canViewAdministrationReport ? [{ key: 'report' as const, label: 'Report', icon: FileClock }] : []),
        ]}
        active={tab}
        onChange={key => setTab(key as Tab)}
      />

      <div className="animate-fade-in">
        {tab === 'administration' && <MarTab />}
        {tab === 'register' && <RegisterTab />}
        {tab === 'report' && canViewAdministrationReport && <ReportTab />}
      </div>
    </div>
  )
}
