using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Shift billing PR2: an approved agreement gives its patterns the support type of the block's first hourly line, and a carried pattern keeps its type when the new revision supplies none.</summary>
public class AgreementApprovalSupportTypeTests
{
    private static readonly DateOnly Nov22 = new(2026, 11, 22), Nov23 = new(2026, 11, 23), Jan3 = new(2027, 1, 3);

    private static void AddRow(Fixture f, string group, string itemNumber, string unit = "H")
    {
        var g = f.Db.SupportActivityGroups.Local.FirstOrDefault(x => x.GroupCode == group)
            ?? f.Db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = group, DisplayName = group, SupportCategory = 4 }).Entity;
        f.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = g.Id, ItemNumber = itemNumber, Description = itemNumber, DayType = ClaimDayType.Weekday, IsIntensive = false, Unit = unit,
            PriceLimit_VIC = 50m, PriceLimit_NSW = 50m, PriceLimit_ACT = 50m, PriceLimit_NT = 50m, PriceLimit_QLD = 50m, PriceLimit_SA = 50m, PriceLimit_TAS = 50m, PriceLimit_WA = 50m,
            PriceLimit_Remote = 50m, PriceLimit_VeryRemote = 50m, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        });
    }

    private static async Task SetLineCodeAsync(Fixture f, ServiceAgreementDraft draft, string code)
    {
        foreach (var line in await f.Db.ServiceAgreementDraftLines.Where(l => l.DraftId == draft.Id).ToListAsync()) line.ItemCode = code;
        await f.Db.SaveChangesAsync();
    }

    private static async Task<string> FirstCodeAsync(Fixture f, Guid draftId, string blockKey) =>
        (await f.Db.ServiceAgreementDraftLines.AsNoTracking().Where(l => l.DraftId == draftId && l.BlockKey == blockKey).OrderBy(l => l.Position).FirstAsync()).ItemCode;

    private static Task<List<string?>> CodesAsync(Fixture f, Guid draftId) =>
        f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == draftId).Select(p => p.SupportGroupCode).ToListAsync();

    [Fact]
    public async Task Approving_gives_each_pattern_the_group_of_its_blocks_first_hourly_line_and_a_block_with_none_gets_null()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock(), WeekdayBlock("other", b => b with { Days = new[] { DayOfWeek.Saturday } }) }, end: Nov22);
        var itemCode = await FirstCodeAsync(f, v1.Id, "weekdays");
        AddRow(f, "GRP_X", itemCode);
        await f.Db.SaveChangesAsync();
        // The second block's lines name a code the catalogue has no hourly row for.
        foreach (var line in await f.Db.ServiceAgreementDraftLines.Where(l => l.DraftId == v1.Id && l.BlockKey == "other").ToListAsync()) line.ItemCode = "ZZ_NONE";
        await f.Db.SaveChangesAsync();

        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None)).Status);

        var made = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync();
        Assert.All(made.Where(p => p.SourceBlockKey == "weekdays"), p => Assert.Equal("GRP_X", p.SupportGroupCode));
        Assert.All(made.Where(p => p.SourceBlockKey == "other"), p => Assert.Null(p.SupportGroupCode));
    }

    [Fact]
    public async Task A_line_whose_catalogue_row_is_not_hourly_does_not_set_the_type()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22);
        AddRow(f, "GRP_X", await FirstCodeAsync(f, v1.Id, "weekdays"), unit: "EA");
        await f.Db.SaveChangesAsync();

        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);

        Assert.All(await CodesAsync(f, v1.Id), code => Assert.Null(code));
    }

    [Fact]
    public async Task A_change_that_ends_patterns_carries_the_old_type_when_the_draft_supplies_none_and_a_draft_type_wins()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22);
        AddRow(f, "GRP_X", await FirstCodeAsync(f, v1.Id, "weekdays"));
        AddRow(f, "GRP_Y", "Y_WD");
        await f.Db.SaveChangesAsync();
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);
        Assert.All(await CodesAsync(f, v1.Id), code => Assert.Equal("GRP_X", code));

        // The same support from 2 November, whose lines name no catalogue row: the patterns keep GRP_X. It is not part of what makes two patterns the same support, so all five are carried.
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 2), end: Nov22);
        await SetLineCodeAsync(f, v2, "ZZ_NONE");
        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, v2.Id, false, Admin, CancellationToken.None);
        Assert.Equal(5, outcome.Approval!.PatternsEnded);
        Assert.All(await CodesAsync(f, v2.Id), code => Assert.Equal("GRP_X", code));

        // And a revision that names another type gets that one.
        var v3 = await AddRevisionAsync(f, 3, new[] { WeekdayBlock() }, start: new DateOnly(2026, 11, 9), end: Nov22);
        await SetLineCodeAsync(f, v3, "Y_WD");
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v3.Id, false, Admin, CancellationToken.None);
        Assert.All(await CodesAsync(f, v3.Id), code => Assert.Equal("GRP_Y", code));
    }

    [Fact]
    public async Task A_renewal_carries_the_old_type_when_the_draft_supplies_none()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: Nov22);
        AddRow(f, "GRP_X", await FirstCodeAsync(f, v1.Id, "weekdays"));
        await f.Db.SaveChangesAsync();
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);

        var renewal = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: Nov23, end: Jan3);
        await SetLineCodeAsync(f, renewal, "ZZ_NONE");
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, renewal.Id, false, Admin, CancellationToken.None);

        Assert.All(await CodesAsync(f, renewal.Id), code => Assert.Equal("GRP_X", code));
    }
}
