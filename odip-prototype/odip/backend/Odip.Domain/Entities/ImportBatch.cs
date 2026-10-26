using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>What an onboarding import brings in.</summary>
public enum ImportKind
{
    Participants = 0,
    Staff = 1,
    FundingPlans = 2,
    UpcomingShifts = 3,
}

/// <summary>
/// One run of the onboarding import (Settings → Import data): what it imported, from which file, who ran it, and whether it was undone. The
/// file itself is never stored; its SHA-256 lets a preview say the same file was imported before. <see cref="Items"/> are the records it
/// created, which Undo works on.
/// </summary>
public class ImportBatch : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public ImportKind Kind { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string FileSha256 { get; set; } = string.Empty;
    /// <summary>The browser's key for one Import click: a second request with the same key answers with this batch instead of importing again.</summary>
    public string IdempotencyKey { get; set; } = string.Empty;
    public int RowCount { get; set; }
    public int CreatedCount { get; set; }
    public int SkippedCount { get; set; }
    public int FailedCount { get; set; }
    /// <summary>Shifts a partial undo left on the roster (published, changed or in use); null until an upcoming-shifts import is undone.</summary>
    public int? KeptCount { get; set; }
    public Guid? CreatedById { get; set; }
    public string CreatedByName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UndoneById { get; set; }
    public string? UndoneByName { get; set; }
    public DateTime? UndoneAt { get; set; }
    public List<ImportBatchItem> Items { get; set; } = new();
}

/// <summary>A record an import created. Not tenant-scoped itself: it is reached only through its tenant-filtered batch.</summary>
public class ImportBatchItem
{
    public Guid Id { get; set; }
    public Guid BatchId { get; set; }
    public ImportBatch? Batch { get; set; }
    /// <summary>"Participant", "User" or "FundingPlan".</summary>
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
}
