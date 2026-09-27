import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './LoginPage'

vi.mock('@/lib/firebase', () => ({
  auth: null,
  devAuthEnabled: false,
}))

vi.mock('@/api/hooks', () => ({
  useLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDevLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDevUsers: () => ({ data: [], isError: false, error: null }),
}))

describe('LoginPage', () => {
  it('associates the Password label with the password input', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('id', 'login-password')
    expect(passwordInput).toHaveAttribute('type', 'password')
  })
})
