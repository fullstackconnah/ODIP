using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Renew agreement (agreement PR 2). The approval fixture's clock (Saturday 10 October 2026, Sydney) with the real 2026-27 catalogue imported, because a save prices from the database.
/// v1 is weekday mornings from 12 October to 22 November 2026 (42 days), approved. Community access on a weekday, one to one, is 04_104_0125_6_1 at $73.58 an hour, so a morning is $294.32.
/// The in-memory database has no public holiday rows, so the engine prices Christmas as an ordinary day (with a notice), which keeps the cents simple.
/// </summary>
public class AgreementRenewalServiceTests
{
    private static readonly DateOnly Nov2 = new(2026, 11, 2), Nov22 = new(2026, 11, 22), Nov23 = new(2026, 11, 23), Jan3 = new(2027, 1, 3);
    private static readonly DateOnly PlanStart = new(2026, 7, 1), PlanEnd = new(2027, 6, 30);

    private static async Task<(Fixture F, ServiceAgreementDraft V1)> ApprovedV1Async(bool withPlan = true)
    {
        var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22,
            requirements: new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } });
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None)).Status);
        if (withPlan) await PlanAsync(f, PlanStart, PlanEnd);
        return (f, v1);
    }

    private static async Task PlanAsync(Fixture f, DateOnly start, DateOnly end)
    {
        f.Db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, PlanStart = start, PlanEnd = end });
        await f.Db.SaveChangesAsync();
    }

    private static Task<RenewalOutcome> RenewAsync(Fixture f, ServiceAgreementDraft source, ApprovalCaller? caller = null, Guid? tenantId = null) =>
        new AgreementRenewalService(f.Db).RenewAsync(tenantId ?? TenantA, f.ParticipantId, source.Id, caller ?? Admin, "coordinator-1", CancellationToken.None);

    private static Task<ServiceAgreementDraft> StoredAsync(Fixture f, Guid id) =>
        f.Db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).Include(d => d.Lines).SingleAsync(d => d.Id == id);

    private static Task<int> RevisionCountAsync(Fixture f) => f.Db.ServiceAgreementDrafts.CountAsync(d => d.ParticipantId == f.ParticipantId);

    [Fact]
    public async Task Renewing_copies_the_blocks_from_the_day_after_the_end_for_the_same_length_priced_now_never_at_the_old_price()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        foreach (var line in v1.Lines) line.UnitPrice = 1m;                       // a price nobody should see again: lines are priced now, never copied
        await f.Db.SaveChangesAsync();

        var outcome = await RenewAsync(f, v1);

        var v2 = await StoredAsync(f, outcome.Draft!.Id);
        // Six whole weeks from Monday 23 November: 30 weekday mornings at $294.32.
        Assert.Equal((2, Nov23, Jan3, PlanStart, PlanEnd, "NSW"), (v2.Version, v2.AgreementStartDate, v2.AgreementEndDate, v2.PlanStartDate, v2.PlanEndDate, v2.State));
        Assert.Equal(8829.60m, v2.Lines.Sum(l => l.Total));
        Assert.All(v2.Lines, l => Assert.Equal(("04_104_0125_6_1", 73.58m), (l.ItemCode, l.UnitPrice)));
        var block = DraftJson.ToDto(Assert.Single(v2.Blocks));
        Assert.Equal(("weekdays", "Female", true, "FirstAid"), (block.Block.Id, block.Requirements.WorkerGender, block.Requirements.Driver, string.Join(",", block.Requirements.Skills)));
        Assert.False(await f.Db.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == v2.Id));   // a Draft: approved through the approval
        Assert.Equal(2, await RevisionCountAsync(f));                                                  // v1 stays, approved
    }


    [Fact]
    public async Task A_term_changed_mid_way_is_renewed_for_its_whole_length()
    {
        var (f, _) = await ApprovedV1Async();
        await using var __ = f;
        // A PR 1 change from 2 November, approved: it covers the term's last three weeks and keeps its end.
        var change = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: Nov2, end: Nov22);
        await MarkApprovedAsync(f.Db, change);

        var v3 = await StoredAsync(f, (await RenewAsync(f, change)).Draft!.Id);

        Assert.Equal((3, Nov23, Jan3), (v3.Version, v3.AgreementStartDate, v3.AgreementEndDate));      // 42 days, the term's, not the change's 21
    }

    [Fact]
    public async Task With_no_plan_covering_the_day_after_the_end_it_says_record_the_new_plan_first_and_saves_nothing()
    {
        var (f, v1) = await ApprovedV1Async(withPlan: false);
        await using var _ = f;
        await PlanAsync(f, PlanStart, Nov22);                                        // the plan ends the day the agreement does

        var refused = await RenewAsync(f, v1);

        Assert.True(refused.PlanNeeded);
        Assert.Null(refused.Draft);
        Assert.Equal("Record the new plan first: no plan of the participant's covers 2026-11-23, the day the renewal starts.", Assert.Single(refused.Errors));
        Assert.Equal(1, await RevisionCountAsync(f));

        await PlanAsync(f, Nov23, new DateOnly(2027, 11, 22));                       // the new plan, starting exactly on that day, covers it
        var v2 = await StoredAsync(f, (await RenewAsync(f, v1)).Draft!.Id);
        Assert.Equal((Nov23, Jan3, Nov23, new DateOnly(2027, 11, 22)), (v2.AgreementStartDate, v2.AgreementEndDate, v2.PlanStartDate, v2.PlanEndDate));
    }

    [Fact]
    public async Task The_renewal_stops_at_the_end_of_a_plan_that_ends_sooner_than_the_term()
    {
        var (f, v1) = await ApprovedV1Async(withPlan: false);
        await using var _ = f;
        await PlanAsync(f, PlanStart, new DateOnly(2026, 12, 31));

        var v2 = await StoredAsync(f, (await RenewAsync(f, v1)).Draft!.Id);

        Assert.Equal((Nov23, new DateOnly(2026, 12, 31)), (v2.AgreementStartDate, v2.AgreementEndDate));
    }

    [Fact]
    public async Task A_renewal_while_a_newer_revision_waits_is_a_409_and_the_waiting_one_survives()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        var waiting = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: Nov2, end: Nov22);   // a change nobody has approved yet

        var refused = await RenewAsync(f, v1);

        Assert.Equal(2, refused.ConflictVersion);
        Assert.Null(refused.Draft);
        Assert.Equal("This agreement has a newer revision, v2. Load it first: a renewal would replace it.", Assert.Single(refused.Errors));
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(d => d.Id == waiting.Id));
        Assert.Equal(2, await RevisionCountAsync(f));
    }


    [Fact]
    public async Task An_item_missing_from_the_new_price_list_is_saved_as_an_issue_and_blocks_approval()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        // The price list withdraws the item from 23 November: every row of it ends the day before.
        foreach (var row in await f.Db.SupportCatalogueItems.Where(i => i.ItemNumber == "04_104_0125_6_1").ToListAsync()) row.EffectiveTo = Nov22;
        await f.Db.SaveChangesAsync();

        var v2 = await StoredAsync(f, (await RenewAsync(f, v1)).Draft!.Id);         // saved, as any save with an issue is

        var quote = DraftJson.ReadQuote(v2.PricingJson)!;
        Assert.True(quote.NeedsReview);
        Assert.Contains(quote.Issues, i => i.Reason is PlanFailureReason.CatalogueNotFound or PlanFailureReason.NoItem);
        Assert.DoesNotContain(v2.Lines, l => l.ItemCode == "04_104_0125_6_1");
        Assert.Equal(ApprovalStatus.Refused, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, v2.Id, false, Admin, CancellationToken.None)).Status);
    }

    [Fact]
    public async Task Approving_the_renewal_ends_nothing_and_leaves_v1s_patterns_as_they_were()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        var v1Patterns = await PatternRowsAsync(f, v1.Id);
        var v2 = (await RenewAsync(f, v1)).Draft!;

        var approved = await f.Service.ApproveAsync(TenantA, f.ParticipantId, v2.Id, false, Admin, CancellationToken.None);

        Assert.Equal((ApprovalStatus.Approved, 0, 5), (approved.Status, approved.Approval!.PatternsEnded, approved.Approval.PatternsCreated));
        Assert.Equal(v1Patterns, await PatternRowsAsync(f, v1.Id));
        Assert.All(await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v2.Id).ToListAsync(), p => Assert.Equal((Nov23, (DateOnly?)Jan3), (p.EffectiveFrom, p.EffectiveTo)));
    }

    private static Task<List<string>> PatternRowsAsync(Fixture f, Guid draftId) =>
        f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == draftId).OrderBy(p => p.Id)
            .Select(p => $"{p.Id} {p.DayOfWeek} {p.EffectiveFrom} {p.EffectiveTo} {p.IsActive} {p.DefaultUserId}").ToListAsync();

    [Fact]
    public async Task Only_an_approver_renews_and_only_the_newest_approved_revision_of_their_own_organisation()
    {
        var (f, v1) = await ApprovedV1Async();
        await using var _ = f;
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        await f.Db.SaveChangesAsync();

        var coordinator = await RenewAsync(f, v1, Coordinator);
        Assert.True(coordinator.NotAnApprover);
        Assert.Equal("Your role cannot renew agreements in your organisation. An Admin can change who may approve in Settings, Plan pricing.", Assert.Single(coordinator.Errors));
        Assert.True((await RenewAsync(f, v1, tenantId: TenantB)).NotFound);           // another organisation's revision is not there

        var change = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: Nov2, end: Nov22);
        await MarkApprovedAsync(f.Db, change);
        Assert.Equal("Renew the agreement from its newest approved revision, v2.", Assert.Single((await RenewAsync(f, v1)).Errors));
        Assert.Equal(2, await RevisionCountAsync(f));

        await using var unapproved = await SetUpAsync();
        var draft = await AddRevisionAsync(unapproved, 1, new[] { WeekdayBlock() }, end: Nov22);
        Assert.Equal("This agreement is not approved for rostering yet, so there is nothing to renew.", Assert.Single((await RenewAsync(unapproved, draft)).Errors));
    }

    /// <summary>Fix round 1 (deep S4, the lead's decision): a renewal cut short by the plan does not shorten the ones after it. The length is the first term's in the chain of terms that each start the day after the one before.</summary>
    [Fact]
    public async Task A_renewal_of_a_plan_capped_renewal_runs_for_the_original_terms_length()
    {
        var (f, v1) = await ApprovedV1Async(withPlan: false);
        await using var _ = f;
        await PlanAsync(f, PlanStart, new DateOnly(2026, 12, 31));
        var v2 = (await RenewAsync(f, v1)).Draft!;                                       // 23 Nov to 31 Dec: 39 days, cut at the plan's end
        await MarkApprovedAsync(f.Db, v2);
        await PlanAsync(f, new DateOnly(2027, 1, 1), new DateOnly(2027, 12, 31));

        var v3 = await StoredAsync(f, (await RenewAsync(f, v2)).Draft!.Id);

        Assert.Equal((3, new DateOnly(2027, 1, 1), new DateOnly(2027, 2, 11)), (v3.Version, v3.AgreementStartDate, v3.AgreementEndDate));   // v1's 42 days, not v2's 39
    }

    /// <summary>Fix round 1 (deep S1): a term of whole calendar months renews for the same months, so a year stays a year across 29 February; any other term keeps its length in days.</summary>
    [Theory]
    [InlineData("2027-07-01", "2028-06-30", "2028-07-01", "2029-06-30")]   // 366 days, holding 29 Feb 2028: a year, not a year and a day
    [InlineData("2027-01-01", "2027-12-31", "2028-01-01", "2028-12-31")]   // 365 days into a leap year: a year, not a day short
    [InlineData("2027-03-01", "2027-05-31", "2027-06-01", "2027-08-31")]   // three months, 92 days, into 92 days
    [InlineData("2026-10-12", "2026-11-22", "2026-11-23", "2027-01-03")]   // 42 days, not whole months: 42 days again
    [InlineData("2028-01-31", "2028-02-29", "2028-03-01", "2028-03-30")]   // 30 days that only look like a month: days
    public void A_term_of_whole_months_renews_for_the_same_months_and_any_other_for_the_same_days(string termStart, string termEnd, string start, string expected) =>
        Assert.Equal(DateOnly.Parse(expected), AgreementRenewalService.SameLengthEnd(DateOnly.Parse(termStart), DateOnly.Parse(termEnd), DateOnly.Parse(start)));
}
