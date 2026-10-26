import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import AccountRedirect from './AccountRedirect'

// The server returns a person who linked their own Microsoft account to /account, a path the app does not have: it belongs on Settings > Profile.

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

const goTo = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/account" element={<AccountRedirect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

describe('/account', () => {
  it('/account?section=microsoft&microsoft=linked redirects to /settings?section=profile&microsoft=linked', () => {
    goTo('/account?section=microsoft&microsoft=linked')
    expect(screen.getByTestId('where').textContent).toBe('/settings?section=profile&microsoft=linked')
  })

  it('carries a refusal code, encoded', () => {
    goTo('/account?microsoft=MicrosoftAccountTaken')
    expect(screen.getByTestId('where').textContent).toBe('/settings?section=profile&microsoft=MicrosoftAccountTaken')
  })

  it('without an outcome goes to Profile alone', () => {
    goTo('/account')
    expect(screen.getByTestId('where').textContent).toBe('/settings?section=profile')
  })
})
