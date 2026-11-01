using System.Text;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>Which file the hub's Paid tab credits a payment to.</summary>
public class ClaimHubPaidTests
{
    private static byte[] Csv(params string[] rows) =>
        Encoding.UTF8.GetBytes(string.Join("\r\n", new[] { "Claim Reference,Status,Error Code,Error Message,Paid Amount" }.Concat(rows)));

    /// <summary>One line rejected in file A, sent again in file B, accepted and paid. Returns both files' summaries.</summary>
    internal static async Task<(BatchDto A, BatchDto B)> RejectedThenResentAndPaidAsync(BatchFixture f, ClaimLineItem line)
    {
        var a = (await f.BuildAsync(line.Id)).Value!;
        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, a.Id, default);
        await f.Service.ImportResultsAsync(f.TenantId, f.User, a.Id, Csv($"{a.Lines[0].RowReference},Rejected,ZZA,one,"), default);
        var second = await f.BuildAsync(line.Id);
        if (!second.Ok) second = await f.Service.BuildAsync(f.TenantId, f.User, new BuildRequest([line.Id], [], [line.Id]), default);
        var b = second.Value!;
        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, b.Id, default);
        await f.Service.ImportResultsAsync(f.TenantId, f.User, b.Id, Csv($"{b.Lines[0].RowReference},Successful,,,"), default);
        Assert.True((await f.Service.MarkPaidAsync(f.TenantId, f.User, b.Id, [], default)).Ok);
        var all = await f.Service.BatchesAsync(f.TenantId, null, 10, default);
        return (all.Single(x => x.Id == a.Id), all.Single(x => x.Id == b.Id));
    }

    [Fact]
    public async Task A_line_rejected_in_one_file_and_paid_in_a_later_one_is_paid_only_under_the_later_file()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();

        var (a, b) = await RejectedThenResentAndPaidAsync(f, lines[0]);

        Assert.Equal((0, 0m), (a.Paid, a.PaidAmount));
        Assert.Equal((1, 120m), (b.Paid, b.PaidAmount));
    }
}
