using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Services;

/// <summary>Either a value, or a status code with the reasons. The controller maps it to an ApiResponse.</summary>
public sealed record BatchResult<T>(int Status, T? Value = default, List<string>? Errors = null, object? Data = null)
{
    public bool Ok => Status == 200;
}

public sealed record BuildRequest(IReadOnlyCollection<Guid> LineIds, IReadOnlyCollection<Guid> ClaimIds, IReadOnlyCollection<Guid> ConfirmedLineIds);

/// <summary>The stored file, for download.</summary>
public sealed record BuiltFile(Guid BatchId, string FileName, byte[] Content);

public sealed record BuildProblemDto(Guid LineId, string ClaimReference, string Rule, string Message);

public sealed record BuildRefusalDto(List<BuildProblemDto> Problems);

public record BatchDto(
    Guid Id, string FileName, ClaimBatchStatus Status, DateTime CreatedAt, string? CreatedByName, DateTime? UploadedAt, string? UploadedByName,
    DateTime? ResultsImportedAt, DateTime? DiscardedAt, int LineCount, decimal TotalAmount,
    int Pending, int Successful, int Rejected, int Withdrawn, int Paid, decimal PaidAmount);

public sealed record BatchLineDto(
    Guid BatchLineId, Guid? ClaimLineItemId, Guid? ClaimId, string? ClaimReference, string? ParticipantName, string SupportNumber, DateOnly From, DateOnly To,
    decimal Amount, int Attempt, string RowReference, ClaimBatchLineOutcome Outcome, string? RejectCode, string? RejectMessage, string? Hint, bool? NeedsDecision,
    decimal? ResultAmount, ClaimLineItemStatus? LineStatus, decimal? PaidAmount, DateTime? DismissedAt);

public sealed record BatchDetailDto : BatchDto
{
    public BatchDetailDto(BatchDto batch, List<BatchLineDto> lines) : base(batch) { Lines = lines; }
    public List<BatchLineDto> Lines { get; init; }
}

public sealed record ResultConflictDto(string RowReference, string Current, string Incoming);

public sealed record ResultsImportDto(
    int Successful, int Rejected, int Unchanged, int LeftAlone, List<ResultConflictDto> Conflicts, List<string> UnknownReferences, List<UnreadRow> UnreadRows, BatchDto Batch);

public sealed record PaidLineRequest(Guid BatchLineId, decimal? Amount);

public sealed record HubProblemDto(string Rule, string Severity, string Message);

public record HubLineDto(
    Guid LineId, Guid ClaimId, string ClaimReference, string ClaimKind, Guid ParticipantId, string ParticipantName, string SupportNumber, string? SupportName,
    DateOnly From, DateOnly To, decimal Hours, decimal? Quantity, decimal UnitPrice, decimal TotalAmount, GSTCode GstCode, ClaimType ClaimType, string? CancellationReason,
    string FundingType, int AgeDays, string AgeBand, int NextAttempt, List<HubProblemDto> Problems);

public sealed record RejectedLineDto : HubLineDto
{
    public RejectedLineDto(HubLineDto line, Guid batchLineId, Guid batchId, string fileName, string rejectCode, string? rejectMessage, bool needsDecision, string hint, DateTime? rejectedAt) : base(line)
    { BatchLineId = batchLineId; BatchId = batchId; FileName = fileName; RejectCode = rejectCode; RejectMessage = rejectMessage; NeedsDecision = needsDecision; Hint = hint; RejectedAt = rejectedAt; }
    public Guid BatchLineId { get; init; }
    public Guid BatchId { get; init; }
    public string FileName { get; init; }
    public string RejectCode { get; init; }
    public string? RejectMessage { get; init; }
    public bool NeedsDecision { get; init; }
    public string Hint { get; init; }
    public DateTime? RejectedAt { get; init; }
}

public sealed record ManagedInvoiceDto(Guid InvoiceId, string Number, InvoiceStatus Status, decimal Total, DateOnly IssueDate);

public sealed record ManagedClaimDto(
    Guid ClaimId, string ClaimReference, Guid? ParticipantId, string? ParticipantName, string FundingType, TripClaimStatus ClaimStatus, decimal TotalAmount,
    int AgeDays, string AgeBand, List<ManagedInvoiceDto> Invoices);

public sealed record HubLinesDto(List<HubLineDto> Ready, List<RejectedLineDto> Rejected, List<ManagedClaimDto> Managed, string? RegistrationProblem);
