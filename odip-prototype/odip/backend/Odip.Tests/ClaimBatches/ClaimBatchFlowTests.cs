using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>Confirming an upload, importing the NDIA's results, marking paid, dismissing, and the hub.</summary>
public class ClaimBatchFlowTests
{
    private const string Header = "Claim Reference,Status,Error Code,Error Message,Paid Amount";

    private static byte[] Csv(params string[] rows) => Encoding.UTF8.GetBytes(string.Join("\r\n", new[] { Header }.Concat(rows)));

    private static async Task<BatchDetailDto> BuiltAsync(BatchFixture f, params Guid[] lineIds)
    {
        var built = await f.BuildAsync(lineIds);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));
        return built.Value!;
    }

    private static async Task<BatchDetailDto> UploadedAsync(BatchFixture f, params Guid[] lineIds)
    {
        var built = await BuiltAsync(f, lineIds);
        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Id, default);
        Assert.True(up.Ok, string.Join("; ", up.Errors ?? []));
        return built;
    }

    // ---- confirm ----

    [Fact]
    public async Task Confirm_submits_the_claim_and_its_lines()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(2);
        var built = await BuiltAsync(f, lines.Select(l => l.Id).ToArray());

        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Id, default);

        Assert.Equal((ClaimBatchStatus.Uploaded, 2), (up.Value!.Status, up.Value.Pending));
        Assert.Equal(TripClaimStatus.Submitted, (await f.Db.TripClaims.SingleAsync()).Status);
        Assert.All(await f.Db.ClaimLineItems.ToListAsync(), l => Assert.Equal(ClaimLineItemStatus.Submitted, l.Status));
        Assert.Contains(await f.Db.AuditLogs.ToListAsync(), a => a.EntityType == "ClaimBatch" && a.Changes.Contains("Uploaded: 2 lines, 1 claims submitted"));
        Assert.Equal(409, (await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Id, default)).Status);
    }

    [Fact]
    public async Task Confirm_refuses_a_resubmitted_line_whose_shift_was_taken()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var built = await BuiltAsync(f, lines[0].Id);
        // Another claim picked up the same booking while the file sat on disk.
        var (other, otherLines, _) = f.AddClaim();
        otherLines[0].ParticipantBookingId = lines[0].ParticipantBookingId;
        await f.Db.SaveChangesAsync();

        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Id, default);

        Assert.Equal(409, up.Status);
        Assert.Contains(up.Errors!, e => e.Contains(other.ClaimReference) && e.Contains("already on claim"));
        Assert.Equal(ClaimBatchStatus.Built, (await f.Db.ClaimBatches.SingleAsync()).Status);
        Assert.Equal(ClaimLineItemStatus.Draft, (await f.Db.ClaimLineItems.FindAsync(lines[0].Id))!.Status);
    }

    [Fact]
    public async Task Confirm_refuses_a_resubmitted_rejected_line_whose_shift_was_taken()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var first = await UploadedAsync(f, lines[0].Id);
        await f.Service.ImportResultsAsync(f.TenantId, f.User, first.Id, Csv($"{first.Lines[0].RowReference},Rejected,ZZA,one,"), default);
        var second = await f.BuildAsync([lines[0].Id]);
        if (!second.Ok) second = await f.Service.BuildAsync(f.TenantId, f.User, new BuildRequest([lines[0].Id], [], [lines[0].Id]), default);
        Assert.True(second.Ok, string.Join("; ", second.Errors ?? []));
        Assert.Equal(2, second.Value!.Lines[0].Attempt);
        // The rejected line gave its shift back, and another claim took it before the file was confirmed.
        var (other, otherLines, _) = f.AddClaim();
        otherLines[0].ParticipantBookingId = lines[0].ParticipantBookingId;
        await f.Db.SaveChangesAsync();

        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, second.Value.Id, default);

        Assert.Equal(409, up.Status);
        Assert.Contains(up.Errors!, e => e.Contains(other.ClaimReference) && e.Contains("already on claim"));
        Assert.Equal(ClaimBatchStatus.Built, (await f.Db.ClaimBatches.FindAsync(second.Value.Id))!.Status);
        Assert.Equal(ClaimLineItemStatus.Rejected, (await f.Db.ClaimLineItems.FindAsync(lines[0].Id))!.Status);
    }

    [Fact]
    public async Task Confirm_refuses_a_cancelled_claim_and_changes_nothing()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await BuiltAsync(f, lines[0].Id);
        claim.Status = TripClaimStatus.Cancelled;
        await f.Db.SaveChangesAsync();

        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Id, default);

        Assert.Equal(409, up.Status);
        Assert.Equal(ClaimBatchStatus.Built, (await f.Db.ClaimBatches.SingleAsync()).Status);
    }

    // ---- results ----

    [Fact]
    public async Task Import_moves_lines_by_reference_and_rolls_the_claim_up()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim(2);
        var up = await UploadedAsync(f, lines.Select(l => l.Id).ToArray());
        var (ok, bad) = (up.Lines[0], up.Lines[1]);

        var result = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id,
            Csv($"{ok.RowReference},Successful,,,120.00", $"{bad.RowReference},Rejected,ZZZ,Some reason,"), default);

        Assert.True(result.Ok, string.Join("; ", result.Errors ?? []));
        Assert.Equal((1, 1, 0, 0), (result.Value!.Successful, result.Value.Rejected, result.Value.Unchanged, result.Value.LeftAlone));
        Assert.Equal(ClaimLineItemStatus.Approved, (await f.Db.ClaimLineItems.FindAsync(ok.ClaimLineItemId))!.Status);
        var rejected = (await f.Db.ClaimLineItems.FindAsync(bad.ClaimLineItemId))!;
        Assert.Equal(ClaimLineItemStatus.Rejected, rejected.Status);
        Assert.Equal("ZZZ: Some reason", rejected.RejectionReason);
        Assert.Equal(ClaimBatchStatus.ResultsImported, result.Value.Batch.Status);
    }

    [Fact]
    public async Task Import_twice_changes_nothing()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim(2);
        var up = await UploadedAsync(f, lines.Select(l => l.Id).ToArray());
        var file = Csv($"{up.Lines[0].RowReference},Successful,,,120.00", $"{up.Lines[1].RowReference},Rejected,ZZZ,No,");
        await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, file, default);
        async Task<string> Snapshot() => string.Join("|", (await f.Db.ClaimLineItems.AsNoTracking().OrderBy(l => l.Id).ToListAsync()).Select(l => $"{l.Status}:{l.TotalAmount}:{l.PaidAmount}"));
        var before = await Snapshot();

        var again = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, file, default);

        Assert.Equal((0, 0, 2, 0), (again.Value!.Successful, again.Value.Rejected, again.Value.Unchanged, again.Value.Conflicts.Count));
        Assert.Equal(before, await Snapshot());
    }

    [Fact]
    public async Task A_different_answer_for_a_settled_line_is_a_conflict_and_changes_nothing()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);
        var r = up.Lines[0].RowReference;
        await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv($"{r},Successful,,,"), default);

        var again = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv($"{r},Rejected,ZZZ,x,"), default);

        var conflict = Assert.Single(again.Value!.Conflicts);
        Assert.Equal(("Successful", "Rejected (ZZZ)"), (conflict.Current, conflict.Incoming));
        Assert.Equal(ClaimLineItemStatus.Approved, (await f.Db.ClaimLineItems.SingleAsync()).Status);
    }

    [Fact]
    public async Task Import_leaves_a_hand_paid_line_alone()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);
        var item = await f.Db.ClaimLineItems.SingleAsync();
        item.Status = ClaimLineItemStatus.Paid;
        item.PaidAmount = 120m;
        await f.Db.SaveChangesAsync();

        var result = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv($"{up.Lines[0].RowReference},Rejected,ZZZ,late,"), default);

        Assert.Equal((1, 1), (result.Value!.Rejected, result.Value.LeftAlone));
        Assert.Equal((ClaimLineItemStatus.Paid, 120m), (item.Status, item.PaidAmount));
        Assert.Equal(ClaimBatchLineOutcome.Rejected, (await f.Db.ClaimBatchLines.SingleAsync()).Outcome);
    }

    [Fact]
    public async Task Import_leaves_a_hand_rejected_line_alone_when_the_file_says_successful()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);
        var item = await f.Db.ClaimLineItems.SingleAsync();
        item.Status = ClaimLineItemStatus.Rejected;
        await f.Db.SaveChangesAsync();

        var result = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv($"{up.Lines[0].RowReference},Successful,,,"), default);

        Assert.Equal((1, 1), (result.Value!.Successful, result.Value.LeftAlone));
        Assert.Equal(ClaimLineItemStatus.Rejected, item.Status);
        Assert.Equal(ClaimBatchLineOutcome.Successful, (await f.Db.ClaimBatchLines.SingleAsync()).Outcome);
    }

    [Fact]
    public async Task Import_reports_unknown_references_and_unreadable_rows()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);

        var result = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv("NOPE,Successful,,,", $"{up.Lines[0].RowReference},Maybe,,,"), default);

        Assert.Equal(["NOPE"], result.Value!.UnknownReferences);
        Assert.Equal("We don't know this result.", Assert.Single(result.Value.UnreadRows).Note);
    }

    [Fact]
    public async Task Import_before_the_upload_is_confirmed_is_refused()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var built = await BuiltAsync(f, lines[0].Id);
        var result = await f.Service.ImportResultsAsync(f.TenantId, f.User, built.Id, Csv(), default);
        Assert.Equal((409, "Confirm you've uploaded this file before importing its results."), (result.Status, result.Errors![0]));
    }

    // ---- the results file reader ----

    [Fact]
    public void Header_aliases_are_read_in_any_case_and_spacing()
    {
        var parsed = NdiaResultsFile.Parse(Encoding.UTF8.GetBytes("claim_ref,RESULT,Reject Code,Rejection Reason,amount paid\nA1,Rejected,e1,why,\"$1,200.50\"\n"));
        Assert.Null(parsed.Error);
        var row = Assert.Single(parsed.Rows);
        Assert.Equal(("A1", ClaimBatchLineOutcome.Rejected, "e1", "why"), (row.Reference, row.Outcome, row.Code, row.Message));
    }

    [Fact]
    public void A_missing_or_repeated_column_refuses_the_whole_file()
    {
        Assert.Contains("reference", NdiaResultsFile.Parse(Encoding.UTF8.GetBytes("Foo,Status,Code\nA,Rejected,x")).Error);
        Assert.Contains("result", NdiaResultsFile.Parse(Encoding.UTF8.GetBytes("Reference,Status,Result,Code\nA,Rejected,x,y")).Error);
    }

    [Fact]
    public void A_file_that_is_not_text_is_refused()
    {
        Assert.Contains("isn't readable text", NdiaResultsFile.Parse([0xFF, 0xFE, 0x00, 0xC3, 0x28]).Error);
    }

    // ---- paid ----

    private static async Task<(BatchFixture F, BatchDetailDto Batch)> AcceptedAsync(int lines = 1)
    {
        var f = new BatchFixture();
        var (_, made, _) = f.AddClaim(lines);
        var up = await UploadedAsync(f, made.Select(l => l.Id).ToArray());
        await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv(up.Lines.Select(l => $"{l.RowReference},Successful,,,").ToArray()), default);
        return (f, up);
    }

    [Fact]
    public async Task Mark_paid_defaults_to_the_accepted_lines_and_rolls_the_claim_up()
    {
        var (f, up) = await AcceptedAsync(2);
        using (f)
        {
            var paid = await f.Service.MarkPaidAsync(f.TenantId, f.User, up.Id, [], default);

            Assert.True(paid.Ok, string.Join("; ", paid.Errors ?? []));
            Assert.Equal((2, 240m), (paid.Value!.Paid, paid.Value.PaidAmount));
            Assert.Equal(TripClaimStatus.Paid, (await f.Db.TripClaims.SingleAsync()).Status);
        }
    }

    [Fact]
    public async Task Mark_paid_refuses_a_line_that_was_not_accepted_and_an_amount_over_the_line()
    {
        var (f, up) = await AcceptedAsync();
        using (f)
        {
            var ghost = await f.Service.MarkPaidAsync(f.TenantId, f.User, up.Id, [new PaidLineRequest(Guid.NewGuid(), null)], default);
            Assert.Equal("NotAccepted", ((BuildRefusalDto)ghost.Data!).Problems[0].Rule);
            Assert.Equal("Only lines the NDIA accepted can be marked paid.", ((BuildRefusalDto)ghost.Data!).Problems[0].Message);

            var over = await f.Service.MarkPaidAsync(f.TenantId, f.User, up.Id, [new PaidLineRequest(up.Lines[0].BatchLineId, 500m)], default);
            Assert.Equal("Enter an amount between $0.01 and $120.00.", ((BuildRefusalDto)over.Data!).Problems[0].Message);
            Assert.Equal(ClaimLineItemStatus.Approved, (await f.Db.ClaimLineItems.SingleAsync()).Status);
        }
    }

    [Fact]
    public async Task Mark_paid_refuses_the_same_line_twice_in_one_request()
    {
        var (f, up) = await AcceptedAsync();
        using (f)
        {
            var id = up.Lines[0].BatchLineId;
            var paid = await f.Service.MarkPaidAsync(f.TenantId, f.User, up.Id, [new PaidLineRequest(id, null), new PaidLineRequest(id, null)], default);

            Assert.Equal((400, "Each line can be marked paid once per request."), (paid.Status, paid.Errors![0]));
            Assert.Equal(ClaimLineItemStatus.Approved, (await f.Db.ClaimLineItems.SingleAsync()).Status);
        }
    }

    [Fact]
    public async Task Import_records_the_paid_amount_and_mark_paid_defaults_to_it()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);
        var imported = await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv($"{up.Lines[0].RowReference},Successful,,,95.00"), default);
        Assert.True(imported.Ok, string.Join("; ", imported.Errors ?? []));
        Assert.Equal(95.00m, (await f.Db.ClaimBatchLines.SingleAsync()).ResultAmount);

        var paid = await f.Service.MarkPaidAsync(f.TenantId, f.User, up.Id, [], default);

        Assert.True(paid.Ok, string.Join("; ", paid.Errors ?? []));
        Assert.Equal(95.00m, (await f.Db.ClaimLineItems.SingleAsync()).PaidAmount);
    }

    [Fact]
    public async Task Mark_paid_with_nothing_accepted_is_a_400()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);
        var paid = await f.Service.MarkPaidAsync(f.TenantId, f.User, up.Id, [], default);
        Assert.Equal((400, "No accepted lines are waiting to be marked paid."), (paid.Status, paid.Errors![0]));
    }

    // ---- dismiss ----

    [Fact]
    public async Task Dismiss_hides_a_rejection_that_needs_a_decision_and_a_second_dismiss_is_harmless()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var up = await UploadedAsync(f, lines[0].Id);
        await f.Service.ImportResultsAsync(f.TenantId, f.User, up.Id, Csv($"{up.Lines[0].RowReference},Rejected,ZZZ,x,"), default);
        var batchLineId = up.Lines[0].BatchLineId;
        Assert.Single((await f.Service.HubAsync(f.TenantId, default)).Rejected);

        var one = await f.Service.DismissAsync(f.TenantId, f.User, batchLineId, default);
        var two = await f.Service.DismissAsync(f.TenantId, f.User, batchLineId, default);

        Assert.True(one.Ok && two.Ok);
        Assert.NotNull(one.Value!.DismissedAt);
        Assert.Empty((await f.Service.HubAsync(f.TenantId, default)).Rejected);
        Assert.Single(await f.Db.AuditLogs.Where(a => a.Changes.Contains("RejectionDismissed")).ToListAsync());
    }

    [Fact]
    public async Task Dismiss_of_a_line_that_was_not_rejected_is_a_409()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var built = await BuiltAsync(f, lines[0].Id);
        Assert.Equal(409, (await f.Service.DismissAsync(f.TenantId, f.User, built.Lines[0].BatchLineId, default)).Status);
    }

    // ---- hub ----

    [Fact]
    public async Task Hub_never_returns_the_NDIS_number()
    {
        using var f = new BatchFixture();
        var (_, _, participant) = f.AddClaim(2);
        Assert.False(string.IsNullOrEmpty(participant.NdisNumber));

        var hub = await f.Service.HubAsync(f.TenantId, default);

        Assert.NotEmpty(hub.Ready);
        Assert.DoesNotContain(participant.NdisNumber, JsonSerializer.Serialize(hub));
    }

    [Fact]
    public async Task Hub_flags_a_line_already_in_a_file_as_not_sendable()
    {
        using var f = new BatchFixture();
        var (_, a, _) = f.AddClaim();
        var (_, b, _) = f.AddClaim();
        await BuiltAsync(f, a[0].Id);

        var hub = await f.Service.HubAsync(f.TenantId, default);

        var inFile = hub.Ready.Single(r => r.LineId == a[0].Id);
        Assert.Contains(inFile.Problems, p => p.Rule == "AlreadyPending");
        Assert.Empty(hub.Ready.Single(r => r.LineId == b[0].Id).Problems);
    }

    [Fact]
    public async Task The_rejected_list_shows_each_line_once_with_its_latest_attempt()
    {
        using var f = new BatchFixture();
        var (_, lines, _) = f.AddClaim();
        var first = await UploadedAsync(f, lines[0].Id);
        await f.Service.ImportResultsAsync(f.TenantId, f.User, first.Id, Csv($"{first.Lines[0].RowReference},Rejected,ZZA,one,"), default);
        var second = await f.BuildAsync([lines[0].Id]);
        if (!second.Ok) second = await f.Service.BuildAsync(f.TenantId, f.User, new BuildRequest([lines[0].Id], [], [lines[0].Id]), default);
        Assert.True(second.Ok, string.Join("; ", second.Errors ?? []));
        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, second.Value!.Id, default);
        await f.Service.ImportResultsAsync(f.TenantId, f.User, second.Value.Id, Csv($"{second.Value.Lines[0].RowReference},Rejected,ZZB,two,"), default);

        var rejected = (await f.Service.HubAsync(f.TenantId, default)).Rejected;

        var line = Assert.Single(rejected);
        Assert.Equal(("ZZB", second.Value.FileName, 3), (line.RejectCode, line.FileName, line.NextAttempt));
    }

    [Fact]
    public async Task Hub_calls_for_other_organisations_see_nothing_of_this_one()
    {
        using var f = new BatchFixture();
        f.AddClaim();
        var hub = await f.Service.HubAsync(f.OtherTenantId, default);
        Assert.Empty(hub.Ready);
        Assert.Empty(hub.Rejected);
    }
}
