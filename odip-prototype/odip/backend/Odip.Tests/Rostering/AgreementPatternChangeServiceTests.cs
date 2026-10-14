using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// A change to a roster pattern an approved agreement made, saved as the agreement's next revision (agreement PR 1). The approval fixture's clock (Saturday 10 October 2026, Sydney) with the real
/// 2026-27 catalogue imported into its database, because a save prices from the database. Money is checked in cents: community access on a weekday, one to one, is 04_104_0125_6_1 at $73.58 an
/// hour (PlanPricingGoldenTests), and 19 October to 22 November 2026 has no NSW public holiday.
/// </summary>
public class AgreementPatternChangeServiceTests
{
    private static readonly DateOnly Oct19 = new(2026, 10, 19), Nov22 = new(2026, 11, 22);

    /// <summary>v1 (weekday mornings to 22 November) approved: its five patterns and its shifts are on the roster.</summary>
    private static async Task<(Fixture F, ServiceAgreementDraft V1, ShiftPattern Monday)> ApprovedAsync(DateOnly? start = null, DraftBlockRequirementsDto? requirements = null)
    {
        var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, start: start, end: Nov22, requirements: requirements);
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        return (f, v1, await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == v1.Id && p.DayOfWeek == DayOfWeek.Monday));
    }

    /// <summary>A revision and the patterns its approval would make, saved without approving it: for a block the approval fixture's own pricing would hold for review.</summary>
    private static async Task<(ServiceAgreementDraft Draft, ShiftPattern Pattern)> WithPatternAsync(Fixture f, PlanBlock block)
    {
        var draft = await AddRevisionAsync(f, 1, new[] { block }, end: Nov22);
        var pattern = AgreementPatternMapper.Map(draft, draft.Blocks.Select(DraftJson.ToDto).ToList()).Single();
        f.Db.ShiftPatterns.Add(pattern);
        await f.Db.SaveChangesAsync();
        return (draft, pattern);
    }

    private static AgreementPatternChangeDto Keep(ShiftPattern p) => new()
    {
        PatternId = p.Id, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay, Ratio = p.Ratio, NightType = p.NightType,
    };

    private static Task<PatternChangeOutcome> ChangeAsync(Fixture f, ServiceAgreementDraft source, AgreementPatternChangeDto change, Guid? tenantId = null) =>
        new AgreementPatternChangeService(f.Db, clock: f.Clock).ChangeAsync(tenantId ?? TenantA, f.ParticipantId, source.Id, change, "coordinator-1", CancellationToken.None);

    private static Task<List<string>> PatternRowsAsync(Fixture f) =>
        f.Db.ShiftPatterns.AsNoTracking().OrderBy(p => p.Id).Select(p => $"{p.Id} {p.DayOfWeek} {p.StartTime} {p.EndTime} {p.EffectiveFrom} {p.EffectiveTo} {p.IsActive}").ToListAsync();


    [Fact]
    public async Task A_longer_monday_from_the_19th_saves_v2_split_and_priced_now_says_the_difference_in_cents_and_leaves_the_roster_alone()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;
        var patternsBefore = await PatternRowsAsync(f);
        var shiftsBefore = await f.Db.Shifts.CountAsync();

        var result = (await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), FromDate = Oct19 })).Result!;

        // Five Mondays and twenty other weekdays: before, 25 x 4h x $73.58; after, 20 x 4h + 5 x 5h; the difference is 5 x $73.58.
        Assert.Equal((2, Oct19, Nov22), (result.Version, result.AgreementStartDate, result.AgreementEndDate));
        Assert.Equal((7358.00m, 7725.90m, 367.90m, false), (result.OldTotal, result.NewTotal, result.Difference, result.NeedsReview));
        var v2 = await f.Db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).Include(d => d.Lines).SingleAsync(d => d.Id == result.DraftId);
        Assert.Equal((2, Oct19, Nov22, v1.PlanStartDate, v1.PlanEndDate, "NSW"), (v2.Version, v2.AgreementStartDate, v2.AgreementEndDate, v2.PlanStartDate, v2.PlanEndDate, v2.State));
        Assert.Equal(new[] { "weekdays", "weekdays-mon" }, v2.Blocks.OrderBy(b => b.Position).Select(b => b.BlockKey));
        Assert.Equal(result.NewTotal, v2.Lines.Sum(l => l.Total));                                    // the answer is the stored lines, not a second sum
        Assert.All(v2.Lines, l => Assert.Equal("04_104_0125_6_1", l.ItemCode));
        Assert.False(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == v2.Id));    // a Draft: nobody has approved it
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(d => d.Id == v1.Id));                   // the approved revision is kept
        Assert.Equal(patternsBefore, await PatternRowsAsync(f));                                        // the roster changes on approval, not now
        Assert.Equal(shiftsBefore, await f.Db.Shifts.CountAsync());
    }

    [Fact]
    public async Task A_preview_answers_what_the_save_then_saves_and_writes_nothing()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;
        var change = Keep(monday) with { EndTime = T(14), FromDate = Oct19 };

        var preview = (await ChangeAsync(f, v1, change with { Preview = true })).Result!;
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
        var saved = (await ChangeAsync(f, v1, change)).Result!;

        Assert.Null(preview.DraftId);
        Assert.Equal((saved.Version, saved.AgreementStartDate, saved.AgreementEndDate, saved.OldTotal, saved.NewTotal, saved.Difference, saved.NeedsReview),
            (preview.Version, preview.AgreementStartDate, preview.AgreementEndDate, preview.OldTotal, preview.NewTotal, preview.Difference, preview.NeedsReview));
    }

    [Fact]
    public async Task One_to_two_on_every_day_is_stored_as_the_blocks_numbers_and_priced_as_the_engine_prices_those_blocks()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;

        var result = (await ChangeAsync(f, v1, Keep(monday) with { Ratio = SupportRatio.OneToTwo, AllDays = true, FromDate = Oct19 })).Result!;

        var v2 = await f.Db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).SingleAsync(d => d.Id == result.DraftId);
        var block = DraftJson.ReadBlock(Assert.Single(v2.Blocks).BlockJson);
        Assert.Equal(("weekdays", 1, 2, 5), (block.Id, block.Workers, block.ParticipantsPresent, block.Days.Count));
        Assert.Equal(Priced(Quote(new[] { block }, Oct19, Nov22)).Sum(l => l.Total), result.NewTotal);   // the engine over the real catalogue, outside the service
        Assert.True(result.Difference < 0m);
    }

    [Fact]
    public async Task A_change_while_a_newer_revision_waits_is_a_409_and_the_waiting_revision_survives()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;
        var waiting = await AddRevisionAsync(f, 2, new[] { WeekdayBlock(change: b => b with { End = T(12) }) }, end: Nov22);

        var saved = await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14) });
        var preview = await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), Preview = true });

        Assert.Equal((2, 2), (saved.ConflictVersion, preview.ConflictVersion));
        Assert.Null(saved.Result);
        Assert.Equal("This agreement has a newer revision, v2. Open the agreement and make the change there.", Assert.Single(saved.Errors));
        Assert.Single((await f.Db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).SingleAsync(d => d.Id == waiting.Id)).Blocks);
        Assert.Equal(2, await f.Db.ServiceAgreementDrafts.CountAsync());
    }


    [Fact]
    public async Task The_from_date_is_the_providers_tomorrow_not_the_utc_one_and_a_utc_today_is_refused_as_past()
    {
        var (f, v1, monday) = await ApprovedAsync(start: new DateOnly(2026, 10, 1));               // started already, so the default is tomorrow and not the start
        await using var _ = f;
        f.Clock.Set(new DateTimeOffset(2026, 10, 10, 14, 30, 0, TimeSpan.Zero));                  // Saturday 10 October in UTC is 01:30 on Sunday 11 October in Sydney

        var byDefault = (await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), Preview = true })).Result!;
        var utcToday = await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), Preview = true, FromDate = new DateOnly(2026, 10, 10) });

        Assert.Equal(new DateOnly(2026, 10, 12), byDefault.AgreementStartDate);
        Assert.Equal("A change cannot start before today (2026-10-11).", Assert.Single(utcToday.Errors));
    }

    [Fact]
    public async Task A_from_date_before_the_agreement_starts_or_after_it_ends_is_refused_and_the_default_waits_for_the_start()
    {
        var (f, v1, monday) = await ApprovedAsync(start: new DateOnly(2026, 11, 2));               // an agreement that starts in three weeks
        await using var _ = f;

        var early = await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), FromDate = Oct19 });
        var late = await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), FromDate = new DateOnly(2026, 11, 23) });
        var byDefault = (await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), Preview = true })).Result!;

        Assert.Equal("A change cannot start before the agreement does (2026-11-02).", Assert.Single(early.Errors));
        Assert.Equal("A change cannot start after the agreement ends (2026-11-22).", Assert.Single(late.Errors));
        Assert.Equal(new DateOnly(2026, 11, 2), byDefault.AgreementStartDate);                       // never pulled before the agreement's own start
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    [Fact]
    public async Task A_change_that_leaves_the_block_invalid_is_a_400_in_words_and_saves_nothing()
    {
        await using var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        var night = Block("night", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(21), T(7), b => b with
        {
            Setting = PlanSetting.AtHome, WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(22), To = T(6) },
        });
        var (v1, pattern) = await WithPatternAsync(f, night);

        var saved = await ChangeAsync(f, v1, Keep(pattern) with { StartTime = T(22, 30) });          // the window now starts before the block does
        var preview = await ChangeAsync(f, v1, Keep(pattern) with { StartTime = T(22, 30), Preview = true });

        Assert.Contains(saved.Errors, e => e.Contains("the sleepover window must lie inside the block", StringComparison.Ordinal));
        Assert.Equal(saved.Errors, preview.Errors);
        Assert.Equal(((PatternChangeResultDto?)null, false, (int?)null), (saved.Result, saved.NotFound, saved.ConflictVersion));
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
        Assert.Equal(T(21), (await f.Db.ShiftPatterns.AsNoTracking().SingleAsync()).StartTime);
    }


    [Fact]
    public async Task Another_organisations_revision_or_a_pattern_no_agreement_made_is_not_found_and_nothing_is_saved()
    {
        var (f, v1, monday) = await ApprovedAsync();
        await using var _ = f;
        var handMade = new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DayOfWeek = DayOfWeek.Saturday, StartTime = T(9), EndTime = T(12), EffectiveFrom = new DateOnly(2026, 1, 1), IsActive = true };
        f.Db.ShiftPatterns.Add(handMade);
        await f.Db.SaveChangesAsync();

        Assert.True((await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14) }, tenantId: TenantB)).NotFound);
        Assert.True((await ChangeAsync(f, v1, Keep(handMade) with { EndTime = T(13) })).NotFound);
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    [Fact]
    public async Task Approving_the_saved_revision_ends_v1s_patterns_the_day_before_and_makes_the_split_ones_from_the_19th()
    {
        // Asks of a worker that are not the defaults, so the stored requirements go through the whole chain (save, read back, the mapper) that Task 6's carry-over compares as text.
        var (f, v1, monday) = await ApprovedAsync(requirements: new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } });
        await using var _ = f;
        // Tuesday's pattern has a default worker, the coordinator's own: Task 6 holds the unchanged support to keep it.
        var staff = Guid.NewGuid();
        f.Db.Users.Add(new User { Id = staff, TenantId = TenantA, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
        (await f.Db.ShiftPatterns.SingleAsync(p => p.SourceDraftId == v1.Id && p.DayOfWeek == DayOfWeek.Tuesday)).DefaultUserId = staff;
        await f.Db.SaveChangesAsync();
        var result = (await ChangeAsync(f, v1, Keep(monday) with { EndTime = T(14), FromDate = Oct19 })).Result!;

        var approved = await f.Service.ApproveAsync(TenantA, f.ParticipantId, result.DraftId!.Value, false, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Approved, approved.Status);
        Assert.All(await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync(), p => Assert.Equal(new DateOnly(2026, 10, 18), p.EffectiveTo));
        var made = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == result.DraftId).OrderBy(p => p.DayOfWeek).ToListAsync();
        Assert.Equal(new[] { (DayOfWeek.Monday, "weekdays-mon", T(14)), (DayOfWeek.Tuesday, "weekdays", T(13)), (DayOfWeek.Wednesday, "weekdays", T(13)), (DayOfWeek.Thursday, "weekdays", T(13)), (DayOfWeek.Friday, "weekdays", T(13)) },
            made.Select(p => (p.DayOfWeek, p.SourceBlockKey!, p.EndTime)));
        Assert.All(made, p => Assert.Equal((Oct19, (DateOnly?)Nov22), (p.EffectiveFrom, p.EffectiveTo)));
        // The real chain: a change saved by SaveAsync, then approved. The requirements went through save, read-back and the mapper and still match as text, so the unchanged days carry over with their default worker.
        var old = approved.OldShifts!;
        Assert.Equal((20, 5, 5), (old.Carried, old.Removed, approved.Approval!.ShiftsCreated));     // Tuesday to Friday, 20 October to 20 November, carried; the five unfilled Mondays from the 19th removed; five new Mondays
        Assert.Equal(30, await f.Db.Shifts.CountAsync());                                             // 30 - 5 + 5
        Assert.Equal((Guid?)staff, made.Single(p => p.DayOfWeek == DayOfWeek.Tuesday).DefaultUserId);
    }
}
