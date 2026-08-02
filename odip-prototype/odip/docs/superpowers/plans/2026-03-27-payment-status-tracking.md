# Payment Status Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `OopPaymentStatus` string on `ParticipantBooking` with a typed `PaymentStatus` enum, expose it via an inline pill dropdown on the trip detail Bookings tab, and show a payment breakdown summary on the Overview tab.

**Architecture:** The enum lives in `Enums.cs` alongside all other domain enums. The entity field, DTOs, and PATCH endpoint are updated in a single migration. The frontend reads payment status from the existing bookings list query (no extra API call) and derives summary counts client-side.

**Tech Stack:** .NET 9 / ASP.NET Core / EF Core 8 / PostgreSQL (backend); React 19 / TypeScript / TanStack Query v5 / Tailwind CSS v4 / Dropdown component (frontend)

---

### Task 1: Add PaymentStatus enum

**Files:**
- Modify: `backend/Odip.Domain/Enums/Enums.cs`

- [ ] **Step 1: Append PaymentStatus to Enums.cs**

Open `backend/Odip.Domain/Enums/Enums.cs` and add at the end of the file:

```csharp
public enum PaymentStatus
{
    NotInvoiced = 0,
    InvoiceSent = 1,
    Partial     = 2,
    Paid        = 3,
    Overdue     = 4
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/Odip.Domain/Enums/Enums.cs
git commit -m "feat: add PaymentStatus enum"
```

---

### Task 2: Update ParticipantBooking entity

**Files:**
- Modify: `backend/Odip.Domain/Entities/ParticipantBooking.cs`

- [ ] **Step 1: Replace OopPaymentStatus with PaymentStatus**

Find:
```csharp
    public string? OopPaymentStatus { get; set; }
```
Replace with:
```csharp
    public PaymentStatus PaymentStatus { get; set; } = PaymentStatus.NotInvoiced;
```

- [ ] **Step 2: Commit**

```bash
git add backend/Odip.Domain/Entities/ParticipantBooking.cs
git commit -m "feat: replace OopPaymentStatus string with PaymentStatus enum on ParticipantBooking"
```

---

### Task 3: Update booking DTOs

**Files:**
- Modify: `backend/Odip.Application/DTOs/DTOs.cs`

- [ ] **Step 1: Add PaymentStatus to BookingListDto**

Find:
```csharp
    public bool ActionRequired { get; init; }
    public InsuranceStatus InsuranceStatus { get; init; }
}
```
Replace with:
```csharp
    public bool ActionRequired { get; init; }
    public InsuranceStatus InsuranceStatus { get; init; }
    public PaymentStatus PaymentStatus { get; init; }
}
```

- [ ] **Step 2: Replace OopPaymentStatus in BookingDetailDto**

Find:
```csharp
    public string? OopPaymentStatus { get; init; }
    public string? BookingNotes { get; init; }
```
Replace with:
```csharp
    public PaymentStatus PaymentStatus { get; init; }
    public string? BookingNotes { get; init; }
```

- [ ] **Step 3: Add PaymentStatus to PatchBookingDto**

Find:
```csharp
public record PatchBookingDto
{
    public BookingStatus? BookingStatus { get; init; }
    public InsuranceStatus? InsuranceStatus { get; init; }
}
```
Replace with:
```csharp
public record PatchBookingDto
{
    public BookingStatus? BookingStatus { get; init; }
    public InsuranceStatus? InsuranceStatus { get; init; }
    public PaymentStatus? PaymentStatus { get; init; }
}
```

- [ ] **Step 4: Replace OopPaymentStatus in UpdateBookingDto**

Find:
```csharp
public record UpdateBookingDto : CreateBookingDto
{
    public string? OopPaymentStatus { get; init; }
    public bool ActionRequired { get; init; }
    public string? CancellationReason { get; init; }
}
```
Replace with:
```csharp
public record UpdateBookingDto : CreateBookingDto
{
    public PaymentStatus PaymentStatus { get; init; }
    public bool ActionRequired { get; init; }
    public string? CancellationReason { get; init; }
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/Odip.Application/DTOs/DTOs.cs
git commit -m "feat: add PaymentStatus to booking DTOs, replace OopPaymentStatus"
```

---

### Task 4: Update TripsController — projection and PATCH endpoint

**Files:**
- Modify: `backend/Odip.Api/Controllers/TripsController.cs`

