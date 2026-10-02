import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DoseSheet, type DoseTarget } from './DoseSheet'
import type { PortalDoseSlotDto, PortalPrnDto } from '@/api/types'

const h = vi.hoisted(() => ({ record: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useRecordShiftDose: () => ({ mutateAsync: h.record, isPending: false }),
  useStaff: () => ({ data: [{ id: 'self', fullName: 'Me Myself', isActive: true }, { id: 'w1', fullName: 'Wendy Witness', isActive: true }, { id: 'gone', fullName: 'Inactive Person', isActive: false }] }),
}))
vi.mock('@/lib/completionRequestId', () => ({ newCompletionRequestId: () => 'key-1' }))

const shift = { id: 'shift-1', timeZoneId: 'Australia/Sydney', canRecordDoses: true, canRecordDosesReason: null as string | null }

const slot = (over: Partial<PortalDoseSlotDto> = {}): DoseTarget => ({
  kind: 'slot',
  slot: {
    medicationId: 'med-1', medicationName: 'Paracetamol', strength: '500mg', doseDescription: '2 tablets', form: 'Tablet', route: 'Oral', directions: null,
    supportLevel: 'Administer', isHighRisk: false, scheduledAt: '2026-10-05T12:00:00', scheduledTime: '12:00', state: 'Due', isOverdue: false, outcome: null,
    witness: { required: false, status: null, witnessName: null, requestedAt: null, respondedAt: null }, ...over,
  } as PortalDoseSlotDto,
})

const prn = (over: Partial<PortalPrnDto> = {}): DoseTarget => ({
  kind: 'prn',
  prn: {
    medicationId: 'med-p', medicationName: 'Ibuprofen', strength: null, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', directions: null,
    supportLevel: 'Administer', isHighRisk: false, indication: 'Pain', maxDosesPer24h: 3, minIntervalMinutes: null, dosesInLast24h: 0, lastDoseAt: null,
    maxDosesReached: false, nextAvailableAt: null, outcomePendingAdministrationId: null, ...over,
  } as PortalPrnDto,
})

function open(target: DoseTarget, props: Partial<React.ComponentProps<typeof DoseSheet>> = {}) {
  const onClose = vi.fn()
  render(<DoseSheet open onClose={onClose} shift={shift} target={target} online {...props} />)
  return onClose
}

beforeEach(() => {
  h.record.mockReset().mockResolvedValue({})
  localStorage.setItem('odip_user', JSON.stringify({ id: 'self', role: 'SupportWorker' }))
})
afterEach(() => localStorage.removeItem('odip_user'))

