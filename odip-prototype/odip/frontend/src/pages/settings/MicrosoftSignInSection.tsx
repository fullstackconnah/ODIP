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
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { notSavedText } from './settingsSections'

const ROLE_OPTIONS = [
  { value: 'ReadOnly', label: 'Read only' },
  { value: 'SupportWorker', label: 'Support Worker' },
  { value: 'Coordinator', label: 'Coordinator' },
]
const ROLE_HINT = "Someone who signs in with Microsoft for the first time gets a Bunya Support account with this role. You're emailed when that happens, and you can change their role in Staff."

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
    // Written a tick after mount: AnnouncementRegion must already be on the page for a screen reader to announce its text.
    const tick = setTimeout(() => setAnnounced(outcome === 'linked' ? 'Microsoft sign-in is on.' : describeMicrosoftOutcome(outcome, 'organisation').sentence), 0)
    setParams(p => { p.delete('microsoft'); return p }, { replace: true })
    return () => clearTimeout(tick)
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
      className="w-full max-w-prose sm:[&_select]:w-64"
      onChange={e => { setRoleDraft(e.target.value as MicrosoftRole); setSaved(false) }}
    />
  )

  const save = () => {
    if (!linked) return
    setSaved(false)
    saveRole.mutate({ defaultRole: role, expectedUpdatedAt: linked.updatedAt }, {
      onSuccess: () => { setSaved(true); setAnnounced('Role saved.') },
      // Someone else changed the link: read it again, so the next Save carries its updatedAt instead of the stale one.
      onError: e => { if (apiErrorStatus(e) === 409) link.refetch() },
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
              { label: 'Linked', value: linked.linkedByName ? `${formatDateTimeAu(linked.linkedAt)} by ${linked.linkedByName}` : formatDateTimeAu(linked.linkedAt) },
            ]}
          />
          <p className="max-w-prose text-sm text-[var(--color-muted-foreground)]">Only accounts from this directory can sign in with Microsoft. To use a different directory, turn this off and link again.</p>
          {roleField}
          {saveRole.isError && <Callout tone="danger">{notSavedText(saveRole.error)}</Callout>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button variant="secondary" className="w-full sm:w-auto" onClick={save} disabled={role === linked.defaultRole || saveRole.isPending}>Save role</Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)]"><Check aria-hidden className="size-4" />Saved</span>
            )}
            <Button variant="secondary" className="w-full sm:ml-auto sm:w-auto" onClick={() => setConfirming(true)}>Turn off Microsoft sign-in</Button>
          </div>
        </>
      ) : (
        <>
          <p className="max-w-prose text-sm">
            Link your organisation's Microsoft directory so your team can sign in with their Microsoft work accounts. Passwords keep working.
          </p>
          {roleField}
          <p className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">Microsoft will ask you to sign in as an administrator of your directory: a Global, Privileged Role, Application or Cloud Application Administrator.</p>
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
            <p>No one can sign in with Microsoft until you link again. Everyone keeps their Bunya Support account and role, and passwords keep working.</p>
            <p>People who joined through Microsoft have no password, so they can't sign in until it's back on.</p>
            {microsoftSession && <p>You signed in with Microsoft, so you'll be signed out within 30 minutes.</p>}
            {turnOff.isError && <Callout tone="danger">Microsoft sign-in couldn't be turned off. Try again.</Callout>}
          </div>
        }
      />
    </div>
  )
}
