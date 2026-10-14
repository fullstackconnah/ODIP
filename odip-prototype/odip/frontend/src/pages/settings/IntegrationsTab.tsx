import { useId, useState } from 'react'
import {
  useConnectEmploymentHero, useDisconnectEmploymentHero, useDismissEmploymentHeroItem, useEmploymentHeroBusinesses,
  useEmploymentHeroEmployees, useEmploymentHeroStatus, useLinkEmploymentHeroStaff, useSyncEmploymentHero,
} from '@/api/hooks'
import type { EmploymentHeroAttentionDto, EmploymentHeroAttentionKind, EmploymentHeroBusinessDto, EmploymentHeroStatusDto } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FactList } from '@/components/FactList'
import { FormField } from '@/components/FormField'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
import { SelectField } from '@/components/SelectField'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateTimeAu, formatRelative, plural } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { extractErrorMessage, parseApiDate } from '@/lib/utils'

const MUTED = 'text-sm text-[var(--color-muted-foreground)]'
/** The pickers and the key field take a name's width, not the card's (formGrid's "medium"). */
const FIELD_WIDTH = 'w-full max-w-[24rem]'
/** Above this many items the Needs-attention list gets a name filter (owner, 2026-10-14). */
const FILTER_FROM = 11

/** Settings → Integrations: the Employment Hero card. The API key is pasted once and never shown again; staff then come from EH every 30 minutes. */
export default function IntegrationsTab() {
  const status = useEmploymentHeroStatus()
  if (status.isLoading) return <PageState kind="loading" noun="integrations" />
  if (status.isError || !status.data) return <PageState kind="error" noun="integrations" onRetry={() => status.refetch()} />
  const eh = status.data
  const badge: { label: string; tone: Tone } = eh.connected
    ? eh.lastSyncError ? { label: 'Last sync failed', tone: 'danger' } : { label: 'Connected', tone: 'success' }
    : eh.configured ? { label: 'Not connected', tone: 'neutral' } : { label: 'Not set up', tone: 'neutral' }
  return (
    <section aria-labelledby="eh-heading" className="flex max-w-[56rem] flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="eh-heading" className="text-sm font-semibold">Employment Hero</h2>
          <StatusBadge tone={badge.tone} label={badge.label} />
        </div>
        <p className={MUTED}>Staff come from Employment Hero Payroll, the master list. ODIP checks it for changes every 30 minutes.</p>
      </div>
      {!eh.configured && (
        <Callout tone="info" title="Integrations aren't set up on this server yet.">
          Ask whoever runs your ODIP server to set INTEGRATIONS_MASTER_KEY. The rest of ODIP works as usual.
        </Callout>
      )}
      {eh.connected ? <Connected eh={eh} /> : eh.configured && <ConnectForm />}
    </section>
  )
}

