using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// May shifts be placed on this participant's roster now? The answer is the readiness check every roster write already uses (<c>ParticipantReadiness.CheckAsync</c>: a participant who does not
/// exist, is a draft or is not active is refused in either mode, and Enforce mode also wants the strict gate). It lives in the API project, which this one cannot reference, so the
/// approval of an agreement revision and the daily top-up ask it through this seam, and the API registers the real one.
/// </summary>
public interface IRosterPlacementGate
{
    /// <summary>True when the participant may be rostered. Asked with the context whose tenant scope the caller works in, so a participant of another organisation is never allowed.</summary>
    Task<bool> MayPlaceAsync(OdipDbContext db, Guid participantId, CancellationToken ct);
}
