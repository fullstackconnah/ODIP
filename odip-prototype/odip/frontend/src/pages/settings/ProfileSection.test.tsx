import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ProfileSection from './ProfileSection'

// My account > Profile: your own name and mobile, the Employment Hero lock, and the password reset email.

const { profile, mutate, send, can, refetch } = vi.hoisted(() => ({
  profile: { data: undefined as unknown, isError: false },
  mutate: vi.fn(),
  send: vi.fn(),
  can: { value: true },
  refetch: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({
  useMyProfile: () => ({ ...profile, refetch }),
  useUpdateMyProfile: () => ({ mutate, isPending: false }),
  useAuthConfig: () => ({ data: { microsoft: false, microsoftStartUrl: null } }),
  useMicrosoftAccount: () => ({ data: undefined, isError: false }),
  useUnlinkMicrosoftAccount: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('@/lib/setPasswordEmail', () => ({ canSendSetPasswordEmail: () => can.value, sendSetPasswordEmail: send }))

const PROFILE = { firstName: 'Jane', lastName: 'Smith', email: 'jane@acme.example.com', mobile: '0400 000 000', managedByEmploymentHero: false }

function renderProfile() {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', fullName: 'Jane Smith', username: 'jane@acme.example.com', tenantName: 'Acme' }))
  const element = <ProfileSection title="Profile" description="Your name and phone, and your password." readOnly={false} focusOnMount={false} />
  render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element }], { initialEntries: ['/settings?section=profile'] })} />)
  return userEvent.setup({ delay: null })
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' })

beforeEach(() => {
  mutate.mockReset(); send.mockReset().mockResolvedValue(undefined); refetch.mockReset()
  profile.data = PROFILE; profile.isError = false; can.value = true
  localStorage.clear(); sessionStorage.clear()
})

describe('Profile: your details', () => {
  it('fills the fields from the server and keeps Save off until something changes', () => {
    renderProfile()
    expect(screen.getByLabelText(/First name/)).toHaveValue('Jane')
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Smith')
    expect(screen.getByLabelText('Mobile')).toHaveValue('0400 000 000')
    expect(screen.getAllByText('jane@acme.example.com').length).toBeGreaterThan(0)
    expect(saveButton()).toBeDisabled()
  })

  it('sends exactly the three fields, trimmed, then says Saved', async () => {
    mutate.mockImplementation((_body, opts) => opts.onSuccess({ ...PROFILE, firstName: 'Alex', lastName: 'Kim', mobile: null }))
    const user = renderProfile()

    await user.clear(screen.getByLabelText(/First name/)); await user.type(screen.getByLabelText(/First name/), ' Alex ')
    await user.clear(screen.getByLabelText(/Last name/)); await user.type(screen.getByLabelText(/Last name/), 'Kim')
    await user.clear(screen.getByLabelText('Mobile'))
    await user.click(saveButton())

    expect(mutate.mock.calls[0][0]).toEqual({ firstName: 'Alex', lastName: 'Kim', mobile: null })
    expect(screen.getAllByRole('status').some(s => s.textContent === 'Saved')).toBe(true)
    expect(saveButton()).toBeDisabled()
  })

  it.each([
    ['First name', /First name/, '', 'Enter your first name.'],
    ['Last name', /Last name/, '', 'Enter your last name.'],
    ['Mobile', 'Mobile', 'call me', 'Enter a mobile number of up to 20 characters, using digits, spaces and + ( ) -.'],
    ['Mobile', 'Mobile', '123456789012345678901', 'Enter a mobile number of up to 20 characters, using digits, spaces and + ( ) -.'],
  ] as const)('says "%s" is wrong in words and holds Save', async (_name, label, value, sentence) => {
    const user = renderProfile()
    const field = screen.getByLabelText(label)

    await user.clear(field)
    if (value) await user.type(field, value)

    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(screen.getAllByRole('status').some(s => s.textContent === 'Fix 1 field to save.')).toBe(true)
  })

  it('says why a refused save was refused and keeps what was typed', async () => {
    mutate.mockImplementation((_body, opts) => opts.onError({ response: { status: 500, data: {} } }))
    const user = renderProfile()

    await user.type(screen.getByLabelText(/First name/), 'y')
    await user.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Check your connection and try again.')
    expect(screen.getByLabelText(/First name/)).toHaveValue('Janey')
  })

  it('shows a stale-page Employment Hero refusal in the foot and reloads the profile', async () => {
    mutate.mockImplementation((_body, opts) => opts.onError({ response: { status: 409, data: { message: 'Employment Hero now keeps your name and mobile up to date.', code: 'EmploymentHeroOwnsProfile' } } }))
    const user = renderProfile()

    await user.type(screen.getByLabelText(/First name/), 'y')
    await user.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Employment Hero now keeps your name and mobile up to date.')
    expect(refetch).toHaveBeenCalled()
  })

  it('is locked when Employment Hero keeps the profile: read-only fields, the note, no Save', () => {
    profile.data = { ...PROFILE, managedByEmploymentHero: true }
    renderProfile()
    expect(screen.getByLabelText(/First name/)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/Last name/)).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Mobile')).toHaveAttribute('readonly')
    expect(screen.getByText(/Employment Hero keeps your name and mobile up to date\. Change them in Employment Hero and they'll update here after the next sync\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('has no form and no reset button while viewing as someone', () => {
    sessionStorage.setItem('odip_viewing_user', 'u2')
    renderProfile()
    expect(screen.queryByLabelText(/First name/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send me a password reset email' })).not.toBeInTheDocument()
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
  })

  it('offers Try again when the profile will not load', () => {
    profile.data = undefined; profile.isError = true
    renderProfile()
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })
})

describe('Profile: password reset email', () => {
  it('sends the email to the address the server holds, says so, and offers to send it again', async () => {
    const user = renderProfile()

    await user.click(screen.getByRole('button', { name: 'Send me a password reset email' }))

    expect(send).toHaveBeenCalledWith('jane@acme.example.com')
    expect((await screen.findAllByText("Check your email. We've sent a link to jane@acme.example.com.")).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeInTheDocument()
  })

  it('says to wait when Firebase has had too many requests', async () => {
    send.mockRejectedValue({ code: 'auth/too-many-requests' })
    const user = renderProfile()
    await user.click(screen.getByRole('button', { name: 'Send me a password reset email' }))
    expect((await screen.findAllByText('Too many emails were sent. Wait a few minutes, then try again.')).length).toBeGreaterThan(0)
  })

  it('says it could not send for any other failure', async () => {
    send.mockRejectedValue(new Error('network'))
    const user = renderProfile()
    await user.click(screen.getByRole('button', { name: 'Send me a password reset email' }))
    expect((await screen.findAllByText("We couldn't send the email. Try again.")).length).toBeGreaterThan(0)
  })

  it('is hidden where Firebase cannot send one', () => {
    can.value = false
    renderProfile()
    expect(screen.queryByText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send me a password reset email' })).not.toBeInTheDocument()
  })

  // N4: canSendSetPasswordEmail() only says Firebase is configured, so a Microsoft-only account (no Firebase user) would be offered an email that never arrives.
  it('is hidden in a Microsoft session', () => {
    localStorage.setItem('odip_sign_in_method', 'microsoft')
    renderProfile()
    expect(screen.queryByRole('button', { name: 'Send me a password reset email' })).not.toBeInTheDocument()
  })
})