function ConnectForm() {
  const businesses = useEmploymentHeroBusinesses()
  const connect = useConnectEmploymentHero()
  const hintId = useId()
  const [apiKey, setApiKey] = useState('')
  const [found, setFound] = useState<EmploymentHeroBusinessDto[] | null>(null)
  const [businessId, setBusinessId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const findBusinesses = async () => {
    setError(null)
    try {
      const list = await businesses.mutateAsync(apiKey.trim())
      setFound(list)
      setBusinessId(list.length === 1 ? list[0].id : '')
    } catch (e) {
      setError(extractErrorMessage(e, "Employment Hero couldn't be checked. Try again."))
    }
  }
  const save = async () => {
    setError(null)
    try {
      await connect.mutateAsync({ apiKey: apiKey.trim(), businessId })
      setApiKey('')
    } catch (e) {
      setError(extractErrorMessage(e, "Employment Hero couldn't be connected. Try again."))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {/* From sm the button sits beside the field with the hint under both; on a phone the hint stays with its field and the button drops below. */}
        <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
          <FormField label="API key" descriptionId={hintId} className="min-w-0 flex-[1_1_16rem] max-w-[24rem]">
            {/* new-password: a password manager must not offer to save the EH key as a sign-in. */}
            <input type="password" autoComplete="new-password" value={apiKey} onChange={e => { setApiKey(e.target.value); setFound(null) }} />
          </FormField>
          <p id={hintId} className="basis-full text-xs text-[var(--color-muted-foreground)] sm:order-last">From Employment Hero Payroll. ODIP stores it encrypted and never shows it again.</p>
          {found === null && (
            <Button variant="secondary" className="order-last mt-1 sm:order-none sm:mt-0" onClick={findBusinesses} disabled={!apiKey.trim() || businesses.isPending}>
              {businesses.isPending ? 'Finding…' : 'Find businesses'}
            </Button>
          )}
        </div>
      </div>
      {found !== null && (found.length === 0 ? (
        <p className={MUTED}>This API key can't see any business in Employment Hero.</p>
      ) : (
        <>
          <SelectField label="Business" className={FIELD_WIDTH} value={businessId} onChange={e => setBusinessId(e.target.value)} placeholder="Choose the business"
            options={found.map(b => ({ value: b.id, label: b.name }))} />
          <p className={MUTED}>
            When you connect, ODIP links your staff to Employment Hero by email and adds anyone missing as a support worker (no invite is sent).
            From then on staff come from Employment Hero: New staff member and the staff import are turned off.
          </p>
          <div><Button onClick={save} disabled={!businessId || connect.isPending}>{connect.isPending ? 'Connecting…' : 'Connect'}</Button></div>
        </>
      ))}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  )
}

function Connected({ eh }: { eh: EmploymentHeroStatusDto }) {
  const sync = useSyncEmploymentHero()
  const disconnect = useDisconnectEmploymentHero()
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <FactList items={[
        { label: 'Business', value: eh.businessName },
        { label: 'Connected', value: `${formatDateTimeAu(eh.connectedAt)} by ${eh.connectedByName}` },
        {
          label: 'Last sync',
          value: eh.lastSyncAt
            ? <>{formatDateTimeAu(eh.lastSyncAt)} <span className="text-[var(--color-muted-foreground)]">· {formatRelative(parseApiDate(eh.lastSyncAt), { style: 'long' })}</span></>
            : 'Not yet. The first sync runs within 30 minutes, or press Sync now.',
        },
        { label: 'Staff', value: `${plural(eh.staffLinked, 'staff member')} linked, ${eh.staffNotLinked} not linked` },
      ]} />
      {/* Failures sit under the facts and above the buttons, never at the bottom of the card. */}
      {eh.lastSyncError && (
        <Callout tone="danger" title="The last sync didn't work.">
          <p>{eh.lastSyncError}</p>
          <p>Nobody's details changed. ODIP tries again every 30 minutes.</p>
        </Callout>
      )}
      {sync.error != null && <Callout tone="danger">{extractErrorMessage(sync.error, "The sync couldn't start. Try again.")}</Callout>}
      {disconnect.error != null && <Callout tone="danger">{extractErrorMessage(disconnect.error, "Employment Hero couldn't be disconnected. Try again.")}</Callout>}
      {/* One line each on a phone, so the destructive action never sits beside the routine one. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? 'Syncing…' : 'Sync now'}</Button>
        {/* Apart from Sync now, so the destructive action never sits beside the routine one. */}
        <Button variant="secondary" className="sm:ml-auto" onClick={() => setConfirming(true)}>Disconnect</Button>
      </div>
      <AnnouncementRegion message={sync.isSuccess ? 'Sync finished.' : ''} />
      {(eh.lastSyncAt || eh.attention.length > 0) && <Attention items={eh.attention} />}
      <ConfirmDialog
        open={confirming}
        title="Disconnect Employment Hero?"
        message="Syncing stops and the saved API key is deleted. Staff keep their links, so connecting the same business again links them back. New staff member and the staff import come back."
        confirmLabel="Disconnect"
        variant="danger"
        loading={disconnect.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
    </div>
  )
}

/** The groups, in the server's order: what the Admin does about each kind. */
const GROUPS: { kind: EmploymentHeroAttentionKind; title: string; intro: string }[] = [
  { kind: 'NotLinked', title: 'Not linked', intro: 'In ODIP but not matched to anyone in Employment Hero. Link them, or leave them unlinked.' },
  { kind: 'FixInEmploymentHero', title: 'Fix in Employment Hero', intro: "ODIP can't take these people as they are. Fix them in Employment Hero; each clears at the next sync." },
  { kind: 'FixInOdip', title: 'Fix in ODIP', intro: "Only an Admin can make these changes, on the person's staff page." },
  { kind: 'MissingFromEmploymentHero', title: 'No longer in Employment Hero', intro: "Linked, but missing from Employment Hero's employee list. ODIP never archives anyone for this; dismiss once you've checked." },
]

function Attention({ items }: { items: EmploymentHeroAttentionDto[] }) {
  const dismiss = useDismissEmploymentHeroItem()
  const [linking, setLinking] = useState<EmploymentHeroAttentionDto | null>(null)
  const [leaving, setLeaving] = useState<EmploymentHeroAttentionDto | null>(null)
  const [query, setQuery] = useState('')
  const shown = query.trim() ? items.filter(i => i.name.toLowerCase().includes(query.trim().toLowerCase())) : items
  const failedName = dismiss.error != null ? items.find(i => i.id === dismiss.variables)?.name : undefined
  // Leaving someone unlinked who has a same-name EH employee makes the next sync add that employee as new staff, so it asks first.
  const leaveUnlinked = (item: EmploymentHeroAttentionDto) => item.employeeId ? setLeaving(item) : dismiss.mutate(item.id)

  return (
    <section aria-labelledby="eh-attention" className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-[var(--section-gap)]">
      <h3 id="eh-attention" className="text-sm font-semibold">{`Needs attention (${items.length})`}</h3>
      {items.length === 0 && (
        <p className={`${MUTED} rounded-[var(--radius-md)] border border-[var(--color-border)] py-5 text-center`}>Nothing needs attention.</p>
      )}
      {/* Top of the list, not the bottom: with 200 rows the bottom is off screen. */}
      {dismiss.error != null && (
        <Callout tone="danger">{`${failedName ? `${failedName}: ` : ''}${extractErrorMessage(dismiss.error, "That couldn't be saved. Try again.")}`}</Callout>
      )}
      {items.length >= FILTER_FROM && <SearchInput value={query} onChange={setQuery} label="Find a person" placeholder="Find a person" />}
      {query.trim() && shown.length === 0 && (
        <p className={`${MUTED} rounded-[var(--radius-md)] border border-[var(--color-border)] py-5 text-center`}>{`No one matches "${query.trim()}".`}</p>
      )}
      {GROUPS.map(group => {
        const rows = shown.filter(i => i.kind === group.kind)
        if (rows.length === 0) return null
        return (
          <section key={group.kind} aria-labelledby={`eh-group-${group.kind}`} className="flex flex-col gap-1">
            <h4 id={`eh-group-${group.kind}`} className="text-sm font-semibold">{`${group.title} (${rows.length})`}</h4>
            <p className={MUTED}>{group.intro}</p>
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {rows.map(item => {
                const busy = dismiss.isPending && dismiss.variables === item.id
                return (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div className="min-w-0 flex-[1_1_20rem]">
                      <p className="text-sm font-medium break-words">{item.name}</p>
                      <p className={`${MUTED} break-words`}>{item.reason}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.kind === 'NotLinked' && (
                        <>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setLinking(item)} aria-label={`Link to an Employment Hero employee: ${item.name}`}>Link to employee…</Button>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => leaveUnlinked(item)} aria-label={`Leave unlinked: ${item.name}`}>Leave unlinked</Button>
                        </>
                      )}
                      {item.kind === 'MissingFromEmploymentHero' && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => dismiss.mutate(item.id)} aria-label={`Dismiss: ${item.name}`}>Dismiss</Button>
                      )}
                      {item.kind === 'FixInOdip' && item.userId && (
                        <Button size="sm" variant="secondary" to={`/staff/${item.userId}/edit`} aria-label={`Open staff page: ${item.name}`}>Open staff page</Button>
                      )}
                      {item.kind === 'FixInEmploymentHero' && <span className={MUTED}>Fix it in Employment Hero; it clears at the next sync.</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {linking && <LinkPicker item={linking} onClose={() => setLinking(null)} />}
      <ConfirmDialog
        open={leaving !== null}
        title={leaving ? `Leave ${leaving.name} unlinked?` : ''}
        message={leaving ? `${leaving.name} in Employment Hero will be added as a new staff member at the next sync.` : ''}
        confirmLabel="Leave unlinked"
        onCancel={() => setLeaving(null)}
        onConfirm={() => {
          if (leaving) dismiss.mutate(leaving.id)
          setLeaving(null)
        }}
      />
    </section>
  )
}

/** The picker for one waiting person: EH employees nobody here is linked to, with the same-name suggestion chosen first. */
function LinkPicker({ item, onClose }: { item: EmploymentHeroAttentionDto; onClose: () => void }) {
  const employees = useEmploymentHeroEmployees(true)
  const link = useLinkEmploymentHeroStaff()
  const [employeeId, setEmployeeId] = useState(item.employeeId ?? '')
  const list = employees.data ?? []
  return (
    <Modal open onClose={onClose} title={`Link ${item.name}`} size="sm" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => link.mutate({ itemId: item.id, employeeId }, { onSuccess: onClose })} disabled={!employeeId || link.isPending}>
          {link.isPending ? 'Linking…' : 'Link'}
        </Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <p className={MUTED}>{`Choose ${item.name}'s record in Employment Hero. From the next sync, Employment Hero keeps their details up to date.`}</p>
        {employees.isLoading ? <p role="status" className={MUTED}>Reading Employment Hero's employees…</p>
          : employees.isError ? <Callout tone="danger">{extractErrorMessage(employees.error, "Employment Hero's employees couldn't be read. Try again.")}</Callout>
          : list.length === 0 ? <p className={MUTED}>Everyone in Employment Hero is already linked to someone in ODIP.</p>
          : (
            // A native select on purpose: a phone opens its own picker, and a desktop type-ahead searches 200 names.
            <SelectField label="Employment Hero employee" value={employeeId} onChange={e => setEmployeeId(e.target.value)} placeholder="Choose an employee"
              options={list.map(e => ({
                value: e.id,
                // Added by sync: Link moves the id from that never-signed-in duplicate and archives it (EmploymentHeroController.Link).
                label: `${e.email ? `${e.name} (${e.email})` : e.name}${e.id === item.employeeId ? ' · same name' : ''}${e.addedBySync ? ' (added by sync, never signed in)' : ''}`,
              }))} />
          )}
        {link.error != null && <Callout tone="danger">{extractErrorMessage(link.error, "The link couldn't be saved. Try again.")}</Callout>}
      </div>
    </Modal>
  )
}
