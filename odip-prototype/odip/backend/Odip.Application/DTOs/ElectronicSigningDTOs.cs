using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

public record CreateElectronicSigningSnapshotDto
{
    [Required] public Guid DraftId { get; init; }
    [Range(1, int.MaxValue)] public int DraftVersion { get; init; }
}

public record SubmitElectronicSigningEvidenceDto
{
    [Required, StringLength(200)] public string IdempotencyKey { get; init; } = string.Empty;
    [Required, StringLength(300)] public string SignerName { get; init; } = string.Empty;
    [Required, StringLength(200)] public string SignerCapacity { get; init; } = string.Empty;
    public bool IsAuthorisedRepresentative { get; init; }
    public bool ConsentToElectronicMethod { get; init; }
    public bool IntendsToSign { get; init; }
    public bool DocumentWasDisplayed { get; init; }
}

public record ElectronicSigningSnapshotDto(Guid Id, Guid DraftId, int DraftVersion, string DocumentJson, string DocumentHash, string Status);
public record ElectronicSigningEvidenceDto(Guid Id, string Status, string EvidenceHash, DateTime CreatedAt);
