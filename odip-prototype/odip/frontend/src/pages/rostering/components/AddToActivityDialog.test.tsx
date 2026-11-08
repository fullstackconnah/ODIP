import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddToActivityDialog } from './AddToActivityDialog'
import { makeActivity, makeShift } from '../test-fixtures'

const post = vi.fn()
vi.mock('@/api/client', async () => ({
  ...(await vi.importActual<object>('@/api/client')),
  apiPost: (...args: unknown[]) => post(...args),
}))

const shift = makeShift({ id: 'shift-9', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '13:00:00', isGroupLine: true })

function open(activities = [makeActivity({ id: 'act', title: 'Bowling' })]) {
  const props = { shift, activities, onClose: vi.fn(), onNew: vi.fn(), onAttached: vi.fn() }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddToActivityDialog {...props} />
    </QueryClientProvider>,
  )
  return props
}

beforeEach(() => {
  post.mockReset()
  post.mockResolvedValue(makeActivity())
})

describe('AddToActivityDialog', () => {
  it('asks first when the times differ, then goes back to the list', async () => {
    open()
    await userEvent.click(screen.getByRole('radio', { name: /Bowling/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Agreement .*, activity .*shift moves to the activity's times\./)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('radio', { name: /Bowling/ })).toBeChecked()
  })

  it('counts only the people who are coming', () => {
    const person = (id: string, didNotAttend: boolean) => ({ participantId: id, participantName: id, ratio: 'OneToOne' as const, shiftIds: [id], timesDiffer: false, didNotAttend })
    open([makeActivity({ id: 'act', participants: [person('a', false), person('b', true), person('c', false)] })])
    expect(screen.getByText(/· 2 people/)).toBeInTheDocument()
  })

  it('attaches the shift on Add to activity', async () => {
    const props = open()
    await userEvent.click(screen.getByRole('radio', { name: /Bowling/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add to activity' }))
    await waitFor(() => expect(props.onAttached).toHaveBeenCalled())
    expect(post).toHaveBeenCalledWith('/rostering/group-activities/act/shifts', { shiftIds: ['shift-9'] })
  })

  it('attaches at once when the times match', async () => {
    const props = open([makeActivity({ id: 'act', startTime: '09:00:00', endTime: '13:00:00' })])
    await userEvent.click(screen.getByRole('radio', { name: /Bowling/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(props.onAttached).toHaveBeenCalled())
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('offers New activity, with a line, when the day has none', async () => {
    const props = open([])
    expect(screen.getByText(/No activities on .* yet\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'New activity' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(props.onNew).toHaveBeenCalledWith(shift)
  })

  it('shows the server message and stays open when the attach is refused', async () => {
    post.mockRejectedValue(new Error('Activity is cancelled.'))
    const props = open([makeActivity({ id: 'act', startTime: '09:00:00', endTime: '13:00:00' })])
    await userEvent.click(screen.getByRole('radio', { name: /Bowling/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/Activity is cancelled\.|Couldn't add/)).toBeInTheDocument()
    expect(props.onAttached).not.toHaveBeenCalled()
  })
})
