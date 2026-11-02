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
    private static TripClaim TripClaimOnToday(LedgerKit kit, Participant person, TripClaimStatus status, string reference, int dayOffset = 0)
    {
        var day = Today.AddDays(dayOffset);
        var trip = kit.SeedTrip(day, 1, TripStatus.Completed, "Today trip");
        var booking = kit.SeedBooking(trip, person);
        var (claim, _) = kit.SeedTripClaim(trip, booking, status, 400m, day);
        claim.ClaimReference = reference;
        kit.Db.SaveChanges();
        return claim;
    }

    // ── Shift engine: a shift on a day that is on a live trip claim ─────────

    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Paid)]
    public async Task ShiftPreviewAndRun_LeaveOutTheShiftOnATripClaimDay_AndNameThatClaim(TripClaimStatus status)
    {
        using var kit = NewKit();
        var person = kit.SeedParticipant();
        TripClaimOnToday(kit, person, status, "TC-TRIP-1");
        var onTripDay = kit.SeedShift(person, Today, ShiftStatus.Completed);
        var nextDay = kit.SeedShift(person, Today.AddDays(1), ShiftStatus.Completed);
        var service = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var preview = await service.PreviewAsync(person.Id, Today, Today.AddDays(1), Ct);
        Assert.Equal(new[] { nextDay.Id }, preview.LineItems.Select(l => l.ShiftId).Distinct());
        var left = Assert.Single(preview.LeftOut);
        Assert.Equal(onTripDay.Id, left.ShiftId);
        Assert.Contains("TC-TRIP-1", left.Reason);
        Assert.StartsWith(Today.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture), left.Reason);   // the row's lead already names the participant

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

    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Paid)]
    public async Task TripPreviewAndGenerate_LeaveOutTheWholeParticipantWithAShiftClaimThatDay_AndNameTheClaimAndDate(TripClaimStatus status)
    {
        using var kit = NewKit();
        var (trip, clashing, clear) = TripWithOneClashingParticipant(kit, status);
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

    // ── Overnight shifts: the after-midnight part is dated the next day ─────

    /// <summary>The community access catalogue has no night row of its own here, so an after-midnight part needs one.</summary>
    private static LedgerKit NewOvernightKit()
    {
        var kit = NewKit();
        var weekday = kit.Item(ClaimDayType.Weekday);
        kit.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = weekday.ActivityGroupId, ItemNumber = "04_Night_STD", Description = "Community access night", DayType = ClaimDayType.WeekdayNight, PriceLimit_NSW = 60m, PriceLimit_VIC = 50m,
            CatalogueVersion = "2026-27", EffectiveFrom = weekday.EffectiveFrom, IsActive = true, PaceSupportCategoryNumber = 4, SupportCategoryNumber = 4,
        });
        kit.Db.SaveChanges();
        return kit;
    }

    private static Shift OvernightOnToday(LedgerKit kit, Participant person) => kit.SeedShift(person, Today, ShiftStatus.Completed, startHour: 20, endHour: 4, endsNextDay: true);

    [Fact]
    public async Task ShiftPreviewAndRun_LeaveOutAnOvernightShiftWhoseNextDayIsOnATripClaim_NamingTheClaimAndThatDay()
    {
        using var kit = NewOvernightKit();
        var person = kit.SeedParticipant();
        TripClaimOnToday(kit, person, TripClaimStatus.Draft, "TC-TRIP-5", dayOffset: 1);
        OvernightOnToday(kit, person);
        var service = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        // every shift is left out, so both the preview and the run refuse, naming the claim and the next day
        foreach (var call in new Func<Task>[] { () => service.PreviewAsync(person.Id, Today, Today, Ct), () => service.GenerateAsync(person.Id, Today, Today, Ct) })
        {
            var error = await Assert.ThrowsAsync<NothingClaimableException>(call);
            Assert.Contains("TC-TRIP-5", error.Message);
            Assert.Contains(Today.AddDays(1).ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture), error.Message);
        }
    }

    [Fact]
    public async Task TripGenerate_LeavesOutTheParticipant_WhoseOvernightShiftClaimRunsIntoTheTripDay()
    {
        using var kit = NewOvernightKit();
        var person = kit.SeedParticipant();
        OvernightOnToday(kit, person);
        await new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).GenerateAsync(person.Id, Today, Today, Ct);
        var trip = kit.SeedTrip(Today.AddDays(1), 1, TripStatus.Completed, "Next day trip", activeHours: 8m);
        kit.SeedBooking(trip, person);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).GenerateDraftClaimAsync(trip.Id, null, Ct));

        Assert.Contains("shift claim", error.Message);
    }

    [Fact]
    public async Task ShiftPreview_IgnoresATripClaimOfAnotherOrganisationOnTheSameDate()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = LedgerKit.Create(LedgerKit.TenantA, database);
        mine.SeedProvider("NSW");
        mine.EnsureCommunityAccessCatalogue();
        using var theirs = LedgerKit.Create(LedgerKit.TenantB, database);
        theirs.EnsureCommunityAccessCatalogue();
        TripClaimOnToday(theirs, theirs.SeedParticipant(), TripClaimStatus.Draft, "TC-THEIRS");
        var person = mine.SeedParticipant();
        mine.SeedShift(person, Today, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(mine.Db, mine.Ledger, mine.Tenant).PreviewAsync(person.Id, Today, Today, Ct);

        Assert.Single(preview.LineItems);
        Assert.Empty(preview.LeftOut);
    }
}
