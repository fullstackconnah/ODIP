using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

// The Claims page chart: dollars sent to the NDIA and paid in each of the last 12 provider-local weeks, and where the money stands today.
// Events come from the files and from PaidAt, never from TripClaim dates (those are re-stamped on every resend). Every query names the organisation: the batch and
// batch-line filters let a SuperAdmin through, and a claim line's TenantId is nullable, so the organisation is taken from the batch line wherever one is joined.
public sealed partial class ClaimBatchService
{
    public const int PipelineWeeks = 12;

    private static readonly ClaimBatchStatus[] InFile = [ClaimBatchStatus.Uploaded, ClaimBatchStatus.ResultsImported];

    public async Task<PipelineDto> PipelineAsync(Guid t, CancellationToken ct)
    {
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, t, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, zone);
        var last = RosterWeek.MondayOf(today);
        var first = last.AddDays(-7 * (PipelineWeeks - 1));
        // Two conversions, so a daylight-saving change inside the window moves neither end.
        var fromUtc = ProviderLocalTime.LocalToUtc(first.ToDateTime(TimeOnly.MinValue), zone);
        var toUtc = ProviderLocalTime.LocalToUtc(last.AddDays(7).ToDateTime(TimeOnly.MinValue), zone);

        var sent = await db.ClaimBatches.AsNoTracking()
            .Where(b => b.TenantId == t && InFile.Contains(b.Status) && b.UploadedAt >= fromUtc && b.UploadedAt < toUtc)
            .Select(b => new { At = b.UploadedAt!.Value, Amount = b.TotalAmount }).ToListAsync(ct);
        var rejected = await db.ClaimBatchLines.AsNoTracking()
            .Where(l => l.TenantId == t && l.Outcome == ClaimBatchLineOutcome.Rejected && l.Batch.ResultsImportedAt >= fromUtc && l.Batch.ResultsImportedAt < toUtc)
            .Select(l => new { At = l.Batch.ResultsImportedAt!.Value, l.Amount }).ToListAsync(ct);
        var paid = await InFileLines(t).Where(l => l.PaidAt >= fromUtc && l.PaidAt < toUtc)
            .Select(l => new { At = l.PaidAt!.Value, Amount = l.PaidAmount ?? 0m }).ToListAsync(ct);

        DateOnly WeekOf(DateTime utc) => RosterWeek.MondayOf(DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(utc), zone)));
        var sentBy = sent.GroupBy(r => WeekOf(r.At)).ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));
        var paidBy = paid.GroupBy(r => WeekOf(r.At)).ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));
        var rejectedBy = rejected.GroupBy(r => WeekOf(r.At)).ToDictionary(g => g.Key, g => (Amount: g.Sum(r => r.Amount), Lines: g.Count()));

        var weeks = Enumerable.Range(0, PipelineWeeks).Select(i => first.AddDays(7 * i)).Select(w =>
            new PipelineWeekDto(w, sentBy.GetValueOrDefault(w), paidBy.GetValueOrDefault(w), rejectedBy.GetValueOrDefault(w).Amount, rejectedBy.GetValueOrDefault(w).Lines)).ToList();

        // Today, from current state. A pending line still counts only while its claim line is Submitted: every other way out of the NDIA's hands moves it off Submitted.
        var inFile = db.ClaimBatchLines.AsNoTracking().Where(l => l.TenantId == t && InFile.Contains(l.Batch.Status) && l.ClaimLineItemId != null);
        var withNdia = await inFile.Where(l => l.Outcome == ClaimBatchLineOutcome.Pending && l.ClaimLineItem!.Status == ClaimLineItemStatus.Submitted).SumAsync(l => l.Amount, ct);
        // The default mark-paid uses: what the NDIA said it accepted, else the line's own total.
        var accepted = await inFile.Where(l => l.Outcome == ClaimBatchLineOutcome.Successful && l.ClaimLineItem!.Status == ClaimLineItemStatus.Approved)
            .SumAsync(l => l.ResultAmount ?? l.ClaimLineItem!.TotalAmount, ct);
        var undated = await InFileLines(t).Where(l => l.PaidAt == null).SumAsync(l => l.PaidAmount ?? 0m, ct);
        return new PipelineDto(today, weeks, withNdia, accepted, undated);
    }

    /// <summary>Paid claim lines that are in at least one sent file of this organisation (each line once, whatever its attempts). The claim line's own TenantId is nullable (fail-closed filter), so that filter is lifted and the organisation is the file line's.</summary>
    private IQueryable<ClaimLineItem> InFileLines(Guid t) => db.ClaimLineItems.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
        .Where(l => l.Status == ClaimLineItemStatus.Paid && db.ClaimBatchLines.Any(b => b.TenantId == t && b.ClaimLineItemId == l.Id && InFile.Contains(b.Batch.Status)));
}
