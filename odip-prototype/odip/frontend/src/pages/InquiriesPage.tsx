import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPlus, Plus } from 'lucide-react'
import { Card } from '@/components/Card'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useConvertParticipantInquiry, useCreateParticipantInquiry, useParticipantInquiries, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquirySource, ParticipantInquiryDto } from '@/api/types'
import { usePermissions } from '@/lib/permissions'

const blank = (): CreateParticipantInquiryDto => ({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' })

export default function InquiriesPage() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle } = usePermissions()
  const { data: inquiries = [], isLoading, isError, refetch } = useParticipantInquiries()
  const create = useCreateParticipantInquiry()
  const update = useUpdateParticipantInquiry()
  const convert = useConvertParticipantInquiry()
  const [form, setForm] = useState<CreateParticipantInquiryDto>(blank)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSaving = create.isPending || update.isPending
  const openNew = () => { setError(null); setEditingId(null); setForm(blank()); setShowForm(true) }
  const closeForm = () => { setError(null); setEditingId(null); setForm(blank()); setShowForm(false) }
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError(null)
    if (editingId) update.mutate({ id: editingId, data: form }, { onSuccess: () => { setEditingId(null); setForm(blank()); setShowForm(false) }, onError: () => setError('Could not update this enquiry. Check the details and try again.') })
    else create.mutate(form, { onSuccess: () => { setForm(blank()); setShowForm(false) }, onError: () => setError('Could not capture this enquiry. Check the details and try again.') })
  }
  const startIntake = (id: string) => {
    setError(null)
    convert.mutate({ id }, { onSuccess: (inquiry: ParticipantInquiryDto) => { if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`) }, onError: () => setError('Could not start intake. Please try again.') })
  }
  const edit = (inquiry: ParticipantInquiryDto) => {
    setError(null)
    setEditingId(inquiry.id)
    setForm({ firstName: inquiry.firstName, lastName: inquiry.lastName, phone: inquiry.phone ?? '', email: inquiry.email ?? '', source: inquiry.source, provenance: inquiry.provenance ?? '' })
    setShowForm(true)
  }
  const columns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Name', sortable: true, render: row => `${row.firstName} ${row.lastName}` },
    { key: 'phone', header: 'Contact', render: row => row.phone || row.email || 'No contact details' },
    { key: 'source', header: 'Source', sortable: true },
    { key: 'provenance', header: 'Provenance', render: row => row.provenance || '—' },
    { key: 'participantId', header: 'Status', render: row => row.participantId ? <StatusBadge status="draftintake" label="Draft intake" /> : <StatusBadge status="new" label="New" /> },
    { key: 'id', header: 'Actions', type: 'custom', render: row => canManageParticipantLifecycle ? <div className="flex flex-wrap gap-2"><button type="button" className="rounded border px-3 py-1" onClick={() => edit(row)}>Edit enquiry</button>{row.participantId ? <button type="button" className="rounded bg-[var(--color-primary)] px-3 py-1 text-white" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake</button> : <button type="button" disabled={convert.isPending} className="rounded bg-[var(--color-primary)] px-3 py-1 text-white disabled:opacity-60" onClick={() => startIntake(row.id)}>Start intake</button>}</div> : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span> },
  ]
  const showEmptyState = !isError && !isLoading && inquiries.length === 0 && !showForm
  const showTable = !isError && !showEmptyState && (inquiries.length > 0 || isLoading)
  return <div className="space-y-6 animate-fade-in">
    <PageHeader
      title="Enquiries"
      subtitle="Capture new enquiries and start their intake. Starting intake creates an inactive draft participant you can come back to."
      action={canManageParticipantLifecycle && !showForm && !showEmptyState ? <button type="button" onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20 transition-all"><Plus className="w-4 h-4" /> New enquiry</button> : undefined}
    />
    {isError && <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm flex flex-wrap items-center justify-between gap-3"><span>Could not load enquiries. Please try again.</span><button type="button" className="font-medium underline shrink-0" onClick={() => refetch()}>Retry</button></div>}
    {!canManageParticipantLifecycle && <p role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">You can review enquiries, but your role cannot capture, edit, or start participant intake.</p>}
    {error && <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">{error}</p>}
    {canManageParticipantLifecycle && showForm && <Card title={editingId ? 'Edit enquiry' : 'New enquiry'}>
      <form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={submit}>
        <FormField label="First name" required><input id="inquiry-first-name" required autoComplete="given-name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></FormField>
        <FormField label="Last name" required><input id="inquiry-last-name" required autoComplete="family-name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></FormField>
        <FormField label="Phone"><input id="inquiry-phone" type="tel" autoComplete="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormField>
        <FormField label="Email"><input id="inquiry-email" type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></FormField>
        <FormField label="Source"><select id="inquiry-source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value as InquirySource })}><option>Web</option><option>Email</option><option>Phone</option></select></FormField>
        <FormField label="Provenance or referral notes"><input id="inquiry-provenance" autoComplete="off" value={form.provenance} onChange={e => setForm({ ...form, provenance: e.target.value })} /></FormField>
        <div className="flex gap-2 md:col-span-2"><button disabled={isSaving} className="rounded bg-[var(--color-primary)] px-4 py-2 text-white">{editingId ? 'Save enquiry' : 'Capture enquiry'}</button><button type="button" className="rounded border px-4 py-2" onClick={closeForm}>Cancel</button></div>
      </form>
    </Card>}
    {showEmptyState && <EmptyState icon={ClipboardPlus} title="No enquiries captured yet" description="Capture a light enquiry when someone first contacts the service, then start their draft intake when ready." action={canManageParticipantLifecycle ? { label: 'New enquiry', onClick: openNew } : undefined} />}
    {showTable && <DataTable data={inquiries} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No enquiries captured yet." />}
  </div>
}
