import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from './index.html?raw'
import {
  ENDPOINT,
  ERROR_MESSAGE,
  MESSAGES,
  OFFLINE_MESSAGE,
  REFUSED_MESSAGE,
  SIZES,
  initEarlyAccessForm,
  invalidMessage,
  parseFieldErrors,
  submitRequest,
  validate,
  validateField,
  waitMessage,
  type FormController,
} from './form'

const VALID = { name: 'Alex Sample', organisation: 'Sample Support Co', role: '', organisationSize: '10-49', email: 'alex@example.org', phone: '', message: '', website: '' }
type Values = typeof VALID

function reply(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/** The form under test is the real markup from welcome/index.html, so markup and module cannot drift apart. */
function mountForm(fetchFn: typeof fetch) {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html')
  const panel = page.querySelector('[data-form-panel]')!
  document.body.replaceChildren()
  document.body.append(document.importNode(panel, true))
  const form = document.querySelector<HTMLFormElement>('#alpha-form')!
  const controller = initEarlyAccessForm(form, { fetchFn })
  const input = (name: string) => form.querySelector<HTMLInputElement>(`[data-field="${name}"]`)!
  // Sets the value and fires input, as typing does, so the touched rules run.
  const fill = (values: Partial<Values>) => {
    for (const [k, v] of Object.entries(values)) {
      input(k).value = v
      input(k).dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
  const blur = (name: string) => input(name).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
  const error = (name: string) => q(`[data-error="${name}"]`)
  const shown = (el: HTMLElement) => (el.hidden ? null : el.textContent)
  return { form, controller, input, fill, blur, submit, q, error, shown }
}

let controller: FormController | undefined
afterEach(() => {
  controller?.destroy()
  controller = undefined
  vi.useRealTimers()
})

describe('alpha form: checks', () => {
  it.each([
    ['name', '', 'Enter your name'],
    ['organisation', ' ', "Enter your organisation's name"],
    ['email', '', 'Enter your email address'],
    ['organisationSize', '', "Choose your organisation's size"],
    ['email', 'alex@example', 'Enter an email address like name@example.org'],
    ['role', 'r'.repeat(101), 'Keep this to 100 characters or fewer'],
    ['phone', '+61 9876 5432 ext 104', 'Use digits, spaces and + ( ) - only'],
    ['phone', '123', 'Enter a phone number with 8 to 15 digits'],
    ['phone', '---', 'Enter a phone number with 8 to 15 digits'],
    ['phone', '0491+570156', 'Enter a phone number with 8 to 15 digits'],
    ['phone', '1234567890123456', 'Enter a phone number with 8 to 15 digits'],
    ['message', 'm'.repeat(1001), 'Keep this to 1,000 characters or fewer'],
    ['organisationSize', 'Under-10', "Choose your organisation's size"],
  ] as const)('names each problem in SHAPE\'s words: %s %j', (field, value, message) => {
    expect(validateField(field, value)).toBe(message)
  })

  it('accepts the edge of every limit', () => {
    expect(validateField('name', 'n'.repeat(100))).toBeNull()
    expect(validateField('name', 'n'.repeat(101))).toBe(MESSAGES.tooLong(100))
    expect(validateField('organisation', 'o'.repeat(150))).toBeNull()
    expect(validateField('organisation', 'o'.repeat(151))).toBe('Keep this to 150 characters or fewer')
    expect(validateField('role', 'r'.repeat(100))).toBeNull()
    expect(validateField('message', 'm'.repeat(1000))).toBeNull()
    expect(validateField('phone', '+61 (02) 9876-5432')).toBeNull()
    expect(['', ' ', '1234 5678', '123456789012345', '+61491570156'].map((p) => validateField('phone', p))).toEqual([null, null, null, null, null])
    for (const size of SIZES) expect(validateField('organisationSize', size)).toBeNull()
    expect(validate(VALID)).toEqual({})
  })

  it('maps a 400 onto the size field in any key casing, with the server\'s own text', () => {
    const errors = parseFieldErrors({
      errors: { organisationSize: ['Choose one of the listed sizes.'], OrganisationSize: ['x'], EMAIL: ['Bad'], nope: ['ignored'], name: [42] },
    })
    expect(errors).toEqual({ organisationSize: 'Choose one of the listed sizes.', email: 'Bad' })
  })

  it('counts the fields in the status line', () => {
    expect(invalidMessage(1)).toBe('Check the highlighted field.')
    expect(invalidMessage(3)).toBe('Check the 3 highlighted fields.')
  })

  it('words the 429 wait from Retry-After: 10 when missing, 1 minute singular, dates in minutes', async () => {
    expect(waitMessage(null)).toBe('Too many sign-ups have come from this network in the last few minutes. Try again in 10 minutes.')
    expect(waitMessage(30)).toMatch(/Try again in 1 minute\.$/)
    expect(waitMessage(61)).toMatch(/in 2 minutes\.$/)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-17T00:00:00Z'))
    const later = new Date('2026-10-17T00:05:00Z').toUTCString()
    const fetchFn = vi.fn(async () => reply(429, {}, { 'Retry-After': later }))
    expect(await submitRequest(VALID, fetchFn as unknown as typeof fetch)).toEqual({ kind: 'rate-limited', retryAfterSeconds: 300 })
  })
})

describe('alpha form: request', () => {
  it('POSTs all 8 keys, trimmed, as JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply(202, { status: 'received' }))
    const padded = { name: '  Alex Sample ', organisation: ' Sample Support Co ', role: ' Ops lead ', organisationSize: ' 10-49 ', email: ' alex@example.org ', phone: ' 0491 570 156 ', message: '  Rostering  ', website: ' ' }
    expect(await submitRequest(padded, fetchFn as unknown as typeof fetch)).toEqual({ kind: 'received' })
    const [url, init] = fetchFn.mock.calls[0]
    expect([url, init!.method, (init!.headers as Record<string, string>)['Content-Type']]).toEqual([ENDPOINT, 'POST', 'application/json'])
    expect(JSON.parse(init!.body as string)).toEqual({
      name: 'Alex Sample', organisation: 'Sample Support Co', role: 'Ops lead', organisationSize: '10-49', email: 'alex@example.org',
      phone: '0491 570 156', message: 'Rostering', website: ' ',
    })
  })

  it('sends a message with markup in it verbatim and never renders it', async () => {
    const markup = '<script>alert(1)</script> & <b>hi</b>'
    const fetchFn = vi.fn<typeof fetch>(async () => reply(400, { errors: { message: ['<img src=x onerror=alert(1)>'] } }))
    const m = mountForm(fetchFn as unknown as typeof fetch)
    controller = m.controller
    m.fill({ ...VALID, message: markup })
    m.submit()
    await vi.waitFor(() => expect(m.shown(m.error('message'))).toBe('<img src=x onerror=alert(1)>'))
    expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string).message).toBe(markup)
    expect(m.error('message').querySelector('img')).toBeNull()
    expect(document.body.querySelector('script, b')).toBeNull()
  })

  it.each([
    [202, 'received'], [200, 'received'], [400, 'invalid'], [429, 'rate-limited'], [500, 'error'], [413, 'error'], [415, 'error'],
  ])('maps each reply to its result: %i is %s', async (status, kind) => {
    const result = await submitRequest(VALID, (async () => reply(status)) as unknown as typeof fetch)
    expect(result.kind).toBe(kind)
  })

  it('maps a rejected fetch to offline', async () => {
    expect(await submitRequest(VALID, (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch)).toEqual({ kind: 'offline' })
  })

  it('treats a request that never answers as offline after 15 s', async () => {
    vi.useFakeTimers()
    const fetchFn = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const pending = submitRequest(VALID, fetchFn as unknown as typeof fetch)
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toEqual({ kind: 'offline' })
  })

  it('survives a 400 with an unreadable body', async () => {
    const fetchFn = async () => new Response('not json', { status: 400 })
    expect(await submitRequest(VALID, fetchFn as unknown as typeof fetch)).toEqual({ kind: 'invalid', errors: {} })
  })
})

describe('alpha form: states in the page', () => {
  it('ships disabled with the no-JS note, and the module enables it and hides the note', () => {
    const page = new DOMParser().parseFromString(indexHtml, 'text/html')
    expect([page.querySelector<HTMLButtonElement>('[data-submit]')!.disabled, page.querySelector<HTMLElement>('[data-nojs]')!.hidden]).toEqual([true, false])
    const m = mountForm(vi.fn())
    controller = m.controller
    expect([m.q<HTMLButtonElement>('[data-submit]').disabled, m.q('[data-nojs]').hidden]).toEqual([false, true])
  })

  it('checks a touched field on blur, never an untouched one, and never while the submit is pressed', () => {
    const m = mountForm(vi.fn())
    controller = m.controller
    m.input('name').focus()
    m.blur('name')
    expect(m.shown(m.error('name'))).toBeNull()
    m.fill({ name: 'a' })
    m.fill({ name: '' })
    m.blur('name')
    expect(m.shown(m.error('name'))).toBe('Enter your name')
    m.fill({ organisation: 'x' })
    m.fill({ organisation: '' })
    m.q('[data-submit]').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    m.blur('organisation')
    expect(m.shown(m.error('organisation'))).toBeNull()
  })

  it('clears an error the moment the value is valid', () => {
    const m = mountForm(vi.fn())
    controller = m.controller
    m.fill({ email: 'alex@example' })
    m.blur('email')
    expect([m.shown(m.error('email')), m.input('email').getAttribute('aria-invalid')]).toEqual(['Enter an email address like name@example.org', 'true'])
    m.fill({ email: 'alex@example.org' })
    expect([m.shown(m.error('email')), m.input('email').hasAttribute('aria-invalid')]).toEqual([null, false])
  })

  it('submit checks everything, counts the problems and focuses the first, in field order', () => {
    const fetchFn = vi.fn()
    const m = mountForm(fetchFn)
    controller = m.controller
    m.fill({ name: 'Alex Sample', organisation: 'Sample Support Co' })
    m.submit()
    expect(fetchFn).not.toHaveBeenCalled()
    expect([m.shown(m.q('[data-status]')), m.q('[data-status]').dataset.tone]).toEqual(['Check the 2 highlighted fields.', 'error'])
    expect([m.shown(m.error('organisationSize')), m.shown(m.error('email'))]).toEqual(["Choose your organisation's size", 'Enter your email address'])
    expect(document.activeElement?.id).toBe('f-size')
  })

  it('sending: says Sending…, stays enabled with aria-disabled, keeps the values, and ignores a second submit', async () => {
    let answer: (r: Response) => void = () => {}
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
    const m = mountForm(fetchFn as unknown as typeof fetch)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    const button = m.q<HTMLButtonElement>('[data-submit]')
    expect([m.q('[data-submit-label]').textContent, button.disabled, button.getAttribute('aria-disabled'), m.input('email').value]).toEqual(['Sending…', false, 'true', 'alex@example.org'])
    m.submit()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    answer(reply(500))
    await vi.waitFor(() => expect(m.q('[data-submit-label]').textContent).toBe('Join the alpha'))
  })

  it('received: replaces the form, focuses the heading, and reads the same for a repeat and for the honeypot', async () => {
    const texts: string[] = []
    for (const values of [VALID, VALID, { ...VALID, email: 'alex.again@example.org', website: 'x' }]) {
      const m = mountForm((async () => reply(202, { status: 'received' })) as unknown as typeof fetch)
      controller = m.controller
      m.fill(values)
      m.submit()
      await vi.waitFor(() => expect(m.q('[data-success]').hidden).toBe(false))
      expect([m.form.hidden, document.activeElement]).toEqual([true, m.q('[data-success-heading]')])
      texts.push(m.q('[data-success]').textContent!)
      controller.destroy()
    }
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toContain('Thanks, we have your details.')
  })

  it('Send another sign-up resets the fields, errors, status and touched state, and focuses the name', async () => {
    const m = mountForm((async () => reply(202, { status: 'received' })) as unknown as typeof fetch)
    controller = m.controller
    m.fill({ ...VALID, phone: '0491 570 156' })
    m.submit()
    await vi.waitFor(() => expect(m.q('[data-success]').hidden).toBe(false))
    m.q('[data-reset]').click()
    expect([m.form.hidden, m.q('[data-success]').hidden, m.q('[data-status]').hidden]).toEqual([false, true, true])
    expect(['name', 'organisation', 'organisationSize', 'email', 'phone'].map((f) => m.input(f).value)).toEqual(['', '', '', '', ''])
    expect(document.activeElement?.id).toBe('f-name')
    m.blur('name')
    expect(m.shown(m.error('name'))).toBeNull()
    expect(m.q('[data-submit-label]').textContent).toBe('Join the alpha')
  })

  it('a 400 marks the fields with the server\'s text, keeps the values, and focuses the first', async () => {
    const fetchFn = async () => reply(400, { errors: { email: ['That address was refused.'], organisationSize: ['Choose one of the listed sizes.'] } })
    const m = mountForm(fetchFn as unknown as typeof fetch)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.shown(m.q('[data-status]'))).toBe('Check the 2 highlighted fields.'))
    expect([m.shown(m.error('organisationSize')), m.shown(m.error('email'))]).toEqual(['Choose one of the listed sizes.', 'That address was refused.'])
    expect([m.input('email').value, m.input('organisationSize').value, document.activeElement?.id]).toEqual(['alex@example.org', '10-49', 'f-size'])
  })

  it('a 400 that names no known field focuses the status', async () => {
    const m = mountForm((async () => reply(400, { errors: { somethingElse: ['x'] } })) as unknown as typeof fetch)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.shown(m.q('[data-status]'))).toBe(REFUSED_MESSAGE))
    expect(document.activeElement).toBe(m.q('[data-status]'))
  })

  it('429: amber, the minutes, values kept, the status focused; a retry can succeed', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(reply(429, {}, { 'Retry-After': '480' }))
      .mockResolvedValueOnce(reply(202, { status: 'received' }))
    const m = mountForm(fetchFn as unknown as typeof fetch)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    const status = m.q('[data-status]')
    await vi.waitFor(() => expect(m.shown(status)).toBe('Too many sign-ups have come from this network in the last few minutes. Try again in 8 minutes.'))
    expect([status.dataset.tone, m.input('name').value, document.activeElement]).toEqual(['wait', 'Alex Sample', status])
    expect(m.q('[data-submit-label]').textContent).toBe('Join the alpha')
    m.submit()
    await vi.waitFor(() => expect(m.q('[data-success]').hidden).toBe(false))
  })

  it('offline: the connection copy, values kept', async () => {
    const m = mountForm((async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    const status = m.q('[data-status]')
    await vi.waitFor(() => expect(m.shown(status)).toBe(OFFLINE_MESSAGE))
    expect(OFFLINE_MESSAGE).toBe("We couldn't reach Bunya Support. Check your connection and send again; your details are still in the form.")
    expect([status.dataset.tone, m.input('email').value, document.activeElement]).toEqual(['error', 'alex@example.org', status])
  })

  it('500: the server copy, values kept, then a retry succeeds', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(reply(500)).mockResolvedValueOnce(reply(202, { status: 'received' }))
    const m = mountForm(fetchFn as unknown as typeof fetch)
    controller = m.controller
    m.fill(VALID)
    m.submit()
    await vi.waitFor(() => expect(m.shown(m.q('[data-status]'))).toBe(ERROR_MESSAGE))
    expect(ERROR_MESSAGE).toBe("Something went wrong on our side and your details weren't saved. Try again in a few minutes.")
    expect(m.input('organisation').value).toBe('Sample Support Co')
    m.submit()
    await vi.waitFor(() => expect(m.q('[data-success]').hidden).toBe(false))
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
