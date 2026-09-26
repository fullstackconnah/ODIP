import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConvertParticipantInquiry, useCreateParticipantInquiry, useParticipantInquiries } from '@/api/hooks'
import type { InquirySource } from '@/api/types'

export default function InquiriesPage() {
  const navigate = useNavigate()
  const { data: inquiries = [], isLoading } = useParticipantInquiries()
  const create = useCreateParticipantInquiry()
  const convert = useConvertParticipantInquiry()
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone' as InquirySource, provenance: '' })
  const [createError, setCreateError] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setCreateError(null)
    create.mutate(form, {
      onSuccess: () => setForm({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' }),
      onError: () => setCreateError('Could not capture this inquiry. Check the details and try again.'),
    })
  }
  const convertAndStartIntake = (id: string) => {
    setConvertError(null)
    convert.mutate({ id }, {
      onSuccess: inquiry => { if (inquiry.participantId) navigate(`/participants/${inquiry.participantId}/intake`) },
      onError: () => setConvertError('Could not convert this inquiry to intake. Please try again.'),
    })
  }
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Inquiries</h1><p className="text-sm text-[var(--color-muted-foreground)]">Internal prospect capture. Web capture remains deliberately unexposed until rate limiting and CAPTCHA configuration are approved.</p></div>
    <form className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border p-4" onSubmit={submit}>
      <input required placeholder="First name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} className="rounded border p-2" />
      <input required placeholder="Last name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className="rounded border p-2" />
      <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="rounded border p-2" />
      <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded border p-2" />
      <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value as InquirySource })} className="rounded border p-2"><option>Web</option><option>Email</option><option>Phone</option></select>
      <input placeholder="Provenance / referral notes" value={form.provenance} onChange={e => setForm({ ...form, provenance: e.target.value })} className="rounded border p-2" />
      <button disabled={create.isPending} className="rounded bg-[var(--color-primary)] px-4 py-2 text-white w-fit">Capture inquiry</button>
      {createError && <p role="alert" className="text-sm text-[var(--color-destructive)] md:col-span-2">{createError}</p>}
    </form>
    {convertError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{convertError}</p>}
    {isLoading ? <p>Loading inquiries…</p> : <div className="space-y-2">{inquiries.map(inquiry => <div className="flex items-center justify-between rounded border p-3" key={inquiry.id}><div><strong>{inquiry.firstName} {inquiry.lastName}</strong><span className="ml-2 text-sm">{inquiry.source}</span><p className="text-sm text-[var(--color-muted-foreground)]">{inquiry.phone || inquiry.email || 'No contact details'}</p></div>{inquiry.participantId ? <button className="rounded border px-3 py-1" onClick={() => navigate(`/participants/${inquiry.participantId}/intake`)}>Open intake</button> : <button disabled={convert.isPending} className="rounded bg-[var(--color-primary)] px-3 py-1 text-white" onClick={() => convertAndStartIntake(inquiry.id)}>Convert to intake</button>}</div>)}</div>}
  </div>
}
