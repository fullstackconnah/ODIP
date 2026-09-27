using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Produces a non-persistent manual-test walkthrough only. The narrow identity/tenant checks
/// intentionally make it impossible to use this path for an ordinary participant.
/// </summary>
public sealed class DemoJourneySimulationService
{
    public const string Banner = "SIMULATED — NOT A LEGAL AGREEMENT / NO CLAIM";
    private readonly OdipDbContext _db;
    public DemoJourneySimulationService(OdipDbContext db) => _db = db;

    public async Task<(DemoJourneySimulationDto? Result, string? Error)> SimulateAsync(
        Guid tenantId, Guid participantId, Guid draftId, string actorEmail, bool devAuthEnabled, CancellationToken ct)
    {
        // This is intentionally stricter than normal tenant membership: no real tenant, user,
        // draft, or imported UnapprovedDraft can ever use a simulation as an approval surrogate.
        if (!devAuthEnabled) return (null, "Demo simulation is available only to dev-auth identities.");
        var tenant = await _db.Tenants.AsNoTracking().SingleOrDefaultAsync(x => x.Id == tenantId, ct);
        if (tenant == null || !string.Equals(tenant.Name, "Demo", StringComparison.Ordinal) || !string.Equals(tenant.EmailDomain, "demo.local", StringComparison.OrdinalIgnoreCase))
            return (null, "Demo simulation is restricted to the tenant-owned Demo tenant.");
        if (!actorEmail.EndsWith("@demo.local", StringComparison.OrdinalIgnoreCase))
            return (null, "Demo simulation is restricted to a Demo dev-auth identity.");
        var actorExists = await _db.Users.AnyAsync(x => x.TenantId == tenantId && x.IsActive && x.Email == actorEmail, ct);
        if (!actorExists) return (null, "Demo simulation requires an active tenant-owned Demo identity.");
        var participant = await _db.Participants.AsNoTracking().SingleOrDefaultAsync(x => x.Id == participantId && x.TenantId == tenantId, ct);
        if (participant == null || !participant.IsDraft) return (null, "Demo simulation requires a tenant-owned Demo draft participant.");
        var draft = await _db.ServiceAgreementDrafts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft == null) return (null, "Demo simulation requires the current tenant-owned draft.");
        var hasNewerDraft = await _db.ServiceAgreementDrafts.AnyAsync(x => x.ParticipantId == participantId && x.TenantId == tenantId && x.Version > draft.Version, ct);
        if (hasNewerDraft) return (null, "Demo simulation requires the newest tenant-owned draft version.");
        if (ProvisionalAgreementTemplate.State != "UnapprovedDraft") return (null, "Demo simulation is limited to the provisional UnapprovedDraft source.");

        return (new DemoJourneySimulationDto(Banner,
            "SIMULATED signing displayed; no evidence record or legal signature was created.",
            "SIMULATED activation displayed; participant remains inactive and draft.",
            "SIMULATED booking displayed; no booking, billable event, invoice, or claim was created.",
            "Synthetic rate display only — not an official catalogue amount."), null);
    }
}