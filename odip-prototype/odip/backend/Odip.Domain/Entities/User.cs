using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// System user for authentication and authorisation. Absorbs the former <c>Staff</c> entity's
/// profile/qualification fields (see the staff/user-unification design spec) — every staff
/// member IS a user account. The profile fields below are nullable/defaulted so non-staff users
/// (e.g. SuperAdmin accounts) are unaffected.
/// </summary>
public class User : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName => $"{FirstName} {LastName}";
    public UserRole Role { get; set; }

    /// <summary>Display-only staff position/title — separate from and unrelated to <see cref="Role"/>.</summary>
    public Position? Position { get; set; }
    public string? Mobile { get; set; }
    public string? Region { get; set; }
    public bool IsDriverEligible { get; set; }
    public bool IsFirstAidQualified { get; set; }
    public bool IsMedicationCompetent { get; set; }
    public bool IsManualHandlingCompetent { get; set; }
    public bool IsOvernightEligible { get; set; }
    public DateOnly? FirstAidExpiryDate { get; set; }
    public DateOnly? DriverLicenceExpiryDate { get; set; }
    public DateOnly? ManualHandlingExpiryDate { get; set; }
    public DateOnly? MedicationCompetencyExpiryDate { get; set; }
    public string? WorkerScreeningNumber { get; set; }
    public DateOnly? WorkerScreeningExpiryDate { get; set; }
    public string? Notes { get; set; }

    /// <summary>
    /// Whether any ticked credential expired before <paramref name="today"/>. A request handler passes the PROVIDER's calendar date
    /// (<c>ProviderTimeZoneResolver.TodayAsync</c>): the UTC date is yesterday for the first 10-11 hours of a Sydney day, so a credential
    /// that expired yesterday was not flagged until mid-morning.
    /// </summary>
    public bool HasExpiredQualificationsOn(DateOnly today) =>
        (IsFirstAidQualified && FirstAidExpiryDate.HasValue && FirstAidExpiryDate.Value < today)
        || (IsDriverEligible && DriverLicenceExpiryDate.HasValue && DriverLicenceExpiryDate.Value < today)
        || (IsManualHandlingCompetent && ManualHandlingExpiryDate.HasValue && ManualHandlingExpiryDate.Value < today)
        || (IsMedicationCompetent && MedicationCompetencyExpiryDate.HasValue && MedicationCompetencyExpiryDate.Value < today)
        || (WorkerScreeningExpiryDate.HasValue && WorkerScreeningExpiryDate.Value < today);

    /// <summary><see cref="HasExpiredQualificationsOn"/> at the UTC date: only for a caller with no provider zone to hand. A request handler passes the provider's date instead.</summary>
    public bool HasExpiredQualifications => HasExpiredQualificationsOn(DateOnly.FromDateTime(DateTime.UtcNow));

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}
