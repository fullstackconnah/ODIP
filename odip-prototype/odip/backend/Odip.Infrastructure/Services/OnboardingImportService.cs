using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>What an undo came to: the batch was not found, or these records changed since the import (nothing was undone), or the undone batch.</summary>
public sealed record ImportUndoOutcome(bool NotFound, List<ImportUndoBlockerDto> Blockers, ImportBatchDto? Batch);

/// <summary>
/// Settings → Import data: an organisation's Admin brings participants (and staff) over from another platform's export. Preview reads the file in
/// memory and writes nothing. Commit reads it again, re-checks every row (the preview is never trusted) and creates the ready rows through the
/// manual-entry services, one organisation at a time, in one transaction. Undo takes a whole batch back while nothing has been added to its
/// records. The file is never stored, and nothing here logs a value from it.
/// </summary>
public sealed class OnboardingImportService
{
    public const string ChooseOrganisation = "Choose an organisation to view as before importing: an import belongs to one organisation.";
    public const string LockBusy = "Another import is running for this organisation; try again when it finishes.";
    public const string ChooseLanding = "Choose whether these participants are already receiving services or are new onboarding.";
    public const string CommitFailed = "The import failed, so nothing was imported. Try again; if it keeps failing, contact support.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly ParticipantCreateService _participants;
    private readonly TimeProvider _clock;
    private readonly ILogger<OnboardingImportService>? _logger;

    public OnboardingImportService(OdipDbContext db, ICurrentTenant tenant, ParticipantCreateService participants, TimeProvider clock,
        ILogger<OnboardingImportService>? logger = null)
    {
        _db = db;
        _tenant = tenant;
        _participants = participants;
        _clock = clock;
        _logger = logger;
    }

    /// <summary>
    /// The organisation the import works in. A SuperAdmin must be viewing as one: unscoped, the query filters would read every organisation and
    /// new rows would be stamped with the SuperAdmin's own tenant.
    /// </summary>
    private Guid TenantId() => !_tenant.IsSuperAdmin && _tenant.TenantId is { } id ? id : throw new ImportException(ChooseOrganisation);

    public async Task<ImportPreviewDto> PreviewAsync(ImportKind kind, byte[] content, string fileName, IReadOnlyList<string?>? mapping, CancellationToken ct)
    {
        TenantId();
        var table = ImportFileReader.Read(content, fileName);
        var columns = mapping ?? ImportFields.AutoMatch(kind, table.Headers);
        if (ImportFields.MappingError(kind, columns, table.Headers.Count, requireAll: false) is { } mappingError) throw new ImportException(mappingError);

        var plans = await PlanAsync(kind, table, columns, ct);
        var hash = Sha256(content);
        var previouslyImportedAt = await _db.ImportBatches
            .Where(b => b.FileSha256 == hash && b.UndoneAt == null)
            .OrderByDescending(b => b.CreatedAt)
            .Select(b => (DateTime?)b.CreatedAt)
            .FirstOrDefaultAsync(ct);

        return new ImportPreviewDto(
            ImportFields.For(kind).Select(f => new ImportFieldDto(f.Key, f.Label, f.Required)).ToList(),
            table.Headers.Select((header, i) => new ImportColumnDto(i, header, columns[i], null)).ToList(),
            plans.Select(p => p.ToDto()).ToList(),
            plans.Count(p => p.Status == ImportRowStatus.Ready),
            plans.Count(p => p.Status == ImportRowStatus.Skipped),
            plans.Count(p => p.Status == ImportRowStatus.Invalid),
            previouslyImportedAt);
    }

    /// <summary>Every row's status: the file's own rules, then people already in this organisation, then repeats within the file.</summary>
    private async Task<List<ImportRowPlan>> PlanAsync(ImportKind kind, ImportTable table, IReadOnlyList<string?> mapping, CancellationToken ct)
    {
        var asOf = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var plans = ImportParticipantRows.Build(table, mapping, asOf);

        // Participants already here, by NDIS number: the query filter keeps this to the organisation. Those an undone import archived do not
        // count, so a corrected file can be imported again.
        var undone = _db.ImportBatchItems.Where(i => i.Batch!.UndoneAt != null).Select(i => i.EntityId);
        var existing = (await _db.Participants
                .Where(p => p.NdisNumber != null && !undone.Contains(p.Id))
                .Select(p => new { p.NdisNumber, p.FirstName, p.LastName })
                .ToListAsync(ct))
            .GroupBy(p => ImportParticipantRows.NdisKey(p.NdisNumber!))
            .ToDictionary(g => g.Key, g => g.First());
        foreach (var plan in plans)
            if (plan.DuplicateKey is { } key && existing.TryGetValue(key, out var match))
                plan.Skip($"Already in ODIP as {match.FirstName} {match.LastName}.");

        ImportRowPlan.MarkFileDuplicates(plans, "NDIS number");
        return plans;
    }

