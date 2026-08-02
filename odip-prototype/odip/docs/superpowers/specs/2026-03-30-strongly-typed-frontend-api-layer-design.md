# Strongly Typed Frontend API Layer — Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Scope:** Frontend only — no backend changes

## Problem

All 90 TanStack Query hooks in `frontend/src/api/hooks.ts` (765 lines) use `any` for data types. TypeScript strict mode is enabled but `any` bypasses all its guarantees. Developers get no autocomplete, no refactor safety, and no compile-time contract enforcement between backend DTOs and frontend consumption.

## Decision Summary

| Decision | Choice |
|----------|--------|
| Runtime validation | Types only (no Zod) |
| File organization | Domain-grouped types + hooks |
| Split hooks.ts | Yes, matching type structure |
| Enums | String unions + `as const` arrays |
| Naming | Match backend DTO names |
| Nullable | `| null` for responses, `?:` for request optionals |
| Migration | Big bang with barrel backward compatibility |

## File Structure

```
frontend/src/api/
  client.ts                    ← existing, add generic typed helpers
  types/
    enums.ts                   ← all 33 string unions + const arrays
    common.ts                  ← ApiResponse<T>, PagedResult<T>
    trips.ts                   ← TripListDto, TripDetailDto, CreateTripDto, etc.
    participants.ts            ← ParticipantListDto, ParticipantDetailDto, SupportProfileDto, etc.
    bookings.ts                ← BookingListDto, BookingDetailDto, CreateBookingDto, etc.
    accommodation.ts           ← AccommodationListDto, ReservationDto, etc.
    vehicles.ts                ← VehicleListDto, VehicleAssignmentDto, etc.
    staff.ts                   ← StaffListDto, StaffAvailabilityDto, StaffAssignmentDto, etc.
    tasks.ts                   ← TaskDto, CreateTaskDto, etc.
    activities.ts              ← ActivityDto, ScheduledActivityDto, EventTemplateDto, TripDayDto, etc.
    incidents.ts               ← IncidentListDto, IncidentDetailDto, etc.
    itinerary.ts               ← ItineraryDto + all nested sub-types
    schedule.ts                ← ScheduleOverviewDto + nested types
    dashboard.ts               ← DashboardSummaryDto
    auth.ts                    ← LoginDto, AuthResponseDto
    settings.ts                ← AppSettingsDto, TenantDto, etc.
    claims.ts                  ← TripClaimListDto, TripClaimDetailDto, ClaimLineItemDto, ClaimPreviewResponseDto, etc.
    catalogue.ts               ← SupportActivityGroupDto, SupportCatalogueItemDto, CatalogueImportPreviewDto, etc.
    provider.ts                ← ProviderSettingsDto, UpsertProviderSettingsDto
    public-holidays.ts         ← PublicHolidayDto, CreatePublicHolidayDto
    documents.ts               ← TripDocumentDto
    contacts.ts                ← ContactDto
    index.ts                   ← barrel re-export everything
  hooks/
    trips.ts                   ← useTrips, useTrip, useCreateTrip, useUpdateTrip, usePatchTrip, useGenerateSchedule
    participants.ts            ← useParticipants, useParticipant, useParticipantBookings, useSupportProfile, useCreateParticipant, useUpdateParticipant, useDeleteParticipant
    bookings.ts                ← useBookings, useTripBookings, useCreateBooking, useUpdateBooking, usePatchBooking, useDeleteBooking, useCancelBooking
    accommodation.ts           ← useAccommodation, useAccommodationDetail, useCreateAccommodation, useUpdateAccommodation, useDeleteAccommodation, useCreateReservation, useUpdateReservation, useDeleteReservation, useCancelReservation
    vehicles.ts                ← useVehicles, useVehicleDetail, useCreateVehicle, useUpdateVehicle, useDeleteVehicle, useCreateVehicleAssignment, useTripVehicles
    staff.ts                   ← useStaff, useStaffDetail, useAvailableStaff, useStaffAvailability, useTripStaff, useCreateStaff, useUpdateStaff, useDeleteStaff, useCreateStaffAssignment, useUpdateStaffAssignment, useDeleteStaffAssignment, useCreateStaffAvailability, useUpdateStaffAvailability, useDeleteStaffAvailability
    tasks.ts                   ← useTasks, useTripTasks, useCreateTask, useUpdateTask, useDeleteTask
    activities.ts              ← useActivities, useEventTemplates, useTripSchedule, useCreateScheduledActivity, useUpdateScheduledActivity, useDeleteScheduledActivity
    incidents.ts               ← useIncidents, useIncident, useTripIncidents, useOverdueQscIncidents, useCreateIncident, useUpdateIncident, useDeleteIncident
    schedule.ts                ← useScheduleOverview
    dashboard.ts               ← useDashboard
    auth.ts                    ← useLogin
    settings.ts                ← useSettings, useUpdateSettings, useAdminTenants
    claims.ts                  ← useTripClaims, useClaim, useGenerateClaim, usePreviewClaim, useUpdateClaim, useUpdateClaimLineItem, useDeleteClaim
    catalogue.ts               ← useSupportCatalogue, useUpsertProviderSettings, useProviderSettings
    public-holidays.ts         ← usePublicHolidays, useCreatePublicHoliday, useDeletePublicHoliday
    documents.ts               ← useTripDocuments, useTripItinerary
    constants.ts               ← PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_ITEMS
    index.ts                   ← barrel re-export all hooks, constants, and re-export types
```

