using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Infrastructure;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// DOC-01 — loads a fully-hydrated <see cref="Participant"/> (every nav collection the field map's
/// tables need — see <see cref="ParticipantDocumentFieldMap"/>) plus its
/// <see cref="ParticipantRiskEntry"/> rows, then hands them to the pure
/// <see cref="ParticipantDocumentComposer"/>/<see cref="ParticipantDocumentRenderer"/> pair to
/// produce the Intake Form / Participant Profile PDFs. Mirrors <c>InvoiceService</c>'s constructor
/// shape exactly, including the idempotent <c>QuestPDF.Settings.License</c> assignment.
/// </summary>
public class ParticipantDocumentService
{
    private readonly OdipDbContext _db;

    public ParticipantDocumentService(OdipDbContext db)
    {
        _db = db;
        QuestPDF.Settings.License = LicenseType.Community;
    }

    /// <summary>Returns null when no participant with <paramref name="participantId"/> exists (or isn't visible to the current tenant — the ambient OdipDbContext query filter handles that automatically, no manual tenant check here).</summary>
    public async Task<(byte[] Content, string FileName)?> GenerateIntakeFormAsync(Guid participantId, CancellationToken ct = default)
    {
        var participant = await LoadParticipantAsync(participantId, ct);
        if (participant == null) return null;

        var riskEntries = await LoadRiskEntriesAsync(participantId, ct);
        var model = ParticipantDocumentComposer.ComposeIntakeForm(participant, riskEntries);
        var bytes = ParticipantDocumentRenderer.Render(model);
        return (bytes, BuildFileName(participant, "Intake-Form"));
    }

    /// <summary>Returns null when no participant with <paramref name="participantId"/> exists (or isn't visible to the current tenant).</summary>
    public async Task<(byte[] Content, string FileName)?> GenerateParticipantProfileAsync(Guid participantId, CancellationToken ct = default)
    {
        var participant = await LoadParticipantAsync(participantId, ct);
        if (participant == null) return null;

        var riskEntries = await LoadRiskEntriesAsync(participantId, ct);
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, riskEntries);
        var bytes = ParticipantDocumentRenderer.Render(model);
        return (bytes, BuildFileName(participant, "Participant-Profile"));
    }

    private async Task<Participant?> LoadParticipantAsync(Guid participantId, CancellationToken ct) =>
        await _db.Participants
            .Include(x => x.ContactRoles).ThenInclude(cr => cr.Person)
            .Include(x => x.Consents)
            .Include(x => x.HealthConditions)
            .Include(x => x.AdlAssessments)
            .Include(x => x.ChecklistItems)
            .FirstOrDefaultAsync(x => x.Id == participantId, ct);

    /// <summary>ParticipantRiskEntry is NOT a Participant nav collection — queried separately, filtered by ParticipantId, same as the composer's method signatures expect.</summary>
    private Task<List<ParticipantRiskEntry>> LoadRiskEntriesAsync(Guid participantId, CancellationToken ct) =>
        _db.ParticipantRiskEntries.Where(r => r.ParticipantId == participantId).ToListAsync(ct);

    /// <summary>Mirrors BprCsvService's simple filename convention (a sanitized identifier, a doc-type suffix, a yyyyMMdd stamp).</summary>
    private static string BuildFileName(Participant participant, string docType)
    {
        var sanitized = Regex.Replace(participant.FullName, "[^A-Za-z0-9 -]", "").Trim();
        if (sanitized.Length == 0) sanitized = "Participant";
        return $"{sanitized}-{docType}-{DateTime.UtcNow:yyyyMMdd}.pdf";
    }
}
