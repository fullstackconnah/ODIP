using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Services;

/// <summary>Severity of a <see cref="BillingValidationResult"/>: Error blocks batching, Warning does not.</summary>
public enum BillingSeverity
{
    Error,
    Warning
}

/// <summary>One finding produced by <see cref="BillingValidator"/> against a single event.</summary>
public sealed record BillingValidationResult(Guid EventId, BillingSeverity Severity, string Code, string Message);

/// <summary>
/// Validates a set of <see cref="BillableEvent"/>s against their <see cref="ServiceBooking"/>s
/// before they are batched for claiming/invoicing. The rules mirror the claim-rejection causes
/// documented in the Oassist NDIS bulk-file guidance (booking balance exceeded, duplicate claim
/// reference, claim window elapsed, malformed Quantity/Hours, bad date ranges, amount mismatch).
/// Pure — takes <paramref name="today"/> as an explicit parameter rather than reading the clock,
/// so results are deterministic and testable.
/// </summary>
public sealed class BillingValidator
{
    /// <summary>Warn when the claim deadline is within this many days.</summary>
    public const int DeadlineWarningDays = 14;

    /// <summary>
    /// Runs all validation rules against <paramref name="events"/> and returns every finding
    /// (an event may have zero, one, or several). Does not mutate any input.
    /// </summary>
    /// <param name="events">The candidate billable events (should include navigation to FundingSource where known).</param>
    /// <param name="bookings">Service bookings referenced by <paramref name="events"/> (with their Lines loaded).</param>
    /// <param name="priorClaimedReferences">ClaimReference values already in status Claimed/Paid, for duplicate detection.</param>
    /// <param name="today">The current date, supplied by the caller (never read from the system clock here).</param>
    public IReadOnlyList<BillingValidationResult> Validate(
        IReadOnlyList<BillableEvent> events,
        IReadOnlyList<ServiceBooking> bookings,
        ISet<string> priorClaimedReferences,
        DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(bookings);
        ArgumentNullException.ThrowIfNull(priorClaimedReferences);

        var results = new List<BillingValidationResult>();
        var bookingsById = bookings.ToDictionary(b => b.Id);

        ValidateBookingBalance(events, bookingsById, results);
        ValidateDuplicateReferences(events, priorClaimedReferences, results);
        ValidateClaimWindow(events, bookingsById, today, results);
        ValidateQuantityXorHours(events, results);
        ValidateDateOrder(events, results);
        ValidateAmount(events, results);

        return results;
    }

    /// <summary>
    /// Runs <see cref="Validate"/> and applies its outcome: sets each event's Status to
    /// Validated or Rejected (with RejectionReason populated from any Error findings), and
    /// for validated agency-managed events increments the matching ServiceBookingLine's
    /// ClaimedAmount so later batches see the reduced balance. Returns the same findings
    /// as <see cref="Validate"/> for reporting.
    /// </summary>
    public IReadOnlyList<BillingValidationResult> Apply(
        IReadOnlyList<BillableEvent> events,
        IReadOnlyList<ServiceBooking> bookings,
        ISet<string> priorClaimedReferences,
        DateOnly today)
    {
        var results = Validate(events, bookings, priorClaimedReferences, today);
        var bookingsById = bookings.ToDictionary(b => b.Id);

        var reasonsByEvent = results
            .Where(r => r.Severity == BillingSeverity.Error)
            .GroupBy(r => r.EventId)
            .ToDictionary(g => g.Key, g => string.Join(" | ", g.Select(r => $"{r.Code}: {r.Message}")));

        foreach (var e in events)
        {
            if (reasonsByEvent.TryGetValue(e.Id, out var reason))
            {
                e.Status = BillableEventStatus.Rejected;
                e.RejectionReason = reason;
                continue;
            }

            e.Status = BillableEventStatus.Validated;
            e.RejectionReason = null;

            if (e.ServiceBookingId.HasValue && IsAgencyManaged(e) &&
                bookingsById.TryGetValue(e.ServiceBookingId.Value, out var booking))
            {
                var line = booking.Lines.FirstOrDefault(l => l.SupportItemNumber == e.SupportItemNumber);
                if (line is not null)
                    line.ClaimedAmount += e.TotalAmount;
            }
        }

        return results;
    }

    private static bool IsAgencyManaged(BillableEvent e) =>
        e.FundingSource?.RouteType == FundingRouteType.AgencyManaged;

