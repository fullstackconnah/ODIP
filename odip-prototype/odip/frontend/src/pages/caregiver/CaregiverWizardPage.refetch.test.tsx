import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CaregiverFormDto } from '@/api/types/caregiver'
import projection from '@/test/fixtures/golden/caregiver-projection.json'

// Real hooks over a faked HTTP client: a caregiver's own save refetches the form, and the reset that follows must keep what they typed
// while that save was in flight.
const { mockGet, mockPut, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPut: vi.fn(), mockPost: vi.fn() }))
vi.mock('@/api/caregiverClient', async () => {
  const actual = await vi.importActual<typeof import('@/api/caregiverClient')>('@/api/caregiverClient')
  return { ...actual, caregiverGet: mockGet, caregiverPut: mockPut, caregiverPost: mockPost }
})

import CaregiverWizardPage from './CaregiverWizardPage'

type Body = { caregiverName: string; caregiverRelationship: string | null; payload: unknown; base: unknown }
let server: CaregiverFormDto
let puts: Body[]

function makeDto(overrides: Partial<CaregiverFormDto> = {}): CaregiverFormDto {
  return {
    status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2026-09-17T00:00:00Z', rejectionNote: null,
    current: { firstName: 'Sophie', lastName: 'Rivers' }, editable: [], draft: null, ...overrides,
  }
}

/** The held-open PUT: the server stores the body when it arrives, and answers only when `release` is called. */
function holdNextPut() {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  mockPut.mockImplementationOnce(async (_url: string, body: Body) => { storeDraft(body); await gate })
  return release
}

function storeDraft(body: Body) {
  puts.push(body)
  server = { ...server, caregiverName: body.caregiverName, caregiverRelationship: body.caregiverRelationship, draft: body.payload as never, base: body.base as never }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(
    [{ path: '/caregiver/:token', element: <CaregiverWizardPage /> }, { path: '/gone', element: <p>Elsewhere</p> }],
    { initialEntries: ['/caregiver/tok-1'] },
  )
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

const nameField = () => screen.getByLabelText(/^your name/i)
const relationshipField = () => screen.getByLabelText(/relationship to the participant/i)
const nextButton = () => screen.getByRole('button', { name: /^next$/i })
const saveLater = () => screen.getByRole('button', { name: 'Save and continue later' })

async function open() {
  const user = userEvent.setup()
  const router = renderPage()
  await screen.findByLabelText(/^your name/i)
  return { user, router }
}

beforeEach(() => {
  puts = []
  server = makeDto()
  mockGet.mockReset()
  mockPut.mockReset()
  mockPost.mockReset()
  // A fresh object per call, as over the wire: only structural sharing can make two reads the same reference.
  mockGet.mockImplementation(async () => ({ success: true, data: JSON.parse(JSON.stringify(server)) }))
  mockPut.mockImplementation(async (_url: string, body: Body) => { storeDraft(body) })
  mockPost.mockResolvedValue(undefined)
})

describe('CaregiverWizardPage - typing while a save is in flight', () => {
  it('keeps what was typed between clicking Next and the refetch landing', async () => {
    const { user } = await open()
    await user.type(nameField(), 'Jane Doe')
    const release = holdNextPut()
    await user.click(nextButton())
    await user.type(relationshipField(), 'Mother')
    release()

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText(/medicare number/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /about you/i }))
    expect(relationshipField()).toHaveValue('Mother')
    expect(nameField()).toHaveValue('Jane Doe')
  })

  it('keeps what was typed between clicking Save and continue later and the refetch landing', async () => {
    const { user } = await open()
    await user.type(nameField(), 'Jane Doe')
    const release = holdNextPut()
    await user.click(saveLater())
    await user.type(relationshipField(), 'Mother')
    release()

    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    expect(relationshipField()).toHaveValue('Mother')
    expect(nameField()).toHaveValue('Jane Doe')
  })

  it('keeps a field-array row changed in flight', async () => {
    server = makeDto({ current: { firstName: 'Sophie', lastName: 'Rivers', healthConditions: [{ conditionType: 'IntellectualDisability', has: false }] } })
    const { user } = await open()
    await user.type(nameField(), 'Jane Doe')
    for (let i = 0; i < 3; i++) {
      await user.click(nextButton())
      await waitFor(() => expect(puts).toHaveLength(i + 1))
    }
    await waitFor(() => expect(document.getElementById('healthConditions.0.has')).not.toBeNull())
    const getsBefore = mockGet.mock.calls.length

    const release = holdNextPut()
    await user.click(saveLater())
    await user.selectOptions(document.getElementById('healthConditions.0.has') as HTMLSelectElement, 'true')
    release()

    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet.mock.calls.length).toBe(getsBefore + 1))
    expect(document.getElementById('healthConditions.0.has')).toHaveValue('true')
  })

  it('does nothing when the refetch is identical, and reads twice', async () => {
    const { user } = await open()
    await user.type(relationshipField(), 'Mother')
    // Nothing for the server to change: an identical body keeps the stored record as loaded.
    mockPut.mockImplementationOnce(async (_url: string, body: Body) => { puts.push(body) })
    await user.type(nameField(), 'Jane Doe')
    await user.click(saveLater())

    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    expect(relationshipField()).toHaveValue('Mother')
    expect(nameField()).toHaveValue('Jane Doe')
  })
})