## Type Conventions

### C# to TypeScript Mapping

| C# Type | TypeScript Type | Notes |
|---------|----------------|-------|
| `Guid` | `string` | UUIDs come as strings over JSON |
| `string` | `string` | |
| `string?` | `string \| null` | Backend sends `null`, not `undefined` |
| `int`, `decimal` | `number` | |
| `int?` | `number \| null` | |
| `bool` | `boolean` | |
| `DateOnly` | `string` | ISO `"2026-04-15"` |
| `TimeOnly` | `string` | `"09:30:00"` |
| `DateTime` | `string` | ISO 8601 |
| `List<T>` | `T[]` | |
| Enums | String union type | e.g., `TripStatus` |

### Nullable vs Optional

- Response DTOs: use `| null` — backend always sends the key, value may be null
- Request DTOs: use `?:` — field can be omitted from the request body

```typescript
// Response DTO
interface TripListDto {
  tripCode: string | null;     // always present, sometimes null
}

// Request DTO
interface CreateTripDto {
  tripCode?: string;           // optional to include
}
```

### Enum Pattern

String union types derived from `as const` arrays. Provides autocomplete, type checking, zero runtime cost for the type, and iteration for dropdowns.

```typescript
export const TRIP_STATUSES = [
  'Draft', 'Planning', 'OpenForBookings', 'WaitlistOnly',
  'Confirmed', 'InProgress', 'Completed', 'Cancelled', 'Archived',
] as const;
export type TripStatus = typeof TRIP_STATUSES[number];
```

### Interface Inheritance

Mirror C# DTO inheritance with `extends`:

```typescript
interface TripListDto {
  id: string;
  tripName: string;
  // ...list fields
}

interface TripDetailDto extends TripListDto {
  eventTemplateId: string | null;
  // ...detail-only fields
}
```

### DTO naming asymmetry note

`CreateScheduledActivityDto` and `UpdateScheduledActivityDto` do not include a `category` field, but the response `ScheduledActivityDto` does include `category: ActivityCategory | null`. This is intentional — category is derived from the linked Activity. The TypeScript interfaces must match the backend exactly (no `category` on create/update DTOs).

## Typed Client Helpers

Add generic wrappers to `client.ts` that unwrap `ApiResponse<T>`:

```typescript
import type { ApiResponse } from './types';

export async function apiGet<T>(url: string, params?: Record<string, string>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params });
  return response.data.data as T;
}

export async function apiPost<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, data);
  return response.data.data as T;
}

export async function apiPut<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.put<ApiResponse<T>>(url, data);
  return response.data.data as T;
}

export async function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.patch<ApiResponse<T>>(url, data);
  return response.data.data as T;
}

export async function apiDelete(url: string): Promise<void> {
  await apiClient.delete(url);
}
```

Note: `apiDelete` returns `void` — DELETE endpoints in this app return `ApiResponse<bool>` or empty responses, and callers never use the return data. Mutations that delete only need `onSuccess` to invalidate queries.

## Hook Patterns

### Query Hook

```typescript
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../client';
import type { TripListDto, TripDetailDto } from '../types';

export function useTrips(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['trips', params],
    queryFn: () => apiGet<TripListDto[]>('/trips', params),
  });
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: ['trip', id],
    queryFn: () => apiGet<TripDetailDto>(`/trips/${id}`),
    enabled: !!id,
  });
}
```

### Mutation Hook

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut } from '../client';
import type { CreateTripDto, UpdateTripDto, TripDetailDto } from '../types';

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTripDto) => apiPost<TripDetailDto>('/trips', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}

