import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useAuthConfig, useMicrosoftLink, useSaveMicrosoftRole, useTurnOffMicrosoft } from '@/api/hooks'
import type { MicrosoftRole } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FactList } from '@/components/FactList'
import { PageState } from '@/components/PageState'
import { SelectField } from '@/components/SelectField'
import { formatDateTimeAu } from '@/lib/format'
import { describeMicrosoftOutcome } from '@/lib/signInRefusal'
import { MicrosoftLinkAction } from './MicrosoftLinkAction'
import { notSavedText } from './settingsSections'

const ROLE_OPTIONS = [
  { value: 'ReadOnly', label: 'Read only' },
  { value: 'SupportWorker', label: 'Support Worker' },
  { value: 'Coordinator', label: 'Coordinator' },
]
const ROLE_HINT = "The role someone gets the first time they sign in with Microsoft. You can change anyone's role later in Staff."

/** Settings > Microsoft sign-in (Admin): link the organisation's Microsoft directory, choose the role new people get, or turn it off. */
export default function MicrosoftSignInSection() {
  const config = useAuthConfig()
  const link = useMicrosoftLink()
  const saveRole = useSaveMicrosoftRole()
  const turnOff = useTurnOffMicrosoft()
  const [params, setParams] = useSearchParams()
  const [outcome] = useState(() => params.get('microsoft'))
  const [announced, setAnnounced] = useState('')
  const [roleDraft, setRoleDraft] = useState<MicrosoftRole | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [focusHeading, setFocusHeading] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const heading = () => root.current?.closest('section')?.querySelector('h2') ?? null

  const ready = !link.isPending && !config.isPending
  // Back from Microsoft: say how it went, put focus on the page and drop the code from the address. Once the page is drawn, so the heading can be found.
  useEffect(() => {
    if (outcome === null || !ready) return
    heading()?.focus()
    setAnnounced(outcome === 'linked' ? 'Microsoft sign-in is on.' : describeMicrosoftOutcome(outcome, 'organisation').sentence)
    setParams(p => { p.delete('microsoft'); return p }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => {
    if (focusHeading) heading()?.focus()
  }, [focusHeading])

  if (link.isPending || config.isPending) return <PageState kind="loading" noun="Microsoft sign-in" />
  if (link.isError && link.data === undefined) return <PageState kind="error" noun="Microsoft sign-in" onRetry={() => link.refetch()} />

  const linked = link.data ?? null
  const startUrl = config.data?.microsoftStartUrl ?? null
  const role = roleDraft ?? linked?.defaultRole ?? 'ReadOnly'
  const words = outcome && outcome !== 'linked' ? describeMicrosoftOutcome(outcome, 'organisation') : null
  const microsoftSession = localStorage.getItem('odip_sign_in_method') === 'microsoft'

  const roleField = (
    <SelectField
      label="New people join as"
      value={role}
      options={ROLE_OPTIONS}
      hint={ROLE_HINT}
      onChange={e => { setRoleDraft(e.target.value as MicrosoftRole); setSaved(false) }}
    />
  )

  const save = () => {
    if (!linked) return
    setSaved(false)
    saveRole.mutate({ defaultRole: role, expectedUpdatedAt: linked.updatedAt }, {
      onSuccess: () => { setSaved(true); setAnnounced('Role saved.') },
    })
  }

  const confirmTurnOff = () =>
    turnOff.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false)
        setRoleDraft(null)
        setAnnounced('Microsoft sign-in is off.')
        setFocusHeading(n => n + 1)
      },
    })

  return (
    <div ref={root} className="flex max-w-[56rem] flex-col gap-3">
      <AnnouncementRegion message={announced} />
      {outcome === 'linked' && <Callout tone="success" announce={false}>Microsoft sign-in is on. Your team can now use Sign in with Microsoft.</Callout>}
      {words && (
        <Callout tone={words.tone} announce={false}>
          {words.sentence}
          {words.nextStep ? ` ${words.nextStep}` : ''}
        </Callout>
      )}

      {linked ? (
        <>
          <FactList
            items={[
              { label: 'Microsoft directory ID', value: <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{linked.microsoftTenantId}</span> },
              { label: 'Linked', value: `${formatDateTimeAu(linked.linkedAt)} by ${linked.linkedByName}` },
            ]}
          />
          <p className="text-sm text-[var(--color-fg-muted)]">Your team can sign in with their Microsoft work accounts. People still keep any password they have.</p>
          {roleField}
          {saveRole.isError && <Callout tone="danger">{notSavedText(saveRole.error)}</Callout>}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={save} disabled={role === linked.defaultRole || saveRole.isPending}>Save role</Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-muted)]"><Check aria-hidden className="size-4" />Saved</span>
            )}
            <Button variant="secondary" className="sm:ml-auto" onClick={() => setConfirming(true)}>Turn off Microsoft sign-in</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Link your organisation's Microsoft directory so your team can sign in with their Microsoft work accounts. People who sign in for the first time join with the role you choose.
          </p>
          {roleField}
          <p className="text-sm text-[var(--color-fg-muted)]">You need to be an administrator of your Microsoft directory to link it.</p>
          {startUrl && (
            <MicrosoftLinkAction
              startUrl={startUrl}
              intent="link-tenant"
              defaultRole={role}
              label="Link Microsoft"
              variant="primary"
              preflight={() => link.refetch({ throwOnError: true })}
              returnPath="/settings?section=microsoft"
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        variant="danger"
        title="Turn off Microsoft sign-in?"
        confirmLabel="Turn off"
        loading={turnOff.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmTurnOff}
        message={
          <div className="flex flex-col gap-2">
            <p>People who joined through Microsoft have no password, so they can't sign in until it's back on.</p>
            {microsoftSession && <p>You signed in with Microsoft, so you'll be signed out within 30 minutes.</p>}
            {turnOff.isError && <Callout tone="danger">Microsoft sign-in couldn't be turned off. Try again.</Callout>}
          </div>
        }
      />
    </div>
  )
}
