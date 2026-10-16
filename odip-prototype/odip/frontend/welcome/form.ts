// Alpha sign-up form for the public landing page.
// Plain TypeScript (no React): the landing page is its own Vite entry and stays light.
// Contract (POST /api/public/early-access, same-origin JSON, landing PR 1):
//   202 { status: "received" }  any valid request, including a repeat email and a filled honeypot
//   400 ValidationProblemDetails, errors keyed by the camelCase field names; the page shows the server's own text
//   413 / 415 over the 8 KB body cap or not JSON; 429 with Retry-After when rate-limited; 500 generic

export const ENDPOINT = '/api/public/early-access'
export const FIELDS = ['name', 'organisation', 'role', 'organisationSize', 'email', 'phone', 'message'] as const // DOM order
export type FieldName = (typeof FIELDS)[number]
export const SIZES = ['under-10', '10-49', '50-199', '200-plus'] as const
export const LIMITS = { name: 100, organisation: 150, role: 100, email: 254, message: 1000 } as const
export const MESSAGES = {
  name: 'Enter your name', organisation: "Enter your organisation's name", email: 'Enter your email address',
  emailShape: 'Enter an email address like name@example.org', organisationSize: "Choose your organisation's size",
  phone: 'Use digits, spaces and + ( ) - only', message: 'Keep this to 1,000 characters or fewer',
  tooLong: (n: number) => `Keep this to ${n} characters or fewer`,
} as const
export const OFFLINE_MESSAGE = "We couldn't reach Bunya Support. Check your connection and send again; your details are still in the form."
export const ERROR_MESSAGE = "Something went wrong on our side and your details weren't saved. Try again in a few minutes."

export type FieldErrors = Partial<Record<FieldName, string>>
export type Values = Record<FieldName, string> & {
  /** Honeypot: people never see this field, so a value means a bot filled it in. */
  website: string
}
export type FormState = 'idle' | 'submitting' | 'success' | 'error' | 'rate-limited'
export type SubmitResult =
  | { kind: 'received' }
  | { kind: 'invalid'; errors: FieldErrors }
  | { kind: 'rate-limited'; retryAfterSeconds: number | null }
  | { kind: 'offline' }
  | { kind: 'error' }

// Deliberately lenient: the server does the strict check and answers 400 with field errors.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^[0-9 +()-]*$/

export const invalidMessage = (n: number) => (n === 1 ? 'Check the field marked below.' : `Check the ${n} fields marked below.`)

