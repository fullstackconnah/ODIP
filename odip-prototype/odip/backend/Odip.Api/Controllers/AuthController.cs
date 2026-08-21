using System.Globalization;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Odip.Application.Common;
using Odip.Application.Interfaces;
using Odip.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
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

    public AuthController(
        OdipDbContext db,
        IConfiguration config,
        ILogger<AuthController> logger,
        ILoginAttemptTracker loginAttempts)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _loginAttempts = loginAttempts;
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
            // The message is deliberately identical for every cause. Distinguishing
            // "unknown domain" from "user not found" would confirm which addresses exist.
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        // 1. Verify Firebase ID token
        FirebaseToken decodedToken;
        try
        {
            decodedToken = await FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(dto.IdToken, ct);
        }
        catch (FirebaseAuthException ex)
        {
            return Rejected("Firebase token verification failed: {Message}", ex.Message);
        }

        var email = decodedToken.Claims.TryGetValue("email", out var emailClaim)
            ? emailClaim?.ToString()
            : null;

        if (string.IsNullOrEmpty(email))
            return Rejected("Exchange failed — token carried no email claim");

        var domain = email.Split('@').Last().ToLower();

        // 2. SuperAdmin path — bypasses tenant resolution
        var superAdminDomain = _config["Auth:SuperAdminDomain"] ?? "odip.com.au";
        if (domain == superAdminDomain)
        {
            var superAdmin = await _db.Users
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(u => u.Email == email && u.IsActive, ct);

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
                Token = superAdminToken,
                ExpiresAt = DateTime.UtcNow.AddMinutes(30),
                Username = superAdmin.Username,
                FullName = superAdmin.FullName,
                Role = "SuperAdmin",
                TenantName = null,
                TenantId = null
            }));
        }

        // 3. Standard tenant path
        var tenant = await _db.Tenants
            .FirstOrDefaultAsync(t => t.EmailDomain == domain && t.IsActive, ct);

        if (tenant is null)
        {
            return Rejected("Exchange failed — unknown email domain: {Domain}", domain);
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Email == email && u.TenantId == tenant.Id && u.IsActive, ct);

        if (user is null)
        {
            return Rejected("Exchange failed — user not found in tenant: {Email}", email);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var tenantToken = GenerateJwtToken(user, tenant.Id);
        SetJwtCookie(tenantToken);
        _loginAttempts.RecordSuccess(attemptKey);

        return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
        {
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
