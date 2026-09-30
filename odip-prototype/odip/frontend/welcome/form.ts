// Early-access request form for the public landing page.
// Plain TypeScript (no React): the landing page is its own Vite entry and stays light.
// Contract (POST /api/public/early-access, JSON):
//   202 { status: "received" }  any valid request, including a duplicate email and a filled honeypot
//   400 ValidationProblemDetails with per-field errors
//   429 with Retry-After when rate-limited
//   500 generic

export const ENDPOINT = '/api/public/early-access'
export const LIMITS = { name: 100, organisation: 150, email: 254 } as const

export type FieldName = 'name' | 'organisation' | 'email'
export type FieldErrors = Partial<Record<FieldName, string>>
export interface Values {
  name: string
  organisation: string
  email: string
  /** Honeypot: people never see this field, so a value means a bot filled it in. */
  website: string
}
export type FormState = 'idle' | 'submitting' | 'success' | 'error' | 'rate-limited'
export type SubmitResult =
  | { kind: 'received' }
  | { kind: 'invalid'; errors: FieldErrors }
  | { kind: 'rate-limited'; retryAfterSeconds: number | null }
  | { kind: 'error' }

const FIELDS: FieldName[] = ['name', 'organisation', 'email']
// Deliberately lenient: the server does the strict check and answers 400 with field errors.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateField(field: FieldName, raw: string): string | null {
  const value = raw.trim()
  if (field === 'name') {
    if (!value) return 'Enter your name.'
    if (value.length > LIMITS.name) return `Use ${LIMITS.name} characters or fewer.`
  }
  if (field === 'organisation') {
    if (!value) return 'Enter your organisation.'
    if (value.length > LIMITS.organisation) return `Use ${LIMITS.organisation} characters or fewer.`
  }
  if (field === 'email') {
    if (!value) return 'Enter your email address.'
    if (value.length > LIMITS.email || !EMAIL_SHAPE.test(value)) {
      return 'Enter a valid email address, like name@organisation.org.au.'
    }
  }
  return null
}

export function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {}
  for (const field of FIELDS) {
    const message = validateField(field, values[field])
    if (message) errors[field] = message
  }
  return errors
}

/** Maps ValidationProblemDetails ({ errors: { Name: ["..."] } }) onto the three visible fields. */
export function parseFieldErrors(body: unknown): FieldErrors {
  const out: FieldErrors = {}
  const errors = (body as { errors?: Record<string, unknown> } | null)?.errors
  if (!errors || typeof errors !== 'object') return out
  for (const [key, value] of Object.entries(errors)) {
    const field = FIELDS.find((f) => f === key.toLowerCase())
    if (!field) continue
    const first = Array.isArray(value) ? value.find((v) => typeof v === 'string') : value
    if (typeof first === 'string' && first.trim()) out[field] = first.trim()
  }
  return out
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds)
  const date = Date.parse(header)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.round((date - Date.now()) / 1000))
}

export async function submitRequest(
  values: Values,
  fetchFn: typeof fetch = (...args) => fetch(...args),
  endpoint: string = ENDPOINT,
  timeoutMs = 15000,
): Promise<SubmitResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: values.name.trim(),
        organisation: values.organisation.trim(),
        email: values.email.trim(),
        website: values.website,
      }),
      signal: controller.signal,
    })
    if (response.status === 429) {
      return { kind: 'rate-limited', retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')) }
    }
    if (response.status === 400) {
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      return { kind: 'invalid', errors: parseFieldErrors(body) }
    }
    if (response.ok) return { kind: 'received' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  } finally {
    clearTimeout(timer)
  }
}

export function waitMessage(retryAfterSeconds: number | null): string {
  const minutes = retryAfterSeconds === null ? null : Math.max(1, Math.ceil(retryAfterSeconds / 60))
  const wait = minutes === null ? 'a few minutes' : minutes === 1 ? 'a minute' : `${minutes} minutes`
  return `There have been a lot of requests from your network. Wait ${wait} and try again. Your details are still here.`
}

export const ERROR_MESSAGE = 'Something went wrong on our side, so your request was not sent. Your details are still here. Try again.'
export const INVALID_MESSAGE = 'Some details need another look. Check the fields marked below.'

export interface FormOptions {
  fetchFn?: typeof fetch
  endpoint?: string
}
export interface FormController {
  getState(): FormState
  destroy(): void
}

