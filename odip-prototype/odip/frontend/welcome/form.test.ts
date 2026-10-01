import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from './index.html?raw'
import {
  ENDPOINT,
  ERROR_MESSAGE,
  INVALID_MESSAGE,
  initEarlyAccessForm,
  parseFieldErrors,
  submitRequest,
  validate,
  validateField,
  waitMessage,
  type FormController,
} from './form'

const VALID = { name: 'Alex Sample', organisation: 'Sample Support Co', email: 'alex@example.org', website: '' }

function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/** The form under test is the real markup from welcome/index.html, so markup and module cannot drift apart. */
function mountForm(fetchFn: typeof fetch) {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html')
  const sign = page.querySelector('.sign--form')!
  document.body.replaceChildren()
  document.body.append(document.importNode(sign, true))
  const form = document.querySelector<HTMLFormElement>('#early-access-form')!
  const controller = initEarlyAccessForm(form, { fetchFn })
  const input = (name: string) => form.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!
  const fill = (values: Partial<typeof VALID>) => {
    for (const [k, v] of Object.entries(values)) input(k).value = v
  }
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
  return { form, controller, input, fill, submit, q }
}

describe('early-access form: validation', () => {
  it('asks for each required field and names the problem', () => {
    const errors = validate({ name: ' ', organisation: '', email: '', website: '' })
    expect(errors).toEqual({ name: 'Enter your name.', organisation: 'Enter your organisation.', email: 'Enter your email address.' })
  })

  it('enforces the same length limits as the API (100 / 150 / 254)', () => {
    expect(validateField('name', 'a'.repeat(100))).toBeNull()
    expect(validateField('name', 'a'.repeat(101))).toMatch(/100 characters or fewer/)
    expect(validateField('organisation', 'a'.repeat(150))).toBeNull()
    expect(validateField('organisation', 'a'.repeat(151))).toMatch(/150 characters or fewer/)
    expect(validateField('email', `${'a'.repeat(250)}@x.io`)).toMatch(/valid email/)
  })

  it.each(['alex', 'alex@', '@example.org', 'alex@example', 'a lex@example.org'])('rejects the email %s', (email) => {
    expect(validateField('email', email)).toMatch(/valid email/)
  })

  it('accepts a normal address and trims whitespace', () => {
    expect(validateField('email', '  alex@example.org.au ')).toBeNull()
    expect(validate(VALID)).toEqual({})
  })

  it('maps ValidationProblemDetails onto the visible fields, case-insensitively', () => {
    expect(parseFieldErrors({ errors: { Name: ['Too long.'], EMAIL: ['Not an address.', 'x'], Website: ['ignored'] } })).toEqual({
      name: 'Too long.',
      email: 'Not an address.',
    })
    expect(parseFieldErrors(null)).toEqual({})
    expect(parseFieldErrors({ errors: 'nope' })).toEqual({})
  })
})

describe('early-access form: request', () => {
  it('POSTs JSON to /api/public/early-access with trimmed values and the honeypot', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(202, { status: 'received' }))
    const result = await submitRequest({ ...VALID, name: '  Alex Sample ', website: '' }, fetchFn)
    expect(result).toEqual({ kind: 'received' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    expect(ENDPOINT).toBe('/api/public/early-access')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ name: 'Alex Sample', organisation: 'Sample Support Co', email: 'alex@example.org', website: '' })
  })

  it('sends a filled honeypot through so the server can drop it silently', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(202))
    await submitRequest({ ...VALID, website: 'http://spam.example' }, fetchFn)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).website).toBe('http://spam.example')
  })

  it('maps 400 to field errors, 429 to rate-limited with Retry-After, everything else to error', async () => {
    expect(await submitRequest(VALID, vi.fn().mockResolvedValue(reply(400, { errors: { Email: ['Enter a valid email address.'] } })))).toEqual({
      kind: 'invalid',
      errors: { email: 'Enter a valid email address.' },
    })
    expect(await submitRequest(VALID, vi.fn().mockResolvedValue(reply(429, {}, { 'Retry-After': '540' })))).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: 540,
    })
    expect(await submitRequest(VALID, vi.fn().mockResolvedValue(reply(429)))).toEqual({ kind: 'rate-limited', retryAfterSeconds: null })
    expect(await submitRequest(VALID, vi.fn().mockResolvedValue(reply(500)))).toEqual({ kind: 'error' })
    expect(await submitRequest(VALID, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toEqual({ kind: 'error' })
  })

  it('survives a 400 with an unreadable body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('<html>', { status: 400 }))
    expect(await submitRequest(VALID, fetchFn)).toEqual({ kind: 'invalid', errors: {} })
  })

  it('words the wait in minutes', () => {
    expect(waitMessage(null)).toMatch(/a few minutes/)
    expect(waitMessage(20)).toMatch(/a minute/)
    expect(waitMessage(600)).toMatch(/10 minutes/)
    expect(waitMessage(600)).toMatch(/details are still here/)
  })
})

