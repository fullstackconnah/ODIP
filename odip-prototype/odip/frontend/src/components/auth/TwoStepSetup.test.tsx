import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TwoStepSetup } from './TwoStepSetup'

const m = vi.hoisted(() => ({
  multiFactor: vi.fn(),
  generateSecret: vi.fn(),
  assertionForEnrollment: vi.fn(),
  enroll: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  multiFactor: m.multiFactor,
  TotpMultiFactorGenerator: { generateSecret: m.generateSecret, assertionForEnrollment: m.assertionForEnrollment },
}))

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const user = { email: 'jane.smith@acme.example.com' } as never
const secret = (deadline = new Date(Date.now() + 600_000).toISOString()) => ({
  secretKey: KEY,
  generateQrCodeUrl: vi.fn().mockReturnValue('otpauth://totp/Bunya%20Support:jane?secret=ABCD&issuer=Bunya%20Support'),
  enrollmentCompletionDeadline: deadline,
})
const props = { user, host: 'settings' as const, onEnrolled: vi.fn(), onCancel: vi.fn(), onSignInAgain: vi.fn() }

beforeEach(() => {
  Object.values(props).forEach(p => typeof p === 'function' && 'mockReset' in p && (p as ReturnType<typeof vi.fn>).mockReset())
  props.onEnrolled.mockResolvedValue(undefined)
  m.multiFactor.mockReset().mockReturnValue({ getSession: async () => 'session', enroll: m.enroll })
  m.generateSecret.mockReset().mockImplementation(async () => secret())
  m.assertionForEnrollment.mockReset().mockReturnValue('assertion')
  m.enroll.mockReset().mockResolvedValue(undefined)
})

async function enter(code = '123456') {
  const u = userEvent.setup()
  await u.type(await screen.findByLabelText('Code'), code)
  await u.click(screen.getByRole('button', { name: 'Turn on' }))
  return u
}

describe('TwoStepSetup', () => {
  it('says it is getting the code while it waits, with the buttons held', () => {
    m.generateSecret.mockReturnValue(new Promise(() => {}))
    render(<TwoStepSetup {...props} />)

    expect(screen.getByText('Getting your setup code…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled()
  })

  it('draws the QR code and the key in groups of four, asking Firebase for the Bunya Support issuer', async () => {
    render(<TwoStepSetup {...props} />)

    expect(await screen.findByRole('img', { name: /QR code for setting up two-step verification/ })).toBeInTheDocument()
    expect(screen.getByText('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567')).toBeInTheDocument()
    const issued = (await m.generateSecret.mock.results[0].value).generateQrCodeUrl
    expect(issued).toHaveBeenCalledWith('jane.smith@acme.example.com', 'Bunya Support')
    expect(screen.getByRole('link', { name: 'Open in your authenticator app' })).toHaveAttribute('href', expect.stringMatching(/^otpauth:\/\//))
  })

  it('adds the factor with the code, then hands over', async () => {
    render(<TwoStepSetup {...props} />)
    await enter()

    await waitFor(() => expect(m.enroll).toHaveBeenCalledWith('assertion', 'Authenticator app'))
    expect(m.assertionForEnrollment).toHaveBeenCalledWith(expect.objectContaining({ secretKey: KEY }), '123456')
    await waitFor(() => expect(props.onEnrolled).toHaveBeenCalled())
  })

  it('never touches the clipboard (live is plain HTTP)', async () => {
    const read = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => { read(); return undefined } })
    render(<TwoStepSetup {...props} />)
    await screen.findByText(/ABCD EFGH/)

    expect(read).not.toHaveBeenCalled()
  })

  it('names the wrong code, with the field marked invalid', async () => {
    m.enroll.mockRejectedValue({ code: 'auth/invalid-verification-code' })
    render(<TwoStepSetup {...props} />)
    await enter()

    expect(await screen.findByText("That code didn't work. Check the app lists Bunya Support, then enter the newest code.")).toBeInTheDocument()
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true')
    expect(props.onEnrolled).not.toHaveBeenCalled()
  })

  it('offers a new code when this one has expired, and generates again', async () => {
    m.enroll.mockRejectedValue({ code: 'auth/code-expired' })
    render(<TwoStepSetup {...props} />)
    const u = await enter()

    expect(await screen.findByText('This setup code has expired.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Get a new code' }))
    await waitFor(() => expect(m.generateSecret).toHaveBeenCalledTimes(2))
  })

  it('expires by the clock too, without calling Firebase', async () => {
    m.generateSecret.mockImplementation(async () => secret(new Date(Date.now() - 1000).toISOString()))
    render(<TwoStepSetup {...props} />)
    await enter()

    expect(await screen.findByText('This setup code has expired.')).toBeInTheDocument()
    expect(m.enroll).not.toHaveBeenCalled()
  })

  it('asks to sign in again when Firebase wants a recent sign-in', async () => {
    m.enroll.mockRejectedValue({ code: 'auth/requires-recent-login' })
    render(<TwoStepSetup {...props} />)
    const u = await enter()

    expect(await screen.findByText('For your security, sign in again to finish setting up.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(props.onSignInAgain).toHaveBeenCalled()
  })

  it('says so when two-step verification is not available yet', async () => {
    m.generateSecret.mockRejectedValue({ code: 'auth/operation-not-allowed' })
    render(<TwoStepSetup {...props} />)

    expect(await screen.findByText("Two-step verification isn't available yet. Ask your administrator.")).toBeInTheDocument()
  })

  it('names the host in the buttons', async () => {
    render(<TwoStepSetup {...props} host="login" />)

    expect(await screen.findByRole('button', { name: 'Turn on and sign in' })).toBeInTheDocument()
  })
})
