import { useState } from 'react'
import { ClipboardList, BookOpen } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { TabNav } from '@/components/TabNav'
import { MarTab, RegisterTab } from './medications'

type Tab = 'administration' | 'register'

export default function MedicationsPage() {
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
        ]}
        active={tab}
        onChange={key => setTab(key as Tab)}
      />

      <div className="animate-fade-in">
        {tab === 'administration' && <MarTab />}
        {tab === 'register' && <RegisterTab />}
      </div>
    </div>
  )
}
