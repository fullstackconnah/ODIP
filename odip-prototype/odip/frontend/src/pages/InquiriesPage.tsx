import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPlus } from 'lucide-react'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { useConvertParticipantInquiry, useCreateParticipantInquiry, useParticipantInquiries, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquirySource, ParticipantInquiryDto } from '@/api/types'
import { usePermissions } from '@/lib/permissions'

const blank = (): CreateParticipantInquiryDto => ({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' })

export default function InquiriesPage() {
  const navigate = useNavigate()
  const { canManageParticipantLifecycle } = usePermissions()
  const { data: inquiries = [], isLoading } = useParticipantInquiries()
  const create = useCreateParticipantInquiry()
  const update = useUpdateParticipantInquiry()
  const convert = useConvertParticipantInquiry()
  const [form, setForm] = useState<CreateParticipantInquiryDto>(blank)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isSaving = create.isPending || update.isPending
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError(null)
    if (editingId) update.mutate({ id: editingId, data: form }, { onSuccess: () => { setEditingId(null); setForm(blank()) }, onError: () => setError('Could not update this inquiry. Check the details and try again.') })
    else create.mutate(form, { onSuccess: () => setForm(blank()), onError: () => setError('Could not capture this inquiry. Check the details and try again.') })
  }
  const startIntake = (id: string) => {
    setError(null)
    convert.mutate({ id }, { onSuccess: (inquiry: ParticipantInquiryDto) => { if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`) }, onError: () => setError('Could not start intake. Please try again.') })
  }
  const edit = (inquiry: ParticipantInquiryDto) => {
    setError(null)
    setEditingId(inquiry.id)
    setForm({ firstName: inquiry.firstName, lastName: inquiry.lastName, phone: inquiry.phone ?? '', email: inquiry.email ?? '', source: inquiry.source, provenance: inquiry.provenance ?? '' })
  }
  const columns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Name', sortable: true, render: row => `${row.firstName} ${row.lastName}` },
    { key: 'phone', header: 'Contact', render: row => row.phone || row.email || 'No contact details' },
    { key: 'source', header: 'Source', sortable: true },
    { key: 'provenance', header: 'Provenance', render: row => row.provenance || '—' },
    { key: 'participantId', header: 'Status', render: row => row.participantId ? <span className="inline-flex rounded-full bg-[var(--color-primary-fixed)] px-2 py-0.5 text-xs font-medium text-[var(--color-on-primary-fixed)]">Draft intake</span> : <span className="inline-flex rounded-full bg-[var(--color-surface-container)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted-foreground)]">New</span> },
    { key: 'id', header: 'Actions', type: 'custom', render: row => canManageParticipantLifecycle ? <div className="flex flex-wrap gap-2"><button type="button" className="rounded border px-3 py-1" onClick={() => edit(row)}>Edit inquiry</button>{row.participantId ? <button type="button" className="rounded bg-[var(--color-primary)] px-3 py-1 text-white" onClick={() => navigate(`/participants/${row.participantId}/intake`)}>Resume intake</button> : <button type="button" disabled={convert.isPending} className="rounded bg-[var(--color-primary)] px-3 py-1 text-white disabled:opacity-60" onClick={() => startIntake(row.id)}>Start intake</button>}</div> : <span className="text-sm text-[var(--color-muted-foreground)]">Read-only</span> },
  ]
  return <div className="space-y-6 animate-fade-in">
    <PageHeader title="Inquiries" subtitle="Internal prospect capture. Intake starts one inactive draft participant and can safely be resumed." />
    {!canManageParticipantLifecycle && <p role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">You can review inquiries, but your role cannot capture, edit, or start participant intake.</p>}
    {canManageParticipantLifecycle && <form className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border p-4" onSubmit={submit}>
      <FormField label="First name" required><input id="inquiry-first-name" required autoComplete="given-name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></FormField>
      <FormField label="Last name" required><input id="inquiry-last-name" required autoComplete="family-name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></FormField>
      <FormField label="Phone"><input id="inquiry-phone" type="tel" autoComplete="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormField>
      <FormField label="Email"><input id="inquiry-email" type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></FormField>
      <FormField label="Source"><select id="inquiry-source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value as InquirySource })}><option>Web</option><option>Email</option><option>Phone</option></select></FormField>
      <FormField label="Provenance or referral notes"><input id="inquiry-provenance" autoComplete="off" value={form.provenance} onChange={e => setForm({ ...form, provenance: e.target.value })} /></FormField>
      <div className="flex gap-2"><button disabled={isSaving} className="rounded bg-[var(--color-primary)] px-4 py-2 text-white">{editingId ? 'Save inquiry' : 'Capture inquiry'}</button>{editingId && <button type="button" className="rounded border px-4 py-2" onClick={() => { setEditingId(null); setForm(blank()) }}>Cancel</button>}</div>
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)] md:col-span-2">{error}</p>}
    </form>}
    {!isLoading && inquiries.length === 0 ? <EmptyState icon={ClipboardPlus} title="No inquiries captured yet" description="Capture a light inquiry when someone first contacts the service, then start their draft intake when ready." /> : <DataTable data={inquiries} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No inquiries captured yet." />}
  </div>
}