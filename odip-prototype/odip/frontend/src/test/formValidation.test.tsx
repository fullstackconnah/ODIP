import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TripCreatePage from '@/pages/TripCreatePage'
import VehicleCreatePage from '@/pages/VehicleCreatePage'
import AccommodationCreatePage from '@/pages/AccommodationCreatePage'
import StaffCreatePage from '@/pages/StaffCreatePage'
import TaskCreatePage from '@/pages/TaskCreatePage'
import TemplateFormPanel from '@/components/TemplateFormPanel'
import { LeaveRequestFormModal } from '@/pages/portal/components/LeaveRequestFormModal'
import { UnavailabilityFormModal } from '@/pages/portal/components/UnavailabilityFormModal'
import { AvailabilityRecordFormModal } from '@/pages/rostering/components/AvailabilityRecordFormModal'

// Every form that validates through zodResolver: an empty submit must render the schema's messages,
// not throw. @hookform/resolvers 3.x rethrew zod 4's ZodError, so these forms showed nothing (QA TRIPS-1/STAFF-1).

const { mutation, detail } = vi.hoisted(() => ({
  mutation: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  detail: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/api/hooks', () => ({
  useCreateTrip: mutation,
  useStaff: () => ({ data: [] }),
  useEventTemplates: () => ({ data: [] }),
  useTrips: () => ({ data: [] }),
  useCreateVehicle: mutation,
  useUpdateVehicle: mutation,
  useVehicleDetail: detail,
  useCreateAccommodation: mutation,
  useUpdateAccommodation: mutation,
  useAccommodationDetail: detail,
  useCreateStaff: mutation,
  useUpdateStaff: mutation,
  useStaffDetail: detail,
  useEnsureStaffSignInAccount: mutation,
  useCreateTask: mutation,
  useUpdateTask: mutation,
  useTask: detail,
  useCreateEventTemplate: mutation,
  useUpdateEventTemplate: mutation,
  useDeactivateEventTemplate: mutation,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ isCoordinator: true }),
}))

const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]
const modal = { open: true, onClose: () => {}, onSubmit: vi.fn(), submitting: false, staffOptions }

const forms: { name: string; element: ReactElement; submit: RegExp; messages: string[] }[] = [
  { name: 'TripCreatePage', element: <TripCreatePage />, submit: /create trip/i, messages: ['Trip name is required', 'Start date is required'] },
  { name: 'VehicleCreatePage', element: <VehicleCreatePage />, submit: /create vehicle/i, messages: ['Vehicle name is required'] },
  { name: 'AccommodationCreatePage', element: <AccommodationCreatePage />, submit: /create accommodation/i, messages: ['Property name is required'] },
  { name: 'StaffCreatePage', element: <StaffCreatePage />, submit: /create staff member/i, messages: ['First name is required', 'Last name is required'] },
  { name: 'TaskCreatePage', element: <TaskCreatePage />, submit: /create task/i, messages: ['Title is required'] },
  { name: 'TemplateFormPanel', element: <TemplateFormPanel isOpen onClose={() => {}} />, submit: /create template/i, messages: ['Required'] },
  { name: 'LeaveRequestFormModal', element: <LeaveRequestFormModal {...modal} />, submit: /^save$/i, messages: ['Select a staff member', 'Start date is required'] },
  { name: 'UnavailabilityFormModal', element: <UnavailabilityFormModal {...modal} />, submit: /^save$/i, messages: ['Select a staff member', 'Start time is required'] },
  { name: 'AvailabilityRecordFormModal', element: <AvailabilityRecordFormModal {...modal} />, submit: /^save$/i, messages: ['Select a staff member', 'Start date is required'] },
]

let thrown: unknown[]
const onRejection = (reason: unknown) => { thrown.push(reason) }

beforeEach(() => {
  thrown = []
  process.on('unhandledRejection', onRejection)
})

afterEach(() => {
  process.off('unhandledRejection', onRejection)
})

describe('zodResolver forms: empty submit', () => {
  it.each(forms)('$name shows the field errors and throws nothing', async ({ element, submit, messages }) => {
    const user = userEvent.setup()
    // useUnsavedChangesWarning needs a data router (useBlocker).
    render(<RouterProvider router={createMemoryRouter([{ path: '/', element }])} />)

    await user.click(screen.getByRole('button', { name: submit }))

    for (const message of messages) {
      expect((await screen.findAllByText(message)).length).toBeGreaterThan(0)
    }
    expect(thrown).toEqual([])
  })
})
