namespace Odip.Application.Common;

/// <summary>Machine-readable <c>code</c> values for incident failures, so clients can branch on the failure kind instead of parsing message text.</summary>
public static class IncidentErrorCodes
{
    /// <summary>409: the idempotency key was already used to file an incident for a different reporter. Nothing was written; <c>data</c> is null.</summary>
    public const string IncidentIdempotencyKeyReused = "INCIDENT_IDEMPOTENCY_KEY_REUSED";
}
