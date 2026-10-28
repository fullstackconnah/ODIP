using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements PR B (B-T15): approving a revision that starts in the past, as a reprice from an earlier date makes, leaves delivered work alone.</summary>
public class AgreementBulkApprovalTests
{
    [Fact]
    public async Task Approving_a_revision_that_started_in_the_past_leaves_delivered_and_claimed_shifts_alone()
    {
        await using var f = await SetUpAsync();
        var s = Today.AddDays(-20);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: s, end: new DateOnly(2026, 12, 20));
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        var pattern = await f.Db.ShiftPatterns.FirstAsync(p => p.SourceDraftId == v1.Id);

        Shift Done(DateOnly day) => new() { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, ShiftPatternId = pattern.Id, ServiceDate = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed };
        var claimed = Done(s.AddDays(2));
        var unclaimed = Done(s.AddDays(5));
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = f.ParticipantId, PeriodFrom = claimed.ServiceDate, PeriodTo = claimed.ServiceDate, ClaimReference = "TC-B15" };
        f.Db.Shifts.AddRange(claimed, unclaimed);
        f.Db.TripClaims.Add(claim);
        f.Db.ClaimLineItems.Add(new ClaimLineItem { Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = claimed.Id, SupportItemCode = "04_X", SupportsDeliveredFrom = claimed.ServiceDate, SupportsDeliveredTo = claimed.ServiceDate, Hours = 4, UnitPrice = 73.58m, TotalAmount = 294.32m });
        await f.Db.SaveChangesAsync();
        var before = await f.Db.Shifts.AsNoTracking().Where(x => x.Id == claimed.Id || x.Id == unclaimed.Id).OrderBy(x => x.ServiceDate).Select(x => new { x.Id, x.Status, x.ShiftPatternId }).ToListAsync();

        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: s, end: new DateOnly(2026, 12, 20));
        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, v2.Id, true, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal(before, await f.Db.Shifts.AsNoTracking().Where(x => x.Id == claimed.Id || x.Id == unclaimed.Id).OrderBy(x => x.ServiceDate).Select(x => new { x.Id, x.Status, x.ShiftPatternId }).ToListAsync());
        var line = await f.Db.ClaimLineItems.AsNoTracking().SingleAsync(l => l.ShiftId == claimed.Id);
        Assert.Equal((1, 294.32m), (await f.Db.ClaimLineItems.CountAsync(l => l.ShiftId == claimed.Id), line.TotalAmount));
        var v2Ids = await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v2.Id).Select(p => p.Id).ToListAsync();
        Assert.False(await f.Db.Shifts.AnyAsync(x => v2Ids.Contains(x.ShiftPatternId!.Value) && x.ServiceDate < Today));
        Assert.All(await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync(), p => Assert.Equal(s.AddDays(-1), p.EffectiveTo));
    }
}
