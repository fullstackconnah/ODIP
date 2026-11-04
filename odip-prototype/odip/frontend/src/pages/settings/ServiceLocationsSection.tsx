import { useRef, useState } from 'react'
import { Lock, MapPin, Plus } from 'lucide-react'
import { useArchiveServiceLocation, useCreateServiceLocation, useProviderSettings, useServiceLocations, useUpdateServiceLocation } from '@/api/hooks'
import type { SaveServiceLocationDto, ServiceLocationDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable } from '@/components/DataTable'
import { FormField } from '@/components/FormField'
import { SelectField } from '@/components/SelectField'
import { SlideOver } from '@/components/SlideOver'
import { TAP_AREA } from '@/components/tapArea'
import { formatMapPin, parseMapPin } from '@/lib/mapPin'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { extractErrorMessage } from '@/lib/utils'
import { ZONES } from './timeZones'

/** The form's boxes as typed. `timeZoneId` '' follows the organisation. */
type Form = { name: string; address: string; pin: string; radius: string; timeZoneId: string }
type FieldErrors = Partial<Record<'name' | 'pin' | 'radius', string>>
type Editing = { id?: string; initial: Form }

const NEW_PLACE: Form = { name: '', address: '', pin: '', radius: '200', timeZoneId: '' }
const CELL = 'md:py-2'   // the sibling tables' cell padding
const HALF = 'max-md:flex-1 max-md:min-w-0'   // two equal columns under the card's full-width name
const zoneLabel =(id: string | null) => ZONES.find(z => z.value === id)?.label ?? id

const formOf = (p: ServiceLocationDto): Form => ({
  name: p.name, address: p.address ?? '', pin: formatMapPin(p.latitude, p.longitude), radius: String(p.radiusMetres), timeZoneId: p.timeZoneId ?? '',
})

/** The Use-my-location button needs a secure page: the live site is plain HTTP, so there it says why and leaves the box to type in. */
function locationHelp(): string | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return 'Your browser only shares location over a secure connection. Type the pin instead.'
  if (!('geolocation' in navigator)) return "Your browser can't share its location. Type the pin instead."
  return null
}

/**
 * Settings > Service locations: the places a team works (a day centre, a hub), each with a map pin, a check-in distance and, for a place in another
 * state, its own time zone. A shift points at one. Admin, Coordinator and SuperAdmin write it (the server's roles); everyone else reads. A place is
 * archived, never deleted, so a shift keeps its place's name. This PR only saves the pin and the distance: nothing checks a worker against them yet.
 */
