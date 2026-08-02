# Event Template Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full CRUD (create, edit, deactivate) for event templates — via a slide-over panel in Settings and a "Save as Template" button on the trip detail screen.

**Architecture:** Single shared `TemplateFormPanel` component handles both create and edit via the same slide-over UI. The "Fill from trip" feature maps `TripListDto` fields to template fields client-side — no extra backend endpoint needed. Backend adds one `DELETE` endpoint that soft-deletes (sets `IsActive = false`).

**Tech Stack:** .NET 9 / ASP.NET Core / EF Core 8 (backend); React 19, TypeScript, TanStack Query v5, React Hook Form, Zod, Tailwind CSS v4 (frontend)

---

## File Map

| File | Change |
|------|--------|
| `backend/Odip.Api/Controllers/TasksDashboardController.cs` | Add `DELETE /api/v1/event-templates/{id}` |
| `frontend/src/api/hooks/activities.ts` | Add 3 mutation hooks + update imports |
| `frontend/src/components/TemplateFormPanel.tsx` | Create — shared slide-over component |
| `frontend/src/pages/SettingsPage.tsx` | Wire panel into event-templates tab |
| `frontend/src/pages/TripDetailPage.tsx` | Add "Save as Template" button + panel mount |

---

## Task 1: Backend — DELETE endpoint (soft delete)

**Files:**
- Modify: `backend/Odip.Api/Controllers/TasksDashboardController.cs`

- [ ] **Step 1: Add the DELETE action to `EventTemplatesController`**

  In `TasksDashboardController.cs`, find `EventTemplatesController`. The class ends after the `Update` method:

  ```csharp
  e.IsActive = dto.IsActive; e.UpdatedAt = DateTime.UtcNow;
  await _db.SaveChangesAsync(ct);
  return Ok(ApiResponse<EventTemplateDto>.Ok(new EventTemplateDto { Id = e.Id, EventName = e.EventName }));
  }
  }
  ```

  Insert the new action immediately before the final closing `}` of the class:

  ```csharp
      [HttpDelete("{id:guid}")]
      [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
      public async Task<ActionResult<ApiResponse<bool>>> Deactivate(Guid id, CancellationToken ct)
      {
          var e = await _db.EventTemplates.FirstOrDefaultAsync(x => x.Id == id, ct);
          if (e == null) return NotFound(ApiResponse<bool>.Fail("Template not found"));
          e.IsActive = false;
          e.UpdatedAt = DateTime.UtcNow;
          await _db.SaveChangesAsync(ct);
          return Ok(ApiResponse<bool>.Ok(true));
      }
  ```

- [ ] **Step 2: Build the backend**

  ```bash
  dotnet build backend/Odip.Api
  ```

  Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 3: Start the API and verify the endpoint is visible**

  ```bash
  dotnet run --project backend/Odip.Api
  ```

  Open `http://localhost:5000/swagger` and confirm `DELETE /api/v1/event-templates/{id}` appears under the event-templates group.

- [ ] **Step 4: Manual smoke test**

  Replace `<GUID>` with a real template ID from `GET /api/v1/event-templates`, and `<JWT>` with a valid token:

  ```bash
  # Deactivate a template
  curl -X DELETE "http://localhost:5000/api/v1/event-templates/<GUID>" \
    -H "Authorization: Bearer <JWT>"
  ```

  Expected: `200 OK` — `{"success":true,"data":true}`

  ```bash
  # Confirm it's still in the list but inactive
  curl "http://localhost:5000/api/v1/event-templates" \
    -H "Authorization: Bearer <JWT>"
  ```

  Expected: template still present with `"isActive": false`.

  ```bash
  # Confirm 404 on unknown ID
  curl -X DELETE "http://localhost:5000/api/v1/event-templates/00000000-0000-0000-0000-000000000000" \
    -H "Authorization: Bearer <JWT>"
  ```

  Expected: `404 Not Found` — `{"success":false,"errors":["Template not found"]}`

