using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Billing.Pricing;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Agreement PR 2, D12: approving a renewal (a revision that starts the day after the approved one ends) ends no pattern, so PR 1's carry-over never meets the old ones. Each support still keeps its
/// default worker while that worker is active, and its switch-off; a changed support starts with none, and the preview counts it; no shift moves. The approval fixture's clock, Saturday 10 October 2026.
/// </summary>
public class AgreementRenewalApprovalTests
{
    private static readonly DateOnly Nov22 = new(2026, 11, 22), Nov23 = new(2026, 11, 23), Jan3 = new(2027, 1, 3);

    private static async Task<Guid> UserAsync(Fixture f, string name, bool active)
    {
        var id = Guid.NewGuid();
        f.Db.Users.Add(new User { Id = id, TenantId = TenantA, FirstName = name, LastName = "Turner", Username = name.ToLowerInvariant(), Email = $"{name.ToLowerInvariant()}@example.com", Role = UserRole.SupportWorker, IsActive = active });
        await f.Db.SaveChangesAsync();
        return id;
    }

    private static Task<List<string>> ShiftRowsAsync(Fixture f) =>
        f.Db.Shifts.AsNoTracking().Where(s => s.ServiceDate <= Nov22).OrderBy(s => s.Id).Select(s => $"{s.Id} {s.ShiftPatternId} {s.ServiceDate} {s.UserId} {s.Status}").ToListAsync();


    [Fact]
    public async Task A_renewal_keeps_each_supports_active_default_worker_and_switch_off_starts_a_changed_one_with_none_and_moves_no_shift()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22);
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None)).Status);
        var ben = await UserAsync(f, "Ben", active: true);
        var gus = await UserAsync(f, "Gus", active: false);                                                // archived: his default is not handed on
        foreach (var pattern in await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync())
            pattern.DefaultUserId = pattern.DayOfWeek switch { DayOfWeek.Wednesday => gus, DayOfWeek.Friday => null, _ => ben };
        (await f.Db.ShiftPatterns.SingleAsync(p => p.SourceDraftId == v1.Id && p.DayOfWeek == DayOfWeek.Thursday)).IsActive = false;   // a coordinator switched Thursday off
        await f.Db.SaveChangesAsync();
        var shiftsBefore = await ShiftRowsAsync(f);
        // The renewal, as Renew saves it, with one change: Monday runs to 14:00, a changed support.
        var renewal = await AddRevisionAsync(f, 2, new[]
        {
            WeekdayBlock(change: b => b with { Days = ApprovalTestSupport.Weekdays.Skip(1).ToArray() }), WeekdayBlock("weekdays-mon", b => b with { Days = new[] { DayOfWeek.Monday }, End = T(14) }),
        }, start: Nov23, end: Jan3);
        var preview = (await f.Service.PreviewAsync(TenantA, f.ParticipantId, renewal.Id, Admin, CancellationToken.None)).Preview!;

        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, renewal.Id, false, Admin, CancellationToken.None);

        Assert.Equal((ApprovalStatus.Approved, 0), (outcome.Status, outcome.Approval!.PatternsEnded));
        var made = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == renewal.Id).ToDictionaryAsync(p => p.DayOfWeek, p => (p.DefaultUserId, p.IsActive));
        Assert.Equal(new Dictionary<DayOfWeek, (Guid?, bool)>
        {
            [DayOfWeek.Monday] = (null, true), [DayOfWeek.Tuesday] = (ben, true), [DayOfWeek.Wednesday] = (null, true), [DayOfWeek.Thursday] = (ben, false), [DayOfWeek.Friday] = (null, true),
        }, made);                                                                                         // Thursday keeps Ben and stays switched off
        Assert.Equal(1, preview.ChangedPatterns);                                                          // so the dialog says the changed Monday starts with no default staff
        Assert.Equal(shiftsBefore, await ShiftRowsAsync(f));                                               // v1's shifts are as they were
        Assert.All(await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync(), p => Assert.Equal((DateOnly?)Nov22, p.EffectiveTo));
    }

    [Fact]
    public async Task An_approval_that_ends_patterns_carries_as_pr_1_does_and_the_renewal_rule_stays_out_of_it()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22);
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        var ben = await UserAsync(f, "Ben", active: true);
        foreach (var pattern in await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync()) pattern.DefaultUserId = ben;
        await f.Db.SaveChangesAsync();
        // A change from 2 November that keeps the end: it ends v1's patterns, so PR 1's carry-over decides, with Monday a changed support.
        var change = await AddRevisionAsync(f, 2, new[]
        {
            WeekdayBlock(change: b => b with { Days = ApprovalTestSupport.Weekdays.Skip(1).ToArray() }), WeekdayBlock("weekdays-mon", b => b with { Days = new[] { DayOfWeek.Monday }, End = T(14) }),
        }, start: new DateOnly(2026, 11, 2), end: Nov22);
        var preview = (await f.Service.PreviewAsync(TenantA, f.ParticipantId, change.Id, Admin, CancellationToken.None)).Preview!;

        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, change.Id, false, Admin, CancellationToken.None);

        Assert.Equal((5, 1), (outcome.Approval!.PatternsEnded, preview.ChangedPatterns));
        var made = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == change.Id).ToDictionaryAsync(p => p.DayOfWeek, p => p.DefaultUserId);
        Assert.Equal((Guid?)null, made[DayOfWeek.Monday]);
        Assert.All(made.Where(entry => entry.Key != DayOfWeek.Monday), entry => Assert.Equal((Guid?)ben, entry.Value));
    }

    /// <summary>
    /// Fix round 1 (CR-A S2): D12 runs only when the approval ends no pattern, and for a renewal that always holds. Each approval ends every earlier pattern running past its start, only the newest
    /// revision is approved, and the roster cannot move an agreement pattern's dates (a 409, RosteringPatternUpdateTests). So after a change inside the term is approved, every pattern ends by that
    /// term's end, and the renewal still ends nothing and takes the newest generation's default staff.
    /// </summary>
    [Fact]
    public async Task After_a_change_inside_the_term_a_renewal_still_ends_nothing_and_takes_the_newest_generations_default_staff()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22);
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        var (ben, ann) = (await UserAsync(f, "Ben", active: true), await UserAsync(f, "Ann", active: true));
        foreach (var pattern in await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync()) pattern.DefaultUserId = ben;
        await f.Db.SaveChangesAsync();
        var change = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 2), end: Nov22);
        Assert.Equal(5, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, change.Id, false, Admin, CancellationToken.None)).Approval!.PatternsEnded);
        (await f.Db.ShiftPatterns.SingleAsync(p => p.SourceDraftId == change.Id && p.DayOfWeek == DayOfWeek.Tuesday)).DefaultUserId = ann;
        await f.Db.SaveChangesAsync();
        var renewal = await AddRevisionAsync(f, 3, new[] { WeekdayBlock() }, start: Nov23, end: Jan3);

        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, renewal.Id, false, Admin, CancellationToken.None);

        Assert.Equal(0, outcome.Approval!.PatternsEnded);
        var made = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == renewal.Id).ToDictionaryAsync(p => p.DayOfWeek, p => p.DefaultUserId);
        Assert.Equal((Guid?)ann, made[DayOfWeek.Tuesday]);                                               // the change's worker, not v1's
        Assert.All(made.Where(entry => entry.Key != DayOfWeek.Tuesday), entry => Assert.Equal((Guid?)ben, entry.Value));
        Assert.Empty(await f.Db.ShiftPatterns.Where(p => p.SourceDraftId != renewal.Id && (p.EffectiveTo == null || p.EffectiveTo > Nov22)).ToListAsync());
    }
}