- [ ] **Step 1: Add PaymentStatus to BookingListDto projection**

Search for `new BookingListDto` in the file (it will be in the `GetTripBookings` action). In the object initialiser, find the line:
```csharp
InsuranceStatus = b.InsuranceStatus,
```
Add immediately after it:
```csharp
PaymentStatus = b.PaymentStatus,
```

- [ ] **Step 2: Update UpdateBooking action**

Search for where `OopPaymentStatus` is assigned from the DTO (inside the booking PUT action). Find:
```csharp
booking.OopPaymentStatus = dto.OopPaymentStatus;
```
Replace with:
```csharp
booking.PaymentStatus = dto.PaymentStatus;
```

- [ ] **Step 3: Add PATCH payment-status endpoint**

Find the end of the booking sub-resource actions (after the last action that operates on `/bookings/{bookingId}`). Add:

```csharp
/// <summary>Update payment status for a single booking.</summary>
[HttpPatch("{id}/bookings/{bookingId}/payment-status")]
[Authorize(Roles = "Admin,Coordinator")]
public async Task<IActionResult> PatchBookingPaymentStatus(
    Guid id, Guid bookingId, [FromBody] PatchBookingDto dto, CancellationToken ct)
{
    var booking = await _db.ParticipantBookings
        .FirstOrDefaultAsync(b => b.TripInstanceId == id && b.Id == bookingId, ct);
    if (booking == null) return NotFound();
    if (dto.PaymentStatus.HasValue)
        booking.PaymentStatus = dto.PaymentStatus.Value;
    booking.UpdatedAt = DateTime.UtcNow;
    await _db.SaveChangesAsync(ct);
    return NoContent();
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Api/Controllers/TripsController.cs
git commit -m "feat: project PaymentStatus in bookings query, add PATCH payment-status endpoint"
```

---

### Task 5: EF Core migration

**Files:**
- Create: (auto-generated in `backend/Odip.Infrastructure/Migrations/`)

- [ ] **Step 1: Generate the migration**

```bash
dotnet ef migrations add AddPaymentStatusToBooking --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected: a new `*_AddPaymentStatusToBooking.cs` file in `backend/Odip.Infrastructure/Migrations/` containing:
- `migrationBuilder.DropColumn(name: "OopPaymentStatus", table: "ParticipantBookings")`
- `migrationBuilder.AddColumn<int>(name: "PaymentStatus", table: "ParticipantBookings", nullable: false, defaultValue: 0)`

- [ ] **Step 2: Apply the migration**

```bash
dotnet ef database update --project backend/Odip.Infrastructure --startup-project backend/Odip.Api
```

Expected output: `Done.`

- [ ] **Step 3: Verify the backend builds**

```bash
dotnet build backend/Odip.Api
```

Expected: `Build succeeded.` with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend/Odip.Infrastructure/Migrations/
git commit -m "feat: migration AddPaymentStatusToBooking — drop OopPaymentStatus, add PaymentStatus int"
```

---

### Task 6: Frontend — PaymentStatus enum, helpers, and mutation hook

**Files:**
- Modify: `frontend/src/api/hooks.ts`

- [ ] **Step 1: Add enum, label map, colour map, and items array**

At the top of `frontend/src/api/hooks.ts`, after the existing imports and before the first hook definition, add:

```typescript
// ─── Payment Status ───────────────────────────────────────────
export enum PaymentStatus {
  NotInvoiced = 0,
  InvoiceSent = 1,
  Partial     = 2,
  Paid        = 3,
  Overdue     = 4,
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.NotInvoiced]: 'Not Invoiced',
  [PaymentStatus.InvoiceSent]: 'Invoice Sent',
  [PaymentStatus.Partial]:     'Partial',
  [PaymentStatus.Paid]:        'Paid',
  [PaymentStatus.Overdue]:     'Overdue',
}

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  [PaymentStatus.NotInvoiced]: 'bg-neutral-100 text-neutral-600',
  [PaymentStatus.InvoiceSent]: 'bg-blue-100 text-blue-700',
  [PaymentStatus.Partial]:     'bg-amber-100 text-amber-700',
  [PaymentStatus.Paid]:        'bg-green-100 text-green-700',
  [PaymentStatus.Overdue]:     'bg-red-100 text-red-700',
}

export const PAYMENT_STATUS_ITEMS = (
  Object.values(PaymentStatus).filter((v): v is PaymentStatus => typeof v === 'number')
).map(v => ({ value: String(v), label: PAYMENT_STATUS_LABELS[v] }))
```

