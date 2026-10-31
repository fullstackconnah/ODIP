import { useState } from 'react'
import { useProviderSettings, useUpsertProviderSettings } from '@/api/hooks'
import type { ProviderSettingsDto, UpsertProviderSettingsDto } from '@/api/types'
import { EMAIL_PATTERN } from '@/lib/participantSchema'
import { apiErrorCode, apiErrorMessages, apiErrorStatus } from '@/lib/shiftPackageErrors'
import type { SaveResult } from './SettingsSection'
import { notSavedText } from './settingsSections'

/** ProviderSettingsErrorCodes.ProviderSettingsChanged: the code on the 409 for a stale save, as opposed to the 409 that locks the invoice starting number, so a reworded sentence cannot switch the reseed off. */
const CHANGED_BY_OTHER_CODE = 'PROVIDER_SETTINGS_CHANGED'

/** ProviderSettingsController.ChangedByOther, word for word. The fallback for a server from before the code existed. */
const SERVER_CHANGED_BY_OTHER = 'Settings were changed by someone else. Reload and try again.'

/** The server's 400 for a blank required field names the field in an errors object, not a sentence, so the foot says this. */
const REQUIRED_FIELDS = 'Fill in the registration number, ABN, legal name and address.'

/** The contact checks run on the trimmed value and a blank is always valid. The server applies the same two rules and the same sentences (ProviderSettingsController). */
export const contactEmailProblem = (v: string) => (v && !EMAIL_PATTERN.test(v) ? 'Enter a full email address, like office@example.com.au.' : undefined)

/** An absolute http or https address with a dotted host: a bare example.com.au is refused, not rewritten. */
export function websiteProblem(v: string) {
  if (!v) return undefined
  try {
    const url = new URL(v)
    if (/^https?:$/.test(url.protocol) && url.hostname.includes('.') && !/\s/.test(v)) return undefined
  } catch { /* not an address */ }
  return 'Enter the full web address, starting with https://.'
}

/** A 409: another Admin saved since this form loaded. The server's sentence says to reload; the screen has already done it (see the reseed below). */
const CHANGED_BY_OTHER = 'Not saved. Someone else changed these settings. Their changes are shown and your edits kept; save again.'

/**
 * The one provider settings row behind Organisation profile, Billing details and Safety checks. Its PUT overwrites every text and flag
 * field from the body, so a section sends the row as the server last gave it with only the fields it changed replaced: an untouched null
 * stays null, and another section's fields go back exactly as they came. The query refetches when a section opens (the form seeds only
 * after that), a save writes what it sent into the cache, and the cache refetches after every save; so "as the server last gave it" is
 * that cache. It also carries the row's version back as expectedUpdatedAt, so a save from a form that another Admin has since outdated is refused (409),
 * the row is refetched, and when it arrives the form is reseeded from it with only the person's changed fields laid back over it: the screen then shows
 * exactly what the retry will write, and the fields the other Admin changed say so in their hint (`hint`; naming them in the foot pushed Save past 21px at 390).
 * The two modes and the four invoice numbering fields are never echoed: Safety checks adds a mode through `extra` only when the person changed it, and Billing
 * details sends a numbering field only when its form changed it (the server reads a missing field as unchanged; once an invoice is issued it also sends the row's own start number back).
 */
export function useProviderRow<F extends Record<string, string | boolean | number>>(pick: (row: ProviderSettingsDto | null) => F) {
  const query = useProviderSettings(true, 'always')
  const upsert = useUpsertProviderSettings()
  // No row reads as null (the mock API answers [] for a route it doesn't know).
  const row = query.data && !Array.isArray(query.data) ? query.data : null
  const [form, setForm] = useState<F | null>(null)
  const [base, setBase] = useState<F | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  // The version the refused save sent; set from a 409 until the refetched row (a different version) has been laid into the form.
  const [moved, setMoved] = useState<(keyof F)[]>([])
  const [refusedAt, setRefusedAt] = useState<string | null>(null)
  if (form === null && query.isFetchedAfterMount && !query.isFetching && !query.isError) {
    const loaded = pick(row)
    setForm(loaded)
    setBase(loaded)
  }
  const changed = form && base ? (Object.keys(form) as (keyof F)[]).filter(k => form[k] !== base[k]) : []
  if (refusedAt !== null && form && base && row && row.updatedAt !== refusedAt && !query.isFetching) {
    const fresh = pick(row)
    setForm({ ...fresh, ...Object.fromEntries(changed.map(k => [k, form[k]])) } as F)
    setBase(fresh)
    setMoved((Object.keys(fresh) as (keyof F)[]).filter(k => fresh[k] !== base[k]))
    setRefusedAt(null)
    setResult({ error: CHANGED_BY_OTHER })
  }
  // Billing details and Safety checks are saved together with the profile's four required fields, so they wait for them.
  const incomplete = !row || [row.registrationNumber, row.abn, row.organisationName, row.address].some(v => !v?.trim())

  function save(extra: Partial<UpsertProviderSettingsDto> = {}) {
    if (!form) return
    const body: Partial<ProviderSettingsDto> = { ...row }
    delete body.participantReadinessMode
    delete body.medicationCompetencyMode
    delete body.employmentHeroConnected   // computed by the server on GET; never written
    delete body.updatedAt   // the version goes back as expectedUpdatedAt
    delete body.nextInvoiceDisplayNumber   // likewise (Xero PR1)
    delete body.invoicesIssued
    // The numbering fields go only when this section changed them (below): a stale cached copy must not put back what another Admin set.
    delete body.invoiceNumberPrefix
    delete body.creditNotePrefix
    delete body.invoiceStartNumber
    delete body.paymentTermsDays
    for (const k of changed) Object.assign(body, { [k]: form[k] })
    setResult(null)
    setRefusedAt(null)
    const sentVersion = row?.updatedAt
    upsert.mutate({ ...body, ...extra, expectedUpdatedAt: row?.updatedAt } as UpsertProviderSettingsDto, {
      onSuccess: () => { setBase(form); setMoved([]); setResult('saved') },
      onError: e => {
        // Only the server's lost-update 409 reseeds the form. Another refusal can mean the row moved on (an invoice issued since it loaded fixes the starting number): read it again.
        const lostUpdate = apiErrorStatus(e) === 409 && (apiErrorCode(e) === CHANGED_BY_OTHER_CODE || apiErrorMessages(e).includes(SERVER_CHANGED_BY_OTHER))
        if (lostUpdate) setRefusedAt(sentVersion ?? null)
        else void query.refetch()
        setResult({ error: lostUpdate ? CHANGED_BY_OTHER : notSavedText(e, REQUIRED_FIELDS) })
      },
    })
  }

  const edit = (patch: Partial<F>) => {
    setForm(f => (f ? { ...f, ...patch } : f))
    setMoved(m => m.filter(k => !(k in patch)))
  }
  /** A field's hint: its own, led by "Changed by someone else." while the other Admin's value is the one shown (or sits under the person's edit). */
  const hint = (key: keyof F, own?: string) => [moved.includes(key) && 'Changed by someone else.', own].filter(Boolean).join(' ') || undefined
  return { query, row, form, base, edit, hint, dirty: changed.length > 0, incomplete, save, pending: upsert.isPending, result }
}
