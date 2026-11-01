using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

// Reads. Every query projects with Select: a list, a detail or the hub never loads a batch's file bytes, and never touches the NDIS number.
public sealed partial class ClaimBatchService
{
    public const int ListCap = 200;

    /// <summary>Newest batches first, with the counts of their lines. <paramref name="id"/> narrows it to one.</summary>
    public async Task<List<BatchDto>> BatchesAsync(Guid t, Guid? id, int take, CancellationToken ct)
    {
        var batches = await db.ClaimBatches.AsNoTracking().Where(b => b.TenantId == t && (id == null || b.Id == id))
            .OrderByDescending(b => b.CreatedAt).Take(take)
            .Select(b => new { b.Id, b.FileName, b.Status, b.CreatedAt, b.CreatedByName, b.UploadedAt, b.UploadedByName, b.ResultsImportedAt, b.DiscardedAt, b.LineCount, b.TotalAmount })
            .ToListAsync(ct);
        var ids = batches.Select(b => b.Id).ToList();
        var counts = (await db.ClaimBatchLines.AsNoTracking().Where(l => ids.Contains(l.BatchId)).GroupBy(l => l.BatchId)
            .Select(g => new
            {
                g.Key,
                Pending = g.Count(l => l.Outcome == ClaimBatchLineOutcome.Pending),
                Successful = g.Count(l => l.Outcome == ClaimBatchLineOutcome.Successful),
                Rejected = g.Count(l => l.Outcome == ClaimBatchLineOutcome.Rejected),
                Withdrawn = g.Count(l => l.Outcome == ClaimBatchLineOutcome.Withdrawn),
                Paid = g.Count(l => l.Outcome == ClaimBatchLineOutcome.Successful && l.ClaimLineItem != null && l.ClaimLineItem.Status == ClaimLineItemStatus.Paid),
                PaidAmount = g.Sum(l => l.Outcome == ClaimBatchLineOutcome.Successful && l.ClaimLineItem != null && l.ClaimLineItem.Status == ClaimLineItemStatus.Paid ? l.ClaimLineItem.PaidAmount ?? 0m : 0m),
            }).ToListAsync(ct)).ToDictionary(c => c.Key);

        return batches.Select(b =>
        {
            counts.TryGetValue(b.Id, out var c);
            return new BatchDto(b.Id, b.FileName, b.Status, b.CreatedAt, b.CreatedByName, b.UploadedAt, b.UploadedByName, b.ResultsImportedAt, b.DiscardedAt, b.LineCount, b.TotalAmount,
                c?.Pending ?? 0, c?.Successful ?? 0, c?.Rejected ?? 0, c?.Withdrawn ?? 0, c?.Paid ?? 0, c?.PaidAmount ?? 0m);
        }).ToList();
    }

    public async Task<BatchResult<BatchDto>> SummaryAsync(Guid t, Guid id, CancellationToken ct) =>
        (await BatchesAsync(t, id, 1, ct)).FirstOrDefault() is { } batch ? Done(batch) : Fail<BatchDto>(404, NotFound);

    public async Task<BatchResult<BatchDetailDto>> DetailAsync(Guid t, Guid id, CancellationToken ct)
    {
        if ((await BatchesAsync(t, id, 1, ct)).FirstOrDefault() is not { } batch) return Fail<BatchDetailDto>(404, NotFound);
        return Done(new BatchDetailDto(batch, await LinesAsync(t, l => l.BatchId == id, ct)));
    }

    public async Task<List<BatchLineDto>> LinesAsync(Guid t, Expression<Func<ClaimBatchLine, bool>> where, CancellationToken ct)
    {
        var rows = await db.ClaimBatchLines.AsNoTracking().Where(l => l.TenantId == t).Where(where).OrderBy(l => l.RowReference).Take(MaxRows)
            .Select(l => new
            {
                l.Id, l.ClaimLineItemId, ClaimId = (Guid?)l.ClaimLineItem!.TripClaimId, ClaimReference = (string?)l.ClaimLineItem.TripClaim.ClaimReference,
                l.SupportNumber, l.SupportsDeliveredFrom, l.SupportsDeliveredTo, l.Amount, l.Attempt, l.RowReference, l.Outcome, l.RejectCode, l.RejectMessage, l.ResultAmount,
                LineStatus = (ClaimLineItemStatus?)l.ClaimLineItem.Status, l.ClaimLineItem.PaidAmount, l.DismissedAt,
            }).ToListAsync(ct);
        var people = await ParticipantNamesAsync(t, rows.Where(r => r.ClaimLineItemId != null).Select(r => r.ClaimLineItemId!.Value).ToList(), ct);

        return rows.Select(r =>
        {
            var rejected = r.Outcome == ClaimBatchLineOutcome.Rejected;
            var info = rejected ? NdiaRejectCodes.For(r.RejectCode) : null;
            people.TryGetValue(r.ClaimLineItemId ?? Guid.Empty, out var person);
            return new BatchLineDto(r.Id, r.ClaimLineItemId, r.ClaimId, r.ClaimReference, person.Name, r.SupportNumber, r.SupportsDeliveredFrom, r.SupportsDeliveredTo, r.Amount, r.Attempt,
                r.RowReference, r.Outcome, r.RejectCode, r.RejectMessage, info?.Hint, info?.NeedsDecision, r.ResultAmount, r.LineStatus, r.PaidAmount, r.DismissedAt);
        }).ToList();
    }

