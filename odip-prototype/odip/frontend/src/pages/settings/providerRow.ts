import { useState } from 'react'
import { useProviderSettings, useUpsertProviderSettings } from '@/api/hooks'
import type { ProviderSettingsDto, UpsertProviderSettingsDto } from '@/api/types'
import type { SaveResult } from './SettingsSection'
import { notSavedText } from './settingsSections'

/** The server's 400 for a blank required field names the field in an errors object, not a sentence, so the foot says this. */
const REQUIRED_FIELDS = 'Fill in the registration number, ABN, organisation name and address.'

/**
 * The one provider settings row behind Organisation profile, Billing details and Safety checks. Its PUT overwrites every text and flag
 * field from the body, so a section sends the row as the server last gave it with only the fields it changed replaced: an untouched null
 * stays null, and another section's fields go back exactly as they came. The query refetches when a section opens (the form seeds only
 * after that), a save writes what it sent into the cache, and the cache refetches after every save; so "as the server last gave it" is
 * that cache (another Admin saving in between can still be overwritten, as before). The two modes are never echoed: Safety checks adds
 * one through `extra` only when the person changed it.
 */
export function useProviderRow<F extends Record<string, string | boolean | number>>(pick: (row: ProviderSettingsDto | null) => F) {
  const query = useProviderSettings(true, 'always')
  const upsert = useUpsertProviderSettings()
  // No row reads as null (the mock API answers [] for a route it doesn't know).
  const row = query.data && !Array.isArray(query.data) ? query.data : null
  const [form, setForm] = useState<F | null>(null)
  const [base, setBase] = useState<F | null>(null)
  const [result, setResult] = useState<SaveResult>(null)
  if (form === null && query.isFetchedAfterMount && !query.isFetching && !query.isError) {
    const loaded = pick(row)
    setForm(loaded)
    setBase(loaded)
  }
  const changed = form && base ? (Object.keys(form) as (keyof F)[]).filter(k => form[k] !== base[k]) : []
  // Billing details and Safety checks are saved together with the profile's four required fields, so they wait for them.
  const incomplete = !row || [row.registrationNumber, row.abn, row.organisationName, row.address].some(v => !v?.trim())

  function save(extra: Partial<UpsertProviderSettingsDto> = {}) {
    if (!form) return
    const body: Partial<ProviderSettingsDto> = { ...row }
    delete body.participantReadinessMode
    delete body.medicationCompetencyMode
    delete body.employmentHeroConnected   // computed by the server on GET; never written
    delete body.nextInvoiceDisplayNumber   // likewise (Xero PR1)
    delete body.invoicesIssued
    for (const k of changed) Object.assign(body, { [k]: form[k] })
    setResult(null)
    upsert.mutate({ ...body, ...extra } as UpsertProviderSettingsDto, {
      onSuccess: () => { setBase(form); setResult('saved') },
      // A refusal can mean the row moved on (an invoice issued since it loaded fixes the starting number): read it again.
      onError: e => { setResult({ error: notSavedText(e, REQUIRED_FIELDS) }); void query.refetch() },
    })
  }

  const edit = (patch: Partial<F>) => setForm(f => (f ? { ...f, ...patch } : f))
  return { query, row, form, base, edit, dirty: changed.length > 0, incomplete, save, pending: upsert.isPending, result }
}
