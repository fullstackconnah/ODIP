import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditTripModal from './EditTripModal'
import type { TripDetailDto } from '@/api/types/trips'

const { mutate, state } = vi.hoisted(() => ({ mutate: vi.fn(), state: { error: null as unknown } }))

vi.mock('@/api/hooks', () => ({
  useUpdateTrip: () => ({ mutate, isPending: false, isError: state.error != null, error: state.error }),
  useEventTemplates: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
}))

const trip = { id: 't1', tripName: 'Beach', startDate: '2026-11-01T00:00:00', durationDays: 3, status: 'Draft' } as TripDetailDto

async function setup() {
  const user = userEvent.setup()
  render(<EditTripModal trip={trip} onClose={() => {}} />)
  await screen.findByLabelText(/Start Date/)
  return user
}

describe('EditTripModal — what Save refuses', () => {
  it('refuses an empty start date with a field error', async () => {
    const user = await setup()
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Start date is required.')
    expect(screen.getByLabelText(/Start Date/)).toHaveFocus()
  })

  it('refuses a duration below one day with a field error', async () => {
    const user = await setup()
    fireEvent.change(screen.getByLabelText(/Duration/), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Duration must be at least 1 day.')
    expect(screen.getByLabelText(/Duration/)).toHaveFocus()
  })

  it('clears a field error once the field is corrected', async () => {
    const user = await setup()
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2026-12-01' } })
    expect(screen.queryByText('Start date is required.')).toBeNull()
    expect(screen.getByLabelText(/Start Date/)).not.toHaveAttribute('aria-invalid')
  })

  it('saves a start date and a duration of one or more days', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mutate).toHaveBeenCalledWith({ id: 't1', data: expect.objectContaining({ startDate: '2026-11-01', durationDays: 3 }) }, expect.anything())
  })
})

describe('EditTripModal — a refused save', () => {
  it('shows the server message when the save fails', async () => {
    state.error = { response: { status: 400, data: { message: 'Lead coordinator not found.' } } }
    await setup()
    expect(screen.getByText('Lead coordinator not found.')).toBeInTheDocument()
    state.error = null
  })

  it('disables Save while the trip name is blank', async () => {
    await setup()
    fireEvent.change(screen.getByPlaceholderText('e.g. Beach Getaway 2026'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('EditTripModal — the dialog', () => {
  it('is named by its title and keeps the form open on a backdrop click (it holds typing)', async () => {
    const onClose = vi.fn()
    render(<EditTripModal trip={trip} onClose={onClose} />)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Trip' })
    fireEvent.click(dialog.parentElement!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab inside and gives focus back to the opener when it closes', async () => {
    const user = userEvent.setup()
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Edit Trip</button>
          {open && <EditTripModal trip={trip} onClose={() => setOpen(false)} />}
        </>
      )
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Edit Trip' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Trip' })
    for (let i = 0; i < 40; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})

describe('EditTripModal — field labels', () => {
  it('names the fields so each label finds its control, and marks Trip Name required', async () => {
    await setup()
    expect(screen.getByLabelText(/Trip Name/)).toBeRequired()
    for (const label of ['Trip Code', 'Destination', 'Region', 'Booking Cutoff', 'Min Participants', 'Notes']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })
})

describe('EditTripModal — section headings', () => {
  it('uses one sentence-case label style, no caps, and keeps the Notes label wiring', async () => {
    await setup()
    for (const text of ['Basic info', 'Dates & status', 'Capacity & requirements', 'Notes']) {
      const h = screen.getByText(text, { selector: 'p' })
      expect(h).not.toHaveClass('uppercase')
      expect(h).not.toHaveClass('tracking-wider')
      expect(h).toHaveClass('text-sm', 'font-medium')
    }
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-labelledby', 'editTripNotesLabel')
  })
})
