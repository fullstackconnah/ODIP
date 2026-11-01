using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>
/// Claims sent and paid by provider-local week. The fixture clock is pinned at Fri 2026-10-30 02:00Z (13:00 AEDT), so the window is the 12 Mondays from 10 Aug to 26 Oct 2026.
/// Sydney and Melbourne changed to daylight saving on Sun 4 Oct 2026, inside that window.
/// </summary>
public class ClaimPipelineTests
{
    private static readonly DateOnly Aug10 = new(2026, 8, 10);
    private static DateTime Utc(int m, int d, int h = 0, int min = 0) => new(2026, m, d, h, min, 0, DateTimeKind.Utc);
    private const int Last = 11; // the current week: 26 Oct

    private static byte[] Csv(params string[] rows) =>
        Encoding.UTF8.GetBytes(string.Join("\r\n", new[] { "Claim Reference,Status,Error Code,Error Message,Paid Amount" }.Concat(rows)));

    private static ClaimsController Controller(BatchFixture f)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(f.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new ClaimsController(f.Db, new ClaimGenerationService(f.Db), new ShiftClaimGenerationService(f.Db), new BprCsvService(f.Db), new InvoiceService(f.Db),
            new BudgetLedgerService(f.Db, f.Clock), tenant.Object, f.Clock)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test")) } },
        };
    }

    private static async Task Patch(BatchFixture f, TripClaim claim, ClaimLineItem line, ClaimLineItemStatus status, decimal? paid = null)
    {
        var result = await Controller(f).UpdateLineItem(claim.Id, line.Id, new UpdateClaimLineItemDto { Status = status, PaidAmount = paid }, default);
        Assert.Equal(200, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode ?? 200);
    }

    /// <summary>Builds a file of the lines now (the fixture clock), then confirms it uploaded at <paramref name="at"/>.</summary>
    private static async Task<BatchDetailDto> SentAsync(BatchFixture f, DateTime at, params Guid[] lineIds)
    {
        f.Clock.Utc = BatchFixture.Now;
        var built = await f.BuildAsync(lineIds);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        f.Clock.Utc = at;
        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value!.Id, default);
        Assert.True(up.Ok, string.Join("; ", up.Errors ?? []));
        f.Clock.Utc = BatchFixture.Now;
        return built.Value;
    }

    private static async Task ResultsAsync(BatchFixture f, BatchDetailDto file, string outcome, string? paid = null)
    {
        var imported = await f.Service.ImportResultsAsync(f.TenantId, f.User, file.Id, Csv(file.Lines.Select(l => $"{l.RowReference},{outcome},{(outcome == "Rejected" ? "ZZA" : "")},{(outcome == "Rejected" ? "no" : "")},{paid}").ToArray()), default);
        Assert.True(imported.Ok, string.Join("; ", imported.Errors ?? []));
    }

    private static async Task<PipelineDto> PipelineAsync(BatchFixture f, DateTime? now = null)
    {
        f.Clock.Utc = now ?? BatchFixture.Now;
        return await f.Service.PipelineAsync(f.TenantId, default);
    }

    // ---- sent ----

    [Fact]
    public async Task Sent_week_equals_the_files_tab_total_to_the_cent()
    {
        using var f = new BatchFixture();
        var (_, a, _) = f.AddClaim();
        var (_, b, _) = f.AddClaim();
        a[0].TotalAmount = 1234.56m;
        b[0].TotalAmount = 0.01m;
        await f.Db.SaveChangesAsync();
        await SentAsync(f, Utc(10, 27, 1), a[0].Id);
        await SentAsync(f, Utc(10, 28, 1), b[0].Id);

        var p = await PipelineAsync(f);

        var filesTotal = (await f.Service.BatchesAsync(f.TenantId, null, 10, default)).Sum(x => x.TotalAmount);
        Assert.Equal(1234.57m, filesTotal);
        Assert.Equal(filesTotal, p.Weeks[Last].Sent);
        Assert.Equal(1234.57m, p.Weeks.Sum(w => w.Sent));
    }

    [Fact]
    public async Task Built_and_discarded_files_are_not_sent()
    {
        using var f = new BatchFixture();
        var (_, a, _) = f.AddClaim();
        var (_, b, _) = f.AddClaim();
        Assert.True((await f.BuildAsync(a[0].Id)).Ok);
        var discarded = (await f.BuildAsync(b[0].Id)).Value!;
        Assert.True((await f.Service.DiscardAsync(f.TenantId, f.User, discarded.Id, default)).Ok);

        var p = await PipelineAsync(f);

        Assert.All(p.Weeks, w => Assert.Equal(0m, w.Sent));
    }

    [Fact]
    public async Task Late_Sunday_utc_upload_lands_in_the_provider_week()
    {
        using var f = new BatchFixture();
        var (_, a, _) = f.AddClaim();
        var (_, b, _) = f.AddClaim();
        await SentAsync(f, Utc(11, 1, 14, 30), a[0].Id); // Mon 01:30 AEDT: the week of 2 Nov
        await SentAsync(f, Utc(11, 1, 12, 30), b[0].Id); // Sun 23:30 AEDT: the week of 26 Oct

        var p = await PipelineAsync(f, Utc(11, 3, 2));

        Assert.Equal(new DateOnly(2026, 11, 2), p.Weeks[Last].WeekStart);
        Assert.Equal((120m, 120m), (p.Weeks[Last].Sent, p.Weeks[Last - 1].Sent));
    }

    [Fact]
    public async Task A_Perth_organisation_is_bucketed_by_its_own_zone()
    {
        using var f = new BatchFixture();
        (await f.Db.ProviderSettings.SingleAsync()).State = "WA";
        await f.Db.SaveChangesAsync();
        var (_, a, _) = f.AddClaim();
        var (_, b, _) = f.AddClaim();
        await SentAsync(f, Utc(11, 1, 16, 30), a[0].Id); // Mon 00:30 AWST: the week of 2 Nov
        await SentAsync(f, Utc(11, 1, 15, 30), b[0].Id); // Sun 23:30 AWST: the week of 26 Oct

        var p = await PipelineAsync(f, Utc(11, 3, 2));

        Assert.Equal((120m, 120m), (p.Weeks[Last].Sent, p.Weeks[Last - 1].Sent));
    }

    [Fact]
    public async Task Window_is_12_mondays_across_the_4_Oct_2026_DST_change_with_the_clock_pinned_at_30_Oct()
    {
        using var f = new BatchFixture();
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++) ids.Add(f.AddClaim().Lines[0].Id);
        await SentAsync(f, Utc(8, 9, 14, 0), ids[0]);   // Mon 10 Aug 00:00 AEST: the first instant of week 1
        await SentAsync(f, Utc(8, 9, 13, 59), ids[1]);  // Sun 9 Aug 23:59 AEST: before the window
        await SentAsync(f, Utc(10, 4, 13, 30), ids[2]); // Mon 5 Oct 00:30 AEDT (a fixed +10 would say Sun 4 Oct): the week of 5 Oct
        await SentAsync(f, Utc(10, 29, 13, 0), ids[3]); // the current week
        await SentAsync(f, Utc(11, 1, 13, 0), ids[4]);  // Mon 2 Nov 00:00 AEDT: after the window

        var p = await PipelineAsync(f);

        Assert.Equal(12, p.Weeks.Count);
        Assert.Equal(Enumerable.Range(0, 12).Select(i => Aug10.AddDays(7 * i)), p.Weeks.Select(w => w.WeekStart));
        Assert.Equal(new DateOnly(2026, 10, 30), p.Today);
        Assert.Equal(new[] { 120m, 0, 0, 0, 0, 0, 0, 0, 120m, 0, 0, 120m }, p.Weeks.Select(w => w.Sent));
    }

    // ---- paid ----

    [Fact]
    public async Task Paid_counts_the_paid_amount_in_its_paid_week()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var file = await SentAsync(f, Utc(10, 13, 1), lines[0].Id);
        await ResultsAsync(f, file, "Successful");
        f.Clock.Utc = Utc(10, 27, 3);
        Assert.True((await f.Service.MarkPaidAsync(f.TenantId, f.User, file.Id, [new PaidLineRequest(file.Lines[0].BatchLineId, 95m)], default)).Ok);

        var p = await PipelineAsync(f);

        Assert.Equal(95m, p.Weeks[Last].Paid);
        Assert.Equal(Utc(10, 27, 3), (await f.Db.ClaimLineItems.SingleAsync()).PaidAt);
    }

    [Fact]
    public async Task Line_paid_by_hand_after_a_file_stamps_paid_at_and_counts_and_leaving_paid_clears_it()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var file = await SentAsync(f, Utc(10, 13, 1), lines[0].Id);
        await ResultsAsync(f, file, "Successful");
        var line = lines[0];

        f.Clock.Utc = Utc(10, 28, 3);
        await Patch(f, claim, line, ClaimLineItemStatus.Paid, 100m);
        Assert.Equal((Utc(10, 28, 3), 100m), (line.PaidAt, (await PipelineAsync(f, Utc(10, 28, 4))).Weeks[Last].Paid));

        await Patch(f, claim, line, ClaimLineItemStatus.Approved);
        Assert.Null(line.PaidAt);
        Assert.Equal(0m, (await PipelineAsync(f)).Weeks[Last].Paid);

        f.Clock.Utc = Utc(10, 29, 3);
        await Patch(f, claim, line, ClaimLineItemStatus.Paid, 100m);
        Assert.Equal(Utc(10, 29, 3), line.PaidAt);
    }

    [Fact]
    public async Task Resaving_a_paid_line_keeps_its_paid_week()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var file = await SentAsync(f, Utc(10, 6, 1), lines[0].Id);
        await ResultsAsync(f, file, "Successful");
        f.Clock.Utc = Utc(10, 13, 3);
        Assert.True((await f.Service.MarkPaidAsync(f.TenantId, f.User, file.Id, [], default)).Ok);

        f.Clock.Utc = Utc(10, 29, 3);
        await Patch(f, claim, lines[0], ClaimLineItemStatus.Paid, 80m);

        var p = await PipelineAsync(f);
        Assert.Equal(Utc(10, 13, 3), (await f.Db.ClaimLineItems.SingleAsync()).PaidAt);
        Assert.Equal((80m, 0m), (p.Weeks[9].Paid, p.Weeks[Last].Paid));
    }

    [Fact]
    public async Task Resent_line_counts_twice_in_sent_and_once_in_paid()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var first = await SentAsync(f, Utc(10, 6, 1), lines[0].Id);
        await ResultsAsync(f, first, "Rejected");
        var second = await f.BuildAsync(lines[0].Id);
        if (!second.Ok) second = await f.Service.BuildAsync(f.TenantId, f.User, new BuildRequest([lines[0].Id], [], [lines[0].Id]), default);
        f.Clock.Utc = Utc(10, 14, 1);
        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, second.Value!.Id, default);
        await ResultsAsync(f, second.Value, "Successful");
        f.Clock.Utc = Utc(10, 28, 1);
        Assert.True((await f.Service.MarkPaidAsync(f.TenantId, f.User, second.Value.Id, [], default)).Ok);

        var p = await PipelineAsync(f);

        Assert.Equal((120m, 120m, 240m), (p.Weeks[8].Sent, p.Weeks[9].Sent, p.Weeks.Sum(w => w.Sent)));
        Assert.Equal(120m, p.Weeks.Sum(w => w.Paid));
        Assert.Equal(120m, p.Weeks[Last].Paid);
    }

    [Fact]
    public async Task Paid_lines_without_paid_at_are_undated_not_weekly()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var file = await SentAsync(f, Utc(10, 13, 1), lines[0].Id);
        await ResultsAsync(f, file, "Successful");
        lines[0].Status = ClaimLineItemStatus.Paid;
        lines[0].PaidAmount = 77m;
        await f.Db.SaveChangesAsync();

        var p = await PipelineAsync(f);

        Assert.Equal((77m, 0m), (p.UndatedPaid, p.Weeks.Sum(w => w.Paid)));
    }

    [Fact]
    public async Task Paid_outside_any_file_is_not_counted()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(plan: PlanType.PlanManaged);
        f.Clock.Utc = Utc(10, 28, 3);
        await Patch(f, claim, lines[0], ClaimLineItemStatus.Paid, 120m);
        Assert.NotNull(lines[0].PaidAt);

        var p = await PipelineAsync(f);

        Assert.Equal((0m, 0m), (p.Weeks.Sum(w => w.Paid), p.UndatedPaid));
    }

    // ---- rejected ----

    [Fact]
    public async Task Rejected_counts_the_sent_amount_in_the_import_week()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim(2);
        var file = await SentAsync(f, Utc(10, 13, 1), lines.Select(l => l.Id).ToArray());
        f.Clock.Utc = Utc(10, 27, 2);
        await ResultsAsync(f, file, "Rejected");
        lines[0].TotalAmount = 150m; // corrected after the rejection; the sent amount stays
        await f.Db.SaveChangesAsync();

        var p = await PipelineAsync(f);

        Assert.Equal((240m, 2), (p.Weeks[Last].Rejected, p.Weeks[Last].RejectedLines));
        Assert.Equal((0m, 0), (p.Weeks[9].Rejected, p.Weeks[9].RejectedLines));
    }

    [Fact]
    public async Task Reimport_keeps_the_first_import_date()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var file = await SentAsync(f, Utc(10, 13, 1), lines[0].Id);
        f.Clock.Utc = Utc(10, 14, 2);
        await ResultsAsync(f, file, "Rejected");
        f.Clock.Utc = Utc(10, 28, 2);
        await ResultsAsync(f, file, "Rejected");

        Assert.Equal(Utc(10, 14, 2), (await f.Db.ClaimBatches.SingleAsync()).ResultsImportedAt);
        var p = await PipelineAsync(f);
        Assert.Equal((120m, 0m), (p.Weeks[9].Rejected, p.Weeks[Last].Rejected));
    }

    // ---- today ----

    [Fact]
    public async Task Snapshot_with_ndia_and_accepted_unpaid()
    {
        using var f = new BatchFixture();
        var (pendingClaim, pending, _) = f.AddClaim(4);
        var (_, accepted, _) = f.AddClaim(2);
        await SentAsync(f, Utc(10, 13, 1), pending.Select(l => l.Id).ToArray());
        var open = await SentAsync(f, Utc(10, 13, 2), accepted.Select(l => l.Id).ToArray());
        await Patch(f, pendingClaim, pending[1], ClaimLineItemStatus.Paid, 120m);       // paid by hand: no longer waiting
        await Patch(f, pendingClaim, pending[2], ClaimLineItemStatus.Rejected);          // rejected by hand
        var gone = await f.Db.ClaimBatchLines.SingleAsync(b => b.ClaimLineItemId == pending[3].Id); // the claim line was deleted
        gone.ClaimLineItemId = null;
        f.Db.ClaimLineItems.Remove(pending[3]);
        await f.Db.SaveChangesAsync();
        var imported = await f.Service.ImportResultsAsync(f.TenantId, f.User, open.Id,
            Csv($"{open.Lines[0].RowReference},Successful,,,95.00", $"{open.Lines[1].RowReference},Successful,,,"), default);
        Assert.True(imported.Ok, string.Join("; ", imported.Errors ?? []));

        var p = await PipelineAsync(f);

        Assert.Equal(120m, p.WithNdia);
        Assert.Equal(95m + 120m, p.AcceptedUnpaid);
    }

    // ---- tenants ----

    [Fact]
    public async Task Another_organisation_never_reaches_the_chart_and_a_null_tenant_paid_line_still_counts_for_its_own()
    {
        using var f = new BatchFixture();
        f.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = f.OtherTenantId, RegistrationNumber = "4050099999", ABN = "12345678901", OrganisationName = "Other", Address = "1 St", State = "VIC" });
        var (claim, lines, _) = f.AddClaim();
        var (otherClaim, otherLines, _) = f.AddClaim(tenant: f.OtherTenantId);
        otherLines[0].TotalAmount = 999m;
        await f.Db.SaveChangesAsync();
        var mine = await SentAsync(f, Utc(10, 13, 1), lines[0].Id);
        await ResultsAsync(f, mine, "Successful");
        f.Clock.Utc = Utc(10, 28, 3);
        Assert.True((await f.Service.MarkPaidAsync(f.TenantId, f.User, mine.Id, [], default)).Ok);
        lines[0].TenantId = null; // an older image's INSERT leaves it null; the file line still names the organisation

        var theirs = await f.Service.BuildAsync(f.OtherTenantId, f.User, new BuildRequest([otherLines[0].Id], [], []), default);
        Assert.True(theirs.Ok, string.Join("; ", theirs.Errors ?? []));
        f.Clock.Utc = Utc(10, 27, 1);
        await f.Service.ConfirmUploadedAsync(f.OtherTenantId, f.User, theirs.Value!.Id, default);
        otherLines[0].Status = ClaimLineItemStatus.Paid;
        otherLines[0].PaidAmount = 999m;
        otherLines[0].PaidAt = Utc(10, 28, 3);
        otherLines[0].TenantId = null;
        await f.Db.SaveChangesAsync();

        var p = await PipelineAsync(f);
        var other = await f.Service.PipelineAsync(f.OtherTenantId, default);

        Assert.Equal((120m, 120m), (p.Weeks[Last - 2].Sent, p.Weeks[Last].Paid));
        Assert.Equal((0m, 0m, 0m), (p.WithNdia, p.AcceptedUnpaid, p.UndatedPaid));
        Assert.Equal((999m, 999m), (other.Weeks[Last].Sent, other.Weeks[Last].Paid));
        Assert.NotNull(claim);
        Assert.NotNull(otherClaim);
    }
}