export function initEarlyAccessForm(form: HTMLFormElement, options: FormOptions = {}): FormController {
  const container = form.parentElement ?? form
  const inputs = Object.fromEntries(
    [...FIELDS, 'website' as const].map((f) => [f, form.querySelector<HTMLInputElement>(`[data-field="${f}"]`)]),
  ) as Record<FieldName | 'website', HTMLInputElement | null>
  const errorEls = Object.fromEntries(
    FIELDS.map((f) => [f, form.querySelector<HTMLElement>(`[data-error="${f}"]`)]),
  ) as Record<FieldName, HTMLElement | null>
  const status = form.querySelector<HTMLElement>('[data-status]')
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')
  const submitLabel = form.querySelector<HTMLElement>('[data-submit-label]')
  const success = container.querySelector<HTMLElement>('[data-success]')
  const reset = container.querySelector<HTMLElement>('[data-reset]')
  const hideOnSuccess = Array.from(container.querySelectorAll<HTMLElement>('[data-hide-on-success]'))
  const idleLabel = submitLabel?.textContent?.trim() || 'Request early access'

  let state: FormState = 'idle'
  // Blur validation shows an error and shifts the layout. If that happens while the pointer is pressing the
  // submit button, the button moves away and the click is lost, so blur never validates in that moment.
  let pressingSubmit = false

  function values(): Values {
    return {
      name: inputs.name?.value ?? '',
      organisation: inputs.organisation?.value ?? '',
      email: inputs.email?.value ?? '',
      website: inputs.website?.value ?? '',
    }
  }

  function setFieldError(field: FieldName, message: string | null) {
    const input = inputs[field]
    const el = errorEls[field]
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
    }
    if (el) {
      el.textContent = message ?? ''
      el.hidden = !message
    }
  }

  function showStatus(message: string | null, tone: 'error' | 'wait' | 'info' = 'info') {
    if (!status) return
    status.textContent = message ?? ''
    status.hidden = !message
    status.dataset.tone = tone
  }

  function setState(next: FormState) {
    state = next
    const busy = next === 'submitting'
    form.setAttribute('aria-busy', String(busy))
    if (submit) {
      submit.disabled = false
      submit.setAttribute('aria-disabled', String(busy))
    }
    if (submitLabel) {
      submitLabel.textContent = busy ? 'Sending…' : next === 'error' || next === 'rate-limited' ? 'Try again' : idleLabel
    }
  }

  function focusFirstInvalid(errors: FieldErrors): boolean {
    const first = FIELDS.find((f) => errors[f])
    if (!first) return false
    inputs[first]?.focus()
    return true
  }

  function onInput(event: Event) {
    const target = event.target as HTMLInputElement
    const field = FIELDS.find((f) => inputs[f] === target)
    if (field && target.getAttribute('aria-invalid') === 'true') setFieldError(field, null)
  }

  function onBlur(event: FocusEvent) {
    if (pressingSubmit || event.relatedTarget === submit) return
    const target = event.target as HTMLInputElement
    const field = FIELDS.find((f) => inputs[f] === target)
    if (field && target.value.trim()) setFieldError(field, validateField(field, target.value))
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (state === 'submitting') return
    const current = values()
    const errors = validate(current)
    for (const field of FIELDS) setFieldError(field, errors[field] ?? null)
    if (Object.keys(errors).length > 0) {
      showStatus(null)
      setState('idle')
      focusFirstInvalid(errors)
      return
    }
    showStatus(null)
    setState('submitting')
    const result = await submitRequest(current, options.fetchFn, options.endpoint)
    if (result.kind === 'received') {
      setState('success')
      form.hidden = true
      hideOnSuccess.forEach((el) => (el.hidden = true))
      if (success) {
        success.hidden = false
        success.focus()
      }
      return
    }
    if (result.kind === 'invalid') {
      setState('idle')
      for (const field of FIELDS) setFieldError(field, result.errors[field] ?? null)
      showStatus(INVALID_MESSAGE, 'error')
      if (!focusFirstInvalid(result.errors)) status?.focus()
      return
    }
    if (result.kind === 'rate-limited') {
      setState('rate-limited')
      showStatus(waitMessage(result.retryAfterSeconds), 'wait')
      status?.focus()
      return
    }
    setState('error')
    showStatus(ERROR_MESSAGE, 'error')
    status?.focus()
  }

  function onReset() {
    for (const f of [...FIELDS, 'website' as const]) if (inputs[f]) inputs[f]!.value = ''
    for (const field of FIELDS) setFieldError(field, null)
    showStatus(null)
    setState('idle')
    form.hidden = false
    hideOnSuccess.forEach((el) => (el.hidden = false))
    if (success) success.hidden = true
    inputs.name?.focus()
  }

  const onPress = () => { pressingSubmit = true }
  const onRelease = () => { pressingSubmit = false }
  const doc = form.ownerDocument
  submit?.addEventListener('pointerdown', onPress)
  doc.addEventListener('pointerup', onRelease)
  doc.addEventListener('pointercancel', onRelease)
  form.addEventListener('submit', onSubmit)
  form.addEventListener('input', onInput)
  form.addEventListener('focusout', onBlur)
  reset?.addEventListener('click', onReset)
  // The button ships disabled so a no-JavaScript visitor cannot send the form to the wrong place.
  setState('idle')

  return {
    getState: () => state,
    destroy() {
      submit?.removeEventListener('pointerdown', onPress)
      doc.removeEventListener('pointerup', onRelease)
      doc.removeEventListener('pointercancel', onRelease)
      form.removeEventListener('submit', onSubmit)
      form.removeEventListener('input', onInput)
      form.removeEventListener('focusout', onBlur)
      reset?.removeEventListener('click', onReset)
    },
  }
}
