import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useParticipant, useParticipantBookings, useSupportProfile } from '@/api/hooks'
import { formatDateAu, maskNdisNumber } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { TabNav } from '@/components/TabNav'
import { StatusBadge } from '@/components/StatusBadge'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { Card } from '@/components/Card'
import { ArrowLeft, Users, Shield, ClipboardList, Pencil, Pill, StickyNote, ListChecks, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { usePermissions } from '@/lib/permissions'
import { OVERNIGHT_SUPPORT_LABELS, OVERNIGHT_RATIO_LABELS } from '@/api/types/participants'
import { MedicationsTab, NotesTab, RoutinesTab, RestrictivePracticesTab } from './participant-detail'

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
      {label}
    </span>
  )
}

export default function ParticipantDetailPage() {
  const { canWrite } = usePermissions()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  type Tab = 'details' | 'bookings' | 'support' | 'medications' | 'notes' | 'routines' | 'restrictive-practices' | 'history'
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    initialTab === 'bookings' || initialTab === 'support' || initialTab === 'medications' || initialTab === 'notes' || initialTab === 'routines' || initialTab === 'restrictive-practices' || initialTab === 'history' ? initialTab : 'details'
  )
  const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const isAdmin = currentUser.role === 'Admin'
  const { data: p, isLoading } = useParticipant(id)
  const { data: bookings = [] } = useParticipantBookings(id)
  const { data: supportProfile } = useSupportProfile(id)

  if (isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!p) return <div className="text-center py-12">Participant not found</div>

  const mobilityAidBadges = [
    p.mobilityAidWheelchair && 'Wheelchair',
    p.mobilityAidWalker && 'Walker',
  ].filter((v): v is string => !!v)

  const equipmentBadges = [
    p.requiresHiLoBed && 'Hi-Lo Bed',
    p.requiresHoist && 'Hoist',
    p.requiresShowerChair && 'Shower Chair',
    p.requiresCommode && 'Commode',
    p.requiresStandingMachine && 'Standing Machine',
  ].filter((v): v is string => !!v)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <Link to="/participants" className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{p.fullName}</h1>
            <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} />
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{p.region || 'No region'} · {p.planType} · Support Ratio: {p.supportRatio}</p>
          <div className="mt-2">
            <ServiceStreamBadges value={p.serviceStreams} />
          </div>
        </div>
        {canWrite && (
          <Link to={`/participants/${id}/edit`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
            <Pencil className="w-4 h-4" /> Edit
          </Link>
        )}
      </div>

      <TabNav
        tabs={[
          { key: 'details', label: 'Details', icon: Users },
          { key: 'bookings', label: 'Bookings', icon: ClipboardList },
          { key: 'support', label: 'Support Profile', icon: Shield },
          { key: 'medications', label: 'Medications', icon: Pill },
          { key: 'notes', label: 'Notes', icon: StickyNote },
          { key: 'routines', label: 'Routines', icon: ListChecks },
          { key: 'restrictive-practices', label: 'Restrictive Practices', icon: ShieldAlert },
          ...(isAdmin ? [{ key: 'history' as const, label: 'History' }] : []),
        ]}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      {tab === 'details' && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card title="Personal Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              <span className="text-[var(--color-muted-foreground)]">NDIS Number</span><span className="font-mono">{p.ndisNumber ? maskNdisNumber(p.maskedNdisNumber || p.ndisNumber) : '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Date of Birth</span><span>{formatDateAu(p.dateOfBirth)}</span>
              <span className="text-[var(--color-muted-foreground)]">Funding Org</span><span>{p.fundingOrganisation || '—'}</span>
              <span className="text-[var(--color-muted-foreground)]">Repeat Client</span><span>{p.isRepeatClient ? 'Yes' : 'No'}</span>
              <span className="text-[var(--color-muted-foreground)]">Preferred Staff</span><span>{p.preferredStaffName ?? '—'}</span>
            </div>
          </Card>
          <Card title="Support Needs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
              <span className="text-[var(--color-muted-foreground)]">Mobility Aids</span>
              <span className="flex flex-wrap gap-1">
                {mobilityAidBadges.length ? mobilityAidBadges.map(b => <Tag key={b} label={b} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">Mobility Support</span>
              <span className="flex flex-wrap gap-1">
                {p.mobilitySupportOptions?.length ? p.mobilitySupportOptions.map(o => <Tag key={o} label={o} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">High Support</span><span>{p.isHighSupport ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-[var(--color-primary)]">check_circle</span> Yes</span> : 'No'}</span>
              <span className="text-[var(--color-muted-foreground)]">Overnight Support</span>
              <span>{p.overnightSupport && p.overnightSupport !== 'None' ? `${OVERNIGHT_SUPPORT_LABELS[p.overnightSupport]} (${OVERNIGHT_RATIO_LABELS[p.overnightRatio]})` : 'None'}</span>
              <span className="text-[var(--color-muted-foreground)]">Equipment</span>
              <span className="flex flex-wrap gap-1">
                {equipmentBadges.length ? equipmentBadges.map(b => <Tag key={b} label={b} />) : '—'}
              </span>
              <span className="text-[var(--color-muted-foreground)]">Restrictive Practice</span><span>{p.hasRestrictivePracticeFlag ? <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none text-amber-500">warning</span> Yes</span> : 'No'}</span>
            </div>
          </Card>
          {(p.mobilityNotes || p.transportRequirements || p.equipmentRequirements || p.notes) && (
            <Card title="Notes" className="md:col-span-2">
              <div className="text-sm space-y-2 text-[var(--color-muted-foreground)]">
                {p.mobilityNotes && <p><strong>Mobility:</strong> {p.mobilityNotes}</p>}
                {p.transportRequirements && <p><strong>Transport:</strong> {p.transportRequirements}</p>}
                {p.equipmentRequirements && <p><strong>Equipment:</strong> {p.equipmentRequirements}</p>}
                {p.notes && <p><strong>General:</strong> {p.notes}</p>}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'bookings' && (
        <DataTable
          data={bookings}
          keyField="id"
          columns={[
            {
              key: 'tripName',
              header: 'Trip',
              render: (b: any) => (
                <Link to={`/trips/${b.tripInstanceId}`} className="font-medium hover:text-[var(--color-primary)]">
                  {b.tripName || 'Trip'}
                </Link>
              ),
            },
            { key: 'bookingStatus', header: 'Status', type: 'badge' },
            { key: 'bookingDate', header: 'Date', type: 'date' },
          ]}
          emptyMessage="No bookings"
        />
      )}

      {tab === 'support' && (
        <Card>
          {!supportProfile ? (
            <p className="text-[var(--color-muted-foreground)]">No support profile recorded</p>
          ) : (
            <div className="space-y-4 text-sm">
              {[
                { label: 'Communication Notes', value: supportProfile.communicationNotes },
                { label: 'Behaviour Support', value: supportProfile.behaviourSupportNotes },
                { label: 'Restrictive Practice Details', value: supportProfile.restrictivePracticeDetails },
                { label: 'Manual Handling', value: supportProfile.manualHandlingNotes },
                { label: 'Medication & Health', value: supportProfile.medicationHealthSummary },
                { label: 'Emergency Considerations', value: supportProfile.emergencyConsiderations },
                { label: 'Travel-Specific', value: supportProfile.travelSpecificNotes },
              ].filter(f => f.value).map(f => (
                <div key={f.label}>
                  <p className="font-medium text-[var(--color-muted-foreground)] mb-1">{f.label}</p>
                  <p className="whitespace-pre-line">{f.value}</p>
                </div>
              ))}
              {supportProfile.reviewDate && <p className="text-xs text-[var(--color-muted-foreground)]">Review Date: {formatDateAu(supportProfile.reviewDate)}</p>}
            </div>
          )}
        </Card>
      )}

      {tab === 'medications' && (
        <MedicationsTab participantId={id} />
      )}

      {tab === 'notes' && (
        <NotesTab participantId={id} />
      )}

      {tab === 'routines' && (
        <RoutinesTab participantId={id} />
      )}

      {tab === 'restrictive-practices' && (
        <RestrictivePracticesTab participantId={id} />
      )}

      {tab === 'history' && isAdmin && p && (
        <AuditHistoryTab entityType="Participant" entityId={String(p.id)} />
      )}
    </div>
  )
}
