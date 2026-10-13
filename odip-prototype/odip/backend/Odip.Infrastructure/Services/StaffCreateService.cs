using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>What a staff create came to: the tracked user, or the refusal (409 when the address is taken, a code when it needs confirming).</summary>
public sealed record StaffCreateResult(User? User, string? Error, string? ErrorCode = null, bool IsConflict = false);

/// <summary>
/// POST /staff as a service, so the onboarding import creates staff by exactly the manual-entry rules: role guardrails, the reserved SuperAdmin
/// domain, another organisation's own domain, global email uniqueness, the unusual-address confirmation and collision-safe usernames. It TRACKS
/// the user; the caller saves. Moved verbatim from StaffController.
/// </summary>
public sealed class StaffCreateService
{
    public const string OtherOrganisationMessage = "That address belongs to another organisation on ODIP.";
    public const string EmailTakenMessage = "A user with this email already exists.";

    private readonly OdipDbContext _db;
    private readonly IConfiguration? _config;

    public StaffCreateService(OdipDbContext db, IConfiguration? config)
    {
        _db = db;
        _config = config;
    }

    public async Task<StaffCreateResult> StageAsync(CreateStaffDto dto, ClaimsPrincipal? caller, Guid? tenantId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Email)) return new(null, "Email is required.");

        var guardError = RoleGuardrailError(caller, dto.Role);
        if (guardError != null) return new(null, guardError);

        // Username/Email uniqueness is GLOBAL across tenants (design spec §2/§7) — IgnoreQueryFilters
        // so the check sees every tenant's users, not just the caller's own (matches AdminUsersController).
        var emailLower = EmailIdentity.Normalise(dto.Email);
        var reservedError = ReservedDomainError(caller, emailLower);
        if (reservedError != null) return new(null, reservedError);

        var otherOrganisationError = await OtherOrganisationAddressErrorAsync(caller, emailLower, tenantId, ct);
        if (otherOrganisationError != null) return new(null, otherOrganisationError);

        var emailTaken = await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email.ToLower() == emailLower, ct);
        if (emailTaken) return new(null, EmailTakenMessage, IsConflict: true);

        // Any address can sign in, so one at neither the tenant's own domain nor a common provider (a typo, another organisation's) is a live
        // login for whoever owns it: ask for a confirmation first (see AddressConfirmation).
        var tenantDomain = await TenantEmailDomainAsync(tenantId, ct);
        if (tenantDomain is not null && !dto.AddressConfirmed && AddressConfirmation.Needed(emailLower, tenantDomain))
            return new(null, AddressConfirmation.Message(emailLower, tenantDomain), AddressConfirmation.Code);

        // Collision-safe username handling: reuses the migration's own algorithm (StaffUserUnificationMapping.ResolveUsername).
        var existingUsernamesList = await _db.Users.IgnoreQueryFilters().Select(u => u.Username.ToLower()).ToListAsync(ct);
        var username = StaffUserUnificationMapping.ResolveUsername(dto.FirstName, dto.LastName, existingUsernamesList.ToHashSet());

        var s = new User
        {
            Id = Guid.NewGuid(), FirstName = dto.FirstName, LastName = dto.LastName,
            Username = username, Email = emailLower,
            Role = dto.Role, Position = dto.Position,
            Mobile = dto.Mobile, Region = dto.Region,
            IsDriverEligible = dto.IsDriverEligible, IsFirstAidQualified = dto.IsFirstAidQualified,
            IsMedicationCompetent = dto.IsMedicationCompetent, IsManualHandlingCompetent = dto.IsManualHandlingCompetent,
            IsOvernightEligible = dto.IsOvernightEligible, IsActive = dto.IsActive, Notes = dto.Notes,
            FirstAidExpiryDate = dto.FirstAidExpiryDate,
            DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = dto.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = dto.WorkerScreeningExpiryDate
        };
        _db.Users.Add(s);
        return new(s, null);
    }

    /// <summary>
    /// §4.1 role-change guardrails. SuperAdmin callers are unrestricted. Anyone else cannot touch (grant or edit) a SuperAdmin account, and
    /// cannot assign the Admin role unless they are an Admin. A null caller (a unit test with no request) counts as no elevated role.
    /// </summary>
    public static string? RoleGuardrailError(ClaimsPrincipal? caller, UserRole targetRole, UserRole? existingRole = null)
    {
        bool IsInRole(string role) => caller?.IsInRole(role) ?? false;

        if (IsInRole("SuperAdmin")) return null;
        if (existingRole == UserRole.SuperAdmin) return "Cannot edit a SuperAdmin account.";
        if (targetRole == UserRole.SuperAdmin) return "Cannot grant the SuperAdmin role.";
        if (targetRole == UserRole.Admin && !IsInRole("Admin")) return "Only an Admin can assign the Admin role.";
        return null;
    }

    /// <summary>An address on <c>Auth:SuperAdminDomain</c> signs in as SuperAdmin whatever the row's Role, so only a SuperAdmin may enter one.</summary>
    public string? ReservedDomainError(ClaimsPrincipal? caller, string normalisedEmail)
    {
        if (caller?.IsInRole("SuperAdmin") ?? false) return null;
        var domain = SuperAdminDomain.From(_config);
        return SuperAdminDomain.Covers(normalisedEmail, domain) ? SuperAdminDomain.ReservedMessage(domain) : null;
    }

    /// <summary>
    /// Global uniqueness of an address makes a squat permanent (the first tenant to type an address owns it, and an archived row keeps it), so a
    /// caller who is not a SuperAdmin may not give staff an address at ANOTHER tenant's own email domain: it would block that tenant from ever adding
    /// the person, and send the person into this tenant's workspace. Returns the refusal, or null. It is a refusal, not a question: it cannot be
    /// confirmed away. The match is on the whole domain, so a subdomain is only unusual (AddressConfirmation), not another organisation's. A shared
    /// provider (gmail.com) is nobody's own, even if a tenant was given it as its domain, so it is never another organisation's either.
    /// </summary>
    public async Task<string?> OtherOrganisationAddressErrorAsync(ClaimsPrincipal? caller, string normalisedEmail, Guid? ownTenantId, CancellationToken ct)
    {
        if (caller?.IsInRole("SuperAdmin") ?? false) return null;
        var at = normalisedEmail.LastIndexOf('@');
        if (at < 0) return null;

        var domain = normalisedEmail[(at + 1)..];
        if (CommonEmailProviders.Covers(domain)) return null;
        var own = ownTenantId ?? Guid.Empty;
        // Tenants are written with their domain tidied (EmailIdentity.NormaliseDomain), but a row from before that rule may hold " Acme.com" or "@acme.com"
        // and must keep protecting its tenant, so the stored side is tidied the same way here. There are few tenants, so they are compared in memory
        // rather than by an expression the database has to translate.
        var otherDomains = await _db.Tenants.Where(t => t.Id != own).Select(t => t.EmailDomain).ToListAsync(ct);
        var belongsToAnother = otherDomains.Any(other => EmailIdentity.NormaliseDomain(other) == domain);
        return belongsToAnother ? OtherOrganisationMessage : null;
    }

    /// <summary>The email domain of a tenant, or null when none is given or it cannot be found. Tenants have no query filter, so any tenant is readable.</summary>
    public async Task<string?> TenantEmailDomainAsync(Guid? tenantId, CancellationToken ct) =>
        tenantId is null ? null : await _db.Tenants.Where(t => t.Id == tenantId).Select(t => t.EmailDomain).FirstOrDefaultAsync(ct);
}
