import type { ReactNode, Ref } from 'react'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { CheckboxField } from '@/components/CheckboxField'
import { resultLine } from '@/lib/intakeBooking'

const MUTED = 'text-sm text-[var(--color-muted-foreground)]'

/** A refusal after the enquiry itself saved (SHAPE.md section 4): the visit, a change to it, or Send again. */
export type VisitRefusal = { kind: 'new' | 'changed' | 'resend'; message: string }

const REFUSAL_TITLE: Record<VisitRefusal['kind'], string> = {
  new: "Enquiry saved. The visit isn't booked yet.",
  changed: "Enquiry saved. The visit wasn't changed.",
  resend: "Enquiry saved. The invite wasn't sent again.",
}

/**
 * The enquiry form's Intake visit card (SHAPE.md section 3): not booked, a tick box that books the visit in the same Save; booked, the result line,
 * the visit's fields and, when it applies, Send again. Presentational: the form owns the state and what Save does. The body is capped at 36rem, so
 * the shared fields read as they do in the slide-over.
 */
export function IntakeVisitCard({
  row, booked, past, zone, bookingOn, onBookingOn, email, sends, fields, resend, refusal, refusalRef, cancelled, cancelledRef, onCancelVisit,
}: {
  /** The stored enquiry; null before the first save. */
  row: ParticipantInquiryDto | null
  booked: boolean
  past: boolean
  zone: string
  bookingOn: boolean
  onBookingOn: (on: boolean) => void
  /** The Email field above, as typed: the invite goes there (D2). */
  email: string
  /** Whether this Save emails the contact (a new booking, or a change to anything the invite states). */
  sends: boolean
  fields: ReactNode
  /** Send again, offered when this Save won't email anyway (D2): the box and why it is offered. */
  resend: { on: boolean; onChange: (on: boolean) => void; hint: string } | null
  refusal: VisitRefusal | null
  refusalRef: Ref<HTMLDivElement>
  cancelled: { tone: 'success' | 'danger'; title: string; message: string } | null
  cancelledRef: Ref<HTMLDivElement>
  onCancelVisit: () => void
}) {
  const result = booked && row ? resultLine(row, zone) : null
  const inviteTo = email
    ? <p className="text-sm">{booked ? 'Saving emails an updated invite to ' : 'Saving books the visit and emails an invite with a calendar file to '}<span className="font-medium break-all">{email}</span>.</p>
    : <p className={MUTED}>Add an email above. The invite goes there.</p>

  return (
    <Card title="Intake visit" action={booked && !past ? <Button variant="ghost-danger" onClick={onCancelVisit}>Cancel visit</Button> : undefined}>
      <div className="flex flex-col gap-[var(--field-gap-y)] max-w-[36rem]">
        {cancelled && (
          <div ref={cancelledRef} tabIndex={-1} className="focus:outline-none">
            <Callout tone={cancelled.tone} title={cancelled.title}>{cancelled.message}</Callout>
          </div>
        )}
        {refusal && (
          <div ref={refusalRef} tabIndex={-1} className="focus:outline-none">
            <Callout tone="danger" title={REFUSAL_TITLE[refusal.kind]}>
              <span className="break-words">
                {refusal.kind === 'new' ? `${refusal.message} Change the details and save again, or untick Book the intake visit to finish without one.` : refusal.message}
              </span>
            </Callout>
          </div>
        )}
        {booked ? (
          <>
            {result && <Callout tone={result.tone} announce={false}><span className="break-words">{result.text}</span></Callout>}
            {past && <p className={MUTED}>This visit's time has passed. To book another time, change the date and time.</p>}
            {sends && inviteTo}
            {fields}
            {resend && (
              <CheckboxField
                label={<>Send the invite again to <span className="font-medium break-all">{email}</span></>}
                hint={resend.hint}
                checked={resend.on}
                onChange={e => resend.onChange(e.target.checked)}
              />
            )}
          </>
        ) : (
          <>
            <CheckboxField
              label="Book the intake visit now"
              hint="Optional. You can also book it later from Enquiries."
              checked={bookingOn}
              onChange={e => onBookingOn(e.target.checked)}
            />
            {bookingOn && (
              <>
                {inviteTo}
                {fields}
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