    private static void ValidateBookingBalance(
        IReadOnlyList<BillableEvent> events,
        IReadOnlyDictionary<Guid, ServiceBooking> bookingsById,
        List<BillingValidationResult> results)
    {
        var agencyGroups = events
            .Where(e => e.ServiceBookingId.HasValue && IsAgencyManaged(e))
            .GroupBy(e => (BookingId: e.ServiceBookingId!.Value, e.SupportItemNumber));

        foreach (var group in agencyGroups)
        {
            if (!bookingsById.TryGetValue(group.Key.BookingId, out var booking))
            {
                foreach (var e in group)
                    results.Add(new BillingValidationResult(
                        e.Id, BillingSeverity.Error, "NO_BOOKING_LINE",
                        $"ServiceBooking {group.Key.BookingId} referenced by this event was not found."));
                continue;
            }

            var line = booking.Lines.FirstOrDefault(l => l.SupportItemNumber == group.Key.SupportItemNumber);
            if (line is null)
            {
                foreach (var e in group)
                    results.Add(new BillingValidationResult(
                        e.Id, BillingSeverity.Error, "NO_BOOKING_LINE",
                        $"No ServiceBookingLine for support item '{group.Key.SupportItemNumber}' " +
                        $"on booking '{booking.ProdaBookingReference}'."));
                continue;
            }

            var totalClaimed = group.Sum(e => e.TotalAmount);
            if (totalClaimed > line.RemainingAmount)
            {
                var message =
                    $"Sum of claimed amounts ${totalClaimed:0.00} for support item '{group.Key.SupportItemNumber}' " +
                    $"exceeds remaining service booking balance ${line.RemainingAmount:0.00} " +
                    $"on booking '{booking.ProdaBookingReference}'.";
                foreach (var e in group)
                    results.Add(new BillingValidationResult(e.Id, BillingSeverity.Error, "BOOKING_BALANCE", message));
            }
        }
    }

    private static void ValidateDuplicateReferences(
        IReadOnlyList<BillableEvent> events,
        ISet<string> priorClaimedReferences,
        List<BillingValidationResult> results)
    {
        var duplicateGroups = events
            .GroupBy(e => (e.ClaimReference, e.SupportItemNumber, e.SupportsDeliveredFrom))
            .Where(g => g.Count() > 1);

        foreach (var group in duplicateGroups)
        {
            var message =
                $"Claim reference '{group.Key.ClaimReference}' for support item '{group.Key.SupportItemNumber}' " +
                $"delivered from {group.Key.SupportsDeliveredFrom:yyyy-MM-dd} appears {group.Count()} times in this batch.";
            foreach (var e in group)
                results.Add(new BillingValidationResult(e.Id, BillingSeverity.Error, "DUPLICATE_REF", message));
        }

        foreach (var e in events)
        {
            if (priorClaimedReferences.Contains(e.ClaimReference))
                results.Add(new BillingValidationResult(
                    e.Id, BillingSeverity.Error, "DUPLICATE_REF",
                    $"Claim reference '{e.ClaimReference}' has already been claimed or paid."));
        }
    }

    private static void ValidateClaimWindow(
        IReadOnlyList<BillableEvent> events,
        IReadOnlyDictionary<Guid, ServiceBooking> bookingsById,
        DateOnly today,
        List<BillingValidationResult> results)
    {
        foreach (var e in events)
        {
            if (!e.ServiceBookingId.HasValue || !bookingsById.TryGetValue(e.ServiceBookingId.Value, out var booking))
                continue;

            var deadline = booking.ClaimDeadline;
            if (today > deadline)
            {
                results.Add(new BillingValidationResult(
                    e.Id, BillingSeverity.Error, "PAST_DEADLINE",
                    $"Claim window for booking '{booking.ProdaBookingReference}' closed on {deadline:yyyy-MM-dd}; " +
                    $"today is {today:yyyy-MM-dd}."));
            }
            else if (deadline.DayNumber - today.DayNumber <= DeadlineWarningDays)
            {
                results.Add(new BillingValidationResult(
                    e.Id, BillingSeverity.Warning, "DEADLINE_NEAR",
                    $"Claim window for booking '{booking.ProdaBookingReference}' closes on {deadline:yyyy-MM-dd}, " +
                    $"within {DeadlineWarningDays} days of today ({today:yyyy-MM-dd})."));
            }
        }
    }

    private static void ValidateQuantityXorHours(IReadOnlyList<BillableEvent> events, List<BillingValidationResult> results)
    {
        foreach (var e in events)
        {
            if (e.Quantity.HasValue == e.Hours.HasValue)
                results.Add(new BillingValidationResult(
                    e.Id, BillingSeverity.Error, "QTY_XOR_HOURS",
                    $"Exactly one of Quantity or Hours must be set (got Quantity={e.Quantity}, Hours={e.Hours})."));
        }
    }

    private static void ValidateDateOrder(IReadOnlyList<BillableEvent> events, List<BillingValidationResult> results)
    {
        foreach (var e in events)
        {
            if (e.SupportsDeliveredFrom > e.SupportsDeliveredTo)
                results.Add(new BillingValidationResult(
                    e.Id, BillingSeverity.Error, "DATE_ORDER",
                    $"SupportsDeliveredFrom ({e.SupportsDeliveredFrom:yyyy-MM-dd}) is after " +
                    $"SupportsDeliveredTo ({e.SupportsDeliveredTo:yyyy-MM-dd})."));
        }
    }

    private static void ValidateAmount(IReadOnlyList<BillableEvent> events, List<BillingValidationResult> results)
    {
        foreach (var e in events)
        {
            decimal? units = e.Quantity ?? (e.Hours.HasValue ? (decimal)e.Hours.Value.TotalHours : null);
            if (!units.HasValue)
                continue;

            var expected = Math.Round(e.UnitPrice * units.Value, 2, MidpointRounding.AwayFromZero);
            if (Math.Abs(expected - e.TotalAmount) > 0.01m)
                results.Add(new BillingValidationResult(
                    e.Id, BillingSeverity.Warning, "AMOUNT_MISMATCH",
                    $"TotalAmount ${e.TotalAmount:0.00} does not match UnitPrice x units = ${expected:0.00}."));
        }
    }
}