export function useUpdateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTripDto }) =>
      apiPut<TripDetailDto>(`/trips/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trip', id] });
    },
  });
}
```

### Delete Mutation Hook

```typescript
export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/bookings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['trip-bookings'] });
    },
  });
}
```

## Query Key Reference

Preserve existing query keys exactly. All mutation invalidation must reference these keys.

| Hook | Query Key |
|------|-----------|
| useTrips | `['trips', params]` |
| useTrip | `['trip', id]` |
| useTripBookings | `['trip-bookings', tripId]` |
| useTripAccommodation | `['trip-accommodation', tripId]` |
| useTripVehicles | `['trip-vehicles', tripId]` |
| useTripStaff | `['trip-staff', tripId]` |
| useTripTasks | `['trip-tasks', tripId]` |
| useTripSchedule | `['trip-schedule', tripId]` |
| useTripDocuments | `['trip-documents', tripId]` |
| useTripItinerary | `['trip-itinerary', tripId]` |
| useParticipants | `['participants', params]` |
| useParticipant | `['participant', id]` |
| useParticipantBookings | `['participant-bookings', id]` |
| useSupportProfile | `['support-profile', id]` |
| useAccommodation | `['accommodation', params]` |
| useAccommodationDetail | `['accommodation-detail', id]` |
| useVehicles | `['vehicles', params]` |
| useVehicleDetail | `['vehicle-detail', id]` |
| useStaff | `['staff', params]` |
| useStaffDetail | `['staff-detail', id]` |
| useAvailableStaff | `['staff-available', startDate, endDate]` |
| useStaffAvailability | `['staff-availability', id]` |
| useTasks | `['tasks', params]` |
| useActivities | `['activities']` |
| useEventTemplates | `['event-templates']` |
| useDashboard | `['dashboard']` |
| useBookings | `['bookings', params]` |
| useScheduleOverview | `['schedule-overview', params]` |
| useIncidents | `['incidents', params]` |
| useIncident | `['incident', id]` |
| useTripIncidents | `['trip-incidents', tripId]` |
| useOverdueQscIncidents | `['incidents-overdue-qsc']` |
| useSettings | `['settings']` |
| useAdminTenants | `['admin-tenants']` |
| useTripClaims | `['trip-claims', tripId]` |
| useClaim | `['claim', claimId]` |
| useProviderSettings | `['provider-settings']` |
| useSupportCatalogue | `['support-catalogue']` |
| usePublicHolidays | `['public-holidays', year, state]` |

## Migration Strategy

### Step 1 — Create type files (zero risk)
Write all `types/*.ts` files with interfaces and enums. Write `types/index.ts` barrel export. Nothing references these yet.

### Step 2 — Add typed client helpers (minimal change)
Add `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete` to `client.ts`. Existing `apiClient` export unchanged.

### Step 3 — Create new hook files (zero risk)
Write all `hooks/*.ts` files with typed hooks. Write `hooks/index.ts` barrel that re-exports everything, including all types. Also re-export the constants (PAYMENT_STATUS_LABELS, etc.). Old `hooks.ts` still exists.

### Step 4 — Switch over
Rename old `hooks.ts` → `hooks.legacy.ts` (safety net). The new `hooks/index.ts` barrel serves the same import path. Run `npm run build` to verify zero type errors. Delete `hooks.legacy.ts` once verified.

### Step 5 — Clean up page components
Remove all `(t: any)`, `(b: any)`, `(s: any)` inline casts from page components. Add type imports where components use DTO shapes directly. This step is incremental — each page can be cleaned up independently.

## Out of Scope

- Zod runtime validation
- Form type integration (React Hook Form + Zod schemas for forms)
- API error response typing beyond `ApiResponse<T>`
- Auto-generation tooling (NSwag, OpenAPI → TypeScript)
- Backend OpenAPI/Swagger spec generation

## Complete Inventory

### Enums (33)

PlanType, SupportRatio, PreferredContactMethod, TripStatus, BookingStatus, ReservationStatus, VehicleType, VehicleAssignmentStatus, StaffRole, AvailabilityType, AssignmentStatus, ScheduledActivityStatus, SleepoverType, ActivityCategory, TaskType, TaskPriority, TaskItemStatus, DocumentType, UserRole, IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus, InsuranceStatus, PaymentStatus, ContactType, TripClaimStatus, ClaimLineItemStatus, ClaimDayType, ClaimType, GSTCode, ClaimStatus, OvernightSupportType

### DTOs by Domain

**Common (2):** ApiResponse\<T>, PagedResult\<T>

**Auth (2):** LoginDto, AuthResponseDto

**Trips (5):** TripListDto, TripDetailDto, CreateTripDto, UpdateTripDto, PatchTripDto

**Participants (6):** ParticipantListDto, ParticipantDetailDto, CreateParticipantDto, UpdateParticipantDto, SupportProfileDto, UpdateSupportProfileDto

**Contacts (1):** ContactDto

**Bookings (5):** BookingListDto, BookingDetailDto, CreateBookingDto, UpdateBookingDto, PatchBookingDto

**Accommodation (4):** AccommodationListDto, AccommodationDetailDto, CreateAccommodationDto, UpdateAccommodationDto

**Reservations (3):** ReservationDto, CreateReservationDto, UpdateReservationDto

**Vehicles (7):** VehicleListDto, VehicleDetailDto, CreateVehicleDto, UpdateVehicleDto, VehicleAssignmentDto, CreateVehicleAssignmentDto, UpdateVehicleAssignmentDto

**Staff (10):** StaffListDto, StaffDetailDto, CreateStaffDto, UpdateStaffDto, StaffAvailabilityDto, CreateStaffAvailabilityDto, UpdateStaffAvailabilityDto, StaffAssignmentDto, CreateStaffAssignmentDto, UpdateStaffAssignmentDto

**Tasks (3):** TaskDto, CreateTaskDto, UpdateTaskDto

**Activities (8):** ActivityDto, CreateActivityDto, UpdateActivityDto, ScheduledActivityDto, CreateScheduledActivityDto, UpdateScheduledActivityDto, TripDayDto, UpdateTripDayDto

**Events (3):** EventTemplateDto, CreateEventTemplateDto, UpdateEventTemplateDto

**Incidents (4):** IncidentListDto, IncidentDetailDto, CreateIncidentDto, UpdateIncidentDto

**Itinerary (8):** ItineraryDto, ItineraryParticipantDto, ItineraryAccommodationDto, ItineraryVehicleDto, ItineraryStaffDto, ItineraryDayDto, ItineraryActivityDto, ItineraryDayAccommodationEventDto

**Schedule (6):** ScheduleOverviewDto, ScheduleTripDto, ScheduleStaffDto, ScheduleStaffTripStatusDto, ScheduleVehicleDto, ScheduleVehicleTripStatusDto

**Dashboard (1):** DashboardSummaryDto

**Settings (5):** AppSettingsDto, UpdateAppSettingsDto, TenantDto, CreateTenantDto, UpdateTenantDto

**Claims (9):** TripClaimListDto, TripClaimDetailDto, ClaimLineItemDto, UpdateClaimDto, UpdateClaimLineItemDto, ClaimPreviewRequestDto, GenerateClaimRequestDto, ClaimPreviewResponseDto, ClaimPreviewLineItemDto

**Provider (2):** ProviderSettingsDto, UpsertProviderSettingsDto

**Catalogue (5):** SupportActivityGroupDto, SupportCatalogueItemDto, CatalogueImportPreviewDto, CatalogueImportRowDto, ConfirmCatalogueImportDto

**Public Holidays (2):** PublicHolidayDto, CreatePublicHolidayDto

**Documents (1):** TripDocumentDto

**Total: ~102 interfaces + 33 enums**

### Hooks (90 total)

**Query Hooks (39):**
useTrips, useTrip, useTripBookings, useTripAccommodation, useTripVehicles, useTripStaff, useTripTasks, useTripSchedule, useTripDocuments, useTripItinerary, useParticipants, useParticipant, useParticipantBookings, useSupportProfile, useAccommodation, useAccommodationDetail, useVehicles, useVehicleDetail, useStaff, useStaffDetail, useAvailableStaff, useStaffAvailability, useTasks, useActivities, useEventTemplates, useDashboard, useBookings, useScheduleOverview, useIncidents, useIncident, useTripIncidents, useOverdueQscIncidents, useSettings, useAdminTenants, useTripClaims, useClaim, useProviderSettings, useSupportCatalogue, usePublicHolidays

**Mutation Hooks (51):**
useCreateTrip, useUpdateTrip, usePatchTrip, useCreateBooking, useUpdateBooking, usePatchBooking, useDeleteBooking, useCancelBooking, useCreateParticipant, useUpdateParticipant, useDeleteParticipant, useCreateAccommodation, useUpdateAccommodation, useDeleteAccommodation, useCreateReservation, useUpdateReservation, useDeleteReservation, useCancelReservation, useCreateVehicle, useUpdateVehicle, useDeleteVehicle, useCreateVehicleAssignment, useCreateStaff, useUpdateStaff, useDeleteStaff, useCreateStaffAssignment, useUpdateStaffAssignment, useDeleteStaffAssignment, useCreateStaffAvailability, useUpdateStaffAvailability, useDeleteStaffAvailability, useCreateTask, useUpdateTask, useDeleteTask, useCreateIncident, useUpdateIncident, useDeleteIncident, useCreateScheduledActivity, useUpdateScheduledActivity, useDeleteScheduledActivity, useGenerateSchedule, useLogin, useUpdateSettings, useGenerateClaim, usePreviewClaim, useUpdateClaim, useUpdateClaimLineItem, useDeleteClaim, useUpsertProviderSettings, useCreatePublicHoliday, useDeletePublicHoliday

**Constants (also re-exported):**
PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, PAYMENT_STATUS_ITEMS
