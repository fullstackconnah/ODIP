using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Claims;

/// <summary>
/// A participant's day is claimed once: the same participant on the same date is on a shift claim or a trip claim, never both. Each engine leaves out what the other already holds
/// (the trip engine the whole participant, the shift engine the shift), names that claim, and frees the day again once the claim is Rejected or Cancelled.
/// </summary>
public class ShiftTripClashGuardTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static LedgerKit NewKit()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        return kit;
    }

    /// <summary>A completed one-day trip on <see cref="LedgerKit.Today"/> that the participant is confirmed on, with a claim of the given status on it.</summary>
    private static TripClaim TripClaimOnToday(LedgerKit kit, Participant person, TripClaimStatus status, string reference)
    {
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip");
        var booking = kit.SeedBooking(trip, person);
        var (claim, _) = kit.SeedTripClaim(trip, booking, status, 400m, Today);
        claim.ClaimReference = reference;
        kit.Db.SaveChanges();
        return claim;
    }

    // ── Shift engine: a shift on a day that is on a live trip claim ─────────

    [Fact]
    public async Task ShiftPreviewAndRun_LeaveOutTheShiftOnATripClaimDay_AndNameThatClaim()
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        TripClaimOnToday(kit, person, TripClaimStatus.Draft, "TC-TRIP-1");
        var onTripDay = kit.SeedShift(person, Today, ShiftStatus.Completed);
        var nextDay = kit.SeedShift(person, Today.AddDays(1), ShiftStatus.Completed);
        var service = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var preview = await service.PreviewAsync(person.Id, Today, Today.AddDays(1), Ct);
        Assert.Equal(new[] { nextDay.Id }, preview.LineItems.Select(l => l.ShiftId).Distinct());
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(onTripDay.Id, left.ShiftId);
        Assert.Contains("TC-TRIP-1", left.Reason);

        var run = await service.GenerateAsync(person.Id, Today, Today.AddDays(1), Ct);
        Assert.Equal(1, run.ShiftCount);
        Assert.Equal(onTripDay.Id, Assert.Single(run.LeftOut).ShiftId);
    }

    [Fact]
    public async Task ShiftRun_RefusesWhenEveryShiftIsOnATripClaimDay_NamingTheClaim()
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        TripClaimOnToday(kit, person, TripClaimStatus.Submitted, "TC-TRIP-2");
        kit.SeedShift(person, Today, ShiftStatus.Completed);

        var error = await Assert.ThrowsAsync<NothingClaimableException>(() =>
            new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).GenerateAsync(person.Id, Today, Today, Ct));

        Assert.Contains("TC-TRIP-2", error.Message);
    }

    [Theory]
    [InlineData(TripClaimStatus.Rejected)]
    [InlineData(TripClaimStatus.Cancelled)]
    public async Task ShiftPreview_ClaimsTheShiftAgain_OnceTheTripClaimIsRejectedOrCancelled(TripClaimStatus status)
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        TripClaimOnToday(kit, person, status, "TC-TRIP-3");
        kit.SeedShift(person, Today, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).PreviewAsync(person.Id, Today, Today, Ct);

        Assert.Single(preview.LineItems);
        Assert.Empty(preview.LeftOut);
    }

    [Fact]
    public async Task ShiftPreview_IgnoresATripClaimOfAnotherParticipant()
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        var other = kit.SeedParticipant(first: "Sam", last: "Other");
        TripClaimOnToday(kit, other, TripClaimStatus.Draft, "TC-TRIP-4");
        kit.SeedShift(person, Today, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).PreviewAsync(person.Id, Today, Today, Ct);

        Assert.Single(preview.LineItems);
        Assert.Empty(preview.LeftOut);
    }

    // ── Trip engine: a participant with a live shift claim on a trip day ────

    private static (TripInstance Trip, Participant Clashing, Participant Clear) TripWithOneClashingParticipant(LedgerKit kit, TripClaimStatus shiftClaimStatus)
    {
        var clashing = kit.SeedParticipant(first: "Ann", last: "Clash");
        var clear = kit.SeedParticipant(first: "Bo", last: "Clear");
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        kit.SeedBooking(trip, clashing);
        kit.SeedBooking(trip, clear);
        var shift = kit.SeedShift(clashing, Today, ShiftStatus.Completed);
        kit.SeedShiftClaim(clashing, shiftClaimStatus, 400m, shift, reference: "TC-SHIFT-1");
        return (trip, clashing, clear);
    }

    [Fact]
    public async Task TripPreviewAndGenerate_LeaveOutTheWholeParticipantWithAShiftClaimThatDay_AndNameTheClaimAndDate()
    {
        using var kit = NewKit();
        var (trip, clashing, clear) = TripWithOneClashingParticipant(kit, TripClaimStatus.Draft);
        var service = new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var preview = await service.PreviewClaimAsync(trip.Id, null, Ct);
        Assert.All(preview.LineItems, l => Assert.Equal(clear.FullName, l.ParticipantName));
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(clashing.Id, left.ParticipantId);
        Assert.Contains("TC-SHIFT-1", left.Reason);
        Assert.Contains("4 Oct 2026", left.Reason);

        var claim = await service.GenerateDraftClaimAsync(trip.Id, null, Ct);
        var bookingOwners = kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).Select(l => l.ParticipantBooking!.ParticipantId).Distinct().ToList();
        Assert.Equal(new[] { clear.Id }, bookingOwners);
    }

    [Fact]
    public async Task TripGenerate_RefusesWhenEveryParticipantClashes_SayingWhy()
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        kit.SeedBooking(trip, person);
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 400m, kit.SeedShift(person, Today, ShiftStatus.Completed), reference: "TC-SHIFT-2");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).GenerateDraftClaimAsync(trip.Id, null, Ct));

        Assert.Contains("TC-SHIFT-2", error.Message);
    }

    [Theory]
    [InlineData(TripClaimStatus.Rejected)]
    [InlineData(TripClaimStatus.Cancelled)]
    public async Task TripPreview_IncludesTheParticipantAgain_OnceTheShiftClaimIsRejectedOrCancelled(TripClaimStatus status)
    {
        using var kit = NewKit();
        var (trip, _, _) = TripWithOneClashingParticipant(kit, status);

        var preview = await new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).PreviewClaimAsync(trip.Id, null, Ct);

        Assert.Empty(preview.LeftOut);
        Assert.Equal(2, preview.LineItems.Select(l => l.ParticipantName).Distinct().Count());
    }

    [Fact]
    public async Task TripPreview_IgnoresAShiftClaimOnADayOutsideTheTrip()
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        kit.SeedBooking(trip, person);
        kit.SeedShiftClaim(person, TripClaimStatus.Draft, 400m, kit.SeedShift(person, Today.AddDays(1), ShiftStatus.Completed));

        var preview = await new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).PreviewClaimAsync(trip.Id, null, Ct);

        Assert.Empty(preview.LeftOut);
        Assert.NotEmpty(preview.LineItems);
    }
}