    /// <summary>One advisory-lock key per organisation: imports and undos in one organisation queue, other organisations are not held up.</summary>
    public static long LockKey(Guid tenantId) => BitConverter.ToInt64(tenantId.ToByteArray(), 0);

    public async Task<ImportResultDto> CommitAsync(ImportKind kind, byte[] content, string fileName, IReadOnlyList<string?>? mapping,
        ImportLanding? landing, string idempotencyKey, ClaimsPrincipal? caller, CancellationToken ct)
    {
        var tenantId = TenantId();
        if (string.IsNullOrWhiteSpace(idempotencyKey) || idempotencyKey.Length > 100)
            throw new ImportException("The import request has no key. Reload the page and try again.");
        if (kind == ImportKind.Participants && landing is null) throw new ImportException(ChooseLanding);
        var table = ImportFileReader.Read(content, fileName);
        var columns = mapping ?? ImportFields.AutoMatch(kind, table.Headers);
        if (ImportFields.MappingError(kind, columns, table.Headers.Count, requireAll: true) is { } mappingError) throw new ImportException(mappingError);
        if (await ReplayAsync(idempotencyKey, ct) is { } earlier) return earlier;

        await using var importLock = await AcquireLockAsync(tenantId, ct);
        // A request that waited behind its own twin finds the batch the twin made.
        if (await ReplayAsync(idempotencyKey, ct) is { } twin) return twin;

        var plans = await PlanAsync(kind, table, columns, ct);
        var batch = new ImportBatch
        {
            Id = Guid.NewGuid(), TenantId = tenantId, Kind = kind, FileName = Path.GetFileName(fileName), FileSha256 = Sha256(content),
            IdempotencyKey = idempotencyKey, RowCount = plans.Count, CreatedById = ActorId(caller), CreatedByName = ActorName(caller),
        };
        var items = new List<ImportBatchItem>();
        var rowNumber = 0;
        try
        {
            foreach (var plan in plans.Where(p => p.Status == ImportRowStatus.Ready))
            {
                rowNumber = plan.RowNumber;
                if (await CreateAsync(plan, landing, caller, ct) is { } entityId)
                    items.Add(new ImportBatchItem { Id = Guid.NewGuid(), BatchId = batch.Id, EntityType = nameof(Participant), EntityId = entityId });
            }
            batch.CreatedCount = items.Count;
            batch.SkippedCount = plans.Count(p => p.Status == ImportRowStatus.Skipped);
            batch.FailedCount = plans.Count(p => p.Status == ImportRowStatus.Invalid);
            // Stamped after the rows, so undo can tell the contact roles this import made from ones added later (ImportUntouched).
            batch.CreatedAt = DateTime.UtcNow;
            _db.ImportBatches.Add(batch);
            _db.ImportBatchItems.AddRange(items);
            await _db.SaveChangesAsync(ct);
            await importLock.CommitAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Disposing the lock rolls the whole transaction back. Only the row number and the exception's type are logged: a database
            // error's own text can quote a value from the file.
            _logger?.LogError("Import {BatchId} failed at row {RowNumber}: {ExceptionType}", batch.Id, rowNumber, ex.GetType().Name);
            throw new ImportException(CommitFailed, 500);
        }
        return new ImportResultDto(batch.Id, batch.CreatedCount, batch.SkippedCount, batch.FailedCount, plans.Select(p => p.ToDto()).ToList(), Replayed: false);
    }

    private async Task<CatalogueImportLock> AcquireLockAsync(Guid tenantId, CancellationToken ct)
    {
        try { return await CatalogueImportLock.AcquireAsync(_db, LockKey(tenantId), LockBusy, ct); }
        catch (InvalidOperationException ex) when (ex.Message == LockBusy) { throw new ImportException(LockBusy, 409); }
    }

    private async Task<ImportResultDto?> ReplayAsync(string idempotencyKey, CancellationToken ct)
    {
        var earlier = await _db.ImportBatches.Where(b => b.IdempotencyKey == idempotencyKey)
            .Select(b => new { b.Id, b.CreatedCount, b.SkippedCount, b.FailedCount })
            .FirstOrDefaultAsync(ct);
        return earlier is null ? null : new ImportResultDto(earlier.Id, earlier.CreatedCount, earlier.SkippedCount, earlier.FailedCount, [], Replayed: true);
    }