- [ ] **Step 5: Commit**

  ```bash
  git add backend/Odip.Api/Controllers/TasksDashboardController.cs
  git commit -m "feat: add DELETE /api/v1/event-templates/{id} soft-delete endpoint"
  ```

---

## Task 2: Frontend — mutation hooks for event templates

**Files:**
- Modify: `frontend/src/api/hooks/activities.ts`

- [ ] **Step 1: Update the import to include the create/update DTOs**

  In `frontend/src/api/hooks/activities.ts`, the current import block is:

  ```typescript
  import type {
    ActivityDto,
    EventTemplateDto,
    TripDayDto,
    CreateScheduledActivityDto,
    UpdateScheduledActivityDto,
    ScheduledActivityDto,
  } from '../types'
  ```

  Replace it with:

  ```typescript
  import type {
    ActivityDto,
    EventTemplateDto,
    CreateEventTemplateDto,
    UpdateEventTemplateDto,
    TripDayDto,
    CreateScheduledActivityDto,
    UpdateScheduledActivityDto,
    ScheduledActivityDto,
  } from '../types'
  ```

- [ ] **Step 2: Append the three new mutation hooks at the end of the file**

  ```typescript
  export function useCreateEventTemplate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (data: CreateEventTemplateDto) =>
        apiPostRaw<EventTemplateDto>('/event-templates', data),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['event-templates'] })
      },
    })
  }

  export function useUpdateEventTemplate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: ({ id, data }: { id: string; data: UpdateEventTemplateDto }) =>
        apiPutRaw<EventTemplateDto>(`/event-templates/${id}`, data),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['event-templates'] })
      },
    })
  }

  export function useDeactivateEventTemplate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (id: string) => apiDeleteRaw<boolean>(`/event-templates/${id}`),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['event-templates'] })
      },
    })
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/api/hooks/activities.ts
  git commit -m "feat: add useCreateEventTemplate, useUpdateEventTemplate, useDeactivateEventTemplate hooks"
  ```

---

## Task 3: `TemplateFormPanel` component

**Files:**
- Create: `frontend/src/components/TemplateFormPanel.tsx`

