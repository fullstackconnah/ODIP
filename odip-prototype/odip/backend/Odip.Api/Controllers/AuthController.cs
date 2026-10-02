using System.Globalization;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.Interfaces;
using Odip.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public class AuthController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthController> _logger;
    private readonly ILoginAttemptTracker _loginAttempts;
    private readonly IFirebaseTokenVerifier _tokenVerifier;

    // IFirebaseTokenVerifier is intentionally NOT registered in Program.cs, for the same reason as IFirebaseUserService on
    // AdminUsersController: ActivatorUtilities falls back to the parameter's default, so production needs no DI change while a
    // unit test can inject a fake that returns claims instead of calling Firebase.
    public AuthController(
        OdipDbContext db,
        IConfiguration config,
        ILogger<AuthController> logger,
        ILoginAttemptTracker loginAttempts,
        ICurrentTenant currentTenant,
        IFirebaseTokenVerifier? tokenVerifier = null)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _loginAttempts = loginAttempts;
        _tokenVerifier = tokenVerifier ?? new FirebaseTokenVerifier();
        // currentTenant is intentionally unused: AuthResponseDto.StaffId (the only thing that
        // ever needed ICurrentTenant.ViewAsUserId here) was dropped per the staff/user
        // unification design spec §4.3. The parameter is kept so DI resolution and existing test
        // call sites that construct this controller with five arguments don't need to change.
    }

    /// <summary>
    /// Exchange a Firebase ID token for a Odip backend JWT with tenant and role claims.
    /// </summary>
    [HttpPost("exchange")]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponseDto>>> Exchange(
        [FromBody] ExchangeTokenDto dto, CancellationToken ct)
    {
        // Every rejection below funnels through Rejected() so the failure is always
        // counted. A path that returns Unauthorized directly would be a free retry and
        // would make the lockout bypassable by aiming at that specific case.
        var attemptKey = LoginAttemptKey();

        if (_loginAttempts.IsLockedOut(attemptKey, out var retryAfter))
        {
            _logger.LogWarning("Exchange locked out after repeated failures: {Key}", attemptKey);
            Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds))
                .ToString(CultureInfo.InvariantCulture);
            return StatusCode(
                StatusCodes.Status429TooManyRequests,
                ApiResponse<AuthResponseDto>.Fail("Too many failed sign-in attempts. Try again shortly."));
        }

        ActionResult<ApiResponse<AuthResponseDto>> Rejected(string logMessage, params object?[] logArgs)
        {
            _loginAttempts.RecordFailure(attemptKey);
            _logger.LogWarning(logMessage, logArgs);
            // The message is deliberately identical for every cause. Telling "no such user" from "that address is on
            // two rows" or "its tenant is inactive" would confirm which addresses exist.
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        // 1. Verify Firebase ID token
        IReadOnlyDictionary<string, object> claims;
        try
        {
            claims = await _tokenVerifier.VerifyIdTokenAsync(dto.IdToken, ct);
        }
        catch (FirebaseAuthException ex)
        {
            return Rejected("Firebase token verification failed: {Message}", ex.Message);
        }

        var rawEmail = claims.TryGetValue("email", out var emailClaim)
            ? emailClaim?.ToString()
            : null;

        if (string.IsNullOrWhiteSpace(rawEmail))
            return Rejected("Exchange failed — token carried no email claim");

        // Both sides of the lookups below are compared in one form (see EmailIdentity). Firebase lower-cases an address, but a user row
        // stored as typed before that rule existed is mixed-case, and an exact comparison would answer its owner with a 401.
        var email = EmailIdentity.Normalise(rawEmail);

        // Firebase issues an ID token as soon as an account is created, before the
        // owner has clicked the verification link. Without this check, anyone who
        // knows a pre-provisioned user's email (e.g. a coordinator's work address)
        // could sign up in Firebase with that address and exchange the resulting
        // unverified token for a fully authenticated ODIP session — a window that
        // stays open for as long as the real owner hasn't claimed the account.
        //
        // Accounts the app creates itself (an admin creating a user, a tenant's first user, "Send set-password email" for a user or staff
        // member who has none yet) are created VERIFIED (FirebaseUserService.BuildCreateUserArgs): nothing ever sends them a verification
        // link, so without that they could never pass this check. It does not reopen the window above. Firebase allows one email/password
        // account per address, so once the app has made the account nobody else can sign up with that address, and one made without a
        // password cannot be signed into until its owner follows the emailed set-password link, which proves they control the mailbox. An
        // account that already existed is never marked verified by the app: EnsureSignInAccountAsync and UpdateUserByEmailAsync leave it as it is.
        if (!IsEmailVerified(claims))
            return Rejected("Exchange failed — email not verified: {Email}", email);

        var domain = email.Split('@').Last();

        // 2. SuperAdmin path — bypasses tenant resolution
        var superAdminDomain = SuperAdminDomain.From(_config);
        if (domain == superAdminDomain)
        {
            var superAdmin = await _db.Users
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(u => u.Email.ToLower() == email && u.IsActive, ct);

            if (superAdmin is null)
            {
                return Rejected("SuperAdmin exchange — email not in DB: {Email}", email);
            }

            superAdmin.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            var superAdminToken = GenerateSuperAdminJwtToken(superAdmin);
            SetJwtCookie(superAdminToken);
            _loginAttempts.RecordSuccess(attemptKey);

            return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
            {
                Id = superAdmin.Id,
                Token = superAdminToken,
                ExpiresAt = DateTime.UtcNow.AddMinutes(30),
                Username = superAdmin.Username,
                FullName = superAdmin.FullName,
                Role = "SuperAdmin",
                TenantName = null,
                TenantId = null
            }));
        }

        // 3. Standard tenant path. Staff sign in with whatever address they own (their own mailbox at a provider such as gmail.com as readily as
        // the organisation's), so the domain of the address says nothing about the tenant: the tenant is the one on the user's own row. That is
        // why the lookup crosses tenants (IgnoreQueryFilters; the tenant is what is being found), and why an address that matches more than one
        // active row is refused instead of guessed at: signing in as the wrong person, in the wrong tenant, is worse than a 401. Take(2) is
        // enough to tell one from many. Tenant.EmailDomain plays no part in signing in.
        var matches = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.Email.ToLower() == email && u.IsActive)
            .Take(2)
            .ToListAsync(ct);

        if (matches.Count == 0)
        {
            return Rejected("Exchange failed — no active user has this email: {Email}", email);
        }

        if (matches.Count > 1)
        {
            return Rejected(
                "Exchange failed — email matches more than one active user ({FirstUserId} and {SecondUserId}), so nobody was signed in. " +
                "Fix the duplicate rows: {Email}", matches[0].Id, matches[1].Id, email);
        }

        var user = matches[0];

        var tenant = await _db.Tenants
            .FirstOrDefaultAsync(t => t.Id == user.TenantId && t.IsActive, ct);

        if (tenant is null)
        {
            return Rejected("Exchange failed — the tenant of user {UserId} is missing or inactive: {Email}", user.Id, email);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var tenantToken = GenerateJwtToken(user, tenant.Id);
        SetJwtCookie(tenantToken);
        _loginAttempts.RecordSuccess(attemptKey);

        return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
        {
            Id = user.Id,
            Token = tenantToken,
            ExpiresAt = DateTime.UtcNow.AddMinutes(30),
            Username = user.Username,
            FullName = user.FullName,
            Role = user.Role.ToString(),
            TenantName = tenant.Name,
            TenantId = tenant.Id
        }));
    }

    [HttpPost("logout")]
    [Authorize]
    public IActionResult Logout()
    {
        Response.Cookies.Delete("odip_jwt", new CookieOptions { Path = "/api" });
        return Ok(ApiResponse<object>.Ok(null, "Logged out."));
    }

    /// <summary>
    /// Developer-only login that bypasses Firebase entirely. Only reachable when the
    /// DEV_AUTH_ENABLED environment variable is set to "true" — otherwise this route behaves
    /// as if it does not exist. Must never be enabled on an internet-facing deployment.
    /// </summary>
    [HttpPost("dev-login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponseDto>>> DevLogin([FromBody] DevLoginDto? dto, CancellationToken ct)
    {
        if (!IsDevAuthEnabled())
            return NotFound();

        var username = string.IsNullOrEmpty(dto?.Username) ? "admin" : dto.Username;

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Username == username && u.IsActive, ct);

        if (user is null)
            return NotFound(ApiResponse<AuthResponseDto>.Fail($"Dev user '{username}' not found"));

        _logger.LogWarning("DEV AUTH: issuing token for {Username} ({Email}) — Firebase bypassed. This must never be enabled on an internet-facing deployment.", user.Username, user.Email);

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        if (user.Role == Domain.Enums.UserRole.SuperAdmin)
        {
            var superAdminToken = GenerateSuperAdminJwtToken(user);
            SetJwtCookie(superAdminToken);

            return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
            {
                Id = user.Id,
                Token = superAdminToken,
                ExpiresAt = DateTime.UtcNow.AddMinutes(30),
                Username = user.Username,
                FullName = user.FullName,
                Role = "SuperAdmin",
                TenantName = null,
                TenantId = null
            }));
        }

        var tenant = await _db.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == user.TenantId, ct);

        if (tenant is null)
            return NotFound(ApiResponse<AuthResponseDto>.Fail("Tenant not found for dev user"));

        var tenantToken = GenerateJwtToken(user, tenant.Id);
        SetJwtCookie(tenantToken);
        // Deliberately does NOT clear the /auth/exchange failure count. Dev login is a
        // bypass by design; letting it reset the lockout would hand an attacker a way to
        // clear their own on any instance running with DEV_AUTH_ENABLED.

        return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
        {
            Id = user.Id,
            Token = tenantToken,
            ExpiresAt = DateTime.UtcNow.AddMinutes(30),
            Username = user.Username,
            FullName = user.FullName,
            Role = user.Role.ToString(),
            TenantName = tenant.Name,
            TenantId = tenant.Id
        }));
    }

    /// <summary>
    /// Lists active users available for dev-login, for discovery in local/dev environments.
    /// Only reachable when DEV_AUTH_ENABLED is "true" — otherwise this route behaves as if it
    /// does not exist.
    /// </summary>
    [HttpGet("dev-users")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<IEnumerable<object>>>> DevUsers(CancellationToken ct)
    {
        if (!IsDevAuthEnabled())
            return NotFound();

        var users = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.IsActive)
            .OrderBy(u => u.Username)
            .Select(u => new
            {
                u.Username,
                Role = u.Role.ToString(),
                TenantName = u.Tenant != null ? u.Tenant.Name : null
            })
            .ToListAsync(ct);

        return Ok(ApiResponse<IEnumerable<object>>.Ok(users));
    }

    /// <summary>
    /// Diagnostic-only endpoint for investigating rate-limit partitioning behind nginx /
    /// Docker's published-port NAT. Returns exactly what the server resolves for this request
    /// — the post-forwarded-header client IP/port, the raw forwarded headers as received, and
    /// the exact partition key the "login" rate limiter would use — so a partition-key mismatch
    /// for real external clients can be diagnosed instead of guessed at. Only reachable when
    /// DEV_AUTH_ENABLED is "true" — otherwise this route behaves as if it does not exist.
    /// </summary>
    [HttpGet("dev-whoami")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public IActionResult DevWhoAmi()
    {
        if (!IsDevAuthEnabled())
            return NotFound();

        var connection = HttpContext.Connection;

        return Ok(ApiResponse<object>.Ok(new
        {
            remoteIpAddress = connection.RemoteIpAddress?.ToString(),
            remotePort = connection.RemotePort,
            xForwardedFor = Request.Headers["X-Forwarded-For"].ToString(),
            xRealIp = Request.Headers["X-Real-IP"].ToString(),

            // The key the "login" limiter ACTUALLY partitioned on, recorded by the policy
            // delegate itself (Program.cs RecordLimiterPartitionKey) rather than
            // re-derived here. An earlier version of this endpoint recomputed the key from
            // Connection.RemoteIpAddress at controller time and reported a value the
            // limiter never used, which turned a real partitioning bug into a mystery.
            // Null means the limiter did not run for this request at all — itself the
            // answer to "why is this endpoint not being limited?".
            limiterPartitionKey = HttpContext.Items.TryGetValue("__odip.limiterPartitionKey", out var k) ? k : null,
            // Controller-time view, kept only so the two can be compared. If these
            // disagree, trust limiterPartitionKey.
            controllerTimeIp = connection.RemoteIpAddress?.ToString()

        }));
    }

    // Same notion of "a client" the rate limiter uses (Program.cs RateLimitPartitionKey):
    // post-forwarded-header remote IP, falling back to the per-request TraceIdentifier so
    // an unresolvable address can never bucket every caller together. Behind shared egress
    // this is one key for several people, which is exactly why only FAILURES are counted.
    private string LoginAttemptKey() =>
        HttpContext.Connection.RemoteIpAddress?.ToString() ?? HttpContext.TraceIdentifier;

    private static bool IsDevAuthEnabled()
        => string.Equals(Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED"), "true", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// True when the decoded Firebase token's "email_verified" claim is present and true.
    /// Public (rather than private, unlike the controller's other claim helpers) specifically
    /// so it can be unit tested directly: Exchange's full flow depends on the sealed,
    /// non-DI FirebaseAuth.DefaultInstance.VerifyIdTokenAsync, which cannot be exercised in an
    /// offline unit test without adding a Firebase abstraction layer — out of scope for this
    /// hardening task. Accepts both the bool and string claim representations since Firebase
    /// Admin SDK claim values arrive boxed as System.Object.
    /// </summary>
    public static bool IsEmailVerified(IReadOnlyDictionary<string, object> claims)
    {
        if (!claims.TryGetValue("email_verified", out var value) || value is null)
            return false;

        return value switch
        {
            bool b => b,
            string s => bool.TryParse(s, out var parsed) && parsed,
            _ => false
        };
    }

    private void SetJwtCookie(string token)
    {
        Response.Cookies.Append("odip_jwt", token, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Expires = DateTimeOffset.UtcNow.AddDays(7),
            Path = "/api"
        });
    }

    private string GenerateJwtToken(Domain.Entities.User user, Guid tenantId)
    {
        var key = GetSigningKey();
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim("fullName", user.FullName),
            new Claim("tenant_id", tenantId.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: "Odip",
            audience: "Odip",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private string GenerateSuperAdminJwtToken(Domain.Entities.User user)
    {
        var key = GetSigningKey();
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, "SuperAdmin"),
            new Claim("fullName", user.FullName)
        };

        var token = new JwtSecurityToken(
            issuer: "Odip",
            audience: "Odip",
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private SymmetricSecurityKey GetSigningKey()
    {
        var secret = _config["Jwt:Secret"];
        if (string.IsNullOrEmpty(secret))
            secret = Environment.GetEnvironmentVariable("JWT_SECRET");
        if (string.IsNullOrEmpty(secret))
            throw new InvalidOperationException("JWT_SECRET must be configured.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
    }
}
