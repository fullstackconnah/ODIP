using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// "Claim again": a rejected (or cancelled) shift claim is deleted and its shifts are claimed again in one new draft claim. Money rules first: only a Rejected or Cancelled claim goes, a claim with
/// anything paid never goes, the new claim is priced BEFORE anything is deleted (a refusal deletes nothing), and a line changed to a cancellation by hand stays a cancellation.
/// Tests marked D_ are the decisive ones the reviewers mutate. The rollback after the delete and the races are PostgreSQL-only (ClaimAgainPostgresTests).
/// </summary>
public class ShiftClaimAgainTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day1 = new(2026, 10, 20);   // a Tuesday
    private static readonly DateOnly Now = new(2026, 10, 30);

    private static async Task<(LedgerKit Kit, ShiftClaimGenerationService Engine, TripClaim Old, Participant Person, List<Shift> Shifts)> RejectedAsync(int shifts = 3, TripClaimStatus status = TripClaimStatus.Rejected)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        foreach (var item in kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
        kit.Db.SaveChanges();
        var person = kit.SeedParticipant();
        var list = Enumerable.Range(0, shifts).Select(i => kit.SeedShift(person, Day1.AddDays(i), ShiftStatus.Completed)).ToList();
        var engine = new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);
        var old = (await engine.GenerateAsync(person.Id, Day1, Day1.AddDays(shifts - 1), Ct)).Claim;
        // What the NDIA's "Mark as Rejected" leaves: the header moves, the lines stay Submitted.
        old.Status = status;
        foreach (var l in kit.Db.ClaimLineItems.Where(l => l.TripClaimId == old.Id)) l.Status = ClaimLineItemStatus.Submitted;
        kit.Db.SaveChanges();
        return (kit, engine, old, person, list);
    }

    private static async Task<bool> StillThere(LedgerKit kit, TripClaim old) =>
        await kit.Db.TripClaims.AnyAsync(c => c.Id == old.Id, Ct) && await kit.Db.ClaimLineItems.CountAsync(l => l.TripClaimId == old.Id, Ct) > 0;

    public static IEnumerable<object[]> OtherStatuses() =>
        Enum.GetValues<TripClaimStatus>().Where(s => s is not (TripClaimStatus.Rejected or TripClaimStatus.Cancelled)).Select(s => new object[] { s });

    [Theory]
    [MemberData(nameof(OtherStatuses))]
    public async Task D_OnlyARejectedOrCancelledClaimCanBeClaimedAgain_EveryOtherStatusIsRefused_AndNothingIsDeleted(TripClaimStatus status)
    {
        var (kit, engine, old, _, _) = await RejectedAsync(2, status);
        using var _ = kit;

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));
        var preview = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.PreviewClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Equal("Only a rejected claim can be claimed again.", refused.Message);
        Assert.Equal(refused.Message, preview.Message);
        Assert.True(await StillThere(kit, old));
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(Ct));
    }

    [Fact]
    public async Task ATripClaim_IsRefused()
    {
        var (kit, engine, old, _, _) = await RejectedAsync(1);
        using var _ = kit;
        old.Kind = ClaimKind.Trip;
        kit.Db.SaveChanges();

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Equal("Only a shift claim can be claimed again.", refused.Message);
        Assert.True(await StillThere(kit, old));
    }

    [Fact]
    public async Task ARejectedClaimWithThreeCompletedShifts_IsReplacedByOneNewDraftClaim_ForTheSameShifts()
    {
        var (kit, engine, old, person, shifts) = await RejectedAsync(3);
        using var _ = kit;
        var oldReference = old.ClaimReference;
        var oldTotal = old.TotalAmount;

        var made = await engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        Assert.False(await kit.Db.TripClaims.AnyAsync(c => c.Id == old.Id, Ct));
        Assert.Equal(0, await kit.Db.ClaimLineItems.CountAsync(l => l.TripClaimId == old.Id, Ct));
        var claim = await kit.Db.TripClaims.AsNoTracking().SingleAsync(Ct);
        Assert.Equal((made.Claim.Id, ClaimKind.Shift, TripClaimStatus.Draft, person.Id), (claim.Id, claim.Kind, claim.Status, claim.ParticipantId));
        Assert.Equal($"Claimed again from {oldReference}.", claim.Notes);
        Assert.Equal(oldTotal, claim.TotalAmount);
        var lines = await kit.Db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claim.Id).ToListAsync(Ct);
        Assert.Equal(shifts.Select(s => s.Id).Order(), lines.Select(l => l.ShiftId!.Value).Order());
        Assert.All(lines, l => Assert.Equal((ClaimType.Standard, ClaimLineItemStatus.Draft), (l.ClaimType, l.Status)));
        Assert.Equal(3, made.ShiftCount);
    }

    [Fact]
    public async Task ThePeriod_IsTheEarliestToTheLatestServiceDate_OfTheOldClaimsShifts()
    {
        var (kit, engine, old, _, _) = await RejectedAsync(3);
        using var _ = kit;
        old.PeriodFrom = Day1.AddDays(-30);   // the old header's range was wider than its shifts
        old.PeriodTo = Day1.AddDays(30);
        kit.Db.SaveChanges();

        var made = await engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        Assert.Equal((Day1, Day1.AddDays(2)), (made.Claim.PeriodFrom, made.Claim.PeriodTo));
    }

    [Fact]
    public async Task D_WhenNothingCanBeClaimed_ItIsRefused_AndTheOldClaimIsNotDeleted()
    {
        var (kit, engine, old, person, _) = await RejectedAsync(2);
        using var _ = kit;
        person.NdisNumber = null;   // the shifts cannot be priced without it
        kit.Db.SaveChanges();

        var refused = await Assert.ThrowsAnyAsync<InvalidOperationException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Contains("NDIS number missing", refused.Message);
        Assert.True(await StillThere(kit, old));
        Assert.Equal(1, await kit.Db.TripClaims.CountAsync(Ct));
    }

    [Fact]
    public async Task ARejectedCancellationClaim_IsClaimedAgainAsACancellation_WithItsOwnReason()
    {
        var (kit, engine, _, person, _) = await RejectedAsync(1);
        using var _ = kit;
        var shift = kit.SeedShift(person, Day1.AddDays(10), ShiftStatus.Cancelled);
        shift.CancelledAt = new DateTime(2026, 10, 27, 1, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();
        var cancellation = (await engine.GenerateCancellationAsync(shift.Id, "NSDF", new DateOnly(2026, 11, 2), Ct)).Claim;
        cancellation.Status = TripClaimStatus.Rejected;
        kit.Db.SaveChanges();

        var made = await engine.ClaimAgainAsync(cancellation.Id, kit.TenantId, new DateOnly(2026, 11, 2), Ct);

        var line = await kit.Db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.TripClaimId == made.Claim.Id, Ct);
        Assert.Equal((shift.Id, ClaimType.Cancellation, "NSDF"), (line.ShiftId, line.ClaimType, line.CancellationReason));
        Assert.False(await kit.Db.TripClaims.AnyAsync(c => c.Id == cancellation.Id, Ct));
    }

    [Fact]
    public async Task D_ALineChangedToCancellationByHand_ComesBackAsCancellation_AtTheSamePrice_NeverAsStandard()
    {
        var (kit, engine, old, _, shifts) = await RejectedAsync(2);
        using var _ = kit;
        var flipped = await kit.Db.ClaimLineItems.SingleAsync(l => l.TripClaimId == old.Id && l.ShiftId == shifts[0].Id, Ct);
        flipped.ClaimType = ClaimType.Cancellation;
        flipped.CancellationReason = "NSDH";
        kit.Db.SaveChanges();
        var price = flipped.TotalAmount;

        var made = await engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        var lines = await kit.Db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == made.Claim.Id).ToListAsync(Ct);
        var again = lines.Single(l => l.ShiftId == shifts[0].Id);
        Assert.Equal((ClaimType.Cancellation, "NSDH", price), (again.ClaimType, again.CancellationReason, again.TotalAmount));
        var other = lines.Single(l => l.ShiftId == shifts[1].Id);
        Assert.Equal((ClaimType.Standard, (string?)null), (other.ClaimType, other.CancellationReason));
    }

    [Fact]
    public async Task ThePreview_PricesTheOldClaimsShifts_AndDeletesNothing()
    {
        var (kit, engine, old, _, shifts) = await RejectedAsync(3);
        using var _ = kit;
        var claimsBefore = await kit.Db.TripClaims.CountAsync(Ct);
        var linesBefore = await kit.Db.ClaimLineItems.CountAsync(Ct);

        var preview = await engine.PreviewClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        Assert.Equal(shifts.Select(s => s.Id).Order(), preview.LineItems.Select(l => l.ShiftId).Order());
        Assert.All(preview.LineItems, l => Assert.Equal(ClaimType.Standard, l.ClaimType));
        Assert.Equal(old.TotalAmount, preview.TotalAmount);
        Assert.Empty(preview.LeftOut);
        Assert.Equal((claimsBefore, linesBefore), (await kit.Db.TripClaims.CountAsync(Ct), await kit.Db.ClaimLineItems.CountAsync(Ct)));
        Assert.True(await StillThere(kit, old));
    }

    [Fact]
    public async Task AShiftAnotherLiveClaimTookSince_IsLeftOut_NotClaimedTwice()
    {
        var (kit, engine, old, person, shifts) = await RejectedAsync(3);
        using var _ = kit;
        var other = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 100m, shifts[1], reference: "TC-OTHER-1");
        var made = await engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        var lines = await kit.Db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == made.Claim.Id).ToListAsync(Ct);
        Assert.Equal(new[] { shifts[0].Id, shifts[2].Id }.Order(), lines.Select(l => l.ShiftId!.Value).Order());
        var left = Assert.Single(made.LeftOut);
        Assert.Equal(shifts[1].Id, left.ShiftId);
        Assert.Contains("TC-OTHER-1", left.Reason);
        Assert.Equal(other.Id, (await kit.Db.TripClaims.AsNoTracking().SingleAsync(c => c.ClaimReference == "TC-OTHER-1", Ct)).Id);
    }

    [Fact]
    public async Task AShiftThatChangedSince_IsLeftOut_WithWhy_AndAShiftThatMovedToo()
    {
        var (kit, engine, old, _, shifts) = await RejectedAsync(3);
        using var _ = kit;
        shifts[0].Status = ShiftStatus.Published;   // reopened
        shifts[1].ParticipantId = Guid.NewGuid();     // moved to someone else
        kit.Db.SaveChanges();

        var preview = await engine.PreviewClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);
        var made = await engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        Assert.Equal([shifts[2].Id], preview.LineItems.Select(l => l.ShiftId));
        Assert.Equal(new[] { shifts[0].Id, shifts[1].Id }.Order(), preview.LeftOut.Select(l => l.ShiftId).Order());
        Assert.Contains("changed", preview.LeftOut.Single(l => l.ShiftId == shifts[0].Id).Reason);
        Assert.Contains("moved", preview.LeftOut.Single(l => l.ShiftId == shifts[1].Id).Reason);
        Assert.Equal(2, made.LeftOut.Count);
    }

    [Fact]
    public async Task AnIssuedInvoice_Refuses_WithTheExistingSentence_AndNothingIsDeleted()
    {
        var (kit, engine, old, person, _) = await RejectedAsync(2);
        using var _ = kit;
        kit.Db.Invoices.Add(new Invoice { Id = Guid.NewGuid(), TenantId = kit.TenantId, Kind = InvoiceKind.Invoice, Status = InvoiceStatus.Issued, Number = 1, DisplayNumber = "INV-0001", TripClaimId = old.Id, ParticipantId = person.Id });
        kit.Db.SaveChanges();

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Equal(("Void INV-0001 first, then delete the claim.", true), (refused.Message, refused.Conflict));
        Assert.True(await StillThere(kit, old));
    }

    [Fact]
    public async Task AClaimInALiveFile_Refuses_AndNothingIsDeleted()
    {
        var (kit, engine, old, _, _) = await RejectedAsync(2);
        using var _ = kit;
        var line = await kit.Db.ClaimLineItems.FirstAsync(l => l.TripClaimId == old.Id, Ct);
        var batch = new ClaimBatch { Id = Guid.NewGuid(), TenantId = kit.TenantId, FileName = "claims-1.csv", Status = ClaimBatchStatus.Built };
        kit.Db.ClaimBatches.Add(batch);
        kit.Db.ClaimBatchLines.Add(new ClaimBatchLine { Id = Guid.NewGuid(), TenantId = kit.TenantId, BatchId = batch.Id, ClaimLineItemId = line.Id, Outcome = ClaimBatchLineOutcome.Pending });
        kit.Db.SaveChanges();

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Equal(("This claim is in claims-1.csv. Discard that file first.", true), (refused.Message, refused.Conflict));
        Assert.True(await StillThere(kit, old));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task D_AClaimWithAnyPaidLine_Refuses_ByStatusOrByPaidAmount_AndNothingIsDeleted(bool byStatus)
    {
        var (kit, engine, old, _, _) = await RejectedAsync(2);
        using var _ = kit;
        var line = await kit.Db.ClaimLineItems.FirstAsync(l => l.TripClaimId == old.Id, Ct);
        if (byStatus) line.Status = ClaimLineItemStatus.Paid; else line.PaidAmount = 0.01m;
        kit.Db.SaveChanges();

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));
        var preview = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.PreviewClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Equal("Part of this claim has been paid, so it can't be claimed again.", refused.Message);
        Assert.Equal(refused.Message, preview.Message);
        Assert.True(await StillThere(kit, old));
    }

