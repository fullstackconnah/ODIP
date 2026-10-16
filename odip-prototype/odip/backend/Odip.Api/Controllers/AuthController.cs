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
using Odip.Infrastructure.Services;

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
        //
        // A null key means the client address cannot be told apart from the proxy, so
        // the caller is UNKNOWN and there is no budget that is theirs alone to spend.
        // Counting anyway would be counting against a key every client on the internet
        // shares — the denial of service this is here to prevent. See ClientIp.
        var attemptKey = LoginAttemptKey();

        // The lockout is checked up front so a locked-out client's failures answer
        // 429 straight away, but it is NOT the whole defence and it is not final.
        //
        // It keys on an ADDRESS, and an address is not always one person: behind
        // shared egress (a NAT, and in this deployment the proxy hop itself) several
        // people legitimately share one. Refusing at this point would lock out a
        // genuine holder of a valid credential because of a stranger's failures —
        // and the address cannot be relied on to tell them apart.
        //
        // So this only RECORDS the state. The token is still verified below, and a
        // real, valid credential always wins: it returns 200 whatever the counter
        // says. Brute-force protection is not weakened, because a token that does
        // not verify cannot pass — the Firebase verification is the cost of a guess,
        // and an unverified caller reaches no ODIP data on any path.
        var isLockedOut = false;
        var lockedOutRetryAfter = TimeSpan.Zero;
        if (attemptKey is not null)
            isLockedOut = _loginAttempts.IsLockedOut(attemptKey, out lockedOutRetryAfter);

        if (isLockedOut)
        {
            _logger.LogWarning("Exchange attempt from a locked-out client, verifying the token anyway: {Key}", attemptKey);
        }

        ActionResult<ApiResponse<AuthResponseDto>> Rejected(string code, string logMessage, params object?[] logArgs)
        {
            if (attemptKey is not null)
                _loginAttempts.RecordFailure(attemptKey);
            _logger.LogWarning(logMessage, logArgs);

            // A locked-out client is told so — that is the whole point of the counter —
            // but only once the token has failed, so the 429 means "your token was no
            // good AND this address is over its budget", never "your token was not
            // even looked at".
            if (isLockedOut)
            {
                // Only a refusal carries it: a valid token that wins during a lockout must not.
                Response.Headers.RetryAfter = ((int)Math.Ceiling(lockedOutRetryAfter.TotalSeconds))
                    .ToString(CultureInfo.InvariantCulture);
                return StatusCode(
                    StatusCodes.Status429TooManyRequests,
                    ApiResponse<AuthResponseDto>.Fail(ExchangeRefusal.MessageFor(ExchangeRefusal.LockedOut), ExchangeRefusal.LockedOut));
            }

            // Still a 401, and still counted. The code says why, so the sign-in page can tell the person what to do. That is safe because of the order
            // the checks run in (see ExchangeRefusal): everything that depends on ODIP's own rows is decided only after the token's email is verified and
            // its provider allowed, i.e. only for someone who controls the mailbox, and about their own address; an unverified token (which anyone can
            // get for any address) gets the same answer whether or not ODIP knows the address. InvalidToken stays generic.
            return Unauthorized(ApiResponse<AuthResponseDto>.Fail(ExchangeRefusal.MessageFor(code), code));
        }

        // The token must at least HAVE the shape of one before the SDK is asked to parse it. A token that is not three
        // base64url segments cannot be a Firebase token, and the SDK's parse of one is not a defined failure: an all-dots
        // token such as ".." makes it throw NullReferenceException (see FirebaseIdTokenShape). Refusing it here keeps that
        // SDK defect out of the request path AND spends the failure budget like every other refusal, which is the point:
        // without the spend this one shape would be a free retry.
        if (!FirebaseIdTokenShape.LooksLikeAnIdToken(dto.IdToken))
            return Rejected(ExchangeRefusal.InvalidToken, "Exchange failed — the token is not shaped like a Firebase ID token");

        // 1. Verify Firebase ID token
        IReadOnlyDictionary<string, object> claims;
        try
        {
            claims = await _tokenVerifier.VerifyIdTokenAsync(dto.IdToken, ct);
        }
        catch (FirebaseAuthException ex)
        {
            return Rejected(ExchangeRefusal.InvalidToken, "Firebase token verification failed: {Message}", ex.Message);
        }
        catch (Exception ex) when (FirebaseTokenParseFailures.IsUndecodableToken(ex))
        {
            // The SDK could not DECODE the token, as distinct from refusing one it read (FirebaseAuthException, above).
            // Malformed input reaches the decoders: "aaa.bbb.ccc" is three legal base64url segments that are not a JWT, so
            // parsing gets as far as the payload and fails as JsonReaderException, which derives from JsonException and is
            // therefore not an ArgumentException. Letting that escape returned HTTP 500 and, because it never returned
            // through Rejected(), did not spend the failure budget either — which is what made the lockout bypassable by aiming
            // at this one shape. Measured against FirebaseAdmin 3.5.0; see FirebaseTokenParseFailures.
            // The response stays the generic InvalidToken, which is what the shape deserves: nothing about it is actionable, and a
            // fault in the SDK must not pose as one of the more specific codes. Only these types are caught (never by message and
            // never a catch-all), so a genuine fault elsewhere still surfaces as a 500 rather than being laundered into a 401.
            return Rejected(ExchangeRefusal.InvalidToken, "Firebase token could not be decoded: {Type}: {Message}", ex.GetType().Name, ex.Message);
        }

        var rawEmail = claims.TryGetValue("email", out var emailClaim)
            ? emailClaim?.ToString()
            : null;

        if (string.IsNullOrWhiteSpace(rawEmail))
            return Rejected(ExchangeRefusal.InvalidToken, "Exchange failed — token carried no email claim");

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
            return Rejected(ExchangeRefusal.EmailNotVerified, "Exchange failed — email not verified: {Email}", email);

        // How the person signed in decides what "verified" proves (see SignInProviders), so a token from a provider that is not listed is refused,
        // and so is one that does not say which it came from. Both paths below come after this.
        var provider = SignInProviders.From(claims);
        if (provider is null)
        {
            claims.TryGetValue("firebase", out var firebaseClaim);
            // A claim the exchange cannot read is a fault with the token (or the SDK), not something the person can act on, so it stays the generic
            // InvalidToken rather than posing as "that sign-in method is not enabled" to someone who did use email and password.
            return Rejected(
                ExchangeRefusal.InvalidToken,
                "Exchange failed — token carried no readable firebase.sign_in_provider (the firebase claim is {ClaimType}): {Email}",
                firebaseClaim?.GetType().Name ?? "missing", email);
        }

        if (!SignInProviders.Allowed(_config).Contains(provider))
            return Rejected(
                ExchangeRefusal.ProviderNotAllowed,
                "Exchange failed — sign-in provider {Provider} is not allowed (see {ConfigKey}): {Email}", provider, SignInProviders.ConfigKey, email);

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
                return Rejected(ExchangeRefusal.NoOdipAccount, "SuperAdmin exchange — email not in DB: {Email}", email);
            }

            superAdmin.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            var superAdminToken = GenerateSuperAdminJwtToken(superAdmin);
            SetJwtCookie(superAdminToken);
            if (attemptKey is not null)
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
        // enough to tell one from many, and the order makes the two ids the refusal's log line names the same two every time. Tenant.EmailDomain
        // plays no part in signing in.
        var matches = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.Email.ToLower() == email && u.IsActive)
            .OrderBy(u => u.Id)
            .Take(2)
            .ToListAsync(ct);

        if (matches.Count == 0)
        {
            return Rejected(ExchangeRefusal.NoOdipAccount, "Exchange failed — no active user has this email: {Email}", email);
        }

        if (matches.Count > 1)
        {
            return Rejected(
                ExchangeRefusal.Ambiguous,
                "Exchange failed — email matches more than one active user ({FirstUserId} and {SecondUserId}), so nobody was signed in. " +
                "Fix the duplicate rows: {Email}", matches[0].Id, matches[1].Id, email);
        }

        var user = matches[0];

        var tenant = await _db.Tenants
            .FirstOrDefaultAsync(t => t.Id == user.TenantId && t.IsActive, ct);

        if (tenant is null)
        {
            return Rejected(ExchangeRefusal.TenantInactive, "Exchange failed — the tenant of user {UserId} is missing or inactive: {Email}", user.Id, email);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var tenantToken = GenerateJwtToken(user, tenant.Id);
        SetJwtCookie(tenantToken);
        if (attemptKey is not null)
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
            controllerTimeIp = connection.RemoteIpAddress?.ToString(),

            // Whether this address can actually tell clients apart, and so whether
            // the sign-in failure budget is per-client at all. True here is the
            // docker-proxy shape: nginx's $remote_addr was already rewritten to the
            // bridge gateway, so one key is shared by every caller and sign-in
            // failures are deliberately not counted (ClientIp.LoginAttemptKey).
            clientIndistinguishableFromProxy = ClientIp.IsIndistinguishableFromProxy(HttpContext),
            // Null exactly when the address is the proxy's — see above.
            loginAttemptKey = ClientIp.LoginAttemptKey(HttpContext)

        }));
    }

    // Which client's failure budget this attempt spends from. Returns null when
    // the caller cannot be told apart from the proxy (ClientIp.LoginAttemptKey),
    // which is the deployed shape: counting then would be counting against a key
    // EVERY client shares, so one noisy caller locks out everyone. A null key
    // means the attempt is not counted and is not locked out.
    private string? LoginAttemptKey() => ClientIp.LoginAttemptKey(HttpContext);

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
