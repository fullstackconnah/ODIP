namespace Odip.Domain.Enums;

/// <summary>
/// Lifecycle of a caregiver profile submission. Stored as int; the partial unique index on
/// CaregiverProfileSubmissions filters on the Draft (0) and Submitted (1) values, so these
/// numeric assignments are load-bearing — do not reorder.
/// </summary>
public enum CaregiverSubmissionStatus
{
    Draft = 0,
    Submitted = 1,
    Accepted = 2,
    Rejected = 3,
    Revoked = 4,
}
