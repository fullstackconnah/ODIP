using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>Development-only evidence capture. Evidence remains PendingVerification and cannot approve scheduling.</summary>
public sealed class ElectronicSigningEvidenceService
{
    private readonly OdipDbContext _db;
    public ElectronicSigningEvidenceService(OdipDbContext db) => _db = db;

    public async Task<(ElectronicSigningSnapshot? Snapshot, string? Error)> CreateSnapshotAsync(Guid tenantId, Guid participantId, CreateElectronicSigningSnapshotDto request, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == request.DraftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft == null || draft.Version != request.DraftVersion) return (null, "The selected document version is unavailable or stale.");
        if (!ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence) return (null, "Electronic signing evidence is unavailable because the selected agreement source is not approved.");
        var existing = await _db.ElectronicSigningSnapshots.SingleOrDefaultAsync(x => x.DraftId == draft.Id && x.DraftVersion == draft.Version, ct);
        if (existing != null) return (existing, null);
        var document = JsonSerializer.Serialize(new { draft.Id, draft.Version, draft.ParticipantId, draft.ParticipantNameSnapshot, draft.PlanStartDate, draft.PlanEndDate, draft.AgreementStartDate, draft.AgreementEndDate, draft.State, draft.ServiceTypesJson, Lines = draft.Lines.OrderBy(x => x.Id).Select(x => new { x.ServiceType, x.ItemCode, x.Hours, x.UnitPrice, x.CatalogueVersion, x.CatalogueEffectiveFrom, x.CatalogueEffectiveTo }) });
        var snapshot = new ElectronicSigningSnapshot { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DraftId = draft.Id, DraftVersion = draft.Version, DocumentJson = document, DocumentHash = Hash(document) };
        _db.ElectronicSigningSnapshots.Add(snapshot);
        await _db.SaveChangesAsync(ct);
        return (snapshot, null);
    }

    public async Task<(ElectronicSigningEvidence? Evidence, string? Error)> SubmitAsync(Guid tenantId, Guid participantId, Guid snapshotId, SubmitElectronicSigningEvidenceDto request, CancellationToken ct)
    {
        var snapshot = await _db.ElectronicSigningSnapshots.Include(x => x.Evidence).SingleOrDefaultAsync(x => x.Id == snapshotId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (snapshot == null) return (null, "Document snapshot not found.");
        if (!ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence) return (null, "Electronic signing evidence is unavailable because the selected agreement source is not approved.");
        if (Hash(snapshot.DocumentJson) != snapshot.DocumentHash) return (null, "Document integrity check failed.");
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || string.IsNullOrWhiteSpace(request.SignerName) || string.IsNullOrWhiteSpace(request.SignerCapacity))
            return (null, "Signer name, capacity and idempotency key are required.");
        if (!request.DocumentWasDisplayed || !request.ConsentToElectronicMethod || !request.IntendsToSign) return (null, "The displayed document, electronic-method consent and intention are all required.");
        var existing = snapshot.Evidence.SingleOrDefault(x => x.IdempotencyKey == request.IdempotencyKey);
        if (existing != null) return (existing, null);
        var previous = snapshot.Evidence.OrderByDescending(x => x.CreatedAt).FirstOrDefault()?.EvidenceHash ?? "GENESIS";
        var canonical = $"{snapshot.DocumentHash}|{previous}|{request.IdempotencyKey}|{request.SignerName.Trim()}|{request.SignerCapacity.Trim()}|{request.IsAuthorisedRepresentative}|{request.ConsentToElectronicMethod}|{request.IntendsToSign}|{request.DocumentWasDisplayed}";
        var evidence = new ElectronicSigningEvidence { Id = Guid.NewGuid(), TenantId = tenantId, SnapshotId = snapshot.Id, IdempotencyKey = request.IdempotencyKey, SignerName = request.SignerName.Trim(), SignerCapacity = request.SignerCapacity.Trim(), IsAuthorisedRepresentative = request.IsAuthorisedRepresentative, ConsentToElectronicMethod = request.ConsentToElectronicMethod, IntendsToSign = request.IntendsToSign, DocumentWasDisplayed = request.DocumentWasDisplayed, PreviousEvidenceHash = previous, EvidenceHash = Hash(canonical) };
        _db.ElectronicSigningEvidence.Add(evidence);
        await _db.SaveChangesAsync(ct);
        return (evidence, null);
    }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