    /// <summary>The participant of each claim line (a trip line's through its booking, a shift line's through its shift), by line id.</summary>
    private async Task<Dictionary<Guid, (Guid Id, string Name)>> ParticipantNamesAsync(Guid t, IReadOnlyCollection<Guid> lineIds, CancellationToken ct)
    {
        var pairs = await db.ClaimLineItems.AsNoTracking().Where(l => lineIds.Contains(l.Id))
            .Select(l => new { l.Id, ParticipantId = l.ParticipantBookingId != null ? l.ParticipantBooking!.ParticipantId : l.Shift != null ? l.Shift.ParticipantId : (Guid?)null })
            .ToListAsync(ct);
        var participantIds = pairs.Select(p => p.ParticipantId).OfType<Guid>().Distinct().ToList();
        var people = await db.Participants.AsNoTracking().Where(p => p.TenantId == t && participantIds.Contains(p.Id))
            .Select(p => new { p.Id, p.FirstName, p.PreferredName, p.LastName }).ToListAsync(ct);
        var names = people.ToDictionary(p => p.Id, p => string.IsNullOrWhiteSpace(p.PreferredName) ? $"{p.FirstName} {p.LastName}".Trim() : $"{p.PreferredName} {p.LastName}".Trim());
        return pairs.Where(p => p.ParticipantId is { } pid && names.ContainsKey(pid)).ToDictionary(p => p.Id, p => (p.ParticipantId!.Value, names[p.ParticipantId!.Value]));
    }

    // ---- hub ----

    /// <summary>The plan's fixed lowercase strings: trip and shift for a claim kind, agency, plan and self for a funding type.</summary>
    private static string Wire(Enum e) => e.ToString().Replace("Managed", "").ToLowerInvariant();

    private HubLineDto HubLine(BprRow row, BatchContext ctx, int attempt)
    {
        var l = row.Line;
        var perHour = (row.Item?.Unit ?? "H") == "H";
        var age = ClaimBatchChecks.AgeDays(ctx.Today, l.SupportsDeliveredFrom);
        var problems = ClaimBatchChecks.For(row, ctx).Select(p => new HubProblemDto(p.Rule, p.Severity, p.Message)).ToList();
        return new HubLineDto(l.Id, row.Claim.Id, row.Claim.ClaimReference, Wire(row.Claim.Kind), row.Participant?.Id ?? Guid.Empty, row.Participant?.FullName ?? "",
            BprCsvService.ToOut(row, attempt).SupportNumber, row.Item?.Description, l.SupportsDeliveredFrom, l.SupportsDeliveredTo, l.Hours, perHour ? null : l.Hours, l.UnitPrice,
            l.TotalAmount, l.GSTCode, l.ClaimType, l.CancellationReason, Wire(row.PlanType ?? PlanType.AgencyManaged), age, ClaimBatchChecks.AgeBand(age), attempt, problems);
    }