describe('early-access form: states in the page', () => {
  let controller: FormController | null = null
  beforeEach(() => {
    document.body.replaceChildren()
  })
  afterEach(() => {
    controller?.destroy()
    controller = null
  })

  it('ships disabled (no-JavaScript guard) and is enabled once the module starts', () => {
    const page = new DOMParser().parseFromString(indexHtml, 'text/html')
    expect(page.querySelector<HTMLButtonElement>('[data-submit]')!.disabled).toBe(true)
    const m = mountForm(vi.fn())
    controller = m.controller
    expect(m.q<HTMLButtonElement>('[data-submit]').disabled).toBe(false)
    expect(m.controller.getState()).toBe('idle')
  })

  it('inline validation: no request, every problem named, focus moves to the first invalid field', () => {
    const fetchFn = vi.fn()
    const m = mountForm(fetchFn)
    controller = m.controller
    m.fill({ name: 'Alex Sample', organisation: '', email: 'not-an-email' })
    m.submit()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(m.input('organisation').getAttribute('aria-invalid')).toBe('true')
    expect(m.input('email').getAttribute('aria-invalid')).toBe('true')
    expect(m.input('name').hasAttribute('aria-invalid')).toBe(false)
    expect(m.q('[data-error="organisation"]').textContent).toBe('Enter your organisation.')
    expect(m.q('[data-error="organisation"]').hidden).toBe(false)
    expect(document.activeElement).toBe(m.input('organisation'))
    // each input names its error paragraph for assistive tech
    expect(m.input('email').getAttribute('aria-describedby')).toBe('ea-email-error')
  })

  it('blur validation never fires while the submit button is being pressed (the layout shift would eat the click)', () => {
    const m = mountForm(vi.fn())
    controller = m.controller
    const submit = m.q<HTMLButtonElement>('[data-submit]')
    m.input('email').value = 'alex@'
    // focus moving to the submit button: no error yet
    m.input('email').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: submit }))
    expect(m.input('email').hasAttribute('aria-invalid')).toBe(false)
    // pointer pressed on the submit button (Safari does not focus buttons): still no error
    submit.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    m.input('email').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(m.input('email').hasAttribute('aria-invalid')).toBe(false)
    document.dispatchEvent(new Event('pointerup'))
    // an ordinary blur still validates inline
    m.input('email').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(m.input('email').getAttribute('aria-invalid')).toBe('true')
  })

  it('clears a field error as soon as the person edits that field', () => {
    const m = mountForm(vi.fn())
    controller = m.controller
    m.submit()
    expect(m.input('name').getAttribute('aria-invalid')).toBe('true')
    m.input('name').value = 'A'
    m.input('name').dispatchEvent(new Event('input', { bubbles: true }))
    expect(m.input('name').hasAttribute('aria-invalid')).toBe(false)
    expect(m.q('[data-error="name"]').hidden).toBe(true)
  })

  it('submitting: shows the busy state and ignores a second submit', async () => {
    let finish!: (r: Response) => void
    const fetchFn = vi.fn().mockReturnValue(new Promise<Response>((r) => (finish = r)))
    const m = mountForm(fetchFn)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    expect(m.controller.getState()).toBe('submitting')
    expect(m.form.getAttribute('aria-busy')).toBe('true')
    expect(m.q('[data-submit]').getAttribute('aria-disabled')).toBe('true')
    expect(m.q('[data-submit-label]').textContent).toBe('Sending…')
    m.submit()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    finish(reply(202, { status: 'received' }))
    await vi.waitFor(() => expect(m.controller.getState()).toBe('success'))
  })

  it('success: hides the form, says what happens next, moves focus, and offers another request', async () => {
    const m = mountForm(vi.fn().mockResolvedValue(reply(202, { status: 'received' })))
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.controller.getState()).toBe('success'))
    expect(m.form.hidden).toBe(true)
    const success = m.q('[data-success]')
    expect(success.hidden).toBe(false)
    expect(success.textContent).toContain('We will email alex@example.org about early access.')
    expect(m.q('[data-success-email]').textContent).toBe(VALID.email)
    expect(document.activeElement).toBe(success)
    expect(m.q('[data-hide-on-success]').hidden).toBe(true)
    m.q<HTMLButtonElement>('[data-reset]').click()
    expect(m.form.hidden).toBe(false)
    expect(success.hidden).toBe(true)
    expect(m.input('name').value).toBe('')
    expect(m.q('[data-success-email]').textContent).toBe('your address')
    expect(m.controller.getState()).toBe('idle')
  })

  it('server field errors (400): shown inline, focus on the first, input kept', async () => {
    const m = mountForm(vi.fn().mockResolvedValue(reply(400, { errors: { Email: ['Enter a valid email address.'] } })))
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.q('[data-error="email"]').hidden).toBe(false))
    expect(m.q('[data-error="email"]').textContent).toBe('Enter a valid email address.')
    expect(m.q('[data-status]').textContent).toBe(INVALID_MESSAGE)
    expect(document.activeElement).toBe(m.input('email'))
    expect(m.input('name').value).toBe(VALID.name)
    expect(m.controller.getState()).toBe('idle')
  })

  it('error (500): says so, keeps what was typed, and a retry can succeed', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(202))
    const m = mountForm(fetchFn)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.controller.getState()).toBe('error'))
    const status = m.q('[data-status]')
    expect(status.hidden).toBe(false)
    expect(status.textContent).toBe(ERROR_MESSAGE)
    expect(status.getAttribute('role')).toBe('alert')
    expect(m.input('email').value).toBe(VALID.email)
    expect(m.q('[data-submit-label]').textContent).toBe('Try again')
    expect(document.activeElement).toBe(status)
    m.submit()
    await vi.waitFor(() => expect(m.controller.getState()).toBe('success'))
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('network failure is treated like an error and keeps the input', async () => {
    const m = mountForm(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.controller.getState()).toBe('error'))
    expect(m.input('organisation').value).toBe(VALID.organisation)
  })

  it('rate-limited (429): explains the wait, keeps the input, and allows another try', async () => {
    const m = mountForm(vi.fn().mockResolvedValue(reply(429, {}, { 'Retry-After': '600' })))
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.controller.getState()).toBe('rate-limited'))
    expect(m.q('[data-status]').textContent).toMatch(/10 minutes/)
    expect(m.q('[data-status]').dataset.tone).toBe('wait')
    expect(m.input('name').value).toBe(VALID.name)
    expect(m.q<HTMLButtonElement>('[data-submit]').disabled).toBe(false)
    expect(m.q('[data-submit-label]').textContent).toBe('Try again')
  })

  it('a filled honeypot is sent, and to the visitor it still looks like success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(202))
    const m = mountForm(fetchFn)
    controller = m.controller
    m.fill({ ...VALID, website: 'http://spam.example' })
    m.submit()
    await vi.waitFor(() => expect(m.controller.getState()).toBe('success'))
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).website).toBe('http://spam.example')
  })

  it('the honeypot is hidden from people and from assistive tech', () => {
    const m = mountForm(vi.fn())
    controller = m.controller
    const hp = m.q('.hp')
    expect(hp.getAttribute('aria-hidden')).toBe('true')
    expect(m.input('website').tabIndex).toBe(-1)
    expect(m.input('website').getAttribute('autocomplete')).toBe('off')
  })
})
