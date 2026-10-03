using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

namespace Odip.Api.Services;

/// <summary>The readiness check roster writes use (<see cref="ParticipantReadiness.CheckAsync"/>), handed to the infrastructure services that generate shifts without a request of their own.</summary>
public sealed class RosterPlacementGate : IRosterPlacementGate
{
    public async Task<bool> MayPlaceAsync(OdipDbContext db, Guid participantId, CancellationToken ct) =>
        (await ParticipantReadiness.CheckAsync(db, participantId, ct)).Allowed;
}
