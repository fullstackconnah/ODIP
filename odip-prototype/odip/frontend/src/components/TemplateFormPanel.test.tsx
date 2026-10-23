import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TemplateFormPanel from './TemplateFormPanel'
import type { EventTemplateDto } from '@/api/types'

const { mockCreate, mockUpdate } = vi.hoisted(() => ({ mockCreate: vi.fn(), mockUpdate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useCreateEventTemplate: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateEventTemplate: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeactivateEventTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTrips: () => ({ data: [{ id: 'trip-1', tripName: 'Gold Coast Beach Break', tripCode: 'GC-01', destination: 'Gold Coast', region: 'QLD', durationDays: 5 }] }),
}))

const template: EventTemplateDto = {
  id: 'tpl-1',
  eventCode: 'GOLD-01',
  eventName: 'Gold Coast Beach Break',
  defaultDestination: 'Gold Coast',
  defaultRegion: 'QLD',
  preferredTimeOfYear: null,
  standardDurationDays: 7,
  accessibilityNotes: null,
  fullyModifiedAccommodationNotes: null,
  semiModifiedAccommodationNotes: null,
  wheelchairAccessNotes: null,
  typicalActivities: null,
  isActive: true,
}

describe('TemplateFormPanel as a dialog', () => {
  it('is a modal dialog named "New Template" or "Edit Template", closed when isOpen is false', () => {
    const { rerender } = render(<TemplateFormPanel isOpen={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<TemplateFormPanel isOpen onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New template' })).toHaveAttribute('aria-modal', 'true')
    rerender(<TemplateFormPanel isOpen onClose={() => {}} template={template} />)
    expect(screen.getByRole('dialog', { name: 'Edit template' })).toBeInTheDocument()
  })

  it('an untouched panel closes on Escape without asking', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TemplateFormPanel isOpen onClose={onClose} template={template} />)
    expect(screen.getByLabelText('Event name *')).toHaveValue('Gold Coast Beach Break')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('an edit makes Escape ask first; Keep editing keeps the panel and the text', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TemplateFormPanel isOpen onClose={onClose} template={template} />)
    await user.type(screen.getByLabelText('Event name *'), ' 2')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Event name *')).toHaveValue('Gold Coast Beach Break 2')
  })

  it('picking a trip in "Fill from trip" counts as an edit, though the form is re-seeded', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TemplateFormPanel isOpen onClose={onClose} />)
    await user.click(screen.getByRole('combobox', { name: 'Fill from trip' }))
    await user.click(screen.getByRole('option', { name: 'Gold Coast Beach Break' }))
    expect(screen.getByLabelText('Event code *')).toHaveValue('GC-01')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('once the save has gone through there is nothing to discard: Escape closes at once', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockCreate.mockResolvedValue({})
    render(<TemplateFormPanel isOpen onClose={onClose} />)
    await user.type(screen.getByLabelText('Event name *'), 'Winter Break')
    await user.type(screen.getByLabelText('Event code *'), 'WB-1')
    await user.click(screen.getByRole('button', { name: 'Create template' }))
    expect(await screen.findByText('Template created')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('the footer Cancel closes at once, even after an edit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TemplateFormPanel isOpen onClose={onClose} template={template} />)
    await user.type(screen.getByLabelText('Event name *'), ' 2')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // The panel shows no Active control, so an edit must send the flag the template already has (a deactivation made elsewhere stays).
  it("an edit sends the template's own isActive, not true", async () => {
    const user = userEvent.setup()
    mockUpdate.mockResolvedValue({})
    render(<TemplateFormPanel isOpen onClose={() => {}} template={{ ...template, isActive: false }} />)
    await user.type(screen.getByLabelText('Event name *'), ' 2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Template updated')).toBeInTheDocument()
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'tpl-1', data: expect.objectContaining({ eventName: 'Gold Coast Beach Break 2', isActive: false }) })
  })
})