- [ ] **Step 2: Add useUpdateBookingPaymentStatus hook**

Find the last booking-related mutation hook (e.g. `useDeleteBooking`). Add after it:

```typescript
export function useUpdateBookingPaymentStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      tripId,
      bookingId,
      paymentStatus,
    }: {
      tripId: string
      bookingId: string
      paymentStatus: PaymentStatus
    }) =>
      apiClient
        .patch(`/trips/${tripId}/bookings/${bookingId}/payment-status`, { paymentStatus })
        .then(r => r.data),
    onSuccess: (_, { tripId }) => {
      queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'bookings'] })
    },
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/hooks.ts
git commit -m "feat: add PaymentStatus enum, helpers, and useUpdateBookingPaymentStatus hook"
```

---

### Task 7: Add Payment column to Bookings tab

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx`

- [ ] **Step 1: Add new imports**

Find the import line that pulls from the hooks file (something like):
```typescript
import { useTrip, useTripBookings, ... } from '../api/hooks'
```
Add these four names to that import:
```
useUpdateBookingPaymentStatus,
PaymentStatus,
PAYMENT_STATUS_ITEMS,
PAYMENT_STATUS_COLORS,
PAYMENT_STATUS_LABELS,
```

- [ ] **Step 2: Instantiate the hook**

Find the block where mutation hooks are declared (near `useCreateBooking`, `useUpdateBooking`, etc.). Add:
```typescript
const updatePaymentStatus = useUpdateBookingPaymentStatus()
```

- [ ] **Step 3: Add Payment column header**

In the bookings `<thead>`, find the column header for Insurance. Search for the text `Insurance` inside a `<th>` element. Add a new `<th>` after it:

```tsx
<th className="px-3 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
  Payment
</th>
```

- [ ] **Step 4: Add Payment cell to each booking row**

In the bookings `<tbody>`, find where the Insurance status cell is rendered (it will show `booking.insuranceStatus`). Add a new `<td>` immediately after it:

```tsx
<td className="px-3 py-4 whitespace-nowrap">
  <Dropdown
    variant="pill"
    value={String(booking.paymentStatus ?? PaymentStatus.NotInvoiced)}
    onChange={val =>
      updatePaymentStatus.mutate({
        tripId: tripId!,
        bookingId: booking.id,
        paymentStatus: Number(val) as PaymentStatus,
      })
    }
    colorClass={PAYMENT_STATUS_COLORS[booking.paymentStatus ?? PaymentStatus.NotInvoiced]}
    items={PAYMENT_STATUS_ITEMS}
    disabled={isReadOnly}
  />
</td>
```

Note: `tripId` is the route param (already in scope), `isReadOnly` is the existing flag used to disable controls on cancelled/archived trips.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "feat: add Payment status pill dropdown column to bookings tab"
```

---

### Task 8: Add payment summary to Overview tab

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx`

- [ ] **Step 1: Locate the overview participants section**

In the overview tab render, search for where confirmed participant count is displayed. It will reference `trip.currentParticipantCount` or similar and be inside a card/section labelled "Participants".

- [ ] **Step 2: Add payment breakdown below participant stats**

The `bookings` data array is already fetched in TripDetailPage (used by the Bookings tab). Find the variable name (e.g. `bookings`). After the participant count display block in the overview tab, add:

```tsx
{bookings.length > 0 && (() => {
  const counts = bookings.reduce<Record<number, number>>((acc, b) => {
    const s = b.paymentStatus ?? PaymentStatus.NotInvoiced
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  const entries = (Object.entries(counts) as [string, number][])
    .map(([k, v]) => ({ status: Number(k) as PaymentStatus, count: v }))
    .filter(e => e.count > 0)
    .sort((a, b) => a.status - b.status)

  if (entries.length === 0) return null

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-fg-muted uppercase tracking-wider mb-1">Payment</p>
      <div className="flex flex-wrap gap-2">
        {entries.map(({ status, count }) => (
          <span
            key={status}
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[status]}`}
          >
            {count} {PAYMENT_STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  )
})()}
```

- [ ] **Step 3: Verify frontend builds cleanly**

```bash
cd frontend && npm run build
```

Expected: exits 0 with no TypeScript errors.

Also run lint:
```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Final commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "feat: add payment status breakdown summary to trip overview tab"
```
