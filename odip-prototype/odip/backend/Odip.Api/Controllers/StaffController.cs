using System.Security.Claims;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Staff CRUD, now backed by <see cref="User"/> post staff/user-unification — every staff member
/// IS a user account. Route name (<c>api/v1/staff</c>) is kept deliberately (design spec §2).
/// Listings (<see cref="GetAll"/>/<see cref="GetById"/>/<see cref="GetAvailable"/>) show ALL
/// active tenant users regardless of role, per design spec §4.2 — no role filter. Write endpoints
/// enforce the §4.1 guardrails: own-tenant only (free via <c>OdipDbContext</c>'s ambient
/// tenant query filter on every <c>_db.Users</c> read below — a non-SuperAdmin caller's queries
/// are already scoped to their own tenant, so a cross-tenant target id simply resolves to no row,
/// same as "not found"), cannot grant or edit a SuperAdmin account, and a Coordinator actor cannot
/// assign the Admin role (see <see cref="ValidateRoleGuardrails"/>).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/staff")]
public class StaffController : ControllerBase
{
    public const string ChooseOrganisation = "Choose an organisation to view as first: a staff member belongs to one organisation.";

    private readonly OdipDbContext _db;
    private readonly IStaffAvailabilityItemsQuery _availabilityItemsQuery;
    private readonly Microsoft.Extensions.Configuration.IConfiguration? _config;
    // The request's clock: a test fixes it. Every calendar rule uses the PROVIDER's date from it (ProviderTimeZoneResolver.TodayAsync), never the UTC date.
    private readonly TimeProvider _clock;
    private readonly IFirebaseUserService _firebaseUserService;
    private readonly ILogger<StaffController>? _logger;
    // The tenant this request writes to (the caller's own, or the one a SuperAdmin is viewing as). Null when there is none: a SuperAdmin
    // with no tenant selected, and a test that does not care.
    private readonly ICurrentTenant? _currentTenant;
    private readonly StaffCreateService _staffCreator;

    /// <summary>See StaffCreateService.OtherOrganisationAddressErrorAsync.</summary>
    private Task<string?> OtherOrganisationAddressErrorAsync(string normalisedEmail, Guid? ownTenantId, CancellationToken ct) =>
        _staffCreator.OtherOrganisationAddressErrorAsync(User, normalisedEmail, ownTenantId, ct);

    /// <summary>See StaffCreateService.TenantEmailDomainAsync.</summary>
    private Task<string?> TenantEmailDomainAsync(Guid? tenantId, CancellationToken ct) => _staffCreator.TenantEmailDomainAsync(tenantId, ct);

    // IFirebaseUserService is intentionally NOT registered in Program.cs — see AdminUsersController: ActivatorUtilities falls back to the
    // parameter's default, so production needs no DI change while a unit test injects a mock.
    public StaffController(
        OdipDbContext db, IStaffAvailabilityItemsQuery? availabilityItemsQuery = null,
        Microsoft.Extensions.Configuration.IConfiguration? config = null, TimeProvider? clock = null,
        IFirebaseUserService? firebaseUserService = null, ILogger<StaffController>? logger = null, ICurrentTenant? currentTenant = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
        _availabilityItemsQuery = availabilityItemsQuery ?? new StaffAvailabilityItemsQuery(db);
        _config = config;
        _firebaseUserService = firebaseUserService ?? new FirebaseUserService();
        _logger = logger;
        _currentTenant = currentTenant;
        _staffCreator = new StaffCreateService(db, config);
    }

    private static StaffDetailDto ToStaffDetailDto(User s, DateOnly today) => new()
    {
        UpdatedAt = s.UpdatedAt,
        SignInInviteSentAt = s.SignInInviteSentAt,
        SignInAddressUnconfirmed = s.SignInAddressUnconfirmed == true,
        HasSignedIn = s.LastLoginAt != null,
        Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
        FullName = (s.FirstName + " " + s.LastName).Trim(), Username = s.Username,
        Role = s.Role, Position = s.Position ?? Position.SupportWorker, EmploymentType = s.EmploymentType, GoalWeeklyHours = s.GoalWeeklyHours, Email = s.Email,
        Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
        IsFirstAidQualified = s.IsFirstAidQualified, IsCprQualified = s.IsCprQualified, IsMedicationCompetent = s.IsMedicationCompetent,
        IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
        IsActive = s.IsActive, Notes = s.Notes,
        FirstAidExpiryDate = s.FirstAidExpiryDate, CprExpiryDate = s.CprExpiryDate,
        DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
        ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
        MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
        WorkerScreeningNumber = s.WorkerScreeningNumber,
        WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
        EmploymentStartDate = s.EmploymentStartDate,
        HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
    };

