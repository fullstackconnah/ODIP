using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>
/// The single fail-closed eligibility rule for placing a participant into operational work.
/// Readiness is derived from the tenant-owned onboarding record; it is never accepted from a
/// booking or roster request. In particular, an absent onboarding record is not treated as ready.
/// </summary>
public static class ParticipantReadinessGate
{
    public const string NotReadyMessage = "Participant is not ready for booking or rostering.";

    public static IQueryable<Participant> ActiveReadyParticipants(OdipDbContext db) =>
        db.Participants.Where(p =>
            p.IsActive
            && !p.IsDraft
            && p.IntakeCompletedAt != null
            && db.ParticipantOnboardings.Any(o =>
                o.ParticipantId == p.Id
                && o.TenantId == p.TenantId
                && o.ProfileComplete
                && o.ServiceTypeConfirmed
                && o.ServiceAgreementSigned));

    public static Task<bool> IsActiveReadyAsync(OdipDbContext db, Guid participantId, CancellationToken ct) =>
        ActiveReadyParticipants(db).AnyAsync(p => p.Id == participantId, ct);
}
