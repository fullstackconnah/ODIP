using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>Creates append-only, tenant-scoped intake completion evidence.</summary>
public sealed class ParticipantIntakeSnapshotService
{
    private readonly OdipDbContext _db;
    public ParticipantIntakeSnapshotService(OdipDbContext db) { _db = db; QuestPDF.Settings.License = LicenseType.Community; }

    /// <summary>
    /// Builds and tracks a completion snapshot without saving it.  Callers completing intake use
    /// this before their one SaveChangesAsync call so a PDF-render failure cannot persist the
    /// participant's completion timestamp without its corresponding audit record.
    /// </summary>
    public async Task<ParticipantIntakeSnapshot> PrepareCaptureAsync(Participant participant, string actor, string? requestId, CancellationToken ct)
    {
        requestId = string.IsNullOrWhiteSpace(requestId) ? Guid.NewGuid().ToString("N") : requestId;
        var existing = await _db.ParticipantIntakeSnapshots.FirstOrDefaultAsync(x => x.ParticipantId == participant.Id && x.RequestId == requestId, ct);
        if (existing != null) return existing;

        var completedAt = DateTime.UtcNow;
        var revision = (await _db.ParticipantIntakeSnapshots.Where(x => x.ParticipantId == participant.Id).MaxAsync(x => (int?)x.Revision, ct) ?? 0) + 1;
        var fields = new { participant.Id, participant.TenantId, participant.FirstName, participant.LastName, participant.PreferredName, participant.DateOfBirth, participant.Phone, participant.Email, participant.AddressStreet, participant.AddressSuburb, participant.AddressState, participant.AddressPostcode, participant.NdisNumber, participant.PlanType, participant.FundingSource, participant.Region, participant.IsHighSupport, participant.MedicalSummary, participant.BehaviourRiskSummary, participant.Notes, participant.IntakeCompletedAt };
        var snapshotJson = JsonSerializer.Serialize(new { completedAtUtc = completedAt, actor, revision, fields });
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(snapshotJson))).ToLowerInvariant();
        var pdf = Document.Create(container => container.Page(page =>
        {
            page.Margin(36); page.Size(PageSizes.A4); page.DefaultTextStyle(x => x.FontSize(10));
            page.Header().Text("ODIP Intake Completion Evidence").Bold().FontSize(18);
            page.Content().Column(c =>
            {
                c.Spacing(8);
                c.Item().Text($"Completed (UTC): {completedAt:O}");
                c.Item().Text($"Revision: {revision}   Actor: {actor}");
                c.Item().Text($"Participant: {participant.FullName} ({participant.Id})");
                c.Item().Text($"SHA-256: {hash}").FontSize(8);
                c.Item().LineHorizontal(1);
                c.Item().Text(snapshotJson).FontSize(7);
            });
        })).GeneratePdf();
        var snapshot = new ParticipantIntakeSnapshot { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, Revision = revision, CompletedAtUtc = completedAt, CompletedBy = actor, RequestId = requestId, SnapshotJson = snapshotJson, ContentHash = hash, PdfContent = pdf };
        _db.ParticipantIntakeSnapshots.Add(snapshot);
        return snapshot;
    }

    /// <summary>Creates and persists a completion snapshot for standalone callers.</summary>
    public async Task<ParticipantIntakeSnapshot> CaptureAsync(Participant participant, string actor, string? requestId, CancellationToken ct)
    {
        var snapshot = await PrepareCaptureAsync(participant, actor, requestId, ct);
        await _db.SaveChangesAsync(ct);
        return snapshot;
    }

    public Task<ParticipantIntakeSnapshot?> FindAsync(Guid participantId, int revision, CancellationToken ct) =>
        _db.ParticipantIntakeSnapshots.FirstOrDefaultAsync(x => x.ParticipantId == participantId && x.Revision == revision, ct);
}