    internal const string LastAdminMessage = "Add another Admin first. An organisation needs at least one active Admin.";

    /// <summary>
    /// An Admin row: only an Admin may archive it, and (for every caller but a SuperAdmin) a change that demotes or archives the organisation's
    /// last active Admin is refused. The role change itself is RoleGuardrailError's. <c>_db.Users</c> is tenant-filtered, so the count is this organisation's.
    /// </summary>
    private async Task<string?> AdminRowChangeErrorAsync(User s, UserRole newRole, bool archives, CancellationToken ct)
    {
        if (s.Role != UserRole.Admin || (User?.IsInRole("SuperAdmin") ?? false)) return null;
        if (archives && !(User?.IsInRole("Admin") ?? false)) return "Only an Admin can archive an Admin.";
        if (!s.IsActive || (newRole == UserRole.Admin && !archives)) return null;
        // Only an Admin who has signed in counts, as in EmploymentHeroStaffSync: an invited Admin who never has can't yet run the organisation.
        // shortcut: two Admins archiving each other at the same moment can both pass this count; upgrade to a lock or a serializable transaction if it ever happens.
        return await LastAdminErrorAsync(_db, s, ct);
    }

    /// <summary>
    /// The refusal when <paramref name="admin"/> is its organisation's only active Admin who has signed in, else null. Filters on the row's TenantId itself, so it counts the
    /// same organisation whether the caller is tenant-scoped (Staff) or not (the SuperAdmin user form).
    /// </summary>
    internal static async Task<string?> LastAdminErrorAsync(OdipDbContext db, User admin, CancellationToken ct)
    {
        var otherAdmin = await db.Users.IgnoreQueryFilters([TenantFilter.Name])
            .AnyAsync(u => u.TenantId == admin.TenantId && u.Id != admin.Id && u.Role == UserRole.Admin && u.IsActive && u.LastLoginAt != null, ct);
        return otherAdmin ? null : LastAdminMessage;
    }

    /// <summary>See StaffCreateService.RoleGuardrailError.</summary>
    private string? ValidateRoleGuardrails(UserRole targetRole, UserRole? existingRole = null) =>
        StaffCreateService.RoleGuardrailError(User, targetRole, existingRole);

    /// <summary>See StaffCreateService.ReservedDomainError.</summary>
    private string? ReservedDomainError(string normalisedEmail) => _staffCreator.ReservedDomainError(User, normalisedEmail);

