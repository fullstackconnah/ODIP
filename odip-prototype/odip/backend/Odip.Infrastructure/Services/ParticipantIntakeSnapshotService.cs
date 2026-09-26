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
    // Kept in lockstep with documentMapping.ts's entryPhase: 'intake' contract. Do not replace
    // this with all Participant properties: that would leak profile-only data into evidence.
    private static readonly string[] IntakeFieldNames =
    [
        nameof(Participant.FirstName), nameof(Participant.LastName), nameof(Participant.PreferredName), nameof(Participant.DateOfBirth), nameof(Participant.Phone), nameof(Participant.Email),
        nameof(Participant.AddressStreet), nameof(Participant.AddressSuburb), nameof(Participant.AddressState), nameof(Participant.AddressPostcode),
        nameof(Participant.LivingArrangement), nameof(Participant.MainSupportPersonName), nameof(Participant.MainSupportPersonRelationship), nameof(Participant.OthersLivingInAccommodation), nameof(Participant.ResidentialInfo), nameof(Participant.LivesWithOthers), nameof(Participant.WhoLivesWith), nameof(Participant.SilProviderName), nameof(Participant.SilProviderContactPhone), nameof(Participant.AccommodationType), nameof(Participant.OnSiteSupportHours), nameof(Participant.LivingArrangementNotes),
        nameof(Participant.NdisNumber), nameof(Participant.PlanStartDate), nameof(Participant.PlanEndDate), nameof(Participant.PlanType), nameof(Participant.FundingSource), nameof(Participant.FundingOrganisation), nameof(Participant.Region), nameof(Participant.IsRepeatClient), nameof(Participant.ServiceStreams),
        nameof(Participant.MobilityAidWheelchair), nameof(Participant.MobilityAidWalker), nameof(Participant.IsHighSupport), nameof(Participant.IsIntensiveSupport), nameof(Participant.OvernightSupport), nameof(Participant.OvernightRatio), nameof(Participant.RequiresHiLoBed), nameof(Participant.RequiresHoist), nameof(Participant.RequiresShowerChair), nameof(Participant.RequiresCommode), nameof(Participant.RequiresStandingMachine), nameof(Participant.SupportRatio),
        nameof(Participant.MedicalSummary), nameof(Participant.IsCald), nameof(Participant.IsLgbtqi), nameof(Participant.IsFamilyCommunity), nameof(Participant.IsAboriginalOrTorresStraitIslander), nameof(Participant.ReceivedRightsAndResponsibilitiesInfo), nameof(Participant.ReceivedPrivacyAndConfidentialityInfo), nameof(Participant.ReceivedFeedbackInfo), nameof(Participant.ReceivedBeingSafeInfo), nameof(Participant.ReceivedAdvocacyInfo), nameof(Participant.BehavioursOfConcernCurrent), nameof(Participant.BehavioursOfConcernFiveYearHistory), nameof(Participant.ExpressiveSkills), nameof(Participant.HidpaNotes), nameof(Participant.BehaviourRiskSummary), nameof(Participant.Notes)
    ];
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
        var fields = IntakeFieldNames.ToDictionary(name => char.ToLowerInvariant(name[0]) + name[1..], name => participant.GetType().GetProperty(name)!.GetValue(participant));
        // Start with the tenant-filtered persisted projection, then overlay tracked final state.
        // Completion is deliberately prepared before the caller's only SaveChangesAsync call, so
        // a just-submitted contact/risk (and a just-added Person) must not be lost merely because
        // it is not queryable from the database yet. Conversely, tracked deletes must not survive
        // in the evidence. Do not flush early: snapshot and completion remain atomic.
        var persistedContactRoles = await _db.ParticipantContactRoles
            .Where(x => x.ParticipantId == participant.Id)
            .Include(x => x.Person)
            .ToListAsync(ct);
        var contactRoleRows = MergeFinalState(
            persistedContactRoles,
            _db.ChangeTracker.Entries<ParticipantContactRole>()
                .Where(entry => entry.Entity.ParticipantId == participant.Id && entry.Entity.TenantId == participant.TenantId),
            row => row.Id);
        var contactRoles = contactRoleRows.Select(x => new
        {
            label = "Contact role", roleType = x.RoleType.ToString(), personName = ResolvePersonName(x),
            x.RelationshipToParticipant, x.IsPrimary, x.PriorityOrder, x.AuthorisedForMedicalInfo, x.OrganisationName, x.RegistrationNumber, x.Status, x.Notes
        }).ToList();
        var persistedRiskEntries = await _db.ParticipantRiskEntries.Where(x => x.ParticipantId == participant.Id).ToListAsync(ct);
        var riskEntryRows = MergeFinalState(
            persistedRiskEntries,
            _db.ChangeTracker.Entries<ParticipantRiskEntry>()
                .Where(entry => entry.Entity.ParticipantId == participant.Id && entry.Entity.TenantId == participant.TenantId),
            row => row.Id);
        var riskEntries = riskEntryRows.Select(x => new
        {
            label = "Risk entry", atRiskParty = x.AtRiskParty.ToString(), x.Description, x.MitigationNotes, x.IsActive
        }).ToList();
        var snapshotJson = JsonSerializer.Serialize(new { completedAtUtc = completedAt, actor, revision, participantId = participant.Id, tenantId = participant.TenantId, fields, contactRoles, riskEntries });
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

    private string ResolvePersonName(ParticipantContactRole role)
    {
        var tracked = _db.ChangeTracker.Entries<Person>()
            .FirstOrDefault(entry => entry.Entity.Id == role.PersonId && entry.Entity.TenantId == role.TenantId && entry.State != EntityState.Deleted)
            ?.Entity;
        var person = tracked ?? role.Person;
        return person == null ? "Unknown contact" : person.FullName;
    }

    private static List<T> MergeFinalState<T>(IEnumerable<T> persisted, IEnumerable<Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<T>> tracked, Func<T, Guid> id)
        where T : class
    {
        var final = persisted.ToDictionary(id);
        foreach (var entry in tracked)
        {
            if (entry.State == EntityState.Detached || entry.State == EntityState.Unchanged) continue;
            if (entry.State == EntityState.Deleted) final.Remove(id(entry.Entity));
            else final[id(entry.Entity)] = entry.Entity;
        }
        return final.Values.OrderBy(id).ToList();
    }
}