    /// <summary>
    /// Creates one ready row through the manual-entry service and saves it inside the import's transaction. A row the service refuses now (it
    /// changed since the preview) is marked Can't import and left out.
    /// </summary>
    private async Task<Guid?> CreateAsync(ImportRowPlan plan, ImportLanding? landing, ClaimsPrincipal? caller, CancellationToken ct)
    {
        // New onboarding: a draft whose intake is completed by the Intake wizard's own path (snapshot and onboarding row included).
        // Already receiving services: finalised and active, like a participant from before onboarding existed, so no onboarding row.
        var onboarding = landing == ImportLanding.Onboarding;
        var (participant, error) = await _participants.StageAsync(plan.Participant! with { IsDraft = onboarding, CompleteIntake = onboarding }, CompletionActor(caller), ct);
        if (participant is null)
        {
            _db.ChangeTracker.Clear();
            plan.Refuse(error!);
            return null;
        }
        if (!onboarding) participant.IsActive = true;
        await _db.SaveChangesAsync(ct);
        // A saved row's entities are not needed again, and 2,000 rows kept tracked would make every later save slower.
        _db.ChangeTracker.Clear();
        return participant.Id;
    }

    private static Guid? ActorId(ClaimsPrincipal? caller) =>
        Guid.TryParse(caller?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

    private static string ActorName(ClaimsPrincipal? caller) =>
        caller?.FindFirst("fullName")?.Value ?? caller?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";

    // The attribution ParticipantsController gives an intake completed by hand (its CompletionActor).
    private static string CompletionActor(ClaimsPrincipal? caller) =>
        caller?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? caller?.FindFirst("sub")?.Value ?? "unknown";

    public async Task<ImportUndoOutcome> UndoAsync(Guid batchId, ClaimsPrincipal? caller, CancellationToken ct)
    {
        var tenantId = TenantId();
        await using var importLock = await AcquireLockAsync(tenantId, ct);
        var batch = await _db.ImportBatches.FirstOrDefaultAsync(b => b.Id == batchId, ct);
        if (batch is null) return new ImportUndoOutcome(true, [], null);
        if (batch.UndoneAt != null) throw new ImportException("This import was already undone.");

        var ids = await _db.ImportBatchItems.Where(i => i.BatchId == batch.Id).Select(i => i.EntityId).ToListAsync(ct);
        // The import lock does not stop a coordinator adding a shift or a note meanwhile. Locking the participant rows does: a child row's
        // foreign key takes FOR KEY SHARE on its participant, which waits for this FOR UPDATE, so a write either lands before the checks below see
        // it or waits until the undo has committed.
        if (_db.Database.IsNpgsql())
            await _db.Database.ExecuteSqlRawAsync("SELECT 1 FROM \"Participants\" WHERE \"Id\" = ANY({0}) FOR UPDATE", new object[] { ids.ToArray() }, ct);
        var blockers = await ImportUntouched.ParticipantBlockersAsync(_db, ids, batch.CreatedAt, ct);
        if (blockers.Count > 0)
        {
            var blockedIds = blockers.Keys.ToList();
            var names = await _db.Participants.Where(p => blockedIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.FirstName + " " + p.LastName, ct);
            return new ImportUndoOutcome(false, blockers
                .Select(b => new ImportUndoBlockerDto(b.Key, names.GetValueOrDefault(b.Key, ""), b.Value))
                .OrderBy(b => b.Name).ToList(), null);
        }

        var now = DateTime.UtcNow;
        // Archived, not deleted: the audit log keeps the import and the undo. A draft stays on the Onboarding tab whatever IsActive says
        // (ParticipantStages), so an onboarding import's drafts are finalised as archived too: they leave that tab for the Archived view.
        foreach (var participant in await _db.Participants.Where(p => ids.Contains(p.Id)).ToListAsync(ct))
        {
            participant.IsActive = false;
            participant.IsDraft = false;
            participant.UpdatedAt = now;
        }
        batch.UndoneAt = now;
        batch.UndoneById = ActorId(caller);
        batch.UndoneByName = ActorName(caller);
        await _db.SaveChangesAsync(ct);
        await importLock.CommitAsync(ct);
        return new ImportUndoOutcome(false, [], ToDto(batch));
    }

    public async Task<List<ImportBatchDto>> HistoryAsync(CancellationToken ct)
    {
        TenantId();
        var batches = await _db.ImportBatches.OrderByDescending(b => b.CreatedAt).ToListAsync(ct);
        return batches.Select(ToDto).ToList();
    }

    private static ImportBatchDto ToDto(ImportBatch b) =>
        new(b.Id, b.Kind, b.FileName, b.CreatedByName, b.CreatedAt, b.RowCount, b.CreatedCount, b.SkippedCount, b.FailedCount, b.UndoneAt, b.UndoneByName);

    private static string Sha256(byte[] content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
}