private static async Task<(LedgerKit Kit, ShiftClaimGenerationService Engine, TripClaim Old, List<ClaimLineItem> Lines)> TwoLineShiftRejectedAsync()
    {
        var (kit, engine, _, person, _) = await RejectedAsync(1);
        var evening = kit.SeedShift(person, Day1.AddDays(1), ShiftStatus.Completed, 14, 22);   // 2 h of it are evening: priced as two lines
        var old = (await engine.GenerateAsync(person.Id, evening.ServiceDate, evening.ServiceDate, Ct)).Claim;
        old.Status = TripClaimStatus.Rejected;
        var lines = kit.Db.ClaimLineItems.Where(l => l.TripClaimId == old.Id).ToList();
        foreach (var l in lines) l.Status = ClaimLineItemStatus.Submitted;
        kit.Db.SaveChanges();
        Assert.Equal(2, lines.Count);
        return (kit, engine, old, lines);
    }

    [Fact]
    public async Task D_ACompletedShiftWithSomeLinesFlippedByHand_Refuses_AndNothingIsDeleted()
    {
        var (kit, engine, old, lines) = await TwoLineShiftRejectedAsync();
        using var _ = kit;
        lines[0].ClaimType = ClaimType.Cancellation;
        lines[0].CancellationReason = "NSDH";
        kit.Db.SaveChanges();

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));

        Assert.Equal("This claim has a line changed to a cancellation by hand. Change it back on the claim, then claim again.", refused.Message);
        await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.PreviewClaimAgainAsync(old.Id, kit.TenantId, Now, Ct));
        Assert.True(await StillThere(kit, old));
    }

    [Fact]
    public async Task ACompletedShiftWithEveryLineFlippedByHand_StillComesBackAsCancellation()
    {
        var (kit, engine, old, lines) = await TwoLineShiftRejectedAsync();
        using var _ = kit;
        foreach (var l in lines) { l.ClaimType = ClaimType.Cancellation; l.CancellationReason = "NSDH"; }
        kit.Db.SaveChanges();

        var made = await engine.ClaimAgainAsync(old.Id, kit.TenantId, Now, Ct);

        var again = await kit.Db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == made.Claim.Id).ToListAsync(Ct);
        Assert.All(again, l => Assert.Equal((ClaimType.Cancellation, "NSDH"), (l.ClaimType, l.CancellationReason)));
    }

    [Fact]
    public async Task AnotherOrganisationsClaim_IsNotFound_AndUntouched()
    {
        var (kit, engine, old, _, _) = await RejectedAsync(1);
        using var _ = kit;

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(old.Id, Guid.NewGuid(), Now, Ct));

        // The make answers the same 409 as a claim that has gone; the preview stays a 404.
        Assert.True(refused.Conflict);
        Assert.StartsWith("This claim has already been claimed again or deleted.", refused.Message);
        var previewRefused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.PreviewClaimAgainAsync(old.Id, Guid.NewGuid(), Now, Ct));
        Assert.True(previewRefused.NotFound);
        Assert.True(await StillThere(kit, old));
    }
}
