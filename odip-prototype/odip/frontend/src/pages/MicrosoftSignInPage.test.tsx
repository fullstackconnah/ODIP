import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import MicrosoftSignInPage from './MicrosoftSignInPage'

// The server's Microsoft callback sets the session cookies and lands here. The page trades the cookie for a token (POST /auth/microsoft/refresh), stores the
// session the way the password sign-in does, remembers it was a Microsoft one, and goes in. Any failure goes back to /login with a generic outcome.

const { apiPostRaw } = vi.hoisted(() => ({ apiPostRaw: vi.fn() }))
vi.mock('@/api/client', async () => ({ ...(await vi.importActual<object>('@/api/client')), apiPostRaw }))

const DTO = { id: 'u1', token: 'the-token', expiresAt: '2026-10-26T10:00:00Z', username: 'a@b.c', fullName: 'Jane Smith', role: 'Admin', tenantName: 'Acme', tenantId: 'tenant-1' }

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

const renderPage = (strict = false) => {
  const tree = (
    <MemoryRouter initialEntries={['/signin/microsoft']}>
      <Routes>
        <Route path="/signin/microsoft" element={<MicrosoftSignInPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

beforeEach(() => {
  apiPostRaw.mockReset()
  localStorage.clear()
})

describe('MicrosoftSignInPage', () => {
  it('says it is signing in, in a status region present from the first render', () => {
    apiPostRaw.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in with Microsoft…')
  })

  it('stores token, user, viewing tenant and sign-in method, then navigates to /', async () => {
    apiPostRaw.mockResolvedValue({ success: true, data: DTO })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/'))
    expect(apiPostRaw).toHaveBeenCalledWith('/auth/microsoft/refresh')
    expect(localStorage.getItem('odip_token')).toBe('the-token')
    expect(JSON.parse(localStorage.getItem('odip_user')!)).toMatchObject({ fullName: 'Jane Smith' })
    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('tenant-1')
    expect(localStorage.getItem('odip_sign_in_method')).toBe('microsoft')
  })

  it('a refused refresh goes to /login?microsoft=InvalidToken', async () => {
    apiPostRaw.mockRejectedValue({ response: { status: 401, data: { code: 'MicrosoftSessionEnded' } } })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login?microsoft=InvalidToken'))
    expect(localStorage.getItem('odip_token')).toBeNull()
    expect(localStorage.getItem('odip_sign_in_method')).toBeNull()
  })

  it('posts once under StrictMode', async () => {
    apiPostRaw.mockResolvedValue({ success: true, data: DTO })
    renderPage(true)

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/'))
    expect(apiPostRaw).toHaveBeenCalledTimes(1)
  })
})
