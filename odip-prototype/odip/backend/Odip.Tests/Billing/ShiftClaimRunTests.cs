using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Billing;

/// <summary>
/// The claim run: one draft shift claim for every participant in the organisation with completed, unclaimed shifts in a date range. It works from the shifts (a participant with nothing to
/// claim is not listed), lists every shift it leaves out with the reason, keeps the claims already made when one participant fails, and a second run over the same dates claims nothing.
/// The organisation is in NSW: an eight-hour weekday is $480.
/// </summary>
public class ShiftClaimRunTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 31);

    private static LedgerKit Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        return kit;
    }

    private static ShiftClaimGenerationService Engine(LedgerKit kit) => new(kit.Db, kit.Ledger, kit.Tenant);

    private static Participant Person(LedgerKit kit, string first, string last = "Tester") => kit.SeedParticipant(first: first, last: last);

    private static Shift Done(LedgerKit kit, Participant person, int day, SleepoverType night = SleepoverType.None, int start = 9, int end = 17, bool overnight = false)
    {
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, day), ShiftStatus.Completed, start, end, overnight);
        shift.NightType = night;
        kit.Db.SaveChanges();
        return shift;
    }

    /// <summary>Alex has 2 shifts, Blake 1 and Casey 3, all plain weekdays: 6 shifts and $2,880.</summary>
    private static (Participant Alex, Participant Blake, Participant Casey) ThreePeople(LedgerKit kit)
    {
        var (alex, blake, casey) = (Person(kit, "Alex"), Person(kit, "Blake"), Person(kit, "Casey"));
        Done(kit, alex, 1); Done(kit, alex, 2);
        Done(kit, blake, 5);
        Done(kit, casey, 6); Done(kit, casey, 7); Done(kit, casey, 8);
        return (alex, blake, casey);
    }

    [Fact]
    public async Task RunAsync_SeveralParticipants_MakesOneClaimEach_AndTheSummaryAddsUp()
    {
        var kit = Arrange();
        ThreePeople(kit);

        var run = await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);

        Assert.Equal(3, run.ClaimsMade);
        Assert.Equal(6, run.ShiftCount);
        Assert.Equal(2880m, run.TotalAmount);
        Assert.Equal(48m, run.Hours);
        Assert.Equal(await kit.Db.TripClaims.SumAsync(c => c.TotalAmount, Ct), run.TotalAmount);
        Assert.Equal(["Alex Tester", "Blake Tester", "Casey Tester"], run.Participants.Select(p => p.ParticipantName));
        foreach (var row in run.Participants)
        {
            var claim = await kit.Db.TripClaims.SingleAsync(c => c.Id == row.ClaimId, Ct);
            Assert.Equal(ClaimKind.Shift, claim.Kind);
            Assert.Equal(row.ClaimReference, claim.ClaimReference);
        }
        Assert.Empty(run.Skipped);
    }

    [Fact]
    public async Task RunAsync_AParticipantWithNothingToClaim_IsNotListed()
    {
        var kit = Arrange();
        var (outside, claimed, real) = (Person(kit, "Outside"), Person(kit, "Claimed"), Person(kit, "Real"));
        kit.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = kit.TenantId, ParticipantId = outside.Id, ServiceDate = new DateOnly(2026, 9, 15), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed });
        kit.SeedShiftClaim(claimed, TripClaimStatus.Draft, 480m, Done(kit, claimed, 3));
        Done(kit, real, 4);
        await kit.Db.SaveChangesAsync(Ct);
        var before = await kit.Db.TripClaims.CountAsync(Ct);

        var run = await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);

        Assert.Equal("Real Tester", Assert.Single(run.Participants).ParticipantName);
        Assert.Empty(run.LeftOut);
        Assert.Empty(run.Skipped);
        Assert.Equal(before + 1, await kit.Db.TripClaims.CountAsync(Ct));
    }

    [Fact]
    public async Task RunAsync_ASleepover_IsLeftOutWithItsReason_AndTheRestIsClaimed()
    {
        var kit = Arrange();
        var (a, b) = (Person(kit, "Alex"), Person(kit, "Blake"));
        Done(kit, a, 1);
        Done(kit, a, 2, night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);
        Done(kit, b, 5, night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);   // not 3 Oct: the clocks go forward that night, so it is 7 elapsed hours

        var run = await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);

        var row = Assert.Single(run.Participants);
        Assert.Equal("Alex Tester", row.ParticipantName);
        Assert.Equal(1, row.ShiftCount);
        Assert.Equal(1, await kit.Db.ClaimLineItems.CountAsync(l => l.TripClaimId == row.ClaimId, Ct));
        Assert.Equal(["Alex Tester", "Blake Tester"], run.LeftOut.Select(l => l.ParticipantName));
        Assert.All(run.LeftOut, l => Assert.Equal("No catalogue sleepover item covers this date.", l.Reason));   // the kit catalogue has no sleepover item
        Assert.Equal(0, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == b.Id, Ct));
        Assert.Empty(run.Skipped);   // Blake is the NothingClaimable path: left out, not failed
    }

    [Fact]
    public async Task RunAsync_AnActiveNightShift_IsClaimedAndFlagsNothing_ItIsSplitByBandLikeAnyOther()
    {
        var kit = Arrange();
        var a = Person(kit, "Alex");
        Done(kit, a, 6, night: SleepoverType.ActiveNight, start: 14, end: 22);   // 2 h of it are evening: two lines, none flagged (the kit has no night row, so no overnight shift)

        var run = await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);

        Assert.Empty(run.Flagged);
        Assert.Equal(a.Id, Assert.Single(run.Participants).ParticipantId);
    }

    /// <summary>For one participant it adds a claim of theirs to the shared context, then fails: what a failed save leaves behind in the change tracker.</summary>
    private sealed class FailsFor(LedgerKit kit, Guid failing, Exception error) : ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant)
    {
        public override Task<ShiftClaimGenerated> GenerateAsync(Guid participantId, DateOnly from, DateOnly to, CancellationToken ct = default)
        {
            if (participantId != failing) return base.GenerateAsync(participantId, from, to, ct);
            kit.Db.TripClaims.Add(new TripClaim { Id = Guid.NewGuid(), TenantId = kit.TenantId, Kind = ClaimKind.Shift, ParticipantId = participantId, Status = TripClaimStatus.Draft, ClaimReference = "TC-HALF-MADE" });
            throw error;
        }
    }

    [Fact]
    public async Task RunAsync_OneParticipantFails_TheOthersAreClaimed_AndNothingOfTheFailureIsSaved()
    {
        var kit = Arrange();
        var (alex, blake, casey) = ThreePeople(kit);

        var run = await new FailsFor(kit, blake.Id, new DbUpdateException("boom")).RunAsync(kit.TenantId, From, To, Ct);

        Assert.Equal(2, run.ClaimsMade);
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == alex.Id, Ct));
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == casey.Id, Ct));
        Assert.Equal(0, await kit.Db.TripClaims.CountAsync(c => c.ParticipantId == blake.Id, Ct));   // red without ChangeTracker.Clear(): Casey's save also saved Blake's half-made claim
        Assert.Equal(1, await kit.Db.Shifts.CountAsync(s => s.ParticipantId == blake.Id && !kit.Db.ClaimLineItems.Any(l => l.ShiftId == s.Id), Ct));
        var skipped = Assert.Single(run.Skipped);
        Assert.Equal("Blake Tester", skipped.ParticipantName);
        Assert.True(skipped.Failed);
        Assert.Equal(ShiftClaimGenerationService.FailedReason, skipped.Reason);
    }

    [Fact]
    public async Task RunAsync_AnExceptionOfAnyOtherKind_IsMarkedFailedWithThePlainSentence_NeverItsOwnMessage()
    {
        var kit = Arrange();
        var (_, blake, _) = ThreePeople(kit);

        var run = await new FailsFor(kit, blake.Id, new InvalidOperationException("Npgsql: relation \"x\" does not exist")).RunAsync(kit.TenantId, From, To, Ct);

        var skipped = Assert.Single(run.Skipped);
        Assert.True(skipped.Failed);
        Assert.Equal(ShiftClaimGenerationService.FailedReason, skipped.Reason);
        Assert.Equal(2, run.ClaimsMade);
    }

    [Fact]
    public async Task RunAsync_ABusyParticipant_IsMarkedFailedWithTheBusySentence()
    {
        var kit = Arrange();
        var (_, blake, _) = ThreePeople(kit);

        var run = await new FailsFor(kit, blake.Id, new RosterBusyException()).RunAsync(kit.TenantId, From, To, Ct);

        var skipped = Assert.Single(run.Skipped);
        Assert.True(skipped.Failed);
        Assert.Equal(ShiftClaimGenerationService.BusyReason, skipped.Reason);
    }

    [Fact]
    public async Task RunAsync_ASecondRunOverTheSamePeriod_ClaimsNothing()
    {
        var kit = Arrange();
        ThreePeople(kit);
        await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);
        var (claims, lines) = (await kit.Db.TripClaims.CountAsync(Ct), await kit.Db.ClaimLineItems.CountAsync(Ct));

        var second = await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);

        Assert.Equal(0, second.ClaimsMade);
        Assert.Empty(second.Participants);
        Assert.Equal(claims, await kit.Db.TripClaims.CountAsync(Ct));
        Assert.Equal(lines, await kit.Db.ClaimLineItems.CountAsync(Ct));
    }

    [Fact]
    public async Task RunAsync_TwoOrganisations_ClaimsOnlyTheCallersOwn_AsTheTenantAndAsASuperAdminViewingIt()
    {
        var name = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(TenantA, name);
        a.SeedProvider("NSW"); a.SeedCommunityAccessCatalogue();
        var b = LedgerKit.Create(TenantB, name);
        b.SeedProvider("NSW");
        var (ofA, ofB) = (Person(a, "Alex"), b.SeedParticipant(first: "Bianca", last: "Other"));
        Done(a, ofA, 1);
        var bShift = b.SeedShift(ofB, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var asTenant = await Engine(a).PreviewRunAsync(TenantA, From, To, Ct);
        var run = await Engine(a).RunAsync(TenantA, From, To, Ct);

        Assert.Equal("Alex Tester", Assert.Single(run.Participants).ParticipantName);
        Assert.Equal(asTenant.ShiftCount, run.ShiftCount);
        Assert.DoesNotContain("Bianca", System.Text.Json.JsonSerializer.Serialize(run) + System.Text.Json.JsonSerializer.Serialize(asTenant));
        Assert.False(await b.Db.ClaimLineItems.AnyAsync(l => l.ShiftId == bShift.Id, Ct));

        // A SuperAdmin viewing A has no tenant filter, so the explicit TenantId predicates are the only guard.
        var admin = TestDb.Create(name, viewingAs: TenantA);
        Done(a, Person(a, "Alina"), 9);
        var viewing = new ShiftClaimGenerationService(admin);
        var preview = await viewing.PreviewRunAsync(TenantA, From, To, Ct);
        var second = await viewing.RunAsync(TenantA, From, To, Ct);
        Assert.Equal("Alina Tester", Assert.Single(second.Participants).ParticipantName);
        Assert.Equal(preview.ShiftCount, second.ShiftCount);
        Assert.DoesNotContain("Bianca", System.Text.Json.JsonSerializer.Serialize(second) + System.Text.Json.JsonSerializer.Serialize(preview));
        Assert.False(await b.Db.ClaimLineItems.AnyAsync(l => l.ShiftId == bShift.Id, Ct));
        Assert.Empty(await admin.TripClaims.Where(c => c.ParticipantId == ofB.Id).ToListAsync(Ct));
    }

    [Fact]
    public async Task PreviewRunAsync_MakesNothing_AndMatchesTheRun()
    {
        var kit = Arrange();
        ThreePeople(kit);

        var preview = await Engine(kit).PreviewRunAsync(kit.TenantId, From, To, Ct);

        Assert.Equal(0, await kit.Db.TripClaims.CountAsync(Ct));
        Assert.Equal(0, preview.ClaimsMade);
        Assert.All(preview.Participants, p => Assert.Null(p.ClaimId));
        var run = await Engine(kit).RunAsync(kit.TenantId, From, To, Ct);
        Assert.Equal((run.ShiftCount, run.Hours, run.TotalAmount), (preview.ShiftCount, preview.Hours, preview.TotalAmount));
        Assert.Equal(run.Participants.Select(p => (p.ParticipantName, p.ShiftCount, p.TotalAmount)), preview.Participants.Select(p => (p.ParticipantName, p.ShiftCount, p.TotalAmount)));
    }

    [Fact]
    public async Task PreviewRunAsync_CarriesTheBudgetEffect_AsOneBlockForTheWholeRun()
    {
        var kit = Arrange();
        var (alex, blake, _) = ThreePeople(kit);
        kit.SeedPlan(alex, Core(PlanType.PlanManaged, Q(4, 100000m)));
        kit.SeedPlan(blake, Core(PlanType.PlanManaged, Q(4, 100000m)));

        var preview = await Engine(kit).PreviewRunAsync(kit.TenantId, From, To, Ct);

        Assert.NotNull(preview.Budget);
        Assert.Null((await Engine(kit).RunAsync(kit.TenantId, From, To, Ct)).Budget);   // the run itself only makes the claims
    }

    [Fact]
    public async Task GenerateAsync_NothingClaimable_IsATypedRefusal_WithTheSameSentence()
    {
        var kit = Arrange();
        var person = Person(kit, "Alex");
        Done(kit, person, 2, night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);

        var refusal = await Assert.ThrowsAsync<NothingClaimableException>(() => Engine(kit).GenerateAsync(person.Id, From, To, Ct));

        Assert.Equal("Nothing in this date range could be claimed: 1 completed, unclaimed shift was left out. No catalogue sleepover item covers this date.", refusal.Message);
        Assert.Single(refusal.LeftOut);
    }

    [Fact]
    public async Task RunAsync_WithoutProviderSettings_RefusesTheWholeRun()
    {
        var kit = LedgerKit.Create();
        kit.SeedCommunityAccessCatalogue();
        Done(kit, Person(kit, "Alex"), 1);

        var refusal = await Assert.ThrowsAsync<InvalidOperationException>(() => Engine(kit).RunAsync(kit.TenantId, From, To, Ct));

        Assert.Contains("Provider settings are not configured", refusal.Message);
        Assert.Equal(0, await kit.Db.TripClaims.CountAsync(Ct));
    }
}
