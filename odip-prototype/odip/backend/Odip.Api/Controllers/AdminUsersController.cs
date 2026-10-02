using System.Security.Claims;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Route("api/v1/admin/users")]
[Authorize(Roles = "SuperAdmin")]
public class AdminUsersController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ILogger<AdminUsersController> _logger;
    private readonly IFirebaseUserService _firebaseUserService;

    // IFirebaseUserService is intentionally NOT registered in Program.cs — ActivatorUtilities
    // (used by ASP.NET Core's default controller activator) falls back to a parameter's default
    // value when a type isn't resolvable from DI, so this seam works without any DI registration
    // change while still allowing Odip.Tests to inject a Moq mock directly via this constructor.
    public AdminUsersController(
        OdipDbContext db,
        ILogger<AdminUsersController> logger,
        IFirebaseUserService? firebaseUserService = null)
    {
        _db = db;
        _logger = logger;
        _firebaseUserService = firebaseUserService ?? new FirebaseUserService();
    }

    // GET api/v1/admin/users?tenantId=&role=&status=&search=&page=1&pageSize=20
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? tenantId,
        [FromQuery] string? role,
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        // Deliberately a lower default/ceiling (20/100, not the house 50/200) — admin user
        // lists are smaller and this predates the shared 50/200 convention. Do not "tidy"
        // this to match every other controller.
        (page, pageSize) = PagingParams.Clamp(page, pageSize, maxPageSize: 100);

        var query = _db.Users
            .IgnoreQueryFilters()
            .Include(u => u.Tenant)
            .AsQueryable();

        if (tenantId.HasValue)
            query = query.Where(u => u.TenantId == tenantId.Value);

        if (!string.IsNullOrWhiteSpace(role) && Enum.TryParse<UserRole>(role, true, out var parsedRole))
            query = query.Where(u => u.Role == parsedRole);

        if (!string.IsNullOrWhiteSpace(status))
        {
            var isActive = status.Equals("active", StringComparison.OrdinalIgnoreCase);
            query = query.Where(u => u.IsActive == isActive);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.ToLower();
            query = query.Where(u =>
                u.FirstName.ToLower().Contains(term) ||
                u.LastName.ToLower().Contains(term) ||
                u.Email.ToLower().Contains(term) ||
                u.Username.ToLower().Contains(term));
        }

        var totalCount = await query.CountAsync(ct);

        var users = await query
            .OrderBy(u => u.FirstName).ThenBy(u => u.LastName)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(u => new AdminUserDto
            {
                Id = u.Id, FirstName = u.FirstName, LastName = u.LastName,
                FullName = u.FirstName + " " + u.LastName, Email = u.Email, Username = u.Username,
                Role = u.Role.ToString(), TenantId = u.TenantId,
                TenantName = u.Tenant != null ? u.Tenant.Name : "",
                IsActive = u.IsActive, CreatedAt = u.CreatedAt, LastLoginAt = u.LastLoginAt,
                Position = u.Position, Mobile = u.Mobile, Region = u.Region,
                IsDriverEligible = u.IsDriverEligible, IsFirstAidQualified = u.IsFirstAidQualified,
                IsMedicationCompetent = u.IsMedicationCompetent, IsManualHandlingCompetent = u.IsManualHandlingCompetent,
                IsOvernightEligible = u.IsOvernightEligible,
                FirstAidExpiryDate = u.FirstAidExpiryDate, DriverLicenceExpiryDate = u.DriverLicenceExpiryDate,
                ManualHandlingExpiryDate = u.ManualHandlingExpiryDate, MedicationCompetencyExpiryDate = u.MedicationCompetencyExpiryDate,
                WorkerScreeningNumber = u.WorkerScreeningNumber, WorkerScreeningExpiryDate = u.WorkerScreeningExpiryDate,
                Notes = u.Notes
            })
            .ToListAsync(ct);

        var result = new PagedResult<AdminUserDto>
        {
            Items = users,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };

        return Ok(ApiResponse<PagedResult<AdminUserDto>>.Ok(result));
    }

    // GET api/v1/admin/users/{id}
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .Include(u => u.Tenant)
            .FirstOrDefaultAsync(u => u.Id == id, ct);

        if (user is null)
            return NotFound(ApiResponse<object>.Fail("User not found"));

        return Ok(ApiResponse<AdminUserDto>.Ok(ToAdminUserDto(user, user.Tenant?.Name ?? "")));
    }

    /// <summary>Maps a User (plus its resolved tenant name) onto the API DTO — shared by GetById/Create/Update so the §3.1 profile-field list lives in exactly one place.</summary>
    private static AdminUserDto ToAdminUserDto(User user, string tenantName) => new()
    {
        Id = user.Id, FirstName = user.FirstName, LastName = user.LastName, FullName = user.FullName,
        Email = user.Email, Username = user.Username, Role = user.Role.ToString(),
        TenantId = user.TenantId, TenantName = tenantName,
        IsActive = user.IsActive, CreatedAt = user.CreatedAt, LastLoginAt = user.LastLoginAt,
        Position = user.Position, Mobile = user.Mobile, Region = user.Region,
        IsDriverEligible = user.IsDriverEligible, IsFirstAidQualified = user.IsFirstAidQualified,
        IsMedicationCompetent = user.IsMedicationCompetent, IsManualHandlingCompetent = user.IsManualHandlingCompetent,
        IsOvernightEligible = user.IsOvernightEligible,
        FirstAidExpiryDate = user.FirstAidExpiryDate, DriverLicenceExpiryDate = user.DriverLicenceExpiryDate,
        ManualHandlingExpiryDate = user.ManualHandlingExpiryDate, MedicationCompetencyExpiryDate = user.MedicationCompetencyExpiryDate,
        WorkerScreeningNumber = user.WorkerScreeningNumber, WorkerScreeningExpiryDate = user.WorkerScreeningExpiryDate,
        Notes = user.Notes
    };

    // POST api/v1/admin/users
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAdminUserDto dto, CancellationToken ct)
    {
        // Validate tenant exists
        var tenant = await _db.Tenants.FindAsync([dto.TenantId], ct);
        if (tenant is null)
            return BadRequest(ApiResponse<object>.Fail("Tenant not found"));

        // Validate role
        if (!Enum.TryParse<UserRole>(dto.Role, true, out var role) || role == UserRole.SuperAdmin)
            return BadRequest(ApiResponse<object>.Fail("Invalid role. SuperAdmin cannot be assigned."));

        // A typed password is a live credential (the account is verified from the start), so it is held to PasswordPolicy here, as a 400,
        // before Firebase is asked anything. Blank means none: the user sets their own from the emailed link.
        var passwordError = PasswordPolicy.Check(dto.Password);
        if (passwordError is not null)
            return BadRequest(ApiResponse<object>.Fail(passwordError));
        var password = string.IsNullOrEmpty(dto.Password) ? null : dto.Password;

        // The address in the one form ODIP stores and compares (see EmailIdentity): the uniqueness check, Firebase and the row all see
        // the same value, so the exchange can find the row from the lower-case address Firebase puts in a token.
        var email = EmailIdentity.Normalise(dto.Email);

        // Validate email uniqueness across all tenants
        var emailExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.Email.ToLower() == email, ct);
        if (emailExists)
            return Conflict(ApiResponse<object>.Fail("A user with this email already exists"));

        // Validate username uniqueness across all tenants
        var usernameExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.Username.ToLower() == dto.Username.ToLower(), ct);
        if (usernameExists)
            return Conflict(ApiResponse<object>.Fail("A user with this username already exists"));

        // Any address can sign in, so one at neither the tenant's own domain nor a common provider (a typo, another organisation's) is a live
        // login for whoever owns it. Ask the admin to check it before anything is made (see AddressConfirmation); the screen answers with the flag.
        if (!dto.AddressConfirmed && AddressConfirmation.Needed(email, tenant.EmailDomain))
            return BadRequest(ApiResponse<object>.Fail(AddressConfirmation.Message(email, tenant.EmailDomain), AddressConfirmation.Code));

        // Create the Firebase Auth account FIRST, before any DB write. This is the fix for a
        // confirmed data-integrity bug: previously the DB row was inserted before the Firebase
        // call, so a Firebase failure (e.g. a bad/placeholder service account raising
        // TokenResponseException, or any FirebaseAuthException) left an orphaned user row that
        // existed in ODIP's database but not in Firebase, while the client only saw an unhandled
        // 500. Doing Firebase first means a Firebase failure never touches the database at all.
        string? firebaseUid = null;
        var createdFirebaseUser = false;
        try
        {
            firebaseUid = await _firebaseUserService.CreateUserAsync(
                email, $"{dto.FirstName} {dto.LastName}", password, ct);
            createdFirebaseUser = true;
        }
        catch (FirebaseAuthException ex) when (ex.AuthErrorCode == AuthErrorCode.EmailAlreadyExists)
        {
            // User already exists in Firebase — that's OK, they'll be able to sign in.
            // We didn't create anything, so there's nothing to compensate for.
        }
        catch (Exception ex)
        {
            // Deliberately broad: this scope wraps only the single external Firebase call.
            // The confirmed failure mode (TokenResponseException from the Google.Apis auth
            // stack when the service account can't be authenticated) is NOT a
            // FirebaseAuthException, so a narrower catch would let it through unhandled again.
            _logger.LogError(ex, "Failed to create Firebase Auth user for {Email}", email);
            return StatusCode(StatusCodes.Status502BadGateway,
                ApiResponse<object>.Fail("Unable to create the user's sign-in account. Please try again later."));
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            TenantId = dto.TenantId,
            FirstName = dto.FirstName,
            LastName = dto.LastName,
            Email = email,
            Username = dto.Username,
            Role = role,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Position = dto.Position,
            Mobile = dto.Mobile,
            Region = dto.Region,
            IsDriverEligible = dto.IsDriverEligible,
            IsFirstAidQualified = dto.IsFirstAidQualified,
            IsMedicationCompetent = dto.IsMedicationCompetent,
            IsManualHandlingCompetent = dto.IsManualHandlingCompetent,
            IsOvernightEligible = dto.IsOvernightEligible,
            FirstAidExpiryDate = dto.FirstAidExpiryDate,
            DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate,
            ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate,
            MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate,
            WorkerScreeningNumber = dto.WorkerScreeningNumber,
            WorkerScreeningExpiryDate = dto.WorkerScreeningExpiryDate,
            Notes = dto.Notes,
        };

        _db.Users.Add(user);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            // Firebase now has an account we just created, but the DB write failed — compensate
            // by deleting the Firebase account so the two systems don't silently diverge. If we
            // merely reused a pre-existing Firebase account (EmailAlreadyExists case above),
            // createdFirebaseUser is false and we leave that account untouched.
            if (createdFirebaseUser && firebaseUid is not null)
                await _firebaseUserService.DeleteUserAsync(firebaseUid, ct);

            _logger.LogError(ex,
                "Failed to save new user {Email} after Firebase account creation; compensated by deleting Firebase user {FirebaseUid}",
                email, firebaseUid);
            throw; // handled by ExceptionHandlingMiddleware -> standard 500 ApiResponse envelope
        }

        // Say which it was: a password the admin typed is applied to an account made here and NOT to one that already existed, and the
        // set-password email is worded "set" or "reset" accordingly.
        var created = ToAdminUserDto(user, tenant.Name) with
        {
            FirebaseAccount = createdFirebaseUser ? FirebaseAccountStatus.Created : FirebaseAccountStatus.Existing,
        };
        return CreatedAtAction(nameof(GetById), new { id = user.Id }, ApiResponse<AdminUserDto>.Ok(created));
    }

    // PUT api/v1/admin/users/{id}
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateAdminUserDto dto, CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .Include(u => u.Tenant)
            .FirstOrDefaultAsync(u => u.Id == id, ct);

        if (user is null)
            return NotFound(ApiResponse<object>.Fail("User not found"));

        // Validate role
        if (!Enum.TryParse<UserRole>(dto.Role, true, out var role) || role == UserRole.SuperAdmin)
            return BadRequest(ApiResponse<object>.Fail("Invalid role. SuperAdmin cannot be assigned."));

        // The address in the one form ODIP stores and compares (see EmailIdentity). Saving also repairs a row stored as typed.
        var email = EmailIdentity.Normalise(dto.Email);

        // Validate email uniqueness (excluding current user)
        var emailExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.Email.ToLower() == email && u.Id != id, ct);
        if (emailExists)
            return Conflict(ApiResponse<object>.Fail("A user with this email already exists"));

        // Validate username uniqueness (excluding current user)
        var usernameExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.Username.ToLower() == dto.Username.ToLower() && u.Id != id, ct);
        if (usernameExists)
            return Conflict(ApiResponse<object>.Fail("A user with this username already exists"));

        // Capture pre-mutation values: the Firebase account is looked up by the user's ORIGINAL
        // email (Firebase email changes require re-auth and are intentionally not synced — see
        // note below), and the original display name / disabled state are kept so we can revert
        // the Firebase side if the DB save fails after a successful Firebase update.
        // Normalised for the Firebase lookup: a row stored in another case still finds its account.
        var originalEmail = EmailIdentity.Normalise(user.Email);
        var originalDisplayName = user.FullName;
        var originalDisabled = !user.IsActive;

        // Sync changes to Firebase Auth FIRST, before persisting DB changes. This is the fix for
        // a confirmed data-integrity bug: previously the DB save happened first, so a Firebase
        // failure (e.g. TokenResponseException from a bad/placeholder service account, which is
        // NOT a FirebaseAuthException and was never caught here) surfaced as an unhandled 500
        // AFTER the DB row was already committed — leaving the DB updated but Firebase silently
        // out of sync. Doing Firebase first means a Firebase failure never touches the database.
        // NOTE: Email changes are not synced to Firebase here — Firebase Admin SDK email updates
        // require the user to re-authenticate, so we only sync DisplayName and Disabled.
        var firebaseSynced = false;
        try
        {
            await _firebaseUserService.UpdateUserByEmailAsync(
                originalEmail, $"{dto.FirstName} {dto.LastName}", !dto.IsActive, ct);
            firebaseSynced = true;
        }
        catch (FirebaseAuthException ex) when (ex.AuthErrorCode == AuthErrorCode.UserNotFound)
        {
            // Firebase user may not exist if they were created before this feature — skip.
            // Nothing was changed in Firebase, so there's nothing to compensate for.
        }
        catch (Exception ex)
        {
            // Deliberately broad: this scope wraps only the single external Firebase call.
            // The confirmed failure mode (TokenResponseException from the Google.Apis auth
            // stack) is NOT a FirebaseAuthException, so a narrower catch would let it through
            // unhandled again, as it did before this fix.
            _logger.LogError(ex, "Failed to sync user {Email} to Firebase Auth", originalEmail);
            return StatusCode(StatusCodes.Status502BadGateway,
                ApiResponse<object>.Fail("Unable to sync the user's sign-in account. Please try again later."));
        }

        user.FirstName = dto.FirstName;
        user.LastName = dto.LastName;
        user.Email = email;
        user.Username = dto.Username;
        user.Role = role;
        user.IsActive = dto.IsActive;
        user.Position = dto.Position;
        user.Mobile = dto.Mobile;
        user.Region = dto.Region;
        user.IsDriverEligible = dto.IsDriverEligible;
        user.IsFirstAidQualified = dto.IsFirstAidQualified;
        user.IsMedicationCompetent = dto.IsMedicationCompetent;
        user.IsManualHandlingCompetent = dto.IsManualHandlingCompetent;
        user.IsOvernightEligible = dto.IsOvernightEligible;
        user.FirstAidExpiryDate = dto.FirstAidExpiryDate;
        user.DriverLicenceExpiryDate = dto.DriverLicenceExpiryDate;
        user.ManualHandlingExpiryDate = dto.ManualHandlingExpiryDate;
        user.MedicationCompetencyExpiryDate = dto.MedicationCompetencyExpiryDate;
        user.WorkerScreeningNumber = dto.WorkerScreeningNumber;
        user.WorkerScreeningExpiryDate = dto.WorkerScreeningExpiryDate;
        user.Notes = dto.Notes;
        user.UpdatedAt = DateTime.UtcNow;

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            // The DB write failed after Firebase was already updated — compensate by reverting
            // Firebase to its pre-update state so the two systems don't silently diverge. This
            // is best-effort: if it also fails there is nothing more we can do.
            if (firebaseSynced)
            {
                try
                {
                    await _firebaseUserService.UpdateUserByEmailAsync(
                        originalEmail, originalDisplayName, originalDisabled, ct);
                }
                catch (Exception compensationEx)
                {
                    _logger.LogError(compensationEx,
                        "Failed to revert Firebase Auth user {Email} after DB save failure", originalEmail);
                }
            }

            _logger.LogError(ex,
                "Failed to save updated user {Email} after Firebase sync; compensation attempted={Compensated}",
                originalEmail, firebaseSynced);
            throw; // handled by ExceptionHandlingMiddleware -> standard 500 ApiResponse envelope
        }

        // The address is the whole of this person's sign-in, so a change leaves a trace: who changed whose, never the addresses themselves.
        if (email != originalEmail)
            _logger.LogInformation("The sign-in address of user {TargetUserId} was changed by {ActorUserId}", user.Id, User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");

        return Ok(ApiResponse<AdminUserDto>.Ok(ToAdminUserDto(user, user.Tenant?.Name ?? "")));
    }

    // POST api/v1/admin/users/{id}/sign-in-account
    /// <summary>
    /// Makes sure this user has a Firebase sign-in account (creating a verified, passwordless one when there is none) and says which, so
    /// the browser can then send the set-password email and word it truthfully. An account that already exists is left exactly as it is.
    /// Like <see cref="GetAll"/> it looks past the tenant filter: this is the SuperAdmin's account administration surface.
    /// </summary>
    [HttpPost("{id:guid}/sign-in-account")]
    public async Task<IActionResult> EnsureSignInAccount(Guid id, CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == id, ct);

        if (user is null)
            return NotFound(ApiResponse<object>.Fail("User not found"));

        if (!user.IsActive)
            return BadRequest(ApiResponse<object>.Fail("This user is inactive, so they cannot be given a sign-in account."));

        if (string.IsNullOrWhiteSpace(user.Email))
            return BadRequest(ApiResponse<object>.Fail("This user has no email address."));

        var email = EmailIdentity.Normalise(user.Email);

        // An address the app invented for a row that had none (see PlaceholderEmail) can never receive the link, so no account is made for it.
        if (PlaceholderEmail.Covers(email))
            return BadRequest(ApiResponse<object>.Fail(PlaceholderEmail.Message(user.FullName)));

        try
        {
            var result = await _firebaseUserService.EnsureSignInAccountAsync(email, user.FullName, ct);
            var account = result == SignInAccountResult.Created ? FirebaseAccountStatus.Created : FirebaseAccountStatus.Existing;
            // No audit record exists yet (the email itself goes from the browser to Firebase), so this line is the only trace of who asked for it.
            _logger.LogInformation("Sign-in account for user {TargetUserId} was {Account}, as asked by {ActorUserId}", user.Id, account, User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "unknown");
            return Ok(ApiResponse<SignInAccountDto>.Ok(new SignInAccountDto(account)));
        }
        catch (Exception ex) when (FirebaseFailures.IsInvalidEmail(ex))
        {
            // Firebase refused the address itself (a legacy row with a typo). Retrying cannot fix that and correcting the address can, so it is the
            // admin's to act on (400), not a fault on our side (502).
            _logger.LogWarning("Firebase refused the address of user {UserId} as invalid: {Email}", user.Id, email);
            return BadRequest(ApiResponse<object>.Fail("That doesn't look like a valid email address. Correct it first."));
        }
        catch (Exception ex)
        {
            // Deliberately broad, as in Create: the failure that matters (a service account Google cannot authenticate) is not a
            // FirebaseAuthException, and the same call with no Firebase app configured fails the same way, so it is the same 502. The line says
            // where to turn rather than promising a retry will help: an unusable service account stays unusable.
            _logger.LogError(ex, "Failed to ensure a Firebase sign-in account for {Email}", email);
            return StatusCode(StatusCodes.Status502BadGateway,
                ApiResponse<object>.Fail("Unable to set up the user's sign-in account. If it keeps happening, ask whoever runs the Firebase project."));
        }
    }
}
