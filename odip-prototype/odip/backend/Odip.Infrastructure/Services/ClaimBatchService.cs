using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Billing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The NDIA claim files: build one from claim lines, confirm it was uploaded, import the NDIA's results, mark lines paid. Every flow scopes by the tenant it is given (a SuperAdmin bypasses the
/// query filters), takes the "claim-batch" advisory lock first and the per-claim "claim-edit" locks after it in ascending id order, and opens no transaction of its own: the lock does.
/// </summary>
public sealed partial class ClaimBatchService(OdipDbContext db, BprCsvService bpr, InvoiceService invoices, TimeProvider clock)
{
    public const string BusyMessage = "Another change to claims is still being saved. Wait a moment, then try again.";
    public const string NotFound = "Not found.";
    public const int MaxRows = 5000;
    private const string BatchScope = "claim-batch";
    private const string ClaimScope = "claim-edit";
    private const string OnePendingIndex = "UX_ClaimBatchLines_OnePendingPerLine";

    private static BatchResult<T> Fail<T>(int status, string error, object? data = null) => new(status, default, [error], data);
    private static BatchResult<T> Fail<T>(int status, List<string> errors, object? data = null) => new(status, default, errors, data);
    private static BatchResult<T> Done<T>(T value) => new(200, value);

    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);
    private static string? Trunc(string? text, int max) => text is { Length: > 0 } && text.Length > max ? text[..max] : text;

    private static (Guid? Id, string? Name) Who(ClaimsPrincipal user) =>
        (Guid.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null,
         Trunc(user.FindFirst("fullName")?.Value ?? user.FindFirst(ClaimTypes.Name)?.Value, 200));

    /// <summary>Runs a flow, turning a busy lock and a unique-index race into the 409s the person can act on.</summary>
    private async Task<BatchResult<T>> Guard<T>(Func<Task<BatchResult<T>>> body)
    {
        try { return await body(); }
        catch (RosterBusyException) { return Fail<T>(409, BusyMessage); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg)
        {
            return pg.ConstraintName == OnePendingIndex
                ? Fail<T>(409, "One of these lines is already in another file. Discard that file, or wait for its results.", new BuildRefusalDto([]))
                : Fail<T>(409, BusyMessage);
        }
    }

    private Task<RosterGenerationLock> LockBatchAsync(Guid tenantId, CancellationToken ct) => RosterGenerationLock.AcquireAsync(db, tenantId, ct, scope: BatchScope);

    /// <summary>The per-claim edit locks, in ascending id order, joined to the batch lock's transaction (released with it).</summary>
    private async Task LockClaimsAsync(IEnumerable<Guid> claimIds, CancellationToken ct)
    {
        foreach (var id in claimIds.Distinct().Order()) await RosterGenerationLock.AcquireAsync(db, id, ct, scope: ClaimScope);
    }

    /// <summary>The claims of one organisation. TripClaim has no query filter, so the tenant is applied here, by its trip or its participant.</summary>
    private IQueryable<TripClaim> ClaimsOf(Guid tenantId) =>
        db.TripClaims.Where(c => db.TripInstances.Any(i => i.Id == c.TripInstanceId && i.TenantId == tenantId)
            || db.Participants.Any(p => p.Id == c.ParticipantId && p.TenantId == tenantId));

    private void Audit(string entityType, Guid entityId, string field, string? oldValue, string? newValue, ClaimsPrincipal user, AuditAction action = AuditAction.Updated)
    {
        var row = SettingChangeAudit.ForFieldChange(entityType, entityId, field, oldValue, newValue, user);
        row.Action = action;
        db.AuditLogs.Add(row);
    }

    private DateOnly TodayFor(ProviderSettings? settings) =>
        ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, ProviderTimeZoneResolver.FromState(settings?.State).Zone);

    // ---- build ----

    public Task<BatchResult<BatchDetailDto>> BuildAsync(Guid tenantId, ClaimsPrincipal user, BuildRequest request, CancellationToken ct) => Guard(async () =>
    {
        var lineIds = request.LineIds.Distinct().ToList();
        var claimIds = request.ClaimIds.Distinct().ToList();
        if (lineIds.Count == 0 && claimIds.Count == 0) return Fail<BatchDetailDto>(400, "Choose at least one line to send.");

        await using var held = await LockBatchAsync(tenantId, ct);
        var built = await BuildCoreAsync(tenantId, user, lineIds, claimIds, request.ConfirmedLineIds.ToHashSet(), ct);
        if (!built.Ok) return Fail<BatchDetailDto>(built.Status, built.Errors ?? [], built.Data);
        await held.CommitAsync(ct);
        return await DetailAsync(tenantId, built.Value!.Id, ct);
    });

    /// <summary>Builds and saves one batch. The caller holds the claim-batch lock and commits.</summary>
    private async Task<BatchResult<ClaimBatch>> BuildCoreAsync(
        Guid t, ClaimsPrincipal user, IReadOnlyCollection<Guid> lineIds, IReadOnlyCollection<Guid> claimIds, IReadOnlySet<Guid> confirmed, CancellationToken ct)
    {
        // Expansion before the claim locks is read-only and untracked; everything is read again after them.
        var scoped = ClaimsOf(t);
        var named = await db.ClaimLineItems.AsNoTracking().Where(l => lineIds.Contains(l.Id) && scoped.Any(c => c.Id == l.TripClaimId)).Select(l => new { l.Id, l.TripClaimId }).ToListAsync(ct);
        if (named.Count != lineIds.Count) return Fail<ClaimBatch>(404, NotFound);
        var namedClaims = await scoped.AsNoTracking().Where(c => claimIds.Contains(c.Id)).Select(c => c.Id).ToListAsync(ct);
        if (namedClaims.Count != claimIds.Count) return Fail<ClaimBatch>(404, NotFound);

        var touched = named.Select(l => l.TripClaimId).Concat(namedClaims).Distinct().Order().ToList();
        await LockClaimsAsync(touched, ct);

        var allIds = await db.ClaimLineItems.AsNoTracking().Where(l => touched.Contains(l.TripClaimId)).Select(l => l.Id).ToListAsync(ct);
        var rows = await bpr.LoadRowsAsync(t, allIds, ct);
        var wanted = lineIds.ToHashSet();
        var expand = claimIds.ToHashSet();
        var selected = rows.Where(r => wanted.Contains(r.Line.Id)
            || (expand.Contains(r.Claim.Id) && r.PlanType == PlanType.AgencyManaged && r.Line.Status == ClaimLineItemStatus.Draft)).ToList();
        if (selected.Count == 0) return Fail<ClaimBatch>(400, "There are no NDIA-managed lines waiting to be sent on those claims.");
        if (selected.Count > MaxRows) return Fail<ClaimBatch>(400, $"That's {selected.Count} lines. A file holds up to 5,000: choose fewer.");

        var selectedIds = selected.Select(r => r.Line.Id).ToHashSet();
        var errors = new List<string>();
        foreach (var claim in selected.Select(r => r.Claim).DistinctBy(c => c.Id))
        {
            // A claim is sent whole: its other waiting agency lines must be in the file too (a rejected line is lodged again on its own).
            if (rows.Any(r => r.Claim.Id == claim.Id && r.PlanType == PlanType.AgencyManaged && r.Line.Status == ClaimLineItemStatus.Draft && !selectedIds.Contains(r.Line.Id)))
                errors.Add($"{claim.ClaimReference} has lines you didn't choose. A claim is sent whole: include all of its lines.");
        }

        var (context, attempts, lastCode) = await ContextAsync(t, selected, confirmed, true, ct);
        var today = context.Today;
        var problems = selected
            .SelectMany(r => ClaimBatchChecks.For(r, context).Where(p => p.Severity == ClaimBatchChecks.Block).Select(p => new BuildProblemDto(r.Line.Id, r.Claim.ClaimReference, p.Rule, p.Message)))
            .ToList();
        if (problems.Count > 0 || errors.Count > 0)
        {
            if (problems.Count > 0) errors.Add($"{problems.Select(p => p.LineId).Distinct().Count()} line(s) can't be sent yet. Fix them, then build the file again.");
            return Fail<ClaimBatch>(400, errors, new BuildRefusalDto(problems));
        }

        var prefix = "BPR" + today.ToString("yyMMdd", CultureInfo.InvariantCulture);
        var fileCount = await db.ClaimBatches.Where(b => b.TenantId == t && b.FileName.StartsWith(prefix)).CountAsync(ct);
        if (fileCount >= 999) return Fail<ClaimBatch>(409, "999 files have already been built today. Try again tomorrow.");
        var fileName = prefix + (fileCount + 1).ToString("D3", CultureInfo.InvariantCulture) + ".csv";

        int AttemptOf(Guid lineId) => attempts.TryGetValue(lineId, out var a) ? a + 1 : 1;
        var ordered = selected.OrderBy(r => r.Claim.ClaimReference, StringComparer.Ordinal).ThenBy(r => r.Line.SupportsDeliveredFrom).ThenBy(r => r.Line.Id).ToList();
        var written = ordered.Select(r => (Row: r, Out: BprCsvService.ToOut(r, AttemptOf(r.Line.Id)))).ToList();

        var (userId, userName) = Who(user);
        var batch = new ClaimBatch
        {
            Id = Guid.NewGuid(), TenantId = t, FileName = fileName, Status = ClaimBatchStatus.Built, CreatedByUserId = userId, CreatedByName = userName,
            CreatedAt = clock.GetUtcNow().UtcDateTime, LineCount = ordered.Count, TotalAmount = ordered.Sum(r => r.Line.TotalAmount),
            Content = BprCsvService.Write(written.Select(w => w.Out)),
        };
        foreach (var (row, o) in written)
            batch.Lines.Add(new ClaimBatchLine
            {
                Id = Guid.NewGuid(), TenantId = t, BatchId = batch.Id, ClaimLineItemId = row.Line.Id, Attempt = AttemptOf(row.Line.Id), RowReference = o.Reference,
                Outcome = ClaimBatchLineOutcome.Pending, NdisNumber = o.NdisNumber, SupportNumber = o.SupportNumber, SupportsDeliveredFrom = o.From, SupportsDeliveredTo = o.To,
                Amount = row.Line.TotalAmount,
            });
        db.ClaimBatches.Add(batch);

        Audit("ClaimBatch", batch.Id, "Built", null, $"{fileName}: {batch.LineCount} lines, ${Money(batch.TotalAmount)}", user, AuditAction.Created);
        foreach (var row in ordered.Where(r => confirmed.Contains(r.Line.Id) && lastCode.TryGetValue(r.Line.Id, out var code) && NdiaRejectCodes.For(code).NeedsDecision))
            Audit("ClaimLineItem", row.Line.Id, "ResubmitConfirmed", lastCode[row.Line.Id], fileName, user);

        await db.SaveChangesAsync(ct);
        return Done(batch);
    }

    /// <summary>
    /// What the checks need for these rows, read once: the same for a build and for the hub, so the two never disagree. Also each line's last attempt and the code of its last rejection.
    /// </summary>
    // shortcut: the other-funded and held-by checks run per claim, a few queries each; fine for a hub page of 200 claims, batch them if it grows.
    private async Task<(BatchContext Context, Dictionary<Guid, int> Attempts, Dictionary<Guid, string> LastCode)> ContextAsync(
        Guid t, IReadOnlyList<BprRow> selected, IReadOnlySet<Guid> confirmed, bool buildRows, CancellationToken ct)
    {
        var selectedIds = selected.Select(r => r.Line.Id).ToHashSet();
        var settings = selected.Select(r => r.Settings).FirstOrDefault(s => s != null);
        var today = TodayFor(settings);

        var pending = await db.ClaimBatchLines.AsNoTracking()
            .Where(b => b.TenantId == t && b.Outcome == ClaimBatchLineOutcome.Pending && b.ClaimLineItemId != null && selectedIds.Contains(b.ClaimLineItemId.Value))
            .Select(b => new { LineId = b.ClaimLineItemId!.Value, b.Batch.FileName }).ToListAsync(ct);

        var ndisNumbers = selected.Select(r => r.Participant?.NdisNumber?.Trim()).Where(n => !string.IsNullOrEmpty(n)).Distinct().ToList();
        var accepted = await db.ClaimBatchLines.AsNoTracking()
            .Where(b => b.TenantId == t && b.Outcome == ClaimBatchLineOutcome.Successful && b.NdisNumber != null && ndisNumbers.Contains(b.NdisNumber))
            .Select(b => new AcceptedLine(b.NdisNumber!, b.SupportNumber, b.SupportsDeliveredFrom, b.SupportsDeliveredTo, b.Batch.FileName)).ToListAsync(ct);

        var otherFunded = new Dictionary<Guid, string>();
        var heldBy = new Dictionary<Guid, string>();
        foreach (var claim in selected.Select(r => r.Claim).DistinctBy(c => c.Id))
        {
            if (await ClaimSubmission.OtherFundedRefusalAsync(db, claim, ct) is { } funded) otherFunded[claim.Id] = funded;
            var claimId = claim.Id;
            if (await ClaimSubmission.HoldingTheSameAsync(db, claimId, db.ClaimLineItems.Where(l => l.TripClaimId == claimId && selectedIds.Contains(l.Id)), ct) is { } holder) heldBy[claimId] = holder;
        }

        var history = await db.ClaimBatchLines.AsNoTracking()
            .Where(b => b.TenantId == t && b.ClaimLineItemId != null && selectedIds.Contains(b.ClaimLineItemId.Value))
            .Select(b => new { LineId = b.ClaimLineItemId!.Value, b.Attempt, b.Outcome, b.RejectCode }).ToListAsync(ct);
        var attempts = history.GroupBy(h => h.LineId).ToDictionary(g => g.Key, g => g.Max(h => h.Attempt));
        var rejectedNow = selected.Where(r => r.Line.Status == ClaimLineItemStatus.Rejected).Select(r => r.Line.Id).ToHashSet();
        var lastCode = history.Where(h => h.Outcome == ClaimBatchLineOutcome.Rejected && rejectedNow.Contains(h.LineId))
            .GroupBy(h => h.LineId).ToDictionary(g => g.Key, g => g.OrderByDescending(h => h.Attempt).First().RejectCode ?? "");

        var participantIds = selected.Select(r => r.Participant?.Id).OfType<Guid>().Distinct().ToList();
        var plans = (await db.FundingPlans.AsNoTracking().Where(p => p.TenantId == t && participantIds.Contains(p.ParticipantId))
                .Select(p => new { p.ParticipantId, p.PlanStart, p.PlanEnd }).ToListAsync(ct))
            .GroupBy(p => p.ParticipantId).ToDictionary(g => g.Key, g => (IReadOnlyList<(DateOnly Start, DateOnly End)>)g.Select(p => (p.PlanStart, p.PlanEnd)).ToList());

        var context = new BatchContext
        {
            Today = today, BuildRows = buildRows ? selected : [], PendingFiles = pending.GroupBy(p => p.LineId).ToDictionary(g => g.Key, g => g.First().FileName),
            Accepted = accepted, OtherFunded = otherFunded, HeldBy = heldBy, LastRejectCode = lastCode, ConfirmedLineIds = confirmed, Plans = plans,
        };
        return (context, attempts, lastCode);
    }

    // ---- per-claim download (G9) ----

    public Task<BatchResult<BuiltFile>> DownloadForClaimAsync(Guid t, ClaimsPrincipal user, Guid claimId, CancellationToken ct) => Guard(async () =>
    {
        if (!await ClaimsOf(t).AnyAsync(c => c.Id == claimId, ct)) return Fail<BuiltFile>(404, NotFound);

        await using var held = await LockBatchAsync(t, ct);
        var allIds = await db.ClaimLineItems.AsNoTracking().Where(l => l.TripClaimId == claimId).Select(l => l.Id).ToListAsync(ct);
        var agency = (await bpr.LoadRowsAsync(t, allIds, ct)).Where(r => r.PlanType == PlanType.AgencyManaged).ToList();
        if (agency.Count == 0) return Fail<BuiltFile>(400, "This claim has no NDIA-managed lines to send.");

        var unsent = agency.Where(r => r.Line.Status is ClaimLineItemStatus.Draft or ClaimLineItemStatus.Rejected).Select(r => r.Line.Id).ToHashSet();
        var inFiles = await db.ClaimBatchLines.AsNoTracking()
            .Where(b => b.TenantId == t && b.Outcome == ClaimBatchLineOutcome.Pending && b.ClaimLineItemId != null && unsent.Contains(b.ClaimLineItemId.Value))
            .Select(b => new { b.BatchId, b.Batch.FileName, b.Batch.Status }).Distinct().ToListAsync(ct);

        if (inFiles.FirstOrDefault(f => f.Status == ClaimBatchStatus.Uploaded) is { } sent)
            return Fail<BuiltFile>(409, $"This claim was sent in {sent.FileName}. Import that file's results in Claims before lodging it again.");
        if (inFiles.FirstOrDefault() is { } open)
        {
            var pendingInFile = await db.ClaimBatchLines.AsNoTracking()
                .Where(b => b.BatchId == open.BatchId && b.Outcome == ClaimBatchLineOutcome.Pending).Select(b => b.ClaimLineItemId).ToListAsync(ct);
            if (inFiles.Count > 1 || pendingInFile.Count != unsent.Count || pendingInFile.Any(id => id is null || !unsent.Contains(id.Value)))
                return Fail<BuiltFile>(409, $"This claim is in {open.FileName} with other claims. Download it from Claims, or discard it first.");
            return await FileAsync(t, open.BatchId, ct);
        }
        if (unsent.Count == 0) return Fail<BuiltFile>(400, "This claim has no lines left to send to the NDIA.");

        var built = await BuildCoreAsync(t, user, unsent.ToList(), [], new HashSet<Guid>(), ct);
        if (!built.Ok) return Fail<BuiltFile>(built.Status, built.Errors ?? [], built.Data);
        await held.CommitAsync(ct);
        return Done(new BuiltFile(built.Value!.Id, built.Value.FileName, built.Value.Content));
    });

    // ---- discard ----

    public Task<BatchResult<BatchDto>> DiscardAsync(Guid t, ClaimsPrincipal user, Guid id, CancellationToken ct) => Guard(async () =>
    {
        await using var held = await LockBatchAsync(t, ct);
        var batch = await db.ClaimBatches.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == t, ct);
        if (batch is null) return Fail<BatchDto>(404, NotFound);
        if (batch.Status != ClaimBatchStatus.Built) return Fail<BatchDto>(409, "Only a file that hasn't been uploaded can be discarded.");

        var pending = await db.ClaimBatchLines.Where(l => l.BatchId == id && l.Outcome == ClaimBatchLineOutcome.Pending).ToListAsync(ct);
        foreach (var line in pending) line.Outcome = ClaimBatchLineOutcome.Withdrawn;
        var (userId, _) = Who(user);
        batch.Status = ClaimBatchStatus.Discarded;
        batch.DiscardedAt = clock.GetUtcNow().UtcDateTime;
        batch.DiscardedByUserId = userId;
        Audit("ClaimBatch", id, "Status", "Built", $"Discarded: {pending.Count} lines freed", user);
        await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return await SummaryAsync(t, id, ct);
    });

    // ---- confirm upload ----

    public Task<BatchResult<BatchDto>> ConfirmUploadedAsync(Guid t, ClaimsPrincipal user, Guid id, CancellationToken ct) => Guard(async () =>
    {
        await using var held = await LockBatchAsync(t, ct);
        var batch = await db.ClaimBatches.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == t, ct);
        if (batch is null) return Fail<BatchDto>(404, NotFound);
        if (batch.Status != ClaimBatchStatus.Built)
            return Fail<BatchDto>(409, batch.Status == ClaimBatchStatus.Discarded ? "This file was discarded. Build a new one." : "This file has already been confirmed as uploaded.");

        var lineIds = await db.ClaimBatchLines.AsNoTracking().Where(l => l.BatchId == id && l.Outcome == ClaimBatchLineOutcome.Pending && l.ClaimLineItemId != null)
            .Select(l => l.ClaimLineItemId!.Value).ToListAsync(ct);
        var claimIds = await db.ClaimLineItems.AsNoTracking().Where(l => lineIds.Contains(l.Id)).Select(l => l.TripClaimId).Distinct().ToListAsync(ct);
        await LockClaimsAsync(claimIds, ct);

        var claims = await db.TripClaims.Where(c => claimIds.Contains(c.Id)).OrderBy(c => c.Id).ToListAsync(ct);
        var items = await db.ClaimLineItems.Where(l => lineIds.Contains(l.Id)).ToListAsync(ct);
        var now = clock.GetUtcNow().UtcDateTime;
        var open = new[] { TripClaimStatus.Draft, TripClaimStatus.Ready, TripClaimStatus.Rejected };

        // Everything is checked for every claim before anything changes, so one refusal writes nothing.
        var refusals = new List<string>();
        foreach (var claim in claims)
        {
            if (claim.Status == TripClaimStatus.Cancelled) refusals.Add($"{claim.ClaimReference}: it is cancelled, so it can't be sent.");
            if (open.Contains(claim.Status) && await ClaimSubmission.OtherFundedRefusalAsync(db, claim, ct) is { } funded) refusals.Add($"{claim.ClaimReference}: {funded}");
            var claimId = claim.Id;
            if (await ClaimSubmission.HoldingTheSameAsync(db, claimId, db.ClaimLineItems.Where(l => l.TripClaimId == claimId && lineIds.Contains(l.Id)), ct) is { } holder)
                refusals.Add($"{claim.ClaimReference}: a shift in this file is already on claim {holder}, so it can't be sent.");
        }
        if (refusals.Count > 0) return Fail<BatchDto>(409, refusals);

        var submitted = 0;
        foreach (var claim in claims.Where(c => open.Contains(c.Status)))
        {
            try { await invoices.IssueForSubmitAsync(claim.Id, now, user, ct); }
            catch (InvoiceRefusedException ex) { return Fail<BatchDto>(409, $"{claim.ClaimReference}: {ex.Message}"); }
            ClaimStatusRules.ApplyStatus(claim, TripClaimStatus.Submitted, now);
            submitted++;
        }
        foreach (var item in items) { item.Status = ClaimLineItemStatus.Submitted; item.RejectionReason = null; }

        var (userId, userName) = Who(user);
        batch.Status = ClaimBatchStatus.Uploaded;
        batch.UploadedAt = now;
        batch.UploadedByUserId = userId;
        batch.UploadedByName = userName;
        Audit("ClaimBatch", id, "Status", "Built", $"Uploaded: {lineIds.Count} lines, {submitted} claims submitted", user);
        await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return await SummaryAsync(t, id, ct);
    });

    // ---- results ----

    public Task<BatchResult<ResultsImportDto>> ImportResultsAsync(Guid t, ClaimsPrincipal user, Guid id, byte[] file, CancellationToken ct) => Guard(async () =>
    {
        await using var held = await LockBatchAsync(t, ct);
        var batch = await db.ClaimBatches.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == t, ct);
        if (batch is null) return Fail<ResultsImportDto>(404, NotFound);
        if (batch.Status is not (ClaimBatchStatus.Uploaded or ClaimBatchStatus.ResultsImported))
            return Fail<ResultsImportDto>(409, "Confirm you've uploaded this file before importing its results.");
        var parsed = NdiaResultsFile.Parse(file);
        if (parsed.Error != null) return Fail<ResultsImportDto>(400, parsed.Error);

        var lines = await db.ClaimBatchLines.Where(l => l.BatchId == id).ToListAsync(ct);
        var lineIds = lines.Where(l => l.ClaimLineItemId != null).Select(l => l.ClaimLineItemId!.Value).ToList();
        var claimIds = await db.ClaimLineItems.AsNoTracking().Where(l => lineIds.Contains(l.Id)).Select(l => l.TripClaimId).Distinct().ToListAsync(ct);
        await LockClaimsAsync(claimIds, ct);
        var items = await db.ClaimLineItems.Where(l => lineIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id, ct);
        var byReference = lines.ToDictionary(l => l.RowReference, StringComparer.Ordinal);

        int successful = 0, rejected = 0, unchanged = 0, leftAlone = 0;
        var conflicts = new List<ResultConflictDto>();
        var unknown = new List<string>();
        var touched = new HashSet<Guid>();
        foreach (var row in parsed.Rows)
        {
            if (!byReference.TryGetValue(row.Reference, out var line)) { unknown.Add(row.Reference); continue; }
            var code = row.Outcome == ClaimBatchLineOutcome.Rejected ? Trunc(NdiaRejectionCodes.Normalise(row.Code), NdiaRejectionCodes.MaxLength) : null;
            if (line.Outcome != ClaimBatchLineOutcome.Pending)
            {
                if (line.Outcome == row.Outcome && (row.Outcome != ClaimBatchLineOutcome.Rejected || code == line.RejectCode)) unchanged++;
                else conflicts.Add(new ResultConflictDto(line.RowReference, Describe(line.Outcome, line.RejectCode), Describe(row.Outcome, code)));
                continue;
            }

            line.Outcome = row.Outcome;
            items.TryGetValue(line.ClaimLineItemId ?? Guid.Empty, out var item);
            // Only a line still waiting on the NDIA moves: a line someone has since paid or rejected by hand keeps what they recorded.
            var moves = item is { Status: ClaimLineItemStatus.Submitted };
            if (row.Outcome == ClaimBatchLineOutcome.Successful)
            {
                successful++;
                line.ResultAmount = row.Amount;
                if (moves) item!.Status = ClaimLineItemStatus.Approved;
            }
            else
            {
                rejected++;
                line.RejectCode = code;
                line.RejectMessage = Trunc(row.Message, 1000);
                if (moves)
                {
                    item!.Status = ClaimLineItemStatus.Rejected;
                    item.RejectionReason = Trunc(string.Join(": ", new[] { code, row.Message }.Where(s => !string.IsNullOrEmpty(s))), 1000);
                }
            }
            if (moves) touched.Add(item!.TripClaimId); else leftAlone++;
        }

        await RollUpAsync(touched, ct);
        batch.Status = ClaimBatchStatus.ResultsImported;
        batch.ResultsImportedAt = clock.GetUtcNow().UtcDateTime;
        Audit("ClaimBatch", id, "Results", null, $"{successful} successful, {rejected} rejected, {unchanged} unchanged, {conflicts.Count} conflicts, {unknown.Count} unknown", user);
        await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);

        var summary = await SummaryAsync(t, id, ct);
        return Done(new ResultsImportDto(successful, rejected, unchanged, leftAlone, conflicts, unknown, parsed.Unread.ToList(), summary.Value!));
    });

    private static string Describe(ClaimBatchLineOutcome outcome, string? code) => outcome == ClaimBatchLineOutcome.Rejected && code != null ? $"Rejected ({code})" : outcome.ToString();

    /// <summary>Rolls each claim's status up from all of its lines (tracked, so the lines changed in this call count as changed).</summary>
    private async Task RollUpAsync(IReadOnlyCollection<Guid> claimIds, CancellationToken ct)
    {
        if (claimIds.Count == 0) return;
        var claims = await db.TripClaims.Where(c => claimIds.Contains(c.Id)).ToListAsync(ct);
        var lines = await db.ClaimLineItems.Where(l => claimIds.Contains(l.TripClaimId)).ToListAsync(ct);
        var now = clock.GetUtcNow().UtcDateTime;
        foreach (var claim in claims) ClaimStatusRules.RollUp(claim, lines.Where(l => l.TripClaimId == claim.Id).Select(l => l.Status).ToList(), now);
    }

    // ---- paid ----

    public Task<BatchResult<BatchDto>> MarkPaidAsync(Guid t, ClaimsPrincipal user, Guid id, IReadOnlyCollection<PaidLineRequest> requested, CancellationToken ct) => Guard(async () =>
    {
        await using var held = await LockBatchAsync(t, ct);
        var batch = await db.ClaimBatches.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.TenantId == t, ct);
        if (batch is null) return Fail<BatchDto>(404, NotFound);

        var lines = await db.ClaimBatchLines.Where(l => l.BatchId == id).ToListAsync(ct);
        var lineIds = lines.Where(l => l.ClaimLineItemId != null).Select(l => l.ClaimLineItemId!.Value).ToList();
        var claimIds = await db.ClaimLineItems.AsNoTracking().Where(l => lineIds.Contains(l.Id)).Select(l => l.TripClaimId).Distinct().ToListAsync(ct);
        await LockClaimsAsync(claimIds, ct);
        var items = await db.ClaimLineItems.Include(l => l.TripClaim).Where(l => lineIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id, ct);

        var targets = requested.Count > 0
            ? requested.Select(r => (Request: r, Line: lines.FirstOrDefault(l => l.Id == r.BatchLineId))).ToList()
            : lines.Where(l => l.Outcome == ClaimBatchLineOutcome.Successful && l.ClaimLineItemId is { } cid && items.TryGetValue(cid, out var it) && it.Status == ClaimLineItemStatus.Approved)
                .Select(l => (Request: new PaidLineRequest(l.Id, null), Line: (ClaimBatchLine?)l)).ToList();
        if (targets.Count == 0) return Fail<BatchDto>(400, "No accepted lines are waiting to be marked paid.");

        var problems = new List<BuildProblemDto>();
        var paying = new List<(ClaimLineItem Item, decimal Amount)>();
        foreach (var (request, line) in targets)
        {
            ClaimLineItem? item = null;
            if (line?.ClaimLineItemId is { } itemId) items.TryGetValue(itemId, out item);
            var reference = item?.TripClaim.ClaimReference ?? "";
            if (line is null || item is null || line.Outcome != ClaimBatchLineOutcome.Successful || item.Status != ClaimLineItemStatus.Approved)
            {
                problems.Add(new BuildProblemDto(request.BatchLineId, reference, "NotAccepted", "Only lines the NDIA accepted can be marked paid."));
                continue;
            }
            var amount = request.Amount ?? line.ResultAmount ?? item.TotalAmount;
            if (amount <= 0 || amount > item.TotalAmount || decimal.Round(amount, 2) != amount)
            {
                problems.Add(new BuildProblemDto(request.BatchLineId, reference, "Amount", $"Enter an amount between $0.01 and ${Money(item.TotalAmount)}."));
                continue;
            }
            paying.Add((item, amount));
        }
        if (problems.Count > 0) return Fail<BatchDto>(400, $"{problems.Count} line(s) can't be marked paid.", new BuildRefusalDto(problems));

        foreach (var (item, amount) in paying) { item.Status = ClaimLineItemStatus.Paid; item.PaidAmount = amount; }
        await RollUpAsync(paying.Select(p => p.Item.TripClaimId).Distinct().ToList(), ct);
        Audit("ClaimBatch", id, "Paid", null, $"{paying.Count} lines, ${Money(paying.Sum(p => p.Amount))}", user);
        await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return await SummaryAsync(t, id, ct);
    });

    // ---- dismiss ----

    public Task<BatchResult<BatchLineDto>> DismissAsync(Guid t, ClaimsPrincipal user, Guid batchLineId, CancellationToken ct) => Guard(async () =>
    {
        await using var held = await LockBatchAsync(t, ct);
        var line = await db.ClaimBatchLines.FirstOrDefaultAsync(l => l.Id == batchLineId && l.TenantId == t, ct);
        if (line is null) return Fail<BatchLineDto>(404, NotFound);
        if (line.Outcome != ClaimBatchLineOutcome.Rejected || !NdiaRejectCodes.For(line.RejectCode).NeedsDecision)
            return Fail<BatchLineDto>(409, "Only a rejection that needs a decision can be dismissed.");

        if (line.DismissedAt is null)
        {
            line.DismissedAt = clock.GetUtcNow().UtcDateTime;
            line.DismissedByUserId = Who(user).Id;
            if (line.ClaimLineItemId is { } itemId) Audit("ClaimLineItem", itemId, "RejectionDismissed", line.RejectCode, line.RowReference, user);
            else Audit("ClaimBatch", line.BatchId, "RejectionDismissed", line.RejectCode, line.RowReference, user);
            await db.SaveChangesAsync(ct);
        }
        await held.CommitAsync(ct);
        return Done((await LinesAsync(t, l => l.Id == batchLineId, ct)).Single());
    });

    // ---- file ----

    public async Task<BatchResult<BuiltFile>> FileAsync(Guid t, Guid id, CancellationToken ct)
    {
        var file = await db.ClaimBatches.AsNoTracking().Where(b => b.Id == id && b.TenantId == t).Select(b => new { b.Id, b.FileName, b.Status, b.Content }).FirstOrDefaultAsync(ct);
        if (file is null) return Fail<BuiltFile>(404, NotFound);
        if (file.Status == ClaimBatchStatus.Discarded) return Fail<BuiltFile>(409, "This file was discarded. Build a new one.");
        return Done(new BuiltFile(file.Id, file.FileName, file.Content));
    }
}
