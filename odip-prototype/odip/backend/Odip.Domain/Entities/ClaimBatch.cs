using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

public enum ClaimBatchStatus { Built = 0, Uploaded = 1, ResultsImported = 2, Discarded = 3 }

public enum ClaimBatchLineOutcome { Pending = 0, Successful = 1, Rejected = 2, Withdrawn = 3 }

/// <summary>
/// One NDIA bulk-claim file built from claim lines, and where it is in its trip to the NDIA and back: built, uploaded, results imported, or discarded.
/// The file's exact bytes are stored, so every download is the same file. Not audited by the generic interceptor (it would copy <see cref="Content"/>);
/// the batch actions write their own audit rows.
/// </summary>
public class ClaimBatch : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    /// <summary>BPR{yyMMdd}{NNN}.csv, 16 characters.</summary>
    public string FileName { get; set; } = string.Empty;
    public ClaimBatchStatus Status { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; }
    public Guid? UploadedByUserId { get; set; }
    public string? UploadedByName { get; set; }
    public DateTime? UploadedAt { get; set; }
    public DateTime? ResultsImportedAt { get; set; }
    public Guid? DiscardedByUserId { get; set; }
    public DateTime? DiscardedAt { get; set; }
    public int LineCount { get; set; }
    public decimal TotalAmount { get; set; }
    /// <summary>The exact file served on every download.</summary>
    public byte[] Content { get; set; } = [];
    public List<ClaimBatchLine> Lines { get; set; } = [];
}

/// <summary>A claim line as it was sent in one batch, and what the NDIA answered. One attempt of one line.</summary>
public class ClaimBatchLine : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid BatchId { get; set; }
    public ClaimBatch Batch { get; set; } = null!;
    /// <summary>Set null when the claim is deleted, so the history stays.</summary>
    public Guid? ClaimLineItemId { get; set; }
    public ClaimLineItem? ClaimLineItem { get; set; }
    public int Attempt { get; set; }
    /// <summary>{20 hex of the line id}A{attempt}; the NDIA echoes it back.</summary>
    public string RowReference { get; set; } = string.Empty;
    public ClaimBatchLineOutcome Outcome { get; set; }
    public string? RejectCode { get; set; }
    public string? RejectMessage { get; set; }
    public decimal? ResultAmount { get; set; }
    // What the row said, so the duplicate check and the batch view survive a deleted line.
    public string NdisNumber { get; set; } = string.Empty;
    public string SupportNumber { get; set; } = string.Empty;
    public DateOnly SupportsDeliveredFrom { get; set; }
    public DateOnly SupportsDeliveredTo { get; set; }
    public decimal Amount { get; set; }
    public DateTime? DismissedAt { get; set; }
    public Guid? DismissedByUserId { get; set; }
}
