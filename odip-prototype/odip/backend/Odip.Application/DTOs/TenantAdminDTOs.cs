using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ── Tenant DTOs ─────────────────────────────────────────────────────────────

public record TenantDto(
    Guid Id,
    string Name,
    string? EmailDomain,
    bool IsActive,
    DateTime CreatedAt);

public record CreateTenantDto(
    [Required(ErrorMessage = "Enter the organisation name."), StringLength(200)] string Name,
    string? EmailDomain);

public record UpdateTenantDto(
    [Required(ErrorMessage = "Enter the organisation name."), StringLength(200)] string Name,
    string? EmailDomain,
    bool IsActive);

public record TenantUserDto(
    Guid Id,
    string FullName,
    string Role,
    bool IsActive);

// ── Admin User DTOs ────────────────────────────────────────────────────────
// Per staff/user unification design spec §4.5: the "linked Staff record" concept (StaffId) no
// longer exists and is dropped entirely (not just always-null as it was mid-Task-1). These DTOs
// gain the §3.1 profile/qualification fields as OPTIONAL fields instead — Settings → Users
// remains SuperAdmin-only and unchanged in access scope; profile editing still primarily lives on
// the /staff page (design spec §2 Decisions), these are here so a SuperAdmin can set them too.

public record AdminUserDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public Guid TenantId { get; init; }
    public string TenantName { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? LastLoginAt { get; init; }
    public Position? Position { get; init; }
    public string? Mobile { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsCprQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? CprExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    public string? Notes { get; init; }

    /// <summary>
    /// Set by the CREATE response only (null everywhere else): whether the user's Firebase sign-in account was just created or already
    /// existed (<see cref="FirebaseAccountStatus"/>). An account that already existed was left as it was, so a password the admin typed was
    /// not applied to it, and the screen has to say so.
    /// </summary>
    public string? FirebaseAccount { get; init; }
}

public record CreateAdminUserDto
{
    [StringLength(100)]
    public string FirstName { get; init; } = string.Empty;
    [StringLength(100)]
    public string LastName { get; init; } = string.Empty;
    [StringLength(200)]
    public string Email { get; init; } = string.Empty;
    [StringLength(100)]
    public string Username { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public Guid TenantId { get; init; }
    public string? Password { get; init; }
    /// <summary>
    /// The admin has checked the address after being told it is at neither the tenant's own domain nor a common email provider
    /// (<see cref="Odip.Application.Common.AddressConfirmation"/>). Without it such an address is refused with a 400.
    /// </summary>
    public bool AddressConfirmed { get; init; }
    public Position? Position { get; init; }
    [StringLength(20, ErrorMessage = "Mobile can be up to 20 characters.")]
    public string? Mobile { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsCprQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? CprExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    [StringLength(50)]
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}

public record UpdateAdminUserDto
{
    [StringLength(100)]
    public string FirstName { get; init; } = string.Empty;
    [StringLength(100)]
    public string LastName { get; init; } = string.Empty;
    [StringLength(200)]
    public string Email { get; init; } = string.Empty;
    [StringLength(100)]
    public string Username { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    /// <summary>
    /// The admin has checked a NEW address after being told it is at neither the user's tenant's own domain nor a common email provider
    /// (<see cref="Odip.Application.Common.AddressConfirmation"/>). Without it such a change is refused with a 400; an address the row already holds never asks.
    /// </summary>
    public bool AddressConfirmed { get; init; }
}

// ── Tenant Summary DTO (includes user count) ──────────────────────────────

public record TenantSummaryDto(
    Guid Id,
    string Name,
    string? EmailDomain,
    bool IsActive,
    DateTime CreatedAt,
    int UserCount);

/// <summary>
/// What a tenant create with a first user answers: the summary, plus that user's id and what became of their Firebase sign-in account
/// (<see cref="FirebaseAccountStatus"/>: created, existing, or failed when it could not be set up). Both are null when no first user was given.
/// </summary>
public record TenantCreatedDto(
    Guid Id,
    string Name,
    string? EmailDomain,
    bool IsActive,
    DateTime CreatedAt,
    int UserCount,
    Guid? InitialUserId,
    string? FirebaseAccount) : TenantSummaryDto(Id, Name, EmailDomain, IsActive, CreatedAt, UserCount);

// ── Bundled Tenant Creation ───────────────────────────────────────────────

public record CreateTenantWithSetupDto(
    string Name,
    string? EmailDomain,
    TenantSetupProviderDto? ProviderSettings,
    CreateInitialUserDto? InitialUser);

/// <summary>
/// The organisation's provider row as typed at setup. Unlike <see cref="UpsertProviderSettingsDto"/> nothing here is required: the row is always made, and the
/// registration number, ABN and address are filled in later under Organisation profile (whose own save still requires them). The State is the exception: setup refuses a blank or unknown one.
/// </summary>
public record TenantSetupProviderDto
{
    // The same limits as UpsertProviderSettingsDto, so setup cannot store what the Organisation profile save would then refuse.
    [StringLength(20)]
    public string RegistrationNumber { get; init; } = string.Empty;
    [StringLength(20)]
    public string ABN { get; init; } = string.Empty;
    [StringLength(200)]
    public string OrganisationName { get; init; } = string.Empty;
    [StringLength(500)]
    public string Address { get; init; } = string.Empty;
    [StringLength(10)]
    public string? State { get; init; }
    public bool GSTRegistered { get; init; }
    public bool IsPaceProvider { get; init; }
    [StringLength(200)]
    public string? BankAccountName { get; init; }
    [StringLength(10)]
    public string? BSB { get; init; }
    [StringLength(20)]
    public string? AccountNumber { get; init; }
    [StringLength(2000)]
    public string? InvoiceFooterNotes { get; init; }
    public MedicationCompetencyMode? MedicationCompetencyMode { get; init; }
}

public record CreateInitialUserDto(
    string FirstName,
    string LastName,
    string Email,
    string Username,
    string Role,
    string? Password,
    // The admin has checked the address after being told it is at neither the new tenant's domain nor a common email provider.
    bool AddressConfirmed = false);

// ── Public Holidays Sync DTOs ──────────────────────────────────────────────

public record SyncHolidaysDto
{
    public int? FromYear { get; init; }
    public int? ToYear { get; init; }
}

public record SyncResultDto
{
    public int YearsProcessed { get; init; }
    public int HolidaysAdded { get; init; }
    public int HolidaysUpdated { get; init; }
    public string[] Errors { get; init; } = [];
}

public record ModuleVisibilityDto
{
    public bool HiddenAccommodation { get; init; }
    public bool HiddenVehicles { get; init; }
    public bool HiddenTrips { get; init; }
    /// <summary>Whether payslips (and, later, payroll pages) apply: presentation only, the server refuses on its own.</summary>
    public bool EmploymentHeroConnected { get; init; }
    /// <summary>Group activities switch (PR1): off until the screens ship; the server refuses every group-activity write while it is off.</summary>
    public bool GroupActivitiesEnabled { get; init; }
}

public record UpdateModuleVisibilityDto
{
    [System.ComponentModel.DataAnnotations.Required]
    public bool? HiddenAccommodation { get; init; }
    [System.ComponentModel.DataAnnotations.Required]
    public bool? HiddenVehicles { get; init; }
    [System.ComponentModel.DataAnnotations.Required]
    public bool? HiddenTrips { get; init; }
    /// <summary>Optional: left out, the switch is unchanged (the Settings screen does not send it yet).</summary>
    public bool? GroupActivitiesEnabled { get; init; }
}