export function waitMessage(retryAfterSeconds: number | null): string {
  const n = retryAfterSeconds === null ? 10 : Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Too many sign-ups have come from this network in the last few minutes. Try again in ${n} minute${n === 1 ? '' : 's'}.`
}

export function validateField(field: FieldName, raw: string): string | null {
  const v = raw.trim()
  switch (field) {
    case 'name':
    case 'organisation':
      return !v ? MESSAGES[field] : v.length > LIMITS[field] ? MESSAGES.tooLong(LIMITS[field]) : null
    case 'email':
      return !v ? MESSAGES.email : v.length > LIMITS.email || !EMAIL_SHAPE.test(v) ? MESSAGES.emailShape : null
    case 'organisationSize':
      return (SIZES as readonly string[]).includes(v) ? null : MESSAGES.organisationSize
    case 'role':
      return v.length > LIMITS.role ? MESSAGES.tooLong(LIMITS.role) : null
    case 'phone':
      return PHONE.test(v) ? null : MESSAGES.phone
    case 'message':
      return v.length > LIMITS.message ? MESSAGES.message : null
  }
}

export function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {}
  for (const field of FIELDS) {
    const message = validateField(field, values[field])
    if (message) errors[field] = message
  }
  return errors
}

/** Maps ValidationProblemDetails ({ errors: { organisationSize: ["..."] } }) onto the fields, matching keys in any casing (first key wins). */
export function parseFieldErrors(body: unknown): FieldErrors {
  const out: FieldErrors = {}
  const errors = (body as { errors?: Record<string, unknown> } | null)?.errors
  if (!errors || typeof errors !== 'object') return out
  for (const [key, value] of Object.entries(errors)) {
    const field = FIELDS.find((f) => f.toLowerCase() === key.toLowerCase())
    if (!field || out[field]) continue
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
  const body: Record<string, string> = {}
  for (const field of FIELDS) body[field] = values[field].trim()
  body.website = values.website
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (response.status === 429) {
      return { kind: 'rate-limited', retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')) }
    }
    if (response.status === 400) {
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        parsed = null
      }
      return { kind: 'invalid', errors: parseFieldErrors(parsed) }
    }
    if (response.ok) return { kind: 'received' }
    return { kind: 'error' }
  } catch {
    // A rejected fetch or the timeout's abort: the request never got an answer.
    return { kind: 'offline' }
  } finally {
    clearTimeout(timer)
  }
}

export interface FormOptions {
  fetchFn?: typeof fetch
  endpoint?: string
}
export interface FormController {
  getState(): FormState
  destroy(): void
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

export function initEarlyAccessForm(form: HTMLFormElement, options: FormOptions = {}): FormController {
  const container = form.parentElement ?? form
  const inputs = Object.fromEntries(
    [...FIELDS, 'website' as const].map((f) => [f, form.querySelector<Control>(`[data-field="${f}"]`)]),
  ) as Record<FieldName | 'website', Control | null>
  const errorEls = Object.fromEntries(
    FIELDS.map((f) => [f, form.querySelector<HTMLElement>(`[data-error="${f}"]`)]),
  ) as Record<FieldName, HTMLElement | null>
  const status = form.querySelector<HTMLElement>('[data-status]')
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')
  const submitLabel = form.querySelector<HTMLElement>('[data-submit-label]')
  const nojs = form.querySelector<HTMLElement>('[data-nojs]')
  const success = container.querySelector<HTMLElement>('[data-success]')
  const heading = container.querySelector<HTMLElement>('[data-success-heading]')
  const reset = container.querySelector<HTMLElement>('[data-reset]')

  let state: FormState = 'idle'
  // Touched means edited: a field shows a blur error only once the visitor has changed it.
  const touched = new Set<FieldName>()
  // Blur validation shows an error and shifts the layout. If that happens while the pointer is pressing the
  // submit button, the button moves away and the click is lost, so blur never validates in that moment.
  let pressingSubmit = false

  const fieldOf = (target: EventTarget | null) => FIELDS.find((f) => inputs[f] === target)

  function values(): Values {
    const out = { website: inputs.website?.value ?? '' } as Values
    for (const field of FIELDS) out[field] = inputs[field]?.value ?? ''
    return out
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

  function showStatus(message: string | null, tone: 'error' | 'wait' = 'error') {
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
    if (submitLabel) submitLabel.textContent = busy ? 'Sending…' : 'Join the alpha'
  }

  function markInvalid(errors: FieldErrors) {
    for (const field of FIELDS) setFieldError(field, errors[field] ?? null)
    const first = FIELDS.find((f) => errors[f])
    showStatus(invalidMessage(Object.keys(errors).length || 1), 'error')
    if (first) inputs[first]?.focus()
    else status?.focus()
  }

  function onEdit(event: Event) {
    const field = fieldOf(event.target)
    if (!field) return
    touched.add(field)
    if (inputs[field]?.getAttribute('aria-invalid') === 'true' && !validateField(field, inputs[field]!.value)) setFieldError(field, null)
  }

  function onBlur(event: FocusEvent) {
    if (pressingSubmit || event.relatedTarget === submit) return
    const field = fieldOf(event.target)
    if (field && touched.has(field)) setFieldError(field, validateField(field, inputs[field]!.value))
  }

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (state === 'submitting') return
    const current = values()
    const errors = validate(current)
    if (Object.keys(errors).length > 0) {
      setState('idle')
      markInvalid(errors)
      return
    }
    for (const field of FIELDS) setFieldError(field, null)
    showStatus(null)
    setState('submitting')
    const result = await submitRequest(current, options.fetchFn, options.endpoint)
    if (result.kind === 'received') {
      setState('success')
      form.hidden = true
      if (success) success.hidden = false
      heading?.focus()
      return
    }
    if (result.kind === 'invalid') {
      setState('idle')
      markInvalid(result.errors)
      return
    }
    if (result.kind === 'rate-limited') {
      setState('rate-limited')
      showStatus(waitMessage(result.retryAfterSeconds), 'wait')
    } else {
      setState('error')
      showStatus(result.kind === 'offline' ? OFFLINE_MESSAGE : ERROR_MESSAGE, 'error')
    }
    status?.focus()
  }

  function onReset() {
    for (const f of [...FIELDS, 'website' as const]) if (inputs[f]) inputs[f]!.value = ''
    touched.clear()
    for (const field of FIELDS) setFieldError(field, null)
    showStatus(null)
    setState('idle')
    form.hidden = false
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
  form.addEventListener('input', onEdit)
  form.addEventListener('change', onEdit)
  form.addEventListener('focusout', onBlur)
  reset?.addEventListener('click', onReset)
  // The button ships disabled, with a note, so a no-JavaScript visitor cannot send the form to the wrong place.
  if (nojs) nojs.hidden = true
  setState('idle')

  return {
    getState: () => state,
    destroy() {
      submit?.removeEventListener('pointerdown', onPress)
      doc.removeEventListener('pointerup', onRelease)
      doc.removeEventListener('pointercancel', onRelease)
      form.removeEventListener('submit', onSubmit)
      form.removeEventListener('input', onEdit)
      form.removeEventListener('change', onEdit)
      form.removeEventListener('focusout', onBlur)
      reset?.removeEventListener('click', onReset)
    },
  }
}
