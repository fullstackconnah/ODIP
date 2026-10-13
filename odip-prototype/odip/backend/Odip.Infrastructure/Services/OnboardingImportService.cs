using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

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

    private static string Sha256(byte[] content) => Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
}