- [ ] **Step 1: Create the file**

  Create `frontend/src/components/TemplateFormPanel.tsx` with the full content below. Both the foundations (schema, types, mapping function) and the JSX are in one step because the file is new and must be complete to compile:

  ```tsx
  import { useState, useEffect } from 'react'
  import { useForm } from 'react-hook-form'
  import { zodResolver } from '@hookform/resolvers/zod'
  import { z } from 'zod'
  import { X, ChevronDown, ChevronRight } from 'lucide-react'
  import {
    useCreateEventTemplate,
    useUpdateEventTemplate,
    useDeactivateEventTemplate,
    useTrips,
  } from '@/api/hooks'
  import type { EventTemplateDto, TripListDto } from '@/api/types'

  // ---------------------------------------------------------------------------
  // Schema & types
  // ---------------------------------------------------------------------------

  const schema = z.object({
    eventName: z.string().min(1, 'Required'),
    eventCode: z.string().min(1, 'Required'),
    defaultDestination: z.string().optional(),
    defaultRegion: z.string().optional(),
    standardDurationDays: z.coerce.number().int().positive().optional().or(z.literal('')),
    preferredTimeOfYear: z.string().optional(),
    typicalActivities: z.string().optional(),
    accessibilityNotes: z.string().optional(),
    fullyModifiedAccommodationNotes: z.string().optional(),
    semiModifiedAccommodationNotes: z.string().optional(),
    wheelchairAccessNotes: z.string().optional(),
  })

  type FormValues = z.infer<typeof schema>

  // ---------------------------------------------------------------------------
  // Field mapping helper
  // ---------------------------------------------------------------------------

  function mapTripToTemplate(trip: TripListDto): Partial<FormValues> {
    return {
      eventName: trip.tripName,
      eventCode: trip.tripCode ?? '',
      defaultDestination: trip.destination ?? '',
      defaultRegion: trip.region ?? '',
      standardDurationDays: trip.durationDays,
    }
  }

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface TemplateFormPanelProps {
    isOpen: boolean
    onClose: () => void
    /** Present → edit mode. Absent → create mode. */
    template?: EventTemplateDto
    /** Pre-seeds the form fields (from "Save as Template" on trip screen). */
    initialTrip?: TripListDto
  }

  // ---------------------------------------------------------------------------
  // Component
  // ---------------------------------------------------------------------------

  export default function TemplateFormPanel({
    isOpen,
    onClose,
    template,
    initialTrip,
  }: TemplateFormPanelProps) {
    const isEdit = !!template
    const createMutation = useCreateEventTemplate()
    const updateMutation = useUpdateEventTemplate()
    const deactivateMutation = useDeactivateEventTemplate()
    const { data: trips = [] } = useTrips()

    const [selectedTripId, setSelectedTripId] = useState('')
    const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)
    const [accessibilityExpanded, setAccessibilityExpanded] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const {
      register,
      handleSubmit,
      reset,
      setValue,
      formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(schema) })

    // Populate form when panel opens
    useEffect(() => {
      if (!isOpen) return
      setError(null)
      setShowDeactivateConfirm(false)
      setAccessibilityExpanded(false)

      if (template) {
        reset({
          eventName: template.eventName,
          eventCode: template.eventCode,
          defaultDestination: template.defaultDestination ?? '',
          defaultRegion: template.defaultRegion ?? '',
          standardDurationDays: template.standardDurationDays ?? '',
          preferredTimeOfYear: template.preferredTimeOfYear ?? '',
          typicalActivities: template.typicalActivities ?? '',
          accessibilityNotes: template.accessibilityNotes ?? '',
          fullyModifiedAccommodationNotes: template.fullyModifiedAccommodationNotes ?? '',
          semiModifiedAccommodationNotes: template.semiModifiedAccommodationNotes ?? '',
          wheelchairAccessNotes: template.wheelchairAccessNotes ?? '',
        })
      } else if (initialTrip) {
        reset(mapTripToTemplate(initialTrip))
        setSelectedTripId(initialTrip.id)
      } else {
        reset({})
        setSelectedTripId('')
      }
    }, [isOpen, template, initialTrip, reset])

    function handleTripSelect(tripId: string) {
      setSelectedTripId(tripId)
      if (!tripId) return
      const trip = trips.find(t => t.id === tripId)
      if (!trip) return
      const mapped = mapTripToTemplate(trip)
      Object.entries(mapped).forEach(([key, val]) => {
        setValue(key as keyof FormValues, val as any, { shouldDirty: true })
      })
    }

    async function onSubmit(values: FormValues) {
      setError(null)
      const payload = {
        ...values,
        standardDurationDays:
          values.standardDurationDays === '' ? undefined : Number(values.standardDurationDays),
        isActive: true,
      }
      try {
        if (isEdit && template) {
          await updateMutation.mutateAsync({ id: template.id, data: payload as any })
        } else {
          await createMutation.mutateAsync(payload as any)
        }
        onClose()
      } catch (err: any) {
        setError(
          err?.response?.data?.errors?.[0] ||
            err?.response?.data?.message ||
            'Failed to save template.',
        )
      }
    }

    async function handleDeactivate() {
      if (!template) return
      setError(null)
      try {
        await deactivateMutation.mutateAsync(template.id)
        onClose()
      } catch (err: any) {
        setError(err?.response?.data?.errors?.[0] || 'Failed to deactivate template.')
      }
    }

    const inputClass =
      'w-full px-3 py-2 rounded-xl bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all'
    const labelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

    const isBusy =
      isSubmitting || createMutation.isPending || updateMutation.isPending

    if (!isOpen) return null

    return (
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

        {/* Panel */}
        <div className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--color-card)] border-l border-[var(--color-border)] z-50 flex flex-col shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
            <h2 className="font-semibold text-[var(--color-foreground)]">
              {isEdit ? 'Edit Template' : 'New Template'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
            >
              <X className="w-5 h-5 text-[var(--color-muted-foreground)]" />
            </button>
          </div>

          {/* Scrollable form body */}
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
          >
            {/* Fill from trip — create mode only */}
            {!isEdit && (
              <div>
                <label className={labelClass}>Fill from trip</label>
                <select
                  value={selectedTripId}
                  onChange={e => handleTripSelect(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— select a trip —</option>
                  {trips.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.tripName}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                  Fills name, code, destination, region, and duration from the selected trip.
                </p>
              </div>
            )}

            {/* Event Name */}
            <div>
              <label className={labelClass}>Event Name *</label>
              <input
                {...register('eventName')}
                className={inputClass}
                placeholder="e.g. Gold Coast Beach Break"
              />
              {errors.eventName && (
                <p className="text-xs text-red-500 mt-1">{errors.eventName.message}</p>
              )}
            </div>

            {/* Event Code */}
            <div>
              <label className={labelClass}>Event Code *</label>
              <input
                {...register('eventCode')}
                className={`${inputClass} font-mono uppercase`}
                placeholder="e.g. GOLD-01"
              />
              {errors.eventCode && (
                <p className="text-xs text-red-500 mt-1">{errors.eventCode.message}</p>
              )}
            </div>

            {/* Destination + Region */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Default Destination</label>
                <input
                  {...register('defaultDestination')}
                  className={inputClass}
                  placeholder="e.g. Gold Coast"
                />
              </div>
              <div>
                <label className={labelClass}>Default Region</label>
                <input
                  {...register('defaultRegion')}
                  className={inputClass}
                  placeholder="e.g. QLD"
                />
              </div>
            </div>

            {/* Duration + Preferred Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Duration (days)</label>
                <input
                  {...register('standardDurationDays')}
                  type="number"
                  min={1}
                  className={inputClass}
                  placeholder="e.g. 7"
                />
              </div>
              <div>
                <label className={labelClass}>Preferred Time of Year</label>
                <input
                  {...register('preferredTimeOfYear')}
                  className={inputClass}
                  placeholder="e.g. Winter"
                />
              </div>
            </div>

            {/* Typical Activities */}
            <div>
              <label className={labelClass}>Typical Activities</label>
              <textarea
                {...register('typicalActivities')}
                rows={3}
                className={inputClass}
                placeholder="Describe typical activities…"
              />
            </div>

            {/* Accessibility Notes */}
            <div>
              <label className={labelClass}>Accessibility Notes</label>
              <textarea
                {...register('accessibilityNotes')}
                rows={3}
                className={inputClass}
                placeholder="General accessibility notes…"
              />
            </div>

            {/* Collapsible accommodation notes */}
            <div>
              <button
                type="button"
                onClick={() => setAccessibilityExpanded(p => !p)}
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                {accessibilityExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                Accommodation Notes
              </button>

              {accessibilityExpanded && (
                <div className="mt-3 space-y-3 pl-5 border-l border-[var(--color-border)]">
                  <div>
                    <label className={labelClass}>Fully Modified Accommodation</label>
                    <textarea
                      {...register('fullyModifiedAccommodationNotes')}
                      rows={2}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Semi Modified Accommodation</label>
                    <textarea
                      {...register('semiModifiedAccommodationNotes')}
                      rows={2}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Wheelchair Access Notes</label>
                    <textarea
                      {...register('wheelchairAccessNotes')}
                      rows={2}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </form>

          {/* Footer — sticky at bottom, outside scroll area */}
          <div className="px-6 py-4 border-t border-[var(--color-border)] space-y-3 shrink-0">
            {/* Deactivate (edit mode only) */}
            {isEdit && (
              <div>
                {showDeactivateConfirm ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[var(--color-muted-foreground)]">
                      Deactivate this template?
                    </span>
                    <button
                      type="button"
                      onClick={handleDeactivate}
                      disabled={deactivateMutation.isPending}
                      className="text-red-600 font-medium hover:underline disabled:opacity-50"
                    >
                      {deactivateMutation.isPending ? 'Deactivating…' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeactivateConfirm(false)}
                      className="text-[var(--color-muted-foreground)] hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDeactivateConfirm(true)}
                    className="text-sm text-red-500 hover:text-red-700 hover:underline transition-colors"
                  >
                    Deactivate template
                  </button>
                )}
              </div>
            )}

            {/* Save / Cancel */}
            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit(onSubmit)}
                disabled={isBusy}
                className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {isBusy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }
  ```

