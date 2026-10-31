import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ImportInvites from './ImportInvites'

// Real hooks and a real QueryClient, with only the HTTP client mocked: the record call has to refetch the count, which a mocked hook cannot show.
const { apiGet, apiPost, sendEmail } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), sendEmail: vi.fn() }))

vi.mock('@/api/client', () => ({ apiGet, apiPost, apiClient: {} }))
vi.mock('@/lib/signInEmail', async () => ({
  ...(await vi.importActual<typeof import('@/lib/signInEmail')>('@/lib/signInEmail')),
  sendSetPasswordEmailFor: sendEmail,
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ImportInvites: the count follows what was sent', () => {
  it('posts who was sent to, then the button reads the new count with no remount', async () => {
    let remaining = 3
    apiGet.mockImplementation(async () => ({ toInvite: remaining, invitedBefore: 0, signedIn: 0, cannotInvite: 0 }))
    apiPost.mockImplementation(async (url: string) => {
      if (url.startsWith('/users/invites-sent')) { remaining = 1; return 2 }
      return { left: 0, next: null, invites: [
        { staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null },
        { staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: 'created', error: null },
      ] }
    })
    sendEmail.mockImplementation(async (email: string) => ({ ok: true, email, account: 'created' }))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ImportInvites batchId="b1" count={3} /></QueryClientProvider>)

    await userEvent.click(await screen.findByRole('button', { name: 'Send sign-in invites (3)' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send 3 invites' }))

    expect(await screen.findByRole('button', { name: 'Send sign-in invites (1)' })).toBeInTheDocument()
    expect(apiPost).toHaveBeenCalledWith('/users/invites-sent', { userIds: ['s1', 's2'] })
    expect(apiPost).toHaveBeenCalledWith('/imports/b1/invites')
  })
})
