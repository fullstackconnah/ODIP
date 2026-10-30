using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>Building a file, the per-claim download's four cases, discarding, and the tenant 404s.</summary>
public class ClaimBatchBuildTests
{
    [Fact]
    public async Task Build_writes_the_file_and_changes_no_status()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(2);

        var result = await f.BuildAsync(lines.Select(l => l.Id).ToArray());

        Assert.True(result.Ok, string.Join("; ", result.Errors ?? []));
        var batch = result.Value!;
        Assert.Matches(@"^BPR261030001\.csv$", batch.FileName);
        Assert.Equal(ClaimBatchStatus.Built, batch.Status);
        Assert.Equal((2, 2, 240m), (batch.LineCount, batch.Pending, batch.TotalAmount));
        Assert.All(batch.Lines, l => Assert.Equal(ClaimBatchLineOutcome.Pending, l.Outcome));
        Assert.Equal(TripClaimStatus.Draft, (await f.Db.TripClaims.SingleAsync()).Status);
        Assert.All(await f.Db.ClaimLineItems.ToListAsync(), l => Assert.Equal(ClaimLineItemStatus.Draft, l.Status));
        var csv = Encoding.UTF8.GetString((await f.Db.ClaimBatches.SingleAsync()).Content).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(3, csv.Length);
        Assert.Contains(await f.Db.AuditLogs.ToListAsync(), a => a.EntityType == "ClaimBatch" && a.Action == AuditAction.Created && a.Changes.Contains("BPR261030001.csv: 2 lines, $240.00"));
    }

    [Fact]
    public async Task File_names_count_up_within_a_day_and_never_exceed_20_characters()
    {
        using var f = new BatchFixture();
        var names = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            var (_, lines, _) = f.AddClaim();
            var built = await f.BuildAsync(lines[0].Id);
            names.Add(built.Value!.FileName);
            if (i == 1) await f.Service.DiscardAsync(f.TenantId, f.User, built.Value.Id, default); // a discarded name is not reused
        }
        Assert.Equal(["BPR261030001.csv", "BPR261030002.csv", "BPR261030003.csv"], names);
        Assert.All(names, n => Assert.True(n.Length <= 20));
    }

    [Fact]
    public async Task The_day_in_the_name_is_the_providers_local_day()
    {
        using var f = new BatchFixture();
        f.Clock.Utc = new DateTime(2026, 10, 30, 14, 0, 0, DateTimeKind.Utc); // 01:00 on the 31st in Victoria
        var (_, lines, _) = f.AddClaim();
        Assert.Equal("BPR261031001.csv", (await f.BuildAsync(lines[0].Id)).Value!.FileName);
    }

    [Fact]
    public async Task More_than_999_files_in_a_day_is_refused()
    {
        using var f = new BatchFixture();
        for (var i = 1; i <= 999; i++)
            f.Db.ClaimBatches.Add(new ClaimBatch { Id = Guid.NewGuid(), TenantId = f.TenantId, FileName = $"BPR261030{i:D3}.csv", Status = ClaimBatchStatus.Discarded });
        f.Db.SaveChanges();
        var (_, lines, _) = f.AddClaim();

        var result = await f.BuildAsync(lines[0].Id);

        Assert.Equal(409, result.Status);
        Assert.Equal("999 files have already been built today. Try again tomorrow.", Assert.Single(result.Errors!));
    }

    [Fact]
    public async Task A_blocked_line_refuses_the_whole_build_and_writes_nothing()
    {
        using var f = new BatchFixture();
        var (_, good, _) = f.AddClaim();
        var (_, bad, _) = f.AddClaim(ndis: "12345");

        var result = await f.BuildAsync(good[0].Id, bad[0].Id);

        Assert.Equal(400, result.Status);
        var problems = ((BuildRefusalDto)result.Data!).Problems;
        Assert.Equal(bad[0].Id, Assert.Single(problems).LineId);
        Assert.Equal("NdisNumber", problems[0].Rule);
        Assert.Empty(await f.Db.ClaimBatches.ToListAsync());
        Assert.Empty(await f.Db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task A_claim_is_sent_whole()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(2);

        var result = await f.BuildAsync(lines[0].Id);

        Assert.Equal(400, result.Status);
        Assert.Contains($"{claim.ClaimReference} has lines you didn't choose. A claim is sent whole: include all of its lines.", result.Errors!);
    }

    [Fact]
    public async Task Naming_a_claim_picks_its_waiting_agency_lines_only()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(2);

        var result = await f.BuildClaimsAsync(claim.Id);

        Assert.True(result.Ok);
        Assert.Equal(lines.Select(l => l.Id).Order(), result.Value!.Lines.Select(l => l.ClaimLineItemId!.Value).Order());
    }

    [Fact]
    public async Task Naming_a_claim_with_no_agency_lines_is_a_400()
    {
        using var f = new BatchFixture();
        var (claim, _, _) = f.AddClaim(plan: PlanType.PlanManaged);
        var result = await f.BuildClaimsAsync(claim.Id);
        Assert.Equal(400, result.Status);
    }

    [Fact]
    public async Task Nothing_chosen_is_a_400()
    {
        using var f = new BatchFixture();
        var result = await f.Service.BuildAsync(f.TenantId, f.User, new BuildRequest([], [], []), default);
        Assert.Equal((400, "Choose at least one line to send."), (result.Status, result.Errors![0]));
    }

    [Theory]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Approved)]
    [InlineData(TripClaimStatus.Paid)]
    [InlineData(TripClaimStatus.PartiallyPaid)]
    [InlineData(TripClaimStatus.Cancelled)]
    [InlineData(TripClaimStatus.Rejected)]
    public async Task A_claim_that_is_not_open_cannot_have_its_draft_lines_sent(TripClaimStatus status)
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim(status: status);

        var result = await f.BuildAsync(lines[0].Id);

        Assert.Equal(400, result.Status);
        Assert.Contains(((BuildRefusalDto)result.Data!).Problems, p => p.Rule == "ClaimNotOpen");
    }

    [Theory]
    [InlineData(TripClaimStatus.Submitted)]
    [InlineData(TripClaimStatus.Approved)]
    [InlineData(TripClaimStatus.PartiallyPaid)]
    public async Task A_rejected_line_on_a_claim_that_is_out_can_still_be_lodged_again(TripClaimStatus status)
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim(status: status, lineStatus: ClaimLineItemStatus.Rejected);

        var result = await f.BuildAsync(lines[0].Id);

        Assert.True(result.Ok, string.Join("; ", result.Errors ?? []));
    }

    [Fact]
    public async Task A_number_saved_with_a_trailing_space_is_written_and_stored_trimmed()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim(ndis: "431234567 ");

        var built = await f.BuildAsync(lines[0].Id);

        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        Assert.Equal("431234567", (await f.Db.ClaimBatchLines.SingleAsync()).NdisNumber);
        var file = System.Text.Encoding.UTF8.GetString((await f.Db.ClaimBatches.SingleAsync()).Content);
        Assert.Contains(",431234567,", file);
        Assert.DoesNotContain("431234567 ", file);
    }

    [Fact]
    public async Task A_line_already_in_a_file_cannot_go_in_another()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var first = await f.BuildAsync(lines[0].Id);

        var second = await f.BuildAsync(lines[0].Id);

        Assert.Equal(400, second.Status);
        var problem = Assert.Single(((BuildRefusalDto)second.Data!).Problems);
        Assert.Equal("AlreadyPending", problem.Rule);
        Assert.Contains(first.Value!.FileName, problem.Message);
    }

    [Fact]
    public async Task Lines_made_by_the_shift_generator_for_a_normal_participant_pass_the_hard_checks()
    {
        using var f = new BatchFixture();
        var (_, _, participant) = f.AddClaim(0);
        var group = f.Db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 }).Entity;
        f.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = "04_Weekday_STD", Description = "Weekday access", DayType = ClaimDayType.Weekday, PriceLimit_VIC = 40m,
            CatalogueVersion = "2024-25", EffectiveFrom = new DateOnly(2024, 7, 1), IsActive = true,
        });
        f.Db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.TenantId, ParticipantId = participant.Id, ServiceDate = new DateOnly(2026, 9, 7), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        });
        await f.Db.SaveChangesAsync();
        var claim = await new ShiftClaimGenerationService(f.Db).GenerateDraftClaimAsync(participant.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7));

        var result = await f.BuildClaimsAsync(claim.Id);

        Assert.True(result.Ok, string.Join("; ", result.Errors ?? []) + " " + string.Join("; ", (result.Data as BuildRefusalDto)?.Problems.Select(p => p.Rule + ": " + p.Message) ?? []));
        Assert.Equal(320m, result.Value!.TotalAmount);
    }

    // ---- the per-claim download (G9) ----

    [Fact]
    public async Task Per_claim_download_builds_a_one_claim_file()
    {
        using var f = new BatchFixture();
        var (claim, _, _) = f.AddClaim(2);

        var result = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default);

        Assert.True(result.Ok, string.Join("; ", result.Errors ?? []));
        Assert.Equal("BPR261030001.csv", result.Value!.FileName);
        Assert.Equal(3, Encoding.UTF8.GetString(result.Value.Content).Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);
    }

    [Fact]
    public async Task Per_claim_download_twice_gives_the_same_file_not_a_second_one()
    {
        using var f = new BatchFixture();
        var (claim, _, _) = f.AddClaim();

        var first = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default);
        var second = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default);

        Assert.Equal(first.Value!.BatchId, second.Value!.BatchId);
        Assert.Equal(first.Value.Content, second.Value.Content);
        Assert.Single(await f.Db.ClaimBatches.ToListAsync());
    }

    [Fact]
    public async Task Per_claim_download_of_a_claim_sent_in_an_uploaded_file_says_to_import_its_results()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);
        (await f.Db.ClaimBatches.SingleAsync()).Status = ClaimBatchStatus.Uploaded;
        await f.Db.SaveChangesAsync();

        var result = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default);

        Assert.Equal(409, result.Status);
        Assert.Equal($"This claim was sent in {built.Value!.FileName}. Import that file's results in Claims before lodging it again.", Assert.Single(result.Errors!));
    }

    [Fact]
    public async Task Per_claim_download_of_a_claim_in_a_file_with_other_claims_says_so()
    {
        using var f = new BatchFixture();
        var (claim, a, _) = f.AddClaim();
        var (_, b, _) = f.AddClaim();
        var built = await f.BuildAsync(a[0].Id, b[0].Id);

        var result = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default);

        Assert.Equal(409, result.Status);
        Assert.Equal($"This claim is in {built.Value!.FileName} with other claims. Download it from Claims, or discard it first.", Assert.Single(result.Errors!));
    }

    [Fact]
    public async Task Per_claim_download_after_a_discard_builds_a_new_file()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);
        await f.Service.DiscardAsync(f.TenantId, f.User, built.Value!.Id, default);

        var result = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default);

        Assert.True(result.Ok);
        Assert.Equal("BPR261030002.csv", result.Value!.FileName);
    }

    [Fact]
    public async Task Per_claim_download_of_a_claim_with_no_agency_lines_is_a_400()
    {
        using var f = new BatchFixture();
        var (claim, _, _) = f.AddClaim(plan: PlanType.SelfManaged);
        Assert.Equal(400, (await f.Service.DownloadForClaimAsync(f.TenantId, f.User, claim.Id, default)).Status);
    }

    // ---- discard ----

    [Fact]
    public async Task Discard_frees_the_lines_and_a_second_discard_is_refused()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);

        var discarded = await f.Service.DiscardAsync(f.TenantId, f.User, built.Value!.Id, default);

        Assert.Equal((ClaimBatchStatus.Discarded, 1), (discarded.Value!.Status, discarded.Value.Withdrawn));
        Assert.NotNull(discarded.Value.DiscardedAt);
        Assert.Equal(409, (await f.Service.DiscardAsync(f.TenantId, f.User, built.Value.Id, default)).Status);
        // The line can go in a new file now.
        Assert.True((await f.BuildAsync(lines[0].Id)).Ok);
    }

    [Fact]
    public async Task The_file_of_a_discarded_batch_is_refused()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);
        Assert.True((await f.Service.FileAsync(f.TenantId, built.Value!.Id, default)).Ok);
        await f.Service.DiscardAsync(f.TenantId, f.User, built.Value.Id, default);

        var file = await f.Service.FileAsync(f.TenantId, built.Value.Id, default);

        Assert.Equal((409, "This file was discarded. Build a new one."), (file.Status, file.Errors![0]));
    }

    // ---- another organisation's ids (M1, M5) ----

    [Fact]
    public async Task Another_organisations_ids_are_a_404_with_the_same_body_as_a_missing_id()
    {
        using var f = new BatchFixture();
        var (_, mine, _) = f.AddClaim();
        var built = await f.BuildAsync(mine[0].Id);
        var foreignId = built.Value!.Id;
        var other = f.OtherTenantId;
        var missing = Guid.NewGuid();
        var ct = CancellationToken.None;

        async Task<(int, string)[]> Probe(Guid tenant, Guid id) =>
        [
            Shape(await f.Service.DetailAsync(tenant, id, ct)), Shape(await f.Service.FileAsync(tenant, id, ct)), Shape(await f.Service.DiscardAsync(tenant, f.User, id, ct)),
            Shape(await f.Service.ConfirmUploadedAsync(tenant, f.User, id, ct)), Shape(await f.Service.ImportResultsAsync(tenant, f.User, id, [], ct)),
            Shape(await f.Service.MarkPaidAsync(tenant, f.User, id, [], ct)), Shape(await f.Service.DismissAsync(tenant, f.User, id, ct)),
            Shape(await f.Service.DownloadForClaimAsync(tenant, f.User, id, ct)),
        ];
        static (int, string) Shape<T>(BatchResult<T> r) => (r.Status, string.Join("|", r.Errors ?? []));

        var foreign = await Probe(other, foreignId);
        var absent = await Probe(f.TenantId, missing);

        Assert.All(foreign, s => Assert.Equal((404, "Not found."), s));
        Assert.Equal(absent, foreign);
    }

    [Fact]
    public async Task Building_from_another_organisations_line_or_claim_is_a_404_and_writes_nothing()
    {
        using var f = new BatchFixture();
        var (foreignClaim, foreignLines, _) = f.AddClaim(tenant: f.OtherTenantId);

        var byLine = await f.BuildAsync(foreignLines[0].Id);
        var byClaim = await f.BuildClaimsAsync(foreignClaim.Id);
        var viaClaimFile = await f.Service.DownloadForClaimAsync(f.TenantId, f.User, foreignClaim.Id, default);

        Assert.All(new[] { byLine.Status, byClaim.Status, viaClaimFile.Status }, s => Assert.Equal(404, s));
        Assert.Empty(await f.Db.ClaimBatches.ToListAsync());
    }

    [Fact]
    public async Task A_super_admin_viewing_as_one_organisation_cannot_build_from_a_foreign_id()
    {
        // TestDb.Create() is a SuperAdmin context: the query filters are off, so only the service's own tenant scoping stands between the two organisations.
        using var f = new BatchFixture();
        var (_, foreign, _) = f.AddClaim(tenant: f.OtherTenantId);
        var (_, mine, _) = f.AddClaim();

        var result = await f.BuildAsync(mine[0].Id, foreign[0].Id);

        Assert.Equal(404, result.Status);
        Assert.Empty(await f.Db.ClaimBatches.ToListAsync());
    }
}