- [ ] **Step 2: Check TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```

  Expected: no errors. `react-hook-form`, `@hookform/resolvers`, and `zod` are listed in the project's tech stack and should already be installed. If any are missing:

  ```bash
  cd frontend && npm install react-hook-form @hookform/resolvers zod
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/TemplateFormPanel.tsx
  git commit -m "feat: add TemplateFormPanel slide-over component"
  ```

---

## Task 4: Settings page — wire up template CRUD

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add imports**

  At the top of `SettingsPage.tsx`, after the existing imports, add:

  ```typescript
  import { Pencil } from 'lucide-react'
  import TemplateFormPanel from '@/components/TemplateFormPanel'
  ```

- [ ] **Step 2: Add panel state**

  Find the line `const { data: templates = [] } = useEventTemplates()` inside the main `SettingsPage` component. Add directly after it:

  ```typescript
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<any>(undefined)
  ```

- [ ] **Step 3: Replace the templates tab JSX**

  Find and replace the entire `{tab === 'templates' && (...)}` block:

  **Remove:**
  ```tsx
  {tab === 'templates' && (
    <div className="grid gap-4 md:grid-cols-2">
      {templates.map((t: any) => (
        <div key={t.id} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-semibold">{t.eventName}</h3>
              <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.eventCode}</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${t.isActive ? 'badge-confirmed' : 'badge-cancelled'}`}>
              {t.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="text-sm text-[var(--color-muted-foreground)] space-y-1">
            <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.defaultDestination || '—'} · {t.defaultRegion || '—'}</p>
            {t.standardDurationDays && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">schedule</span> {t.standardDurationDays} days</p>}
            {t.preferredTimeOfYear && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {t.preferredTimeOfYear}</p>}
          </div>
        </div>
      ))}
    </div>
  )}
  ```

  **Replace with:**
  ```tsx
  {tab === 'templates' && (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setEditingTemplate(undefined); setPanelOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-all"
        >
          + New Template
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(templates as any[]).filter((t: any) => t.isActive).map((t: any) => (
          <div key={t.id} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 group">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold">{t.eventName}</h3>
                <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.eventCode}</span>
              </div>
              <button
                onClick={() => { setEditingTemplate(t); setPanelOpen(true) }}
                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent)] transition-all"
                title="Edit template"
              >
                <Pencil className="w-4 h-4 text-[var(--color-muted-foreground)]" />
              </button>
            </div>
            <div className="text-sm text-[var(--color-muted-foreground)] space-y-1">
              <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.defaultDestination || '—'} · {t.defaultRegion || '—'}</p>
              {t.standardDurationDays && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">schedule</span> {t.standardDurationDays} days</p>}
              {t.preferredTimeOfYear && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {t.preferredTimeOfYear}</p>}
            </div>
          </div>
        ))}
      </div>

      <TemplateFormPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        template={editingTemplate}
      />
    </div>
  )}
  ```

- [ ] **Step 4: Check TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 5: Manual verification**

  ```bash
  cd frontend && npm run dev
  ```

  Navigate to Settings → Event Templates. Verify:
  - "New Template" button is visible at top-right
  - Clicking it opens the slide-over with blank fields and a "Fill from trip" selector
  - Selecting a trip in the dropdown fills name, code, destination, region, and duration
  - Submitting creates the template and it appears in the grid
  - Hovering a card reveals the pencil icon
  - Clicking the pencil opens the panel pre-filled with that template's data
  - "Deactivate template" shows inline confirm then removes the card from the grid after confirming

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/pages/SettingsPage.tsx
  git commit -m "feat: add template CRUD to Settings event-templates tab"
  ```

---

## Task 5: Trip Detail — "Save as Template" button

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx`

- [ ] **Step 1: Add TemplateFormPanel import**

  Find the component import block in `TripDetailPage.tsx`:

  ```typescript
  import AddVehicleModal from '@/components/AddVehicleModal'
  import AddActivityModal from '@/components/AddActivityModal'
  import GenerateClaimModal from '@/components/GenerateClaimModal'
  import ItineraryTab from '@/components/ItineraryTab'
  ```

  Add after those lines:

  ```typescript
  import TemplateFormPanel from '@/components/TemplateFormPanel'
  ```

- [ ] **Step 2: Add panel state**

  Find the block of `useState` declarations near the top of `TripDetailPage` (the group with `showAddBooking`, `showAddVehicle`, `showAddActivity`). Add after them:

  ```typescript
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false)
  ```

- [ ] **Step 3: Add the "Save as Template" button in the trip header**

  Search the JSX for `handleOpenTripEdit` — it's in the trip header action buttons area. The button looks like:

  ```tsx
  <button
    onClick={handleOpenTripEdit}
    className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#f5f3ef] text-[#43493a] text-sm font-medium hover:bg-[#ede9e3] transition-all"
  >
  ```

  Add the following button immediately **before** that Edit Trip button:

  ```tsx
  {!trip?.eventTemplateId && (
    <button
      onClick={() => setShowSaveAsTemplate(true)}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#f5f3ef] text-[#43493a] text-sm font-medium hover:bg-[#ede9e3] transition-all"
    >
      <FileText className="w-4 h-4" />
      Save as Template
    </button>
  )}
  ```

  `FileText` is already in the lucide-react import at the top of the file. If it's missing, locate the `import { ..., FileText, ... } from 'lucide-react'` line and add `FileText` to it.

- [ ] **Step 4: Mount the panel**

  Find where the other modals are rendered near the end of the JSX return — the section containing `<AddVehicleModal ...>`, `<AddActivityModal ...>`, `<GenerateClaimModal ...>`. Add after them:

  ```tsx
  {trip && (
    <TemplateFormPanel
      isOpen={showSaveAsTemplate}
      onClose={() => setShowSaveAsTemplate(false)}
      initialTrip={trip}
    />
  )}
  ```

  `trip` is typed as `TripDetailDto` which extends `TripListDto`, so it satisfies `initialTrip?: TripListDto` directly.

- [ ] **Step 5: Check TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```

  Expected: no errors. If TypeScript reports `FileText` not found, add it to the existing lucide-react import at the top of the file.

- [ ] **Step 6: Manual verification**

  Open any trip detail page in the dev server. Verify:
  - "Save as Template" button appears in the header when the trip has no `eventTemplateId`
  - Button is absent on trips that are already linked to a template
  - Clicking opens the slide-over with name, code, destination, region, and duration pre-filled
  - "Fill from trip" selector shows the current trip pre-selected
  - Submitting creates the template, panel closes
  - Navigate to Settings → Event Templates — the new template appears in the grid

- [ ] **Step 7: Final build and lint**

  ```bash
  cd frontend && npm run build && npm run lint
  ```

  Expected: build succeeds, zero lint errors.

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/src/pages/TripDetailPage.tsx
  git commit -m "feat: add Save as Template button to trip detail screen"
  ```