describe('CaregiverWizardPage - the base survives a refetch', () => {
  it('sends the base it first loaded on the next save, and an untouched form still submits payload equal to base', async () => {
    server = makeDto({ current: projection as Record<string, unknown>, caregiverName: 'Jane Doe' })
    const { user } = await open()
    await user.click(saveLater())
    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))

    await user.click(saveLater())
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1].base).toEqual(puts[0].base)

    for (let i = 0; i < 7; i++) {
      await user.click(nextButton())
      await waitFor(() => expect(puts).toHaveLength(3 + i))
    }
    await user.click(screen.getByRole('button', { name: /submit for review/i }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    const body = mockPost.mock.calls[0][1]
    expect(body.base).toBeTruthy()
    expect(body.payload).toEqual(body.base)
  })

  it('does not send a staff edit back as the caregiver own after they revert a field', async () => {
    server = makeDto({ current: { firstName: 'Sophie', lastName: 'Rivers', medicareNumber: '111111111' } })
    const { user } = await open()
    await user.type(nameField(), 'Jane Doe')
    await user.click(nextButton())
    await waitFor(() => expect(puts).toHaveLength(1))
    const medicare = () => screen.getByLabelText(/medicare number/i)
    await waitFor(() => expect(medicare()).toHaveValue('111111111'))
    await user.clear(medicare()); await user.type(medicare(), '222222222')
    await user.click(saveLater())
    await waitFor(() => expect(puts).toHaveLength(2))
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3))
    await user.clear(medicare()); await user.type(medicare(), '111111111')
    server = { ...server, current: { ...server.current, medicareNumber: '555555555' } }
    await user.click(saveLater())
    await waitFor(() => expect(puts).toHaveLength(3))
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(4))
    await user.click(saveLater())
    await waitFor(() => expect(puts).toHaveLength(4))
    const b = puts[3] as unknown as { payload: { keyIdentifiers: { medicareNumber: string } }; base: { keyIdentifiers: { medicareNumber: string } } }
    expect(b.payload.keyIdentifiers.medicareNumber).toBe(b.base.keyIdentifiers.medicareNumber)
  })

  it('after a refetch: the caregiver draft stays, the staff edit shows, and a field typed in flight keeps its text', async () => {
    const keyIdentifiers = (medicare: string, pension: string) => ({ keyIdentifiers: { medicareNumber: medicare, pensionCardNumber: pension } }) as never
    server = makeDto({
      current: { firstName: 'Sophie', lastName: 'Rivers', medicareNumber: '111111111', pensionCardNumber: '333333333' },
      base: keyIdentifiers('000000000', '222222222'),
      draft: keyIdentifiers('999888777', '222222222'),
      caregiverName: 'Jane Doe',
    })
    const { user } = await open()

    // The save is held; meanwhile staff change the pension number and the caregiver types a relationship.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockPut.mockImplementationOnce(async (_url: string, body: Body) => {
      puts.push(body)
      server = { ...server, current: { ...server.current, pensionCardNumber: '444444444' }, caregiverRelationship: 'Aunt' }
      await gate
    })
    await user.click(saveLater())
    await user.type(relationshipField(), 'Mother')
    release()

    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    expect(relationshipField()).toHaveValue('Mother')
    await user.click(nextButton())
    await waitFor(() => expect(screen.getByLabelText(/medicare number/i)).toHaveValue('999888777'))
    expect(screen.getByLabelText(/pension card number/i)).toHaveValue('444444444')

    // The Next click above saved again: its base follows the refetch, so staff's pension number is not sent as the caregiver's own edit.
    await waitFor(() => expect(puts).toHaveLength(2))
    const ki = (o: unknown) => (o as { keyIdentifiers: { pensionCardNumber: string; medicareNumber: string } }).keyIdentifiers
    expect(ki(puts[1].base).pensionCardNumber).toBe('444444444')
    expect(ki(puts[1].base).medicareNumber).toBe('000000000')
    expect(ki(puts[1].payload).pensionCardNumber).toBe('444444444')
  })
})

describe('CaregiverWizardPage - after a clean save', () => {
  it('does not ask to confirm leaving once the save and refetch have landed', async () => {
    const { user, router } = await open()
    await user.type(nameField(), 'Jane Doe')
    await user.click(saveLater())
    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))

    await act(async () => { await router.navigate('/gone') })
    expect(screen.queryByText(/leave without saving/i)).not.toBeInTheDocument()
    expect(screen.getByText('Elsewhere')).toBeInTheDocument()
  })

  it('still asks before leaving when a field was typed in flight and the refetch has landed', async () => {
    const { user, router } = await open()
    await user.type(nameField(), 'Jane Doe')
    const release = holdNextPut()
    await user.click(saveLater())
    await user.type(relationshipField(), 'Mother')
    release()
    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))

    await act(async () => { await router.navigate('/gone') })
    expect(await screen.findByText(/leave without saving/i)).toBeInTheDocument()
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument()
  })
})

describe('CaregiverWizardPage - a failed read', () => {
  it('keeps the form on screen when the read after a successful save fails', async () => {
    const { user } = await open()
    await user.type(nameField(), 'Jane Doe')
    mockGet.mockRejectedValueOnce(new Error('Network Error'))
    await user.click(saveLater())

    await screen.findByText(/Progress saved/)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/this link is no longer valid/i)).not.toBeInTheDocument()
    expect(nameField()).toHaveValue('Jane Doe')
  })

  it('still shows the invalid-link page when the first read fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('Request failed with status code 404'))
    renderPage()
    expect(await screen.findByText(/this link is no longer valid/i)).toBeInTheDocument()
  })
})