    /// <summary>The hub's three lists. The NDIS number is read for the checks and never leaves the server.</summary>
    public async Task<HubLinesDto> HubAsync(Guid t, CancellationToken ct)
    {
        var scoped = db.TripClaims.Where(c => c.TenantId == t).AsNoTracking();
        var open = new[] { TripClaimStatus.Draft, TripClaimStatus.Ready };
        var readyIds = await db.ClaimLineItems.AsNoTracking()
            .Where(l => l.Status == ClaimLineItemStatus.Draft && scoped.Any(c => c.Id == l.TripClaimId && open.Contains(c.Status))).Select(l => l.Id).Take(MaxRows).ToListAsync(ct);

        // The newest rejection of each line only, and only while the line is still rejected and in no file.
        var rejectedRows = (await db.ClaimBatchLines.AsNoTracking()
                .Where(b => b.TenantId == t && b.Outcome == ClaimBatchLineOutcome.Rejected && b.ClaimLineItemId != null && b.ClaimLineItem!.Status == ClaimLineItemStatus.Rejected
                    && !db.ClaimBatchLines.Any(p => p.ClaimLineItemId == b.ClaimLineItemId && p.Outcome == ClaimBatchLineOutcome.Pending))
                .Select(b => new { b.Id, b.BatchId, b.Batch.FileName, LineId = b.ClaimLineItemId!.Value, b.Attempt, b.RejectCode, b.RejectMessage, b.DismissedAt, RejectedAt = b.Batch.ResultsImportedAt })
                .ToListAsync(ct))
            .GroupBy(b => b.LineId).Select(g => g.OrderByDescending(b => b.Attempt).First()).Where(b => b.DismissedAt == null).Take(MaxRows).ToList();

        var rows = await bpr.LoadRowsAsync(t, readyIds.Concat(rejectedRows.Select(r => r.LineId)).Distinct().ToList(), ct);
        var byId = rows.ToDictionary(r => r.Line.Id);
        var agency = rows.Where(r => r.PlanType == PlanType.AgencyManaged && (readyIds.Contains(r.Line.Id) || rejectedRows.Any(x => x.LineId == r.Line.Id))).ToList();
        var (ctx, attempts, _) = await ContextAsync(t, agency, new HashSet<Guid>(), false, ct);
        int NextAttempt(Guid id) => attempts.TryGetValue(id, out var a) ? a + 1 : 1;

        var ready = readyIds.Where(byId.ContainsKey).Select(id => byId[id]).Where(r => r.PlanType == PlanType.AgencyManaged)
            .OrderBy(r => r.Line.SupportsDeliveredFrom).ThenBy(r => r.Claim.ClaimReference, StringComparer.Ordinal).Select(r => HubLine(r, ctx, NextAttempt(r.Line.Id))).ToList();
        var rejected = rejectedRows.Where(r => byId.ContainsKey(r.LineId)).Select(r =>
        {
            var info = NdiaRejectCodes.For(r.RejectCode);
            return new RejectedLineDto(HubLine(byId[r.LineId], ctx, NextAttempt(r.LineId)), r.Id, r.BatchId, r.FileName, r.RejectCode ?? "", r.RejectMessage, info.NeedsDecision, info.Hint, r.RejectedAt);
        }).ToList();

        // shortcut: the newest 200 claims only, then the plan- and self-managed ones among them; page it if an organisation outgrows that.
        var recent = await scoped.Where(c => c.Status != TripClaimStatus.Cancelled).OrderByDescending(c => c.CreatedAt).Take(ListCap).Select(c => c.Id).ToListAsync(ct);
        var recentRows = await bpr.LoadRowsAsync(t, await db.ClaimLineItems.AsNoTracking().Where(l => recent.Contains(l.TripClaimId)).Select(l => l.Id).ToListAsync(ct), ct);
        var invoiceLookup = (await db.Invoices.AsNoTracking().Where(i => i.TripClaimId != null && recent.Contains(i.TripClaimId.Value) && i.Kind == InvoiceKind.Invoice)
                .Select(i => new { ClaimId = i.TripClaimId!.Value, Dto = new ManagedInvoiceDto(i.Id, i.DisplayNumber, i.Status, i.Total, i.IssueDate) }).ToListAsync(ct))
            .ToLookup(i => i.ClaimId, i => i.Dto);
        var today = ctx.Today;
        var managed = recentRows.Where(r => r.PlanType is PlanType.PlanManaged or PlanType.SelfManaged).GroupBy(r => r.Claim.Id).Select(g =>
        {
            var first = g.First();
            var oldest = g.Min(r => r.Line.SupportsDeliveredFrom);
            var age = ClaimBatchChecks.AgeDays(today, oldest);
            return new ManagedClaimDto(first.Claim.Id, first.Claim.ClaimReference, first.Participant?.Id, first.Participant?.FullName, Wire(first.PlanType!.Value), first.Claim.Status,
                first.Claim.TotalAmount, age, ClaimBatchChecks.AgeBand(age), invoiceLookup[first.Claim.Id].ToList());
        }).OrderByDescending(c => c.AgeDays).ToList();

        var settings = rows.Concat(recentRows).Select(r => r.Settings).FirstOrDefault(s => s != null) ?? await db.ProviderSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == t, ct);
        return new HubLinesDto(ready, rejected, managed, ClaimBatchChecks.RegistrationProblem(settings));
    }
}