describe('DoseSheet: Given', () => {
  it('sends the slot wall clock zone-less, and the given time as a UTC instant with Z (provider zone Sydney, AEDT)', async () => {
    const onClose = open(slot())
    fireEvent.change(screen.getByLabelText('Time given'), { target: { value: '2026-10-05T12:05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(1))
    expect(h.record).toHaveBeenCalledWith({
      shiftId: 'shift-1',
      medicationId: 'med-1',
      data: {
        status: 'Administered',
        scheduledAt: '2026-10-05T12:00:00',
        administeredAt: '2026-10-05T01:05:00Z',
        administeredAtTimeZone: 'Australia/Sydney',
        acknowledgeLimitBreach: false,
        idempotencyKey: 'key-1',
      },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('requires a witness for a high-risk dose, excludes the worker and inactive staff, and sends witnessStaffId', async () => {
    open(slot({ isHighRisk: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose who witnessed this dose.')
    expect(h.record).not.toHaveBeenCalled()
    const options = Array.from(screen.getByLabelText('Witness').querySelectorAll('option')).map(o => o.textContent)
    expect(options).toEqual(['Choose a staff member', 'Wendy Witness'])
    fireEvent.change(screen.getByLabelText('Witness'), { target: { value: 'w1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    expect(h.record.mock.calls[0][0].data.witnessStaffId).toBe('w1')
  })
})

describe('DoseSheet: default time given', () => {
  it('is now in the PROVIDER zone, not the device zone (provider UTC+14, which is no device zone)', async () => {
    open(slot(), { shift: { ...shift, timeZoneId: 'Pacific/Kiritimati' } })
    const input = screen.getByLabelText('Time given') as HTMLInputElement
    const expected = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Pacific/Kiritimati', dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(' ', 'T')
    expect(input.value).toBe(expected)
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    const sent = new Date(h.record.mock.calls[0][0].data.administeredAt).getTime()
    expect(Math.abs(sent - Date.now())).toBeLessThan(2 * 60_000)
  })
})

describe('DoseSheet: not given', () => {
  it.each([['Refused', 'Refused'], ['Withheld', 'Withheld']])('%s needs a reason and sends no administeredAt', async (label, status) => {
    open(slot())
    fireEvent.click(screen.getByLabelText(label))
    fireEvent.click(screen.getByRole('button', { name: `Record: ${label}` }))
    expect(screen.getByRole('alert')).toHaveTextContent('Say why it was not given.')
    expect(h.record).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' Felt unwell ' } })
    fireEvent.click(screen.getByRole('button', { name: `Record: ${label}` }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    expect(h.record.mock.calls[0][0].data).toEqual({
      status, scheduledAt: '2026-10-05T12:00:00', reason: 'Felt unwell', acknowledgeLimitBreach: false, idempotencyKey: 'key-1',
    })
  })

  it('offers "Not given this shift" at the End and records it as Missed with its reason', async () => {
    open(slot(), { allowMissed: true, initialOutcome: 'Missed' })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Participant was out' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Not given this shift' }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    expect(h.record.mock.calls[0][0].data.status).toBe('Missed')
    expect(h.record.mock.calls[0][0].data.reason).toBe('Participant was out')
  })

  it('does not offer "Not given this shift" during the shift', () => {
    open(slot())
    expect(screen.queryByLabelText('Not given this shift')).not.toBeInTheDocument()
  })
})

describe('DoseSheet: as needed', () => {
  it('sends no scheduledAt, and needs why it was needed', async () => {
    open(prn())
    fireEvent.change(screen.getByLabelText('Time given'), { target: { value: '2026-07-01T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Say why it was needed.')
    fireEvent.change(screen.getByLabelText('Why was it needed?'), { target: { value: 'Headache' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    expect(h.record.mock.calls[0][0].data).toEqual({
      status: 'Administered', administeredAt: '2026-06-30T23:00:00Z', administeredAtTimeZone: 'Australia/Sydney', prnReason: 'Headache',
      acknowledgeLimitBreach: false, idempotencyKey: 'key-1',
    })
  })

  it('needs the limit acknowledged once the daily maximum is reached', async () => {
    open(prn({ maxDosesReached: true }))
    fireEvent.change(screen.getByLabelText('Why was it needed?'), { target: { value: 'Pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/over the daily limit/i)
    fireEvent.click(screen.getByLabelText(/I am giving another on purpose/))
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    expect(h.record.mock.calls[0][0].data.acknowledgeLimitBreach).toBe(true)
  })
})

describe('DoseSheet: competency, errors, offline', () => {
  it('Warn mode records but shows the flag', async () => {
    open(slot(), { shift: { ...shift, canRecordDosesReason: 'Medication Competency not current — this record will be flagged' } })
    expect(screen.getByText(/this record will be flagged/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record: Given' })).toBeEnabled()
  })

  it('Enforce mode disables recording and shows the server reason', () => {
    open(slot(), { shift: { ...shift, canRecordDoses: false, canRecordDosesReason: 'Your Medication Competency has expired.' } })
    expect(screen.getByText('Your Medication Competency has expired.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record: Given' })).toBeDisabled()
  })

  it('shows the server message on a 403 competency refusal and keeps the sheet open', async () => {
    h.record.mockRejectedValueOnce({ response: { status: 403, data: { code: 'MEDICATION_COMPETENCY_EXPIRED', errors: ['Your Medication Competency expired on 1 Sep.'] } } })
    const onClose = open(slot())
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your Medication Competency expired on 1 Sep.'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a too-early dose time message on the time field', async () => {
    h.record.mockRejectedValueOnce({ response: { status: 422, data: { code: 'ADMINISTRATION_TOO_EARLY', errors: ['Can be recorded from 11:00 am.'] } } })
    open(slot())
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(screen.getByText('Can be recorded from 11:00 am.')).toBeInTheDocument())
  })

  it('names who already recorded the dose on a 409', async () => {
    h.record.mockRejectedValueOnce({ response: { status: 409, data: { code: 'ADMINISTRATION_ALREADY_RECORDED', errors: ['x'], data: { recordedByName: 'Sam Lee' } } } })
    open(slot())
    fireEvent.click(screen.getByRole('button', { name: 'Record: Given' }))
    await waitFor(() => expect(screen.getByText(/already recorded by Sam Lee/)).toBeInTheDocument())
  })

  it('keeps the entries and the same idempotency key when saving fails, and retries', async () => {
    h.record.mockRejectedValueOnce(new Error('network'))
    open(slot())
    fireEvent.click(screen.getByLabelText('Refused'))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Said no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: Refused' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/your entries are kept/i))
    expect(screen.getByLabelText('Reason')).toHaveValue('Said no')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(2))
    expect(h.record.mock.calls[1][0].data.idempotencyKey).toBe('key-1')
  })

  it('cannot record while offline', () => {
    open(slot(), { online: false })
    expect(screen.getByRole('button', { name: 'Record: Given' })).toBeDisabled()
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument()
  })
})
