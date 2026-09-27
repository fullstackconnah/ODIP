import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '@/components/DataTable'
import { useConvertParticipantInquiry, useCreateParticipantInquiry, useParticipantInquiries, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquirySource, ParticipantInquiryDto } from '@/api/types'

const blank = (): CreateParticipantInquiryDto => ({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' })

export default function InquiriesPage() {
  const navigate = useNavigate()
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
    setEditingId(inquiry.id)
    setForm({ firstName: inquiry.firstName, lastName: inquiry.lastName, phone: inquiry.phone ?? '', email: inquiry.email ?? '', source: inquiry.source, provenance: inquiry.provenance ?? '' })
  }
  const columns: Column<ParticipantInquiryDto>[] = [
    { key: 'firstName', header: 'Name', sortable: true, render: row => `${row.firstName} ${row.lastName}` },
    { key: 'phone', header: 'Contact', render: row => row.phone || row.email || 'No contact details' },
    { key: 'source', header: 'Source', sortable: true },
    { key: 'provenance', header: 'Provenance', render: row => row.provenance || '—' },
    { key: 'participantId', header: 'Status', render: row => row.participantId ? 'Intake started' : 'New' },
    { key: 'id', header: 'Actions', type: 'custom', render: row => <div className="flex gap-2"><button type="button" className="rounded border px-3 py-1" onClick={() => edit(row)}>Edit</button><button type="button" disabled={convert.isPending} className="rounded bg-[var(--color-primary)] px-3 py-1 text-white disabled:opacity-60" onClick={() => startIntake(row.id)}>Start intake</button></div> },
  ]
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Inquiries</h1><p className="text-sm text-[var(--color-muted-foreground)]">Internal prospect capture. Intake starts one inactive draft participant and can safely be resumed.</p></div>
    <form className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border p-4" onSubmit={submit}>
      <input required aria-label="First name" placeholder="First name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} className="rounded border p-2" />
      <input required aria-label="Last name" placeholder="Last name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className="rounded border p-2" />
      <input aria-label="Phone" placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="rounded border p-2" />
      <input aria-label="Email" type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded border p-2" />
      <select aria-label="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value as InquirySource })} className="rounded border p-2"><option>Web</option><option>Email</option><option>Phone</option></select>
      <input aria-label="Provenance" placeholder="Provenance / referral notes" value={form.provenance} onChange={e => setForm({ ...form, provenance: e.target.value })} className="rounded border p-2" />
      <div className="flex gap-2"><button disabled={isSaving} className="rounded bg-[var(--color-primary)] px-4 py-2 text-white">{editingId ? 'Save inquiry' : 'Capture inquiry'}</button>{editingId && <button type="button" className="rounded border px-4 py-2" onClick={() => { setEditingId(null); setForm(blank()) }}>Cancel</button>}</div>
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)] md:col-span-2">{error}</p>}
    </form>
    <DataTable data={inquiries} columns={columns} keyField="id" loading={isLoading} sortable emptyMessage="No inquiries captured yet." />
  </div>
}