    /// <summary>
    /// A row that already holds an address on <c>Auth:SuperAdminDomain</c> is a SuperAdmin session whatever its Role, whenever it is active
    /// (AuthController.Exchange). Archiving a row only sets IsActive = false and never touches Firebase, so a tenant caller who could bring one
    /// back to life, or change its role, would hand a platform session to whoever still owns that mailbox. Returns the refusal, or null: for a
    /// SuperAdmin, for a row not on that domain, and for any change that only takes capability away or touches other fields (the carve-out in
    /// <see cref="Update"/> that keeps legacy rows editable).
    /// </summary>
    private string? ReservedRowChangeError(User row, bool becomesActive, UserRole newRole)
    {
        if (User?.IsInRole("SuperAdmin") ?? false) return null;
        var domain = SuperAdminDomain.From(_config);
        if (!SuperAdminDomain.Covers(EmailIdentity.Normalise(row.Email), domain)) return null;
        var reactivating = !row.IsActive && becomesActive;
        var changingRole = newRole != row.Role;
        return reactivating || changingRole ? SuperAdminDomain.ReservedRowMessage(domain) : null;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<StaffListDto>>>> GetAll(
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.Users.OrderBy(s => s.LastName).AsQueryable();
        if (isActive.HasValue) query = query.Where(s => s.IsActive == isActive.Value);

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var items = await query
            .Select(s => new StaffListDto
            {
                Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
                FullName = (s.FirstName + " " + s.LastName).Trim(), Username = s.Username,
                Role = s.Role, Position = s.Position ?? Position.SupportWorker, EmploymentType = s.EmploymentType, GoalWeeklyHours = s.GoalWeeklyHours, Email = s.Email,
                Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
                IsFirstAidQualified = s.IsFirstAidQualified, IsCprQualified = s.IsCprQualified, IsMedicationCompetent = s.IsMedicationCompetent,
                IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
                IsActive = s.IsActive,
                FirstAidExpiryDate = s.FirstAidExpiryDate, CprExpiryDate = s.CprExpiryDate,
                DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
                ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
                MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
                WorkerScreeningNumber = s.WorkerScreeningNumber,
                WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
                EmploymentStartDate = s.EmploymentStartDate,
                Notes = s.Notes,
                HasExpiredQualifications =
                    (s.IsFirstAidQualified && s.FirstAidExpiryDate != null && s.FirstAidExpiryDate < today)
                    || (s.IsCprQualified && s.CprExpiryDate != null && s.CprExpiryDate < today)
                    || (s.IsDriverEligible && s.DriverLicenceExpiryDate != null && s.DriverLicenceExpiryDate < today)
                    || (s.IsManualHandlingCompetent && s.ManualHandlingExpiryDate != null && s.ManualHandlingExpiryDate < today)
                    || (s.IsMedicationCompetent && s.MedicationCompetencyExpiryDate != null && s.MedicationCompetencyExpiryDate < today)
                    || (s.WorkerScreeningExpiryDate != null && s.WorkerScreeningExpiryDate < today)
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffListDto>>.Ok(items.Select(i => StaffScreeningMask.Apply(i, User)).ToList()));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffDetailDto>.Fail("Staff not found"));

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        return Ok(ApiResponse<StaffDetailDto>.Ok(StaffScreeningMask.Apply(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            UpdatedAt = s.UpdatedAt,
            FullName = (s.FirstName + " " + s.LastName).Trim(), Username = s.Username,
            Role = s.Role, Position = s.Position ?? Position.SupportWorker, EmploymentType = s.EmploymentType, GoalWeeklyHours = s.GoalWeeklyHours, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsCprQualified = s.IsCprQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate, CprExpiryDate = s.CprExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = s.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
            EmploymentStartDate = s.EmploymentStartDate,
            HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
        }, User)));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> Create([FromBody] CreateStaffDto dto, CancellationToken ct)
    {
        if (_currentTenant is { TenantId: null }) return BadRequest(ApiResponse<StaffDetailDto>.Fail(ChooseOrganisation));
        // A connected organisation's staff come from Employment Hero, the master list (EmploymentHeroStaffSync). The frontend hides the button; this is the rule.
        if (await EmploymentHeroStaffSync.IsConnectedAsync(_db, _currentTenant?.TenantId, ct))
            return Conflict(ApiResponse<StaffDetailDto>.Fail(EmploymentHeroStaffSync.StaffFromEmploymentHeroMessage));
        if (dto.GoalHoursError() is { } goalError) return BadRequest(ApiResponse<StaffDetailDto>.Fail(goalError));
        var staged = await _staffCreator.StageAsync(dto, User, _currentTenant?.TenantId, ct);
        if (staged.IsConflict) return Conflict(ApiResponse<StaffDetailDto>.Fail(staged.Error!));
        if (staged.ErrorCode is { } code) return BadRequest(ApiResponse<StaffDetailDto>.Fail(staged.Error!, code));
        if (staged.Error != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(staged.Error));
        var s = staged.User!;
        await _db.SaveChangesAsync(ct);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        return CreatedAtAction(nameof(GetById), new { id = s.Id }, ApiResponse<StaffDetailDto>.Ok(StaffScreeningMask.Apply(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            UpdatedAt = s.UpdatedAt,
            FullName = s.FullName, Username = s.Username,
            Role = s.Role, Position = s.Position ?? Position.SupportWorker, EmploymentType = s.EmploymentType, GoalWeeklyHours = s.GoalWeeklyHours, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsCprQualified = s.IsCprQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate, CprExpiryDate = s.CprExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = s.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
            EmploymentStartDate = s.EmploymentStartDate,
            HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
        }, User)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffDetailDto>>> Update(Guid id, [FromBody] UpdateStaffDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest(ApiResponse<StaffDetailDto>.Fail("Email is required."));
        if (dto.GoalHoursError() is { } goalError) return BadRequest(ApiResponse<StaffDetailDto>.Fail(goalError));

        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffDetailDto>.Fail("Staff not found"));

        // The form read the row at ExpectedUpdatedAt; another edit since (a deactivation, say) moved UpdatedAt, and this whole-row save would write over it. Absent: saved as before.
        // Compared to the microsecond (the column's precision), as BookingsAccommodationController does.
        if (dto.ExpectedUpdatedAt is { } expectedAt && s.UpdatedAt.Ticks - s.UpdatedAt.Ticks % 10 != expectedAt.Ticks - expectedAt.Ticks % 10)
            return Conflict(ApiResponse<StaffDetailDto>.Fail("Someone else just changed this staff member. Reload the page to see their changes, then save again."));

        var guardError = ValidateRoleGuardrails(dto.Role, existingRole: s.Role);
        if (guardError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(guardError));

        var adminRowError = await AdminRowChangeErrorAsync(s, dto.Role, archives: s.IsActive && !dto.IsActive, ct);
        if (adminRowError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(adminRowError));

        // A row already on the SuperAdmin domain may not be brought back to life, or have its role changed, by a tenant caller.
        var reservedRowError = ReservedRowChangeError(s, becomesActive: dto.IsActive, newRole: dto.Role);
        if (reservedRowError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(reservedRowError));

        var emailLower = EmailIdentity.Normalise(dto.Email);
        var addressChanged = emailLower != EmailIdentity.Normalise(s.Email);
        // Only when the address is being CHANGED: an edit to some other field of a row that already holds such an address (the role guardrail
        // above is what keeps a tenant caller off SuperAdmin accounts) must not start failing because of the address.
        if (addressChanged)
        {
            // Once a row has signed in its address is a working identity: re-pointing it at another mailbox lets that mailbox's owner ask for the
            // set-password link and sign in AS this person, with the row's role, history and attribution, and locks the person out. Before the first
            // sign-in it is only a typo to fix, so that stays open to everyone who may edit staff.
            if (s.LastLoginAt is not null && !((User?.IsInRole("Admin") ?? false) || (User?.IsInRole("SuperAdmin") ?? false)))
                return StatusCode(StatusCodes.Status403Forbidden,
                    ApiResponse<StaffDetailDto>.Fail("Only an Admin can change the address of someone who has already signed in."));

            var reservedError = ReservedDomainError(emailLower);
            if (reservedError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(reservedError));

            var otherOrganisationError = await OtherOrganisationAddressErrorAsync(emailLower, s.TenantId, ct);
            if (otherOrganisationError != null) return BadRequest(ApiResponse<StaffDetailDto>.Fail(otherOrganisationError));
        }

        var emailTaken = await _db.Users.IgnoreQueryFilters([TenantFilter.Name])
            .AnyAsync(u => u.Id != id && u.Email.ToLower() == emailLower, ct);
        if (emailTaken) return Conflict(ApiResponse<StaffDetailDto>.Fail("A user with this email already exists."));

        // A NEW address at neither the tenant's own domain nor a common provider needs a confirmation (see AddressConfirmation). An address the
        // row already holds never does, so legacy rows stay editable.
        if (addressChanged && !dto.AddressConfirmed)
        {
            var rowTenantDomain = await TenantEmailDomainAsync(s.TenantId, ct);
            if (AddressConfirmation.Needed(emailLower, rowTenantDomain))
                return BadRequest(ApiResponse<StaffDetailDto>.Fail(AddressConfirmation.Message(emailLower, rowTenantDomain), AddressConfirmation.Code));
        }

        // Only when Active flips or the name changes, and after every refusal above, so a refused edit changes nothing anywhere. Firebase first, as
        // AdminUsers does: a failure then never leaves the row saved and the sign-in account out of step.
        var (storedName, storedEmail, storedActive) = ($"{s.FirstName} {s.LastName}".Trim(), s.Email, s.IsActive);
        var newName = $"{dto.FirstName} {dto.LastName}".Trim();
        var sent = false;
        if (s.IsActive != dto.IsActive || newName != storedName)
        {
            var (wasSent, syncError) = await SyncFirebaseDisabledAsync(s, !dto.IsActive, addressChanged, ct, newName);
            if (syncError is { } failed) return StatusCode(failed.Status, ApiResponse<StaffDetailDto>.Fail(failed.Message));
            sent = wasSent;
        }

        s.FirstName = dto.FirstName; s.LastName = dto.LastName; s.Position = dto.Position; s.EmploymentType = dto.EmploymentType; s.GoalWeeklyHours = dto.GoalWeeklyHours; s.Role = dto.Role;
        s.Email = emailLower; s.Mobile = dto.Mobile; s.Region = dto.Region;
        if (addressChanged) s.SignInAddressUnconfirmed = false;   // the form asked about an unusual address above: it is person-confirmed now
        s.IsDriverEligible = dto.IsDriverEligible; s.IsFirstAidQualified = dto.IsFirstAidQualified; s.IsCprQualified = dto.IsCprQualified;
        s.IsMedicationCompetent = dto.IsMedicationCompetent; s.IsManualHandlingCompetent = dto.IsManualHandlingCompetent;
        s.IsOvernightEligible = dto.IsOvernightEligible; s.IsActive = dto.IsActive;
        s.Notes = dto.Notes;
        s.FirstAidExpiryDate = dto.FirstAidExpiryDate;
        s.CprExpiryDate = dto.CprExpiryDate;
        s.DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate;
        s.ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate;
        s.MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate;
        // Defence in depth: every role Update allows sees the number; a caller who could not would send none, so keep what is stored rather than wipe it.
        if (StaffScreeningMask.CanSee(User, s.Id)) s.WorkerScreeningNumber = dto.WorkerScreeningNumber;
        s.WorkerScreeningExpiryDate = dto.WorkerScreeningExpiryDate;
        s.UpdatedAt = DateTime.UtcNow;

        try { await _db.SaveChangesAsync(ct); }
        catch when (sent) { await RevertFirebaseDisabledAsync(storedEmail, storedName, !storedActive, ct); throw; }
        // The address is the whole of this person's sign-in, so a change leaves a trace: who changed whose, never the addresses themselves.
        if (addressChanged)
            _logger?.LogInformation("The sign-in address of staff member {TargetUserId} was changed by {ActorUserId}", s.Id, User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        return Ok(ApiResponse<StaffDetailDto>.Ok(StaffScreeningMask.Apply(new StaffDetailDto
        {
            Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
            UpdatedAt = s.UpdatedAt,
            FullName = s.FullName, Username = s.Username,
            Role = s.Role, Position = s.Position ?? Position.SupportWorker, EmploymentType = s.EmploymentType, GoalWeeklyHours = s.GoalWeeklyHours, Email = s.Email,
            Mobile = s.Mobile, Region = s.Region, IsDriverEligible = s.IsDriverEligible,
            IsFirstAidQualified = s.IsFirstAidQualified, IsCprQualified = s.IsCprQualified, IsMedicationCompetent = s.IsMedicationCompetent,
            IsManualHandlingCompetent = s.IsManualHandlingCompetent, IsOvernightEligible = s.IsOvernightEligible,
            IsActive = s.IsActive, Notes = s.Notes,
            FirstAidExpiryDate = s.FirstAidExpiryDate, CprExpiryDate = s.CprExpiryDate,
            DriverLicenceExpiryDate = s.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = s.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = s.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = s.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = s.WorkerScreeningExpiryDate,
            EmploymentStartDate = s.EmploymentStartDate,
            HasExpiredQualifications = s.HasExpiredQualificationsOn(today)
        }, User)));
    }

    /// <summary>Archive (soft-delete) a staff member.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<bool>.Fail("Staff not found"));

        var adminRowError = await AdminRowChangeErrorAsync(s, s.Role, archives: true, ct);
        if (adminRowError != null) return BadRequest(ApiResponse<bool>.Fail(adminRowError));

        var guardError = ValidateRoleGuardrails(s.Role, existingRole: s.Role);
        if (guardError != null) return BadRequest(ApiResponse<bool>.Fail(guardError));

        var sent = false;
        if (s.IsActive)
        {
            var (wasSent, syncError) = await SyncFirebaseDisabledAsync(s, true, addressChanging: false, ct);
            if (syncError is { } failed) return StatusCode(failed.Status, ApiResponse<bool>.Fail(failed.Message));
            sent = wasSent;
        }

        s.IsActive = false; s.UpdatedAt = DateTime.UtcNow;
        try { await _db.SaveChangesAsync(ct); }
        catch when (sent) { await RevertFirebaseDisabledAsync(s.Email, $"{s.FirstName} {s.LastName}".Trim(), false, ct); throw; }
        return Ok(ApiResponse<bool>.Ok(true, "Staff member archived"));
    }

    /// <summary>
    /// Sets the Disabled flag of this member's Firebase account to match Active, with the failure handling of AdminUsersController's update: no
    /// account yet is skipped (the sign-in-account route creates it), an address Firebase refuses is a 400 to correct, anything else a 502.
    /// Looked up by the address the row holds now. Error is null when the save may go on; Sent is true only when Firebase took the change, so a
    /// failed save undoes only what was really sent.
    /// </summary>
    private async Task<(bool Sent, (int Status, string Message)? Error)> SyncFirebaseDisabledAsync(User s, bool disabled, bool addressChanging, CancellationToken ct, string? displayName = null)
    {
        var email = EmailIdentity.Normalise(s.Email);
        var sent = false;
        try
        {
            await _firebaseUserService.UpdateUserByEmailAsync(email, displayName ?? $"{s.FirstName} {s.LastName}".Trim(), disabled, ct);
            sent = true;
        }
        catch (FirebaseAuthException ex) when (ex.AuthErrorCode == AuthErrorCode.UserNotFound)
        {
            // Created before the sign-in account existed: nothing to change in Firebase.
        }
        catch (Exception ex) when (FirebaseFailures.IsInvalidEmail(ex) && addressChanging)
        {
            // This edit is CHANGING the malformed address: refusing would block the edit that fixes it, so skip the sync and save the correction.
            _logger?.LogWarning("Skipping the Firebase sync of user {UserId}: its stored address is not one Firebase accepts, and this edit changes it", s.Id);
        }
        catch (Exception ex) when (FirebaseFailures.IsInvalidEmail(ex))
        {
            _logger?.LogWarning("Firebase refused the stored address of user {UserId} as invalid", s.Id);
            return (false, (StatusCodes.Status400BadRequest, "That doesn't look like a valid email address. Correct it first."));
        }
        catch (Exception ex)
        {
            // Deliberately broad: the confirmed failure (TokenResponseException) is not a FirebaseAuthException.
            _logger?.LogError(ex, "Failed to sync user {Email} to Firebase Auth", email);
            return (false, (StatusCodes.Status502BadGateway, "Unable to sync the user's sign-in account. If it keeps happening, ask whoever runs the Firebase project."));
        }
        return (sent, null);
    }

    /// <summary>The database save failed after the Firebase flip: put the account back, as AdminUsersController does. Best effort, so a failure here is logged and the save's exception still surfaces.</summary>
    private async Task RevertFirebaseDisabledAsync(string email, string displayName, bool disabled, CancellationToken ct)
    {
        try { await _firebaseUserService.UpdateUserByEmailAsync(EmailIdentity.Normalise(email), displayName, disabled, ct); }
        catch (Exception ex) { _logger?.LogError(ex, "Failed to revert Firebase Auth user {Email} after DB save failure", email); }
    }

    /// <summary>
    /// Makes sure this staff member has a Firebase sign-in account (creating a verified, passwordless one when there is none) and says
    /// which, so the browser can then send the set-password email and word it truthfully. Create writes only the user row, so a staff
    /// member added here has had no account until this runs. An account that already exists is left exactly as it is. Tenant-scoped like
    /// every other staff write: a row in another tenant is simply not found.
    /// </summary>
    [HttpPost("{id:guid}/sign-in-account")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SignInAccountDto>>> EnsureSignInAccount(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<SignInAccountDto>.Fail("Staff not found"));

        var guardError = ValidateRoleGuardrails(s.Role, existingRole: s.Role);
        if (guardError != null) return BadRequest(ApiResponse<SignInAccountDto>.Fail(guardError));

        var outcome = await SignInAccounts.EnsureAsync(s, User, _config, _firebaseUserService, _logger, ct);
        if (outcome.Account is { } account) return Ok(ApiResponse<SignInAccountDto>.Ok(account));
        if (outcome.BadGateway) return StatusCode(StatusCodes.Status502BadGateway, ApiResponse<SignInAccountDto>.Fail(outcome.Error!));
        return BadRequest(ApiResponse<SignInAccountDto>.Fail(outcome.Error!));
    }

    /// <summary>
    /// Releases a held sign-in address (see User.SignInAddressUnconfirmed): the caller has checked it. Tenant-scoped (the Users filter: another
    /// organisation's row is not found), idempotent (a row not held is left as it is), audited by the tracked save.
    /// </summary>
    [HttpPost("{id:guid}/confirm-address")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> ConfirmAddress(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<bool>.Fail("Staff not found"));

        var guardError = ValidateRoleGuardrails(s.Role, existingRole: s.Role);
        if (guardError != null) return BadRequest(ApiResponse<bool>.Fail(guardError));

        if (s.SignInAddressUnconfirmed is true)
        {
            s.SignInAddressUnconfirmed = false;
            s.UpdatedAt = _clock.GetUtcNow().UtcDateTime;
            // The card's item goes in the same save, so it does not linger until the next sync.
            _db.EmploymentHeroAttentions.RemoveRange(await _db.EmploymentHeroAttentions
                .Where(a => a.UserId == s.Id && a.Kind == EmploymentHeroAttentionKind.ConfirmAddress).ToListAsync(ct));
            await _db.SaveChangesAsync(ct);
            _logger?.LogInformation("The sign-in address of staff member {TargetUserId} was confirmed by {ActorUserId}", s.Id, User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");
        }
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// Records that the browser sent these people a sign-in invite email, so the next bulk invite skips them and the Staff page can say when. Only
    /// people the caller could invite are stamped (active, never signed in, a SuperAdmin row only by a SuperAdmin, an Admin row only by an Admin or SuperAdmin); any other id is skipped
    /// silently. A tracked save, not a bulk update: Users are audited, so each person gets one Updated row with the caller as the actor. The Users
    /// query filter keeps it to the caller's own organisation (a SuperAdmin's to the one being viewed, or all when none is).
    /// </summary>
    [HttpPost("/api/v1/users/invites-sent")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(8_192)]
    public async Task<ActionResult<ApiResponse<int>>> InvitesSent([FromBody] InvitesSentRequest? body, CancellationToken ct)
    {
        var ids = body?.UserIds?.Distinct().ToList() ?? [];
        if (ids.Count is 0 or > 100) return BadRequest(ApiResponse<int>.Fail("Send between 1 and 100 people at a time."));

        var isSuperAdmin = User.IsInRole("SuperAdmin");
        var isAdmin = isSuperAdmin || User.IsInRole("Admin");
        var people = await _db.Users.Where(u => ids.Contains(u.Id) && u.IsActive && u.LastLoginAt == null && (isSuperAdmin || u.Role != UserRole.SuperAdmin) && (isAdmin || u.Role != UserRole.Admin)).ToListAsync(ct);
        var now = _clock.GetUtcNow().UtcDateTime;
        foreach (var person in people) person.SignInInviteSentAt = now;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<int>.Ok(people.Count));
    }

    /// <summary>
    /// Connection map item 12 — the staff hub's single data source: the staff record plus five
    /// pre-joined collections, each built from exactly one query (no per-row queries). 404s if
    /// <paramref name="id"/> isn't in the caller's tenant — same as GetById, for free from
    /// _db.Users' ambient tenant query filter.
    /// </summary>
    [HttpGet("{id:guid}/overview")]
    public async Task<ActionResult<ApiResponse<StaffOverviewDto>>> GetOverview(Guid id, CancellationToken ct)
    {
        var s = await _db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s == null) return NotFound(ApiResponse<StaffOverviewDto>.Fail("Staff not found"));

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var staffIds = new List<Guid> { id };

        // Availability: shared with ScheduleController.GetScheduleOverview via
        // IStaffAvailabilityItemsQuery (pure move, connection map item 12).
        var availabilityByStaff = await _availabilityItemsQuery.GetAsync(staffIds, today, today.AddDays(90), ct);
        var availability = StaffScreeningMask.Apply(availabilityByStaff[id].ToList(), User, id);

        var upcomingShiftStatuses = new[] { ShiftStatus.Published, ShiftStatus.InProgress, ShiftStatus.PendingReview };
        var upcomingShiftsWindowEnd = today.AddDays(14);
        var upcomingShifts = await _db.Shifts
            .Where(sh => sh.UserId == id && sh.ServiceDate >= today && sh.ServiceDate <= upcomingShiftsWindowEnd
                         && upcomingShiftStatuses.Contains(sh.Status))
            .OrderBy(sh => sh.ServiceDate).ThenBy(sh => sh.StartTime)
            .Select(sh => new StaffOverviewUpcomingShiftDto
            {
                ShiftId = sh.Id, ServiceDate = sh.ServiceDate, StartTime = sh.StartTime, EndTime = sh.EndTime,
                EndsNextDay = sh.EndsNextDay, ParticipantId = sh.ParticipantId,
                ParticipantName = sh.Participant != null ? sh.Participant.FullName : string.Empty,
                Status = sh.Status
            })
            .ToListAsync(ct);

        // "trips ending today or later" — same Cancelled exclusion RosteringController.GetBoard
        // and ScheduleController use for the same StaffAssignments table.
        var upcomingTripAssignments = await _db.StaffAssignments
            .Where(a => a.UserId == id && a.Status != AssignmentStatus.Cancelled && a.AssignmentEnd >= today)
            .OrderBy(a => a.AssignmentStart)
            .Select(a => new StaffOverviewTripAssignmentDto
            {
                AssignmentId = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance.TripName,
                StartDate = a.AssignmentStart, EndDate = a.AssignmentEnd
            })
            .ToListAsync(ct);

        // Newest 10 active incidents where this staff member is the INVOLVED user, not the
        // reporter — same projection shape as IncidentsController.GetAll.
        var recentIncidents = await _db.IncidentReports
            .Where(i => i.InvolvedUserId == id && i.IsActive)
            .OrderByDescending(i => i.IncidentDateTime)
            .Take(10)
            .Select(IncidentProjections.ToListDto(DateTime.UtcNow))
            .ToListAsync(ct);

        // Last 10 completions this staff member SUBMITTED (Shift.UserId at Start/manual-Finish
        // time — see ShiftCompletion.SubmittedByUserId), newest first. The shift/completion
        // projection itself is ShiftCompletionMapper.BuildQueueItemsAsync — the same one
        // RosteringController.GetCompletions uses for the coordinator's review queue — so this
        // reuses that timezone-aware variance calc rather than duplicating it; the "newest 10"
        // selection and ordering happen here since BuildQueueItemsAsync doesn't sort.
        var recentCompletionShiftIds = await _db.ShiftCompletions
            .Where(c => c.SubmittedByUserId == id && c.IsActive && c.Shift!.GroupActivityId == null)
            .OrderByDescending(c => c.SubmittedAt ?? c.StartedAt)
            .Take(10)
            .Select(c => c.ShiftId)
            .ToListAsync(ct);
        var recentCompletionRank = recentCompletionShiftIds
            .Select((shiftId, index) => (shiftId, index))
            .ToDictionary(x => x.shiftId, x => x.index);
        var recentCompletionsQuery = _db.Shifts.Where(sh => recentCompletionShiftIds.Contains(sh.Id));
        var recentCompletions = (await Odip.Api.Rostering.ShiftCompletionMapper.BuildQueueItemsAsync(
                _db, recentCompletionsQuery, ct))
            .OrderBy(c => recentCompletionRank.GetValueOrDefault(c.ShiftId, int.MaxValue))
            .ToList();

        return Ok(ApiResponse<StaffOverviewDto>.Ok(new StaffOverviewDto
        {
            Staff = StaffScreeningMask.Apply(ToStaffDetailDto(s, today), User),
            Availability = availability,
            UpcomingShifts = upcomingShifts,
            UpcomingTripAssignments = upcomingTripAssignments,
            RecentIncidents = recentIncidents,
            RecentCompletions = recentCompletions
        }));
    }

    [HttpGet("{id:guid}/availability")]
    public async Task<ActionResult<ApiResponse<List<StaffAvailabilityDto>>>> GetAvailability(Guid id, CancellationToken ct)
    {
        if (!await _db.Users.AnyAsync(u => u.Id == id, ct)) return NotFound(ApiResponse<List<StaffAvailabilityDto>>.Fail("Staff not found"));

        var items = await _db.StaffAvailabilities.Where(a => a.UserId == id)
            .OrderBy(a => a.StartDateTime)
            .Select(a => new StaffAvailabilityDto
            {
                Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
                EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
                IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAvailabilityDto>>.Ok(items));
    }

    [HttpGet("{id:guid}/assignments")]
    public async Task<ActionResult<ApiResponse<List<StaffAssignmentDto>>>> GetAssignments(Guid id, CancellationToken ct)
    {
        if (!await _db.Users.AnyAsync(u => u.Id == id, ct)) return NotFound(ApiResponse<List<StaffAssignmentDto>>.Fail("Staff not found"));

        var items = await _db.StaffAssignments.Include(a => a.TripInstance)
            .Where(a => a.UserId == id)
            .Select(a => new StaffAssignmentDto
            {
                Id = a.Id, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance.TripName,
                StaffId = a.UserId, AssignmentRole = a.AssignmentRole,
                AssignmentStart = a.AssignmentStart, AssignmentEnd = a.AssignmentEnd,
                Status = a.Status, IsDriver = a.IsDriver, SleepoverType = a.SleepoverType,
                HasConflict = a.HasConflict,
                OverrideReason = a.OverrideReason, AcknowledgedFindingCodes = a.AcknowledgedFindingCodes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAssignmentDto>>.Ok(items));
    }

    /// <summary>Get staff available for a date range.</summary>
    [HttpGet("available")]
    public async Task<ActionResult<ApiResponse<List<StaffListDto>>>> GetAvailable(
        [FromQuery] DateOnly startDate, [FromQuery] DateOnly endDate, CancellationToken ct)
    {
        var startDt = startDate.ToDateTime(TimeOnly.MinValue);
        var endDt = endDate.ToDateTime(TimeOnly.MaxValue);

        // Staff who don't have Unavailable/Leave during the range
        var unavailableStaffIds = await _db.StaffAvailabilities
            .Where(a => (a.AvailabilityType == AvailabilityType.Unavailable || a.AvailabilityType == AvailabilityType.Leave)
                && a.StartDateTime < endDt && a.EndDateTime > startDt)
            .Select(a => a.UserId).Distinct().ToListAsync(ct);

        var items = await _db.Users.Where(s => s.IsActive && !unavailableStaffIds.Contains(s.Id))
            .Select(s => new StaffListDto
            {
                Id = s.Id, FirstName = s.FirstName, LastName = s.LastName,
                FullName = (s.FirstName + " " + s.LastName).Trim(), Username = s.Username,
                Role = s.Role, Position = s.Position ?? Position.SupportWorker,
                IsDriverEligible = s.IsDriverEligible, IsFirstAidQualified = s.IsFirstAidQualified,
                IsMedicationCompetent = s.IsMedicationCompetent, IsManualHandlingCompetent = s.IsManualHandlingCompetent,
                IsOvernightEligible = s.IsOvernightEligible, IsActive = s.IsActive
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffListDto>>.Ok(items));
    }
}
