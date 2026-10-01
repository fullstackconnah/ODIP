using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>
/// The participant queries whose SHAPE matters on PostgreSQL: the register search and the three counts behind the archive
/// warnings. They live here, not inline in the controller, so a test can ask the Npgsql provider for their SQL
/// (<c>ToQueryString</c>, no database needed): EF InMemory evaluates any LINQ in memory, so it stays green even when a query
/// stops translating or silently becomes case-sensitive on the real database.
/// </summary>
public static class ParticipantQueries
{
    /// <summary>
    /// Participants whose full name ("First Last") or preferred name contains <paramref name="search"/>, ignoring case. Both sides
    /// are lower-cased: <c>string.Contains</c> alone is a case-sensitive LIKE on Npgsql, so "jamie" never found "Jamie".
    /// </summary>
    public static IQueryable<Participant> SearchByName(IQueryable<Participant> participants, string search)
    {
        var term = search.Trim().ToLower();
        return participants.Where(p => (p.FirstName + " " + p.LastName).ToLower().Contains(term)
            || (p.PreferredName != null && p.PreferredName.ToLower().Contains(term)));
    }

    /// <summary>Shifts on or after <paramref name="today"/> that are neither cancelled nor completed: what archiving leaves in place.</summary>
    public static IQueryable<Shift> UpcomingShifts(OdipDbContext db, Guid participantId, DateOnly today) =>
        db.Shifts.Where(s => s.ParticipantId == participantId && s.ServiceDate >= today
            && s.Status != ShiftStatus.Cancelled && s.Status != ShiftStatus.Completed);

    /// <summary>Recurring patterns that are switched on and have not ended.</summary>
    public static IQueryable<ShiftPattern> LivePatterns(OdipDbContext db, Guid participantId, DateOnly today) =>
        db.ShiftPatterns.Where(sp => sp.ParticipantId == participantId && sp.IsActive
            && (sp.EffectiveTo == null || sp.EffectiveTo >= today));

    /// <summary>Bookings on trips that have not started, other than cancelled, completed or no-longer-attending ones.</summary>
    public static IQueryable<ParticipantBooking> UpcomingBookings(OdipDbContext db, Guid participantId, DateOnly today) =>
        db.ParticipantBookings.Where(b => b.ParticipantId == participantId && b.TripInstance.StartDate >= today
            && (b.BookingStatus == BookingStatus.Enquiry || b.BookingStatus == BookingStatus.Held
                || b.BookingStatus == BookingStatus.Confirmed || b.BookingStatus == BookingStatus.Waitlist));
}
