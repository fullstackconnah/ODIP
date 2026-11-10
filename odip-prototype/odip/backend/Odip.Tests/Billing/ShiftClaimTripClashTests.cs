using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// A shift on a day the participant is on a live trip claim is left out and names that claim. The left-out row already shows the shift's date, so a clash on that same day
/// does not repeat it; the after-midnight part of an overnight shift is dated the next day, and that date is news.
/// </summary>
public class ShiftClaimTripClashTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Sat = new(2026, 10, 10);   // a Saturday: 20:00 to 02:00 is priced on Saturday and again on Sunday

    private static async Task<(string Reason, string TripClaimReference)> LeftOutAsync(DateOnly tripClaimDay)
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var overnight = kit.SeedShift(person, Sat, ShiftStatus.Completed, 20, 2, endsNextDay: true);
        kit.SeedShift(person, Sat.AddDays(3), ShiftStatus.Completed);   // a clean shift, so the run still makes a claim
        var trip = kit.SeedTrip(tripClaimDay, 1);
        var (tripClaim, _) = kit.SeedTripClaim(trip, kit.SeedBooking(trip, person), TripClaimStatus.Draft, 400m, tripClaimDay);
        var engine = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var made = await engine.GenerateAsync(person.Id, Sat, Sat.AddDays(3), Ct);

        return (Assert.Single(made.LeftOut, l => l.ShiftId == overnight.Id).Reason, tripClaim.ClaimReference);
    }

    [Fact]
    public async Task AClashOnTheShiftsOwnDay_DoesNotRepeatTheDate()
    {
        var (reason, reference) = await LeftOutAsync(Sat);

        Assert.Equal($"It is already on trip claim {reference}. Reject or cancel that claim to claim this shift.", reason);
    }

    [Fact]
    public async Task AClashOnTheAfterMidnightDay_NamesThatDate()
    {
        var (reason, reference) = await LeftOutAsync(Sat.AddDays(1));

        Assert.Equal($"11/10/2026 is already on trip claim {reference}. Reject or cancel that claim to claim this shift.", reason);
    }
}
