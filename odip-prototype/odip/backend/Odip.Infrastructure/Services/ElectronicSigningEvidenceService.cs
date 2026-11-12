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

    public const string WordingChangedError = "The agreement wording changed after this document was prepared. Prepare it again.";
    public const string SupersededDraftError = "A newer revision of this agreement draft exists. Create a snapshot from the latest revision instead.";

    public async Task<(ElectronicSigningSnapshot? Snapshot, string? Error)> CreateSnapshotAsync(Guid tenantId, Guid participantId, CreateElectronicSigningSnapshotDto request, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.Include(x => x.Lines).Include(x => x.Blocks).SingleOrDefaultAsync(x => x.Id == request.DraftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft == null || draft.Version != request.DraftVersion) return (null, "The selected document version is unavailable or stale.");
        if (await HasNewerRevisionAsync(tenantId, participantId, draft.Id, draft.Version, ct)) return (null, SupersededDraftError);
        if (!ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence) return (null, "Electronic signing evidence is unavailable because the selected agreement source is not approved.");
        var existing = await _db.ElectronicSigningSnapshots.SingleOrDefaultAsync(x => x.DraftId == draft.Id && x.DraftVersion == draft.Version, ct);
        if (existing != null) return (existing, null);
        var (responsibilities, complaints) = await WordingAsync(tenantId, ct);
        var document = BuildDocument(draft, responsibilities, complaints);
        var snapshot = new ElectronicSigningSnapshot { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DraftId = draft.Id, DraftVersion = draft.Version, DocumentJson = document, DocumentHash = Hash(document) };
        _db.ElectronicSigningSnapshots.Add(snapshot);
        await _db.SaveChangesAsync(ct);
        return (snapshot, null);
    }

    public async Task<(ElectronicSigningEvidence? Evidence, string? Error)> SubmitAsync(Guid tenantId, Guid participantId, Guid snapshotId, SubmitElectronicSigningEvidenceDto request, CancellationToken ct)
    {
        var snapshot = await _db.ElectronicSigningSnapshots.Include(x => x.Evidence).SingleOrDefaultAsync(x => x.Id == snapshotId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (snapshot == null) return (null, "Document snapshot not found.");
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || string.IsNullOrWhiteSpace(request.SignerName) || string.IsNullOrWhiteSpace(request.SignerCapacity))
            return (null, "Signer name, capacity and idempotency key are required.");
        // A retry of a stored submit returns its stored evidence, even after a newer revision exists; the same key with other signer details is not a retry.
        var existing = snapshot.Evidence.SingleOrDefault(x => x.IdempotencyKey == request.IdempotencyKey);
        if (existing != null)
            return existing.SignerName == request.SignerName.Trim() && existing.SignerCapacity == request.SignerCapacity.Trim() && existing.IsAuthorisedRepresentative == request.IsAuthorisedRepresentative
                ? (existing, null)
                : (null, "This signing request was already used with different signer details.");
        if (await HasNewerRevisionAsync(tenantId, participantId, snapshot.DraftId, snapshot.DraftVersion, ct)) return (null, SupersededDraftError);
        if (!ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence) return (null, "Electronic signing evidence is unavailable because the selected agreement source is not approved.");
        if (Hash(snapshot.DocumentJson) != snapshot.DocumentHash) return (null, "Document integrity check failed.");
        var (responsibilitiesNow, complaintsNow) = await WordingAsync(tenantId, ct);
        if (!WordingMatches(snapshot.DocumentJson, responsibilitiesNow, complaintsNow)) return (null, WordingChangedError);
        if (!request.DocumentWasDisplayed || !request.ConsentToElectronicMethod || !request.IntendsToSign) return (null, "The displayed document, electronic-method consent and intention are all required.");
        var previous = snapshot.Evidence.OrderByDescending(x => x.CreatedAt).FirstOrDefault()?.EvidenceHash ?? "GENESIS";
        var canonical = $"{snapshot.DocumentHash}|{previous}|{request.IdempotencyKey}|{request.SignerName.Trim()}|{request.SignerCapacity.Trim()}|{request.IsAuthorisedRepresentative}|{request.ConsentToElectronicMethod}|{request.IntendsToSign}|{request.DocumentWasDisplayed}";
        var evidence = new ElectronicSigningEvidence { Id = Guid.NewGuid(), TenantId = tenantId, SnapshotId = snapshot.Id, IdempotencyKey = request.IdempotencyKey, SignerName = request.SignerName.Trim(), SignerCapacity = request.SignerCapacity.Trim(), IsAuthorisedRepresentative = request.IsAuthorisedRepresentative, ConsentToElectronicMethod = request.ConsentToElectronicMethod, IntendsToSign = request.IntendsToSign, DocumentWasDisplayed = request.DocumentWasDisplayed, PreviousEvidenceHash = previous, EvidenceHash = Hash(canonical) };
        _db.ElectronicSigningEvidence.Add(evidence);
        await _db.SaveChangesAsync(ct);
        return (evidence, null);
    }
    /// <summary>
    /// The document a signature attests to: the revision's details and every line with what makes it readable (its unit, band, total over the agreement, shifts, flags and block: a sleepover is
    /// not "52 hours at 281.97", a dollar line is not "45.5 hours at 1.00", and a 40 minute shift cannot be totalled from hours times price), and a hash of the blocks and of the pricing answer
    /// the lines came from. The hashes are of a canonical serialisation (read, then written the way the engine writes it), never of the stored text: PostgreSQL's jsonb rewrites its text, so the
    /// same revision would hash differently after a restore. A revision typed by hand has neither.
    /// </summary>
    public static string BuildDocument(ServiceAgreementDraft draft, string? responsibilitiesTerms = null, string? complaintsTerms = null) => JsonSerializer.Serialize(new
    {
        draft.Id, draft.Version, draft.ParticipantId, draft.ParticipantNameSnapshot, draft.PlanStartDate, draft.PlanEndDate, draft.AgreementStartDate, AgreementEndDate = draft.OriginalAgreementEndDate ?? draft.AgreementEndDate, EndedEarlyLastDay = draft.OriginalAgreementEndDate is null ? (DateOnly?)null : draft.AgreementEndDate, draft.State, draft.ServiceTypesJson,
        Lines = draft.Lines.OrderBy(x => x.Id).Select(x => new { x.ServiceType, x.ItemCode, x.Hours, x.UnitPrice, x.CatalogueVersion, x.CatalogueEffectiveFrom, x.CatalogueEffectiveTo, x.Unit, x.Band, x.Total, x.Occurrences, x.Flags, x.BlockKey }),
        BlocksHash = BlocksHash(draft),
        PricingHash = PricingHash(draft),
        ResponsibilitiesTerms = responsibilitiesTerms,
        ComplaintsTerms = complaintsTerms,
    });

    /// <summary>The organisation's wording for sections 6 and 7 as the PDF prints it, read by explicit tenant (the filter is off: the signing page may have no signed-in tenant). Null = the standard text.</summary>
    private async Task<(string? Responsibilities, string? Complaints)> WordingAsync(Guid tenantId, CancellationToken ct)
    {
        var provider = AgreementProvider.From(await _db.ProviderSettings.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct));
        return (provider.ResponsibilitiesTerms, provider.ComplaintsTerms);
    }

    /// <summary>True when the document holds exactly this wording. A document made before the wording existed holds none, so it matches only the standard text.</summary>
    public static bool WordingMatches(string documentJson, string? responsibilities, string? complaints)
    {
        using var document = JsonDocument.Parse(documentJson);
        string? Held(string name) => document.RootElement.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        return Held("ResponsibilitiesTerms") == responsibilities && Held("ComplaintsTerms") == complaints;
    }

    private static string? BlocksHash(ServiceAgreementDraft draft) => draft.Blocks.Count == 0 ? null : Hash(string.Join('\n', draft.Blocks.OrderBy(b => b.Position).Select(b =>
        string.Join('|', b.Position, b.BlockKey, DraftJson.Write(DraftJson.ReadBlock(b.BlockJson)), DraftJson.Write(DraftJson.ReadRequirements(b.RequirementsJson))))));

    private static string? PricingHash(ServiceAgreementDraft draft) => string.IsNullOrWhiteSpace(draft.PricingJson) ? null
        : Hash(DraftJson.ReadQuote(draft.PricingJson) is { } quote ? DraftJson.Write(quote) : draft.PricingJson);   // an answer that cannot be read is hashed as it was written

    // Only a newer revision of the same agreement supersedes it: another agreement's version numbers are its own.
    private Task<bool> HasNewerRevisionAsync(Guid tenantId, Guid participantId, Guid draftId, int version, CancellationToken ct) =>
        _db.ServiceAgreementDrafts.AnyAsync(x => x.TenantId == tenantId && x.ParticipantId == participantId && x.Version > version
            && x.AgreementId == _db.ServiceAgreementDrafts.Where(d => d.Id == draftId).Select(d => d.AgreementId).First(), ct);

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
