using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// The short-notice cancellation claim: a cancelled shift is offered when the participant cancelled less than 7 calendar days before it, counted in the organisation's zone, and the item allows it.
/// October 2026 is AEDT (UTC+11), so 00:30 on the 14th in Sydney is 13:30 UTC on the 13th: a check that counts UTC days would get the boundary wrong.
/// Tests marked D_ are the decisive ones the reviewers mutate.
/// </summary>
public class ShiftCancellationClaimTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Service = new(2026, 10, 20);     // a Tuesday
    private static readonly DateOnly Now = new(2026, 10, 22);         // after the service dates used below
    private static readonly DateTime SixDaysBefore = new(2026, 10, 16, 1, 0, 0, DateTimeKind.Utc);

    private static (LedgerKit Kit, ShiftClaimGenerationService Engine) NewKit(CatalogueClaimFlag? flag = CatalogueClaimFlag.Yes)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = flag;   // the kit's rows carry no flag
        kit.Db.SaveChanges();
        return (kit, new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant));
    }

    private static Shift Cancelled(LedgerKit kit, Participant person, DateOnly date, DateTime? cancelledAtUtc)
    {
        var shift = kit.SeedShift(person, date, ShiftStatus.Cancelled);
        shift.CancelledAt = cancelledAtUtc;
        kit.Db.SaveChanges();
        return shift;
    }

    private static SupportCatalogueItem AddTwin(LedgerKit kit, SupportCatalogueItem standard, string version = "2026-27")
    {
        var group = kit.SeedGroup("GRP_CA_" + version, "Cancellation items", 4);   // its own group, so the rate rows of community access stay as they are
        var twin = new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = standard.ItemNumber + "_CA", Description = "Cancellation", DayType = standard.DayType, PriceLimit_NSW = standard.PriceLimit_NSW,
            CatalogueVersion = version, EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true, PaceSupportCategoryNumber = 4, SupportCategoryNumber = 4,
        };
        kit.Db.SupportCatalogueItems.Add(twin);
        kit.Db.SaveChanges();
        return twin;
    }

    [Fact]
    public async Task D_TheBoundary_CountsDaysInTheOrganisationsZone_NotUtc()
    {
        var (kit, engine) = NewKit();
        using var _ = kit;
        var inside = kit.SeedParticipant(first: "Ines", last: "Inside");
        var outside = kit.SeedParticipant(first: "Olga", last: "Outside");
        // 00:30 on 14 Oct in Sydney = 13:30 UTC on the 13th: six days before the 20th, so offered. A UTC-day count would say seven and leave it out.
        var a = Cancelled(kit, inside, Service, new DateTime(2026, 10, 13, 13, 30, 0, DateTimeKind.Utc));
        // 23:30 on 13 Oct in Sydney = 12:30 UTC on the 13th: seven days before, so left out.
        var b = Cancelled(kit, outside, Service, new DateTime(2026, 10, 13, 12, 30, 0, DateTimeKind.Utc));

        var result = await engine.CancellationCandidatesAsync(kit.TenantId, Now, Ct);

        Assert.Equal([a.Id], result.Shifts.Select(s => s.ShiftId));
        var left = Assert.Single(result.LeftOut);
        Assert.Equal(b.Id, left.ShiftId);
        Assert.Contains("Cancelled 7 days ahead", left.Reason);
        Assert.Equal("Olga Outside", left.ParticipantName);
    }

    [Theory]
    [InlineData(CatalogueClaimFlag.No)]
    [InlineData(null)]
    public async Task D_AnItemThatDoesNotAllowCancellation_IsLeftOut_WithTheSentence(CatalogueClaimFlag? flag)
    {
        var (kit, engine) = NewKit(flag);
        using var _ = kit;
        var shift = Cancelled(kit, kit.SeedParticipant(), Service, SixDaysBefore);

        var result = await engine.CancellationCandidatesAsync(kit.TenantId, Now, Ct);

        Assert.Empty(result.Shifts);
        var left = Assert.Single(result.LeftOut);
        Assert.Equal(shift.Id, left.ShiftId);
        Assert.Equal(ShortNoticeCancellationRule.NotAllowedSentence(kit.Item(ClaimDayType.Weekday).ItemNumber), left.Reason);
    }

    [Fact]
    public async Task D_AnItemWithACancellationTwin_IsOffered_AndTheLineStoresTheStandardCode()
    {
        var (kit, engine) = NewKit(CatalogueClaimFlag.No);
        using var _ = kit;
        var standard = kit.Item(ClaimDayType.Weekday);
        AddTwin(kit, standard);
        var shift = Cancelled(kit, kit.SeedParticipant(), Service, SixDaysBefore);

        var offered = await engine.CancellationCandidatesAsync(kit.TenantId, Now, Ct);
        var made = await engine.GenerateCancellationAsync(shift.Id, "NSDH", Now, Ct);

        Assert.Equal([shift.Id], offered.Shifts.Select(s => s.ShiftId));
        var line = await kit.Db.ClaimLineItems.SingleAsync(l => l.TripClaimId == made.Claim.Id, Ct);
        Assert.Equal(standard.ItemNumber, line.SupportItemCode);   // the file writer swaps in the twin; the claim keeps the standard code
    }

    [Fact]
    public async Task TheTwinSelection_IsTheNewestValidVersion_TheOneTheFileWriterAndTheSendCheckUse()
    {
        var (kit, _) = NewKit(CatalogueClaimFlag.No);
        using var _ = kit;
        var standard = kit.Item(ClaimDayType.Weekday);
        var old = AddTwin(kit, standard, "2026-27a");
        old.EffectiveTo = new DateOnly(2026, 10, 1);
        var newest = AddTwin(kit, standard, "2026-27b");
        kit.Db.SaveChanges();
        var catalogue = await kit.Db.SupportCatalogueItems.AsNoTracking().ToListAsync(Ct);

        var picked = BprCsvService.CancellationTwin(catalogue, standard.ItemNumber, Service);

        Assert.Equal(newest.Id, picked!.Id);
    }

    [Fact]
    public async Task D_AShiftAlreadyOnAClaim_IsNotOfferedAgain_UntilTheNdiaRejectsIt()
    {
        var (kit, engine) = NewKit();
        using var _ = kit;
        var shift = Cancelled(kit, kit.SeedParticipant(), Service, SixDaysBefore);

        var first = await engine.GenerateCancellationAsync(shift.Id, "NSDF", Now, Ct);
        var again = await Assert.ThrowsAsync<InvalidOperationException>(() => engine.GenerateCancellationAsync(shift.Id, "NSDF", Now, Ct));
        var offered = await engine.CancellationCandidatesAsync(kit.TenantId, Now, Ct);

        Assert.Contains(first.Claim.ClaimReference, again.Message);
        Assert.Empty(offered.Shifts);
        Assert.Empty(offered.LeftOut);

        // S4: the NDIA rejected the first CANC line, so the shift is free and a second claim saves.
        foreach (var l in kit.Db.ClaimLineItems.Where(l => l.TripClaimId == first.Claim.Id)) l.Status = ClaimLineItemStatus.Rejected;
        await kit.Db.SaveChangesAsync(Ct);
        var second = await engine.GenerateCancellationAsync(shift.Id, "NSDF", Now, Ct);

        Assert.NotEqual(first.Claim.Id, second.Claim.Id);
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(c => c.Id == second.Claim.Id, Ct));
    }

    [Fact]
    public async Task TheClaim_HasCancellationLines_WithTheReason_AndThePriceOfTheRosteredHours_AndNoTravel()
    {
        var (kit, engine) = NewKit();
        using var _ = kit;
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(1, 100000m)));
        var shift = Cancelled(kit, person, Service, SixDaysBefore);

        var preview = await engine.PreviewCancellationAsync(shift.Id, Now, Ct);
        var made = await engine.GenerateCancellationAsync(shift.Id, " nsdh ", Now, Ct);

        var lines = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == made.Claim.Id).ToListAsync(Ct);
        Assert.NotEmpty(lines);
        Assert.All(lines, l => { Assert.Equal(ClaimType.Cancellation, l.ClaimType); Assert.Equal("NSDH", l.CancellationReason); Assert.Equal(ClaimLineItemStatus.Draft, l.Status); });
        Assert.Equal(TripClaimStatus.Draft, made.Claim.Status);
        Assert.Equal(8m, lines.Sum(l => l.Hours));                       // the rostered 09:00 to 17:00
        Assert.Equal(480m, made.Claim.TotalAmount);                       // 8 h at the NSW weekday limit of $60
        Assert.Equal(preview.TotalAmount, made.Claim.TotalAmount);
        Assert.All(preview.LineItems, l => Assert.Equal(ClaimType.Cancellation, l.ClaimType));
        Assert.DoesNotContain(preview.LineItems, l => l.DayTypeLabel.Contains("travel", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(preview.Budget);
    }

    [Fact]
    public async Task AShiftWithoutACancelTime_OrOnTheDayItself_IsLeftOut_WithAReasonThatSaysWhat()
    {
        var (kit, engine) = NewKit();
        using var _ = kit;
        var legacy = Cancelled(kit, kit.SeedParticipant(first: "Old", last: "Cancel"), Service, cancelledAtUtc: null);
        var sameDay = Cancelled(kit, kit.SeedParticipant(first: "Live", last: "Shift"), Service, SixDaysBefore);

        var result = await engine.CancellationCandidatesAsync(kit.TenantId, Service, Ct);   // "today" is the service date itself

        Assert.Empty(result.Shifts);
        Assert.Contains("cancelled before Bunya Support kept cancel times", result.LeftOut.Single(l => l.ShiftId == legacy.Id).Reason);
        Assert.Contains("You can claim this from 21 Oct 2026", result.LeftOut.Single(l => l.ShiftId == sameDay.Id).Reason);
    }

    [Fact]
    public async Task OnlyACancelledShift_CanBePreviewedOrClaimed_AndTheReasonIsChecked()
    {
        var (kit, engine) = NewKit();
        using var _ = kit;
        var published = kit.SeedShift(kit.SeedParticipant(), Service, ShiftStatus.Published);

        var notCancelled = await Assert.ThrowsAsync<InvalidOperationException>(() => engine.PreviewCancellationAsync(published.Id, Now, Ct));
        var missing = await Assert.ThrowsAsync<InvalidOperationException>(() => engine.GenerateCancellationAsync(Guid.NewGuid(), "NSDH", Now, Ct));
        var badReason = await Assert.ThrowsAsync<InvalidOperationException>(() => engine.GenerateCancellationAsync(published.Id, "XYZ", Now, Ct));

        Assert.Equal("This shift isn't cancelled.", notCancelled.Message);
        Assert.Equal("Shift not found.", missing.Message);
        Assert.Equal("Choose why the participant cancelled: health, family, transport or other.", badReason.Message);
    }

    [Fact]
    public async Task ADraftCancel_IsNotOffered_ButAPublishedCancelIs()
    {
        var (kit, engine) = NewKit();
        using var _ = kit;
        Cancelled(kit, kit.SeedParticipant(first: "Dee", last: "Draft"), Service, cancelledAtUtc: null);   // a Draft cancel is never stamped
        var published = Cancelled(kit, kit.SeedParticipant(first: "Pat", last: "Published"), Service, SixDaysBefore);

        var result = await engine.CancellationCandidatesAsync(kit.TenantId, Now, Ct);

        Assert.Equal([published.Id], result.Shifts.Select(s => s.ShiftId));
    }
}
