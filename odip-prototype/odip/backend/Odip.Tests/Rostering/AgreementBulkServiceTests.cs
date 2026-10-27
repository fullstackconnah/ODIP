using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.AgreementListTests;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Agreements PR B: renew, reprice and extend in bulk. The approval fixture's day (Saturday 10 October 2026) and the 2026-27 catalogue with a December price set on top: the weekday community access
/// code 04_104_0125_6_1 is $73.58 an hour until 30 November 2026 and $74.58 from 1 December, as a second import leaves it. A weekday morning (09:00 to 13:00) is four hours.
/// </summary>
public class AgreementBulkServiceTests
{
    private const string Code = "04_104_0125_6_1";
    private static readonly DateOnly Jul1 = new(2026, 7, 1), Nov22 = new(2026, 11, 22), Nov30 = new(2026, 11, 30), Dec1 = new(2026, 12, 1), Dec20 = new(2026, 12, 20);
    private static readonly DateOnly PlanStart = new(2026, 7, 1), PlanEnd = new(2027, 6, 30);

    internal static async Task<Fixture> NewAsync()
    {
        var f = await SetUpAsync();
        await using var catalogue = await DecemberDatabaseAsync(code => code == Code, 1m, f.DbName);
        return f;
    }

    internal static async Task AddPlanAsync(Fixture f, Guid participantId, DateOnly start, DateOnly end, Guid? tenantId = null)
    {
        f.Db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, ParticipantId = participantId, PlanStart = start, PlanEnd = end });
        await f.Db.SaveChangesAsync();
    }

    /// <summary>A participant (the fixture's own when <paramref name="name"/> is null) with an approved weekday revision, and a plan covering a year.</summary>
    internal static async Task<(Guid Id, ServiceAgreementDraft V1)> AgreementAsync(Fixture f, string? name, DateOnly start, DateOnly end, bool plan = true, bool approve = true, bool handTyped = false)
    {
        var id = name is null ? f.ParticipantId : await ParticipantAsync(f, name);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: start, end: end, participantId: id, handTyped: handTyped);
        if (approve) await MarkApprovedAsync(f.Db, v1);
        if (plan) await AddPlanAsync(f, id, PlanStart, PlanEnd);
        return (id, v1);
    }

    internal static Task<List<BulkItem>> RunAsync(Fixture f, string action, IEnumerable<Guid> ids, DateOnly? end = null, PriceListRef? list = null, OdipDbContext? db = null, TimeProvider? clock = null, ApprovalCaller? caller = null) =>
        new AgreementBulkService(db ?? f.Db, clock: clock ?? f.Clock).RunAsync(TenantA, action, ids.ToList(), end, list, caller ?? Admin, "coordinator-1", CancellationToken.None);

    private static async Task<PriceListRef> DecemberListAsync(Fixture f)
    {
        var list = (await AgreementPriceLists.ListAsync(f.Db, CancellationToken.None)).Single(l => l.Version.StartsWith("2026-27 ("));
        Assert.Equal(Dec1, list.Start);
        return list;
    }

    private static Task<PriceListRef> OldListAsync(Fixture f) => Task.FromResult(new PriceListRef("2026-27", Jul1));

    private static Task<int> RevisionCountAsync(Fixture f, Guid participantId) => f.Db.ServiceAgreementDrafts.CountAsync(d => d.ParticipantId == participantId);

    private static Task<ServiceAgreementDraft> StoredAsync(Fixture f, Guid id) => f.Db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Lines).SingleAsync(d => d.Id == id);

    private static decimal LinesTotal(ServiceAgreementDraft d) => d.Lines.Sum(AgreementPriceLists.LineTotal);

    [Fact]
    public async Task Renew_makes_a_draft_per_agreement_with_totals_to_the_cent()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22);
        var b = await AgreementAsync(f, "Ben", Start, Nov22);
        var c = await AgreementAsync(f, "Cal", Start, Nov22);

        var items = await RunAsync(f, "renew", new[] { a.Id, b.Id, c.Id });

        Assert.All(items, i => Assert.Equal("Created", i.Outcome));
        foreach (var (item, source) in items.Zip(new[] { a.V1, b.V1, c.V1 }))
        {
            var created = await StoredAsync(f, item.NewDraftId!.Value);
            var before = await StoredAsync(f, source.Id);
            Assert.Equal(source.Id, item.SourceDraftId);
            Assert.Equal(new TermFigures(Start, Nov22, LinesTotal(before)), item.Before);
            Assert.Equal(new TermFigures(created.AgreementStartDate, created.AgreementEndDate, LinesTotal(created)), item.After);
            Assert.Equal(new DateOnly(2026, 11, 23), created.AgreementStartDate);
            Assert.Equal(before.Lines.Count, source.Lines.Count);                         // the source revision is untouched
            Assert.False(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(x => x.DraftId == created.Id));
        }
        Assert.Equal("Amy Ng", items[0].Name);
    }

    [Fact]
    public async Task Extend_adds_a_revision_from_the_day_after_the_end_to_the_chosen_date()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22);
        var before = LinesTotal(await StoredAsync(f, a.V1.Id));

        var item = Assert.Single(await RunAsync(f, "extend", new[] { a.Id }, end: new DateOnly(2026, 11, 29)));

        var created = await StoredAsync(f, item.NewDraftId!.Value);
        Assert.Equal(("Created", new DateOnly(2026, 11, 23), new DateOnly(2026, 11, 29), 2), (item.Outcome, created.AgreementStartDate, created.AgreementEndDate, created.Version));
        Assert.Equal((PlanStart, PlanEnd), (created.PlanStartDate, created.PlanEndDate));
        Assert.Equal(20 * 73.58m, item.After!.Total);                                  // 5 weekdays, 4 hours each, written out
        Assert.Equal(1471.60m, LinesTotal(created));
        Assert.Equal(before, LinesTotal(await StoredAsync(f, a.V1.Id)));
    }

    [Fact]
    public async Task Reprice_before_is_the_same_dates_on_the_old_list_and_after_on_the_new()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Dec20);
        var list = await DecemberListAsync(f);
        var rowsBefore = await f.Db.SupportCatalogueItems.AsNoTracking().OrderBy(i => i.Id).Select(i => new { i.Id, i.EffectiveTo, i.IsActive }).ToListAsync();

        var item = Assert.Single(await RunAsync(f, "reprice", new[] { a.Id }, list: list));

        // 1 to 18 December: 14 weekdays of 4 hours is 56 hours, at the old and the new rate. Written out, not recomputed with the engine's helpers.
        Assert.Equal("Created", item.Outcome);
        Assert.Equal(new TermFigures(Dec1, Dec20, 56 * 73.58m), item.Before);
        Assert.Equal(4120.48m, item.Before!.Total);
        Assert.Equal(new TermFigures(Dec1, Dec20, 56 * 74.58m), item.After);
        Assert.Equal(4176.48m, LinesTotal(await StoredAsync(f, item.NewDraftId!.Value)));
        Assert.Equal(rowsBefore, await f.Db.SupportCatalogueItems.AsNoTracking().OrderBy(i => i.Id).Select(i => new { i.Id, i.EffectiveTo, i.IsActive }).ToListAsync());   // the pinned copy is never saved
    }

    [Fact]
    public async Task Reprice_of_an_agreement_that_starts_after_the_list_starts_uses_its_own_start()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, new DateOnly(2026, 12, 7), Dec20);
        var item = Assert.Single(await RunAsync(f, "reprice", new[] { a.Id }, list: await DecemberListAsync(f)));
        Assert.Equal(("Created", new DateOnly(2026, 12, 7)), (item.Outcome, item.Before!.Start));
    }

    [Fact]
    public async Task QuoteAsync_pinned_prices_on_an_end_dated_version()
    {
        await using var f = await NewAsync();
        var oldRow = await f.Db.SupportCatalogueItems.AsNoTracking().FirstAsync(i => i.ItemNumber == Code && i.CatalogueVersion == "2026-27");
        Assert.NotNull(oldRow.EffectiveTo);                                                  // the import end-dated it: the case the pin must handle
        var blocks = new[] { WeekdayBlock() };

        var pinned = await new PlanPricingService(f.Db).QuoteAsync(TenantA, blocks, Dec1, new DateOnly(2026, 12, 18), pinnedVersion: "2026-27");
        var current = await new PlanPricingService(f.Db).QuoteAsync(TenantA, blocks, Dec1, new DateOnly(2026, 12, 18));

        Assert.Equal(56 * 73.58m, AgreementPriceLists.PricedTotal(pinned));
        Assert.Equal(56 * 74.58m, AgreementPriceLists.PricedTotal(current));
        Assert.NotNull((await f.Db.SupportCatalogueItems.AsNoTracking().FirstAsync(i => i.Id == oldRow.Id)).EffectiveTo);
    }

    [Fact]
    public async Task Reprice_skips_what_has_nothing_to_reprice_and_adds_no_revision()
    {
        await using var f = await NewAsync();
        var list = await DecemberListAsync(f);
        var ended = await AgreementAsync(f, null, Jul1, new DateOnly(2026, 9, 30));
        var endsBefore = await AgreementAsync(f, "Ben", Start, Nov30);
        var onList = await AgreementAsync(f, "Cal", Start, Dec20);
        foreach (var line in onList.V1.Lines) (line.CatalogueVersion, line.CatalogueEffectiveFrom) = (list.Version, Dec1);
        var noVersion = await AgreementAsync(f, "Dee", Start, Dec20);
        foreach (var line in noVersion.V1.Lines) line.CatalogueVersion = "";
        var unlisted = await AgreementAsync(f, "Eve", Start, Dec20);
        foreach (var line in unlisted.V1.Lines) line.CatalogueVersion = "1999-00";
        await f.Db.SaveChangesAsync();
        var ids = new[] { ended.Id, endsBefore.Id, onList.Id, noVersion.Id, unlisted.Id };

        var items = await RunAsync(f, "reprice", ids, list: list);

        Assert.Equal(new[] { "The agreement has ended", "Ends before this price list", "Already on this price list or a newer one", "Not on a price list", "Not on a price list" }, items.Select(i => i.Reason));
        Assert.All(items, i => Assert.Equal("Skipped", i.Outcome));
        Assert.All(ids, id => Assert.Equal(1, f.Db.ServiceAgreementDrafts.Count(d => d.ParticipantId == id)));
        Assert.Equal("Already on this price list or a newer one", Assert.Single(await RunAsync(f, "reprice", new[] { (await AgreementAsync(f, "Fay", Start, Dec20)).Id }, list: await OldListAsync(f))).Reason);
    }

    [Theory]
    [InlineData("renew")]
    [InlineData("extend")]
    [InlineData("reprice")]
    public async Task A_waiting_draft_is_skipped_and_left_untouched(string action)
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Dec20);
        var waiting = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: Start, end: Dec20);
        var snapshot = (waiting.Id, waiting.Version, waiting.Lines.Count, LinesTotal(waiting));

        var item = Assert.Single(await RunAsync(f, action, new[] { a.Id }, end: Dec20.AddDays(7), list: await DecemberListAsync(f)));

        Assert.Equal(("Skipped", "A draft is waiting. Open it to finish or discard it."), (item.Outcome, item.Reason));
        var after = await StoredAsync(f, waiting.Id);
        Assert.Equal(snapshot, (after.Id, after.Version, after.Lines.Count, LinesTotal(after)));
        Assert.Equal(2, await RevisionCountAsync(f, a.Id));
    }

    [Fact]
    public async Task Plan_not_covering_the_new_term_fails_and_saves_nothing()
    {
        await using var f = await NewAsync();
        var shortPlan = await AgreementAsync(f, null, Start, Nov22, plan: false);
        await AddPlanAsync(f, shortPlan.Id, PlanStart, new DateOnly(2026, 12, 31));
        var noPlan = await AgreementAsync(f, "Ben", Start, Nov22, plan: false);
        var repriceShort = await AgreementAsync(f, "Cal", Start, Dec20, plan: false);
        await AddPlanAsync(f, repriceShort.Id, PlanStart, Nov30);

        var extend = await RunAsync(f, "extend", new[] { shortPlan.Id, noPlan.Id }, end: new DateOnly(2027, 1, 31));
        var reprice = Assert.Single(await RunAsync(f, "reprice", new[] { repriceShort.Id }, list: await DecemberListAsync(f)));

        Assert.Equal(("Failed", "The plan ends 31 Dec 2026. Record the new plan first."), (extend[0].Outcome, extend[0].Reason));
        Assert.Equal(("Failed", "No plan covers 23 Nov 2026. Record the new plan first."), (extend[1].Outcome, extend[1].Reason));
        Assert.Equal(("Failed", "The plan ends 30 Nov 2026. Record the new plan first."), (reprice.Outcome, reprice.Reason));
        Assert.All(new[] { shortPlan.Id, noPlan.Id, repriceShort.Id }, id => Assert.Equal(1, f.Db.ServiceAgreementDrafts.Count(d => d.ParticipantId == id)));
    }

    [Fact]
    public async Task Extend_refuses_a_date_not_after_the_end_or_too_long()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22, plan: false);
        await AddPlanAsync(f, a.Id, PlanStart, new DateOnly(2032, 12, 31));
        var start = Nov22.AddDays(1);

        var same = Assert.Single(await RunAsync(f, "extend", new[] { a.Id }, end: Nov22));
        var tooLong = Assert.Single(await RunAsync(f, "extend", new[] { a.Id }, end: start.AddDays(800)));
        var longest = Assert.Single(await RunAsync(f, "extend", new[] { a.Id }, end: start.AddDays(799)));

        Assert.Equal(("Failed", "Choose a date after 22 Nov 2026."), (same.Outcome, same.Reason));
        Assert.Equal(("Failed", "An agreement can run at most 800 days."), (tooLong.Outcome, tooLong.Reason));
        Assert.Equal("Created", longest.Outcome);
    }

    private sealed class FirstSaveHook(Func<DbContext, Task> onFirst) : SaveChangesInterceptor
    {
        private bool _done;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_done && eventData.Context is { } context && context.ChangeTracker.Entries<ServiceAgreementDraft>().Any(e => e.State == EntityState.Added))
            {
                _done = true;
                await onFirst(context);
            }
            return result;
        }
    }

    [Fact]
    public async Task A_concurrent_edit_fails_only_that_item()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22);
        var b = await AgreementAsync(f, "Ben", Start, Nov22);
        var c = await AgreementAsync(f, "Cal", Start, Nov22);
        // While A is being saved, someone saves a newer revision for B.
        var hook = new FirstSaveHook(async _ =>
        {
            await using var other = NewDb(f.DbName);
            other.ServiceAgreementDrafts.Add(BuildRevision(TenantA, b.Id, 2, new[] { WeekdayBlock() }, Start, Nov22));
            await other.SaveChangesAsync();
        });
        await using var db = NewDb(f.DbName, false, hook);

        var items = await RunAsync(f, "renew", new[] { a.Id, b.Id, c.Id }, db: db);

        Assert.Equal(new[] { "Created", "Failed", "Created" }, items.Select(i => i.Outcome));
        Assert.Equal("Someone else changed this agreement. Open it and try again.", items[1].Reason);
        Assert.Equal(2, await RevisionCountAsync(f, b.Id));                               // only the one the other session added
    }

    [Fact]
    public async Task One_failure_never_stops_the_rest()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22);
        var unreadable = await AgreementAsync(f, "Ben", Start, Nov22, handTyped: true);
        var c = await AgreementAsync(f, "Cal", Start, Nov22);

        var items = await RunAsync(f, "renew", new[] { a.Id, unreadable.Id, c.Id });

        Assert.Equal(new[] { "Created", "Failed", "Created" }, items.Select(i => i.Outcome));
        Assert.Equal(AgreementRenewalService.UnreadableBlocksWords, items[1].Reason);
        Assert.Empty(f.Db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task A_throwing_item_is_failed_with_plain_words_and_the_next_still_succeeds()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22);
        var b = await AgreementAsync(f, "Ben", Start, Nov22);
        var hook = new FirstSaveHook(_ => throw new InvalidOperationException("boom"));
        await using var db = NewDb(f.DbName, false, hook);

        var items = await RunAsync(f, "renew", new[] { a.Id, b.Id }, db: db);

        Assert.Equal(new[] { "Failed", "Created" }, items.Select(i => i.Outcome));
        Assert.Equal(AgreementBulkService.FailedWords, items[0].Reason);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    private sealed class SteppingClock(TimeSpan step) : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 10, 2, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() { var now = _now; _now += step; return now; }
    }

    [Fact]
    public async Task Past_the_time_budget_the_rest_are_answered_busy_untouched()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22);
        var b = await AgreementAsync(f, "Ben", Start, Nov22);
        var c = await AgreementAsync(f, "Cal", Start, Nov22);

        var items = await RunAsync(f, "renew", new[] { a.Id, b.Id, c.Id }, clock: new SteppingClock(TimeSpan.FromSeconds(20)));

        Assert.Equal(new[] { "Created", "Busy", "Busy" }, items.Select(i => i.Outcome));
        Assert.Equal(AgreementBulkService.BudgetWords, items[1].Reason);
        Assert.Equal(1, await RevisionCountAsync(f, b.Id));
    }

    [Fact]
    public async Task Another_organisations_participant_is_not_found_and_not_written()
    {
        await using var f = await NewAsync();
        var other = await ParticipantAsync(f, "Zed", TenantB);
        await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, tenantId: TenantB, participantId: other);

        var item = Assert.Single(await RunAsync(f, "renew", new[] { other }));

        Assert.Equal(("Failed", "Not found"), (item.Outcome, item.Reason));
        Assert.Equal(1, await RevisionCountAsync(f, other));
    }

    [Fact]
    public async Task A_participant_with_no_approved_revision_is_skipped()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, Nov22, approve: false);

        var item = Assert.Single(await RunAsync(f, "extend", new[] { a.Id }, end: new DateOnly(2026, 11, 29)));

        Assert.Equal(("Skipped", "Not approved yet"), (item.Outcome, item.Reason));
    }
}
