using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Odip.Application.Common;
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

    public AuthController(OdipDbContext db, IConfiguration config, ILogger<AuthController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Exchange a Firebase ID token for a Odip backend JWT with tenant and role claims.
    /// </summary>
    [HttpPost("exchange")]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponseDto>>> Exchange(
        [FromBody] ExchangeTokenDto dto, CancellationToken ct)
    {
        // 1. Verify Firebase ID token
        FirebaseToken decodedToken;
        try
        {
            decodedToken = await FirebaseAuth.DefaultInstance.VerifyIdTokenAsync(dto.IdToken, ct);
        }
        catch (FirebaseAuthException ex)
        {
            _logger.LogWarning("Firebase token verification failed: {Message}", ex.Message);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        var email = decodedToken.Claims.TryGetValue("email", out var emailClaim)
            ? emailClaim?.ToString()
            : null;

        if (string.IsNullOrEmpty(email))
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));

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
                _logger.LogWarning("SuperAdmin exchange — email not in DB: {Email}", email);
                return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
            }

            superAdmin.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            var superAdminToken = GenerateSuperAdminJwtToken(superAdmin);
            SetJwtCookie(superAdminToken);

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
            _logger.LogWarning("Exchange failed — unknown email domain: {Domain}", domain);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Email == email && u.TenantId == tenant.Id && u.IsActive, ct);

        if (user is null)
        {
            _logger.LogWarning("Exchange failed — user not found in tenant: {Email}", email);
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail("Invalid or expired token"));
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var tenantToken = GenerateJwtToken(user, tenant.Id);
        SetJwtCookie(tenantToken);

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
            // Mirrors Program.cs's RateLimitPartitionKey(HttpContext) exactly — same
            // post-forwarded-header RemoteIpAddress, same TraceIdentifier fallback — so this
            // can never silently drift from what the "login" limiter actually partitions on.
            // If RateLimitPartitionKey's logic changes, this must change with it.
            partitionKeyWouldBe = connection.RemoteIpAddress?.ToString() ?? HttpContext.TraceIdentifier
        }));
    }

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