export default function ServiceLocationsSection() {
  const pageQuery = useServiceLocations()
  const { data: places = [], isLoading, isError, refetch } = pageQuery
  const { isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const canEdit = isSuperAdmin || isAdmin || isCoordinator
  // The provider row is readable by the same three roles; it only names the organisation's zone in the first option.
  const provider = useProviderSettings(canEdit).data
  const create = useCreateServiceLocation()
  const update = useUpdateServiceLocation()
  const archive = useArchiveServiceLocation()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [form, setForm] = useState<Form>(NEW_PLACE)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState<string>()
  const [pageError, setPageError] = useState<string>()
  const [locating, setLocating] = useState<'idle' | 'busy' | 'done' | 'refused'>('idle')
  const [accuracy, setAccuracy] = useState<number>()
  const [archiving, setArchiving] = useState<ServiceLocationDto | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const busy = create.isPending || update.isPending
  const help = locationHelp()

  const active = places.filter(p => p.isActive)
  const archived = places.filter(p => !p.isActive)
  const dirty = editing !== null && JSON.stringify(form) !== JSON.stringify(editing.initial)
  const orgZone = zoneLabel(provider?.timeZoneId ?? null)

  const open = (next: Editing) => {
    setEditing(next); setForm(next.initial); setFieldErrors({}); setSaveError(undefined); setLocating('idle'); setAccuracy(undefined); setPageError(undefined)
  }
  const close = () => { setEditing(null); addRef.current?.focus() }
  const edit = (patch: Partial<Form>) => { setForm(cur => ({ ...cur, ...patch })); setSaveError(undefined) }

  function locateMe() {
    setLocating('busy')
    navigator.geolocation.getCurrentPosition(
      pos => {
        edit({ pin: formatMapPin(pos.coords.latitude, pos.coords.longitude) })
        setFieldErrors(cur => ({ ...cur, pin: undefined }))
        setAccuracy(pos.coords.accuracy)
        setLocating('done')
      },
      () => setLocating('refused'),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  async function save() {
    if (!editing) return
    const errors: FieldErrors = {}
    const name = form.name.trim()
    if (!name) errors.name = 'Enter a name.'
    const pin = parseMapPin(form.pin)
    if ('error' in pin) errors.pin = pin.error
    const radius = Number(form.radius)
    if (!form.radius.trim() || !Number.isInteger(radius) || radius < 50 || radius > 2000) errors.radius = 'Use a check-in distance from 50 to 2000 metres.'
    setFieldErrors(errors)
    if (errors.name || errors.pin || errors.radius || 'error' in pin) return
    const data: SaveServiceLocationDto = {
      name, address: form.address.trim() || null, latitude: pin.pin.latitude, longitude: pin.pin.longitude, radiusMetres: radius, timeZoneId: form.timeZoneId || null,
    }
    setSaveError(undefined)
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, data })
      else await create.mutateAsync(data)
      close()
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Could not save the place. Try again.'))
    }
  }

  async function confirmArchive() {
    if (!archiving) return
    setPageError(undefined)
    try {
      await archive.mutateAsync(archiving.id)
    } catch (err) {
      setPageError(extractErrorMessage(err, 'Could not archive the place. Try again.'))
    }
    setArchiving(null)
  }

  const columns = (archivedRows: boolean) => [
    {
      // The address wraps inside the Name cell (wrap + a share of the width), so the other columns and the actions stay in view with no table scroll; on a phone every card is Name, then two columns.
      key: 'name', header: 'Name', className: `font-medium break-words ${CELL} max-md:basis-full`, wrap: true, width: '40%',
      render: (p: ServiceLocationDto) => (
        <div className="min-w-0">
          <span className={archivedRows ? 'text-[var(--color-muted-foreground)]' : undefined}>{p.name}</span>
          {p.address && <p className="text-sm font-normal text-[var(--color-muted-foreground)] break-words">{p.address}</p>}
        </div>
      ),
    },
    { key: 'zone', header: 'Time zone', className: `${CELL} ${HALF}`, render: (p: ServiceLocationDto) => p.timeZoneId ? zoneLabel(p.timeZoneId) : 'Same as your organisation' },
    { key: 'radius', header: 'Check-in distance', className: `${CELL} ${HALF}`, render: (p: ServiceLocationDto) => `${p.radiusMetres} m` },
    ...(canEdit && !archivedRows ? [{
      key: 'actions', header: 'Actions', className: CELL,
      render: (p: ServiceLocationDto) => (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className={TAP_AREA} onClick={() => open({ id: p.id, initial: formOf(p) })} aria-label={`Edit: ${p.name}`}>Edit</Button>
          <Button variant="ghost" size="sm" className={TAP_AREA} disabled={archive.isPending} onClick={() => setArchiving(p)} aria-label={`Archive: ${p.name}`}>Archive</Button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      {!canEdit && (
        <Callout tone="info" icon={Lock} announce={false} className="max-w-prose">Only Admins and Coordinators can change this list.</Callout>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">Archived places stay on the shifts that have them, but can&apos;t be picked for new ones.</p>
        {canEdit && <Button ref={addRef} size="md" onClick={() => open({ initial: NEW_PLACE })}><Plus className="w-4 h-4" /> Add a place</Button>}
      </div>
      {pageError && <Callout tone="error">{pageError}</Callout>}
      <DataTable
        data={active}
        keyField="id"
        loading={isLoading}
        error={isError || retryingAfterError(pageQuery)}
        onRetry={() => refetch()}
        emptyMessage="No service locations yet. Add the places your team works so shifts can point at them."
        columns={columns(false)}
      />
      {archived.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)]">Archived</h3>
          <DataTable data={archived} keyField="id" columns={columns(true)} />
        </section>
      )}

      <SlideOver
        open={editing !== null}
        onClose={close}
        dirty={dirty}
        title={editing?.id ? 'Edit service location' : 'Add a service location'}
        description="A shift can point at this place. Its pin and check-in distance are saved now; checking a worker against them comes later."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" className={TAP_AREA} onClick={close}>Cancel</Button>
            <Button className={TAP_AREA} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        }
      >
        <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
          {saveError && <Callout tone="error">{saveError}</Callout>}
          <FormField label="Name" required error={fieldErrors.name}>
            <input type="text" value={form.name} maxLength={100} autoComplete="off" placeholder="e.g. Southside day centre" onChange={e => edit({ name: e.target.value })} />
          </FormField>
          <FormField label="Address" hint="Shown to the support worker on their shift.">
            <input type="text" value={form.address} maxLength={300} autoComplete="off" onChange={e => edit({ address: e.target.value })} />
          </FormField>
          <div className="space-y-2">
            <FormField label="Map pin" required error={fieldErrors.pin} hint="Latitude, longitude. Stand at the place and use your location, or copy it from a map." keepHint>
              <input type="text" inputMode="decimal" value={form.pin} autoComplete="off" placeholder="-33.8688, 151.2093" onChange={e => { edit({ pin: e.target.value }); setLocating('idle'); setAccuracy(undefined) }} />
            </FormField>
            <Button variant="secondary" size="sm" className={TAP_AREA} disabled={help !== null || locating === 'busy'} onClick={locateMe}>
              <MapPin className="w-4 h-4" aria-hidden /> {locating === 'busy' ? 'Finding you…' : 'Use my current location'}
            </Button>
            <p role="status" className="text-sm text-[var(--color-muted-foreground)]">
              {help ?? (locating === 'done' && accuracy !== undefined ? `Accuracy about ${Math.round(accuracy)} m` : locating === 'refused' ? 'Could not get your location. Type the pin instead.' : '')}
            </p>
          </div>
          <FormField label="Check-in distance (metres)" required error={fieldErrors.radius} hint="How far from the pin a worker can start and still count as at the location.">
            <input type="number" inputMode="numeric" min={50} max={2000} step={1} value={form.radius} onChange={e => edit({ radius: e.target.value })} />
          </FormField>
          <SelectField
            label="Time zone"
            hint="Change this only for a place in another state. Shifts here that haven't started will use the new zone; started shifts keep theirs."
            options={[{ value: '', label: orgZone ? `Same as your organisation (${orgZone})` : 'Same as your organisation' }, ...ZONES]}
            value={form.timeZoneId}
            onChange={e => edit({ timeZoneId: e.target.value })}
          />
        </form>
      </SlideOver>

      <ConfirmDialog
        open={archiving !== null}
        title="Archive this place?"
        message={archiving ? `Archive ${archiving.name}? Shifts already at this place keep it. You can't pick it for new shifts.` : ''}
        confirmLabel="Archive"
        variant="danger"
        loading={archive.isPending}
        onConfirm={confirmArchive}
        onCancel={() => setArchiving(null)}
      />
    </div>
  )
}
