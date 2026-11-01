using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Per-tenant application settings. One row per tenant.
/// </summary>
public class AppSettings : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public bool HiddenAccommodation { get; set; }
    public bool HiddenVehicles { get; set; }
    public int QualificationWarningDays { get; set; } = 30;
    /// <summary>Weekly rostered hours above which a worker gets the OVER_HOURS warning. One number for the organisation; 38 is the old fixed value.</summary>
    public int WeeklyHoursWarning { get; set; } = 38;
    /// <summary>Minutes a finished shift's start or finish may drift from the roster before it goes to review. 15 is the old fixed value.</summary>
    public int VarianceReviewMinutes { get; set; } = 15;
    /// <summary>Days before a participant's plan ends that the alert starts. 30 is the old fixed value.</summary>
    public int PlanExpiryWarningDays { get; set; } = 30;
    /// <summary>Minutes a sign-in lasts, counted from when the person signed in. Null = no limit (today's behaviour); never backfilled.</summary>
    public int? SessionLengthMinutes { get; set; }
}
