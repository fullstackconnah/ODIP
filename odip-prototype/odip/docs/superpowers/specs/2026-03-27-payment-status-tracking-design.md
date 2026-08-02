---
tags: [project/trip-planner, feature/payment-tracking, layer/backend, layer/frontend]
date: 2026-03-27
project: TripPlanner
---

# Payment Status Tracking — Design Spec

## Overview

Add payment status tracking to participant bookings. Each `ParticipantBooking` (the join between a participant and a trip) will carry a structured `PaymentStatus` enum replacing the existing free-text `OopPaymentStatus` string. The status is surfaced as an inline pill dropdown on the trip detail Bookings tab and summarised on the trip Overview tab.

---

## Enum Definition

```csharp
public enum PaymentStatus
{
    NotInvoiced = 0,  // default — invoice not yet sent
    InvoiceSent = 1,
    Partial     = 2,
    Paid        = 3,
    Overdue     = 4
}
```

UI labels map 1:1: "Not Invoiced", "Invoice Sent", "Partial", "Paid", "Overdue".

---

## Backend Changes

### 1. Domain — `Odip.Domain`

- Add `PaymentStatus.cs` enum to `Odip.Domain/Enums/`
- On `ParticipantBooking`: replace `string? OopPaymentStatus` with `PaymentStatus PaymentStatus { get; set; } = PaymentStatus.NotInvoiced`

### 2. Application — `Odip.Application`

- Add `PaymentStatus PaymentStatus` to any booking DTOs that are returned with booking data (the DTO used by `GET /api/v1/trips/{id}/bookings`)
- Add `UpdateBookingPaymentStatusDto` record: `{ PaymentStatus PaymentStatus }`

### 3. API — `Odip.Api`

- Add `PATCH /api/v1/trips/{tripId}/bookings/{bookingId}/payment-status`
  - Accepts `UpdateBookingPaymentStatusDto`
  - Updates only `PaymentStatus` and `UpdatedAt` on the booking
  - Returns `204 No Content`
  - Requires `Admin` or `Coordinator` role

### 4. Infrastructure — `Odip.Infrastructure`

- EF Core migration: rename/repurpose column `OopPaymentStatus` (string → int enum)
  - Migration name: `AddPaymentStatusToBooking`
  - Column: `PaymentStatus int NOT NULL DEFAULT 0`

---

## Frontend Changes

### 1. Types — `frontend/src/api/`

Add `PaymentStatus` TypeScript enum to match the backend:

```typescript
export enum PaymentStatus {
  NotInvoiced = 0,
  InvoiceSent = 1,
  Partial     = 2,
  Paid        = 3,
  Overdue     = 4,
}
```

Add a `useUpdateBookingPaymentStatus` mutation hook that calls `PATCH /api/v1/trips/{tripId}/bookings/{bookingId}/payment-status` and invalidates the trip bookings query on success.

### 2. Trip Detail Page — Bookings Tab

Add a **Payment** column to the participant/bookings table.

Each row shows a `Dropdown` with `variant="pill"` using the payment status colour:

| Status | Pill colour (Tailwind) |
|---|---|
| Not Invoiced | `bg-neutral-100 text-neutral-600` (grey) |
| Invoice Sent | `bg-blue-100 text-blue-700` |
| Partial | `bg-amber-100 text-amber-700` |
| Paid | `bg-green-100 text-green-700` |
| Overdue | `bg-red-100 text-red-700` |

On change: calls `useUpdateBookingPaymentStatus` with the new value. Optimistic update is not needed — React Query invalidation is sufficient.

### 3. Trip Detail Page — Overview Tab

In the participants summary section add a **Payment summary** row below the existing participant count stats:

```
Participants: 8 confirmed
Payment:  ■ 3 paid  ■ 2 invoice sent  ■ 1 partial  ■ 1 overdue  ■ 1 not invoiced
```

- Only show status counts that are > 0
- Coloured dots matching the pill colours above
- Derived from the already-fetched bookings data — no additional API call needed

---

## What Is Not In Scope

- Payment amounts or dollar values
- Payment history / audit log
- Automated overdue detection (overdue is set manually)
- Email/notification on status change

---

## Acceptance Criteria

1. Every booking row on the Bookings tab shows a Payment pill dropdown
2. Selecting a new status from the dropdown saves immediately without a page reload
3. The Overview tab participants section shows a breakdown of payment statuses
4. Default status for new bookings is "Not Invoiced"
5. Backend migration runs without data loss (existing `OopPaymentStatus` string values dropped — field had no structured data)
6. Build and lint pass with no TypeScript errors
