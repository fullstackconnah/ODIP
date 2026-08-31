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
        var model = await ComposeIntakeFormAsync(participantId, ct);
        if (model == null) return null;

        var bytes = ParticipantDocumentRenderer.Render(model);
        return (bytes, BuildFileName(model.ParticipantFullName, "Intake-Form"));
    }

    /// <summary>Returns null when no participant with <paramref name="participantId"/> exists (or isn't visible to the current tenant).</summary>
    public async Task<(byte[] Content, string FileName)?> GenerateParticipantProfileAsync(Guid participantId, CancellationToken ct = default)
    {
        var model = await ComposeParticipantProfileAsync(participantId, ct);
        if (model == null) return null;

        var bytes = ParticipantDocumentRenderer.Render(model);
        return (bytes, BuildFileName(model.ParticipantFullName, "Participant-Profile"));
    }

    /// <summary>
    /// DOC-01 review polish — the load+compose step extracted out of <see cref="GenerateIntakeFormAsync"/>
    /// so a test can call it directly and assert on the returned <see cref="ParticipantDocumentModel"/>
    /// (proving every child collection the composer needs was actually hydrated by
    /// <see cref="LoadParticipantAsync"/>'s .Include(...) chain) without going through QuestPDF
    /// rendering — QuestPDF's compressed PDF stream bytes can't reliably be grepped for text — and
    /// without re-implementing the EF load in the test. Public rather than internal: no
    /// InternalsVisibleTo exists anywhere in this backend tree, and the existing cross-project
    /// test-access convention in Odip.Infrastructure/Services is already "public" — see
    /// <see cref="ParticipantDocumentComposer"/>'s public static Compose* methods, which
    /// <c>ParticipantDocumentComposerTests</c> already calls directly the same way.
    /// Returns null under the same conditions as <see cref="GenerateIntakeFormAsync"/>.
    /// </summary>
    public async Task<ParticipantDocumentModel?> ComposeIntakeFormAsync(Guid participantId, CancellationToken ct = default)
    {
        var participant = await LoadParticipantAsync(participantId, ct);
        if (participant == null) return null;

        var riskEntries = await LoadRiskEntriesAsync(participantId, ct);
        return ParticipantDocumentComposer.ComposeIntakeForm(participant, riskEntries);
    }

    /// <summary>See <see cref="ComposeIntakeFormAsync"/>'s doc comment — same reasoning, Participant Profile variant.</summary>
    public async Task<ParticipantDocumentModel?> ComposeParticipantProfileAsync(Guid participantId, CancellationToken ct = default)
    {
        var participant = await LoadParticipantAsync(participantId, ct);
        if (participant == null) return null;

        var riskEntries = await LoadRiskEntriesAsync(participantId, ct);
        return ParticipantDocumentComposer.ComposeParticipantProfile(participant, riskEntries);
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

    /// <summary>
    /// Mirrors BprCsvService's simple filename convention (a sanitized identifier, a doc-type
    /// suffix, a yyyyMMdd stamp). Public (same reasoning as <see cref="ComposeIntakeFormAsync"/>'s
    /// doc comment) so a test can exercise the sanitization directly against a crafted
    /// header-unsafe participant name without needing a full <see cref="Participant"/> graph — the
    /// sanitized allowlist is letters/digits/space/hyphen only, so quotes, commas, CR/LF (a
    /// Content-Disposition header-injection vector if left in) and non-ASCII/unicode are all
    /// stripped. Falls back to "Participant" when sanitizing strips the name to nothing (e.g. an
    /// entirely non-ASCII name) — guards against emitting a malformed filename with an
    /// empty/leading-hyphen name segment.
    /// </summary>
    public static string BuildFileName(string participantFullName, string docType)
    {
        var sanitized = Regex.Replace(participantFullName, "[^A-Za-z0-9 -]", "").Trim();
        if (sanitized.Length == 0) sanitized = "Participant";
        return $"{sanitized}-{docType}-{DateTime.UtcNow:yyyyMMdd}.pdf";
    }
}
