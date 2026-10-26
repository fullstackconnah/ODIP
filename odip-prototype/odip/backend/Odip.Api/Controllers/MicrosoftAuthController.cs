using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using Odip.Api.Services;
using Odip.Api.Services.Microsoft;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications.Templates;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Sign in with Microsoft (ms-sso spec 2026-10-26). start and callback are a browser navigation, so they answer with redirects to fixed paths and
/// never JSON. The callback has no ODIP session (odip_jwt is SameSite=Strict, so the browser does not send it on Entra's cross-site return): the
/// start-time user is bound inside the protected correlation cookie and re-read from the database at the callback. Every read there ignores the tenant
/// filter and names its tenant or tid, because the ambient tenant is none.
/// </summary>
[ApiController]
[Route("api/v1/auth/microsoft")]
public class MicrosoftAuthController : ControllerBase
{
    public const string CorrelationCookie = "odip_ms_corr";
    public const string RefreshCookie = "odip_ms_refresh";
    public const string CookiePath = "/api/v1/auth/microsoft";
    public const string AuditActor = "Microsoft sign-in";
    private static readonly TimeSpan CorrelationLife = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RefreshLife = TimeSpan.FromHours(12);
    private static readonly UserRole[] GrantableRoles = [UserRole.Coordinator, UserRole.SupportWorker, UserRole.ReadOnly];

    private readonly OdipDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<MicrosoftAuthController> _logger;
    private readonly ILoginAttemptTracker _attempts;
    private readonly IMicrosoftCodeRedeemer _redeemer;
    private readonly IMicrosoftIdTokenValidator _validator;
    private readonly IDataProtector _correlation;
    private readonly IDataProtector _refresh;
    private readonly IMemoryCache _cache;
    private readonly TimeProvider _clock;
    private readonly StaffCreateService _staff;
    private readonly INotificationRaiser _raiser;
    private readonly IFirebaseUserService _firebase;

    private string? _attemptKey;
    private bool _lockedOut;

    // IFirebaseUserService is optional for the same reason as on AdminUsersController: production needs no DI entry, a test injects a fake.
    public MicrosoftAuthController(
        OdipDbContext db, IConfiguration config, ILogger<MicrosoftAuthController> logger, ILoginAttemptTracker attempts,
        IMicrosoftCodeRedeemer redeemer, IMicrosoftIdTokenValidator validator, IDataProtectionProvider dataProtection,
        IMemoryCache cache, TimeProvider clock, StaffCreateService staff, INotificationRaiser raiser, IFirebaseUserService? firebase = null)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _attempts = attempts;
        _redeemer = redeemer;
        _validator = validator;
        _correlation = dataProtection.CreateProtector("Odip.MicrosoftSignIn.Correlation.v1");
        _refresh = dataProtection.CreateProtector("Odip.MicrosoftSignIn.Refresh.v1");
        _cache = cache;
        _clock = clock;
        _staff = staff;
        _raiser = raiser;
        _firebase = firebase ?? new FirebaseUserService();
    }

    private sealed record Correlation(string State, string Nonce, string CodeVerifier, string Intent, Guid? UserId, Guid? OrgId, UserRole? DefaultRole, DateTimeOffset IssuedAt);
    private sealed record RefreshTicket(Guid UserId, Guid MicrosoftTenantId, Guid MicrosoftObjectId, DateTimeOffset IssuedAt);

    // ── Start ────────────────────────────────────────────────────────────

    [HttpGet("start")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public IActionResult Start([FromQuery] string? intent, [FromQuery] string? defaultRole)
    {
        var cfg = MicrosoftSignInConfig.From(_config);
        if (cfg is null) return NotFound();

        // The correlation cookie is Secure and host-bound: started on any other host it would never come back, and the person would land on a
        // refusal that counts against them. Send them to the configured host instead (the intent only; nothing else is carried).
        // shortcut: compares the host, not the scheme, because behind two proxies the forwarded scheme is not reliable.
        if (Uri.TryCreate(cfg.PublicBaseUrl, UriKind.Absolute, out var publicUri)
            && !string.Equals(Request.Host.Host, publicUri.Host, StringComparison.OrdinalIgnoreCase))
            return Redirect(cfg.StartUrl(Uri.EscapeDataString(intent ?? "")));

        BeginAttempt();
        var path = MicrosoftSignInPaths.For(intent ?? "");

        Guid? userId = null, orgId = null;
        UserRole? role = null;
        if (intent is MicrosoftIntent.LinkTenant or MicrosoftIntent.LinkAccount)
        {
            if (User.Identity?.IsAuthenticated != true
                || !Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid)
                || !Guid.TryParse(User.FindFirstValue("tenant_id"), out var oid))
                return Refuse(MicrosoftRefusal.SignInRequired, path, "Microsoft start - {Intent} needs a signed-in user", intent);
            (userId, orgId) = (uid, oid);
            var claimRole = User.FindFirstValue(ClaimTypes.Role);

            if (intent == MicrosoftIntent.LinkTenant)
            {
                if (claimRole != nameof(UserRole.Admin)) return Refuse(MicrosoftRefusal.MicrosoftAdminOnly, path, "Microsoft start - link-tenant by a non-Admin ({Role})", claimRole);
                role = UserRole.ReadOnly;
                if (!string.IsNullOrEmpty(defaultRole))
                {
                    role = GrantableRoles.Cast<UserRole?>().FirstOrDefault(r => string.Equals(r.ToString(), defaultRole, StringComparison.OrdinalIgnoreCase));
                    if (role is null) return Refuse(MicrosoftRefusal.InvalidToken, path, "Microsoft start - default role {Role} is not grantable", defaultRole);
                }
                if (OrgLinks(oid).Any()) return Refuse(MicrosoftRefusal.MicrosoftOrgAlreadyLinked, path, "Microsoft start - org {Org} is already linked", oid);
            }
            else
            {
                if (claimRole == nameof(UserRole.SuperAdmin)) return Refuse(MicrosoftRefusal.SignInRequired, path, "Microsoft start - link-account by a SuperAdmin");
                if (!OrgLinks(oid).Any()) return Refuse(MicrosoftRefusal.MicrosoftNotLinked, path, "Microsoft start - org {Org} is not linked", oid);
                var own = _db.Users.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefault(u => u.Id == uid && u.TenantId == oid);
                if (own is null) return Refuse(MicrosoftRefusal.MicrosoftSessionChanged, path, "Microsoft start - user {User} not found in org {Org}", uid, oid);
                if (own.MicrosoftObjectId is not null) return Refuse(MicrosoftRefusal.MicrosoftAccountAlreadyLinked, path, "Microsoft start - user {User} already has an identity", uid);
            }
        }
        else if (intent != MicrosoftIntent.SignIn)
        {
            return Refuse(MicrosoftRefusal.InvalidToken, MicrosoftSignInPaths.SignInRefusal, "Microsoft start - unknown intent {Intent}", intent);
        }

        var corr = new Correlation(Random32(), Random32(), Random32(), intent!, userId, orgId, role, _clock.GetUtcNow());
        Response.Cookies.Append(CorrelationCookie, _correlation.Protect(JsonSerializer.Serialize(corr)), new CookieOptions
        {
            HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax, Path = CookiePath, MaxAge = CorrelationLife,
        });

        var challenge = WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(corr.CodeVerifier)));
        return Redirect(QueryHelpers.AddQueryString("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize", new Dictionary<string, string?>
        {
            ["client_id"] = cfg.ClientId,
            ["response_type"] = "code",
            ["redirect_uri"] = cfg.RedirectUri,
            ["response_mode"] = "query",
            ["scope"] = "openid profile email",
            ["state"] = corr.State,
            ["nonce"] = corr.Nonce,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = "S256",
            ["prompt"] = "select_account",
        }));
    }

    // ── Callback ─────────────────────────────────────────────────────────

    [HttpGet("callback")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error, CancellationToken ct)
    {
        var cfg = MicrosoftSignInConfig.From(_config);
        if (cfg is null) return NotFound();
        BeginAttempt();

        // The cookie is single-use whatever happens next.
        var cookie = Request.Cookies[CorrelationCookie];
        Response.Cookies.Delete(CorrelationCookie, new CookieOptions { Path = CookiePath });

        var corr = ReadCorrelation(cookie);
        if (corr is null) return Refuse(MicrosoftRefusal.InvalidToken, MicrosoftSignInPaths.SignInRefusal, "Microsoft callback - no usable correlation cookie");
        var path = MicrosoftSignInPaths.For(corr.Intent);

        if (string.IsNullOrEmpty(state) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(state), Encoding.UTF8.GetBytes(corr.State)))
            return Refuse(MicrosoftRefusal.InvalidToken, path, "Microsoft callback - state does not match");
        // Single use beyond deleting the cookie: a replayed callback (same cookie, same state) is refused.
        // shortcut: in-memory, one API container; move to a table if the API is ever scaled out.
        if (_cache.TryGetValue("ms-state:" + state, out _)) return Refuse(MicrosoftRefusal.InvalidToken, path, "Microsoft callback - state was already used");
        _cache.Set("ms-state:" + state, true, CorrelationLife);

        // The person pressed Cancel at Microsoft. No guess is involved, so it does not spend the failure budget.
        if (!string.IsNullOrEmpty(error)) return RefuseUncounted(MicrosoftRefusal.MicrosoftCancelled, path, "Microsoft callback - Entra sent error {Error}", error);
        if (string.IsNullOrEmpty(code)) return Refuse(MicrosoftRefusal.InvalidToken, path, "Microsoft callback - no code");

        var idToken = await _redeemer.RedeemAsync(code, corr.CodeVerifier, cfg.RedirectUri, ct);
        if (idToken is null) return Refuse(MicrosoftRefusal.InvalidToken, path, "Microsoft callback - the code could not be redeemed");

        MicrosoftIdTokenResult validated;
        try
        {
            validated = await _validator.ValidateAsync(idToken, corr.Nonce, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Entra's metadata could not be fetched: a fault of ours, not a guess, so it is not counted.
            _logger.LogError(ex, "Microsoft callback - the ID token could not be validated");
            return RefuseUncounted(MicrosoftRefusal.InvalidToken, path, "Microsoft callback - validation failed");
        }
        if (validated.Identity is not { } identity)
            return Refuse(validated.Refusal ?? MicrosoftRefusal.InvalidToken, path, "Microsoft callback - the ID token was refused ({Code})", validated.Refusal);

        // Everything below writes as nobody in particular (anonymous request); the audit rows say where it came from.
        HttpContext.Items[AuditInterceptor.ActorItemKey] = AuditActor;

        return corr.Intent switch
        {
            MicrosoftIntent.SignIn => await SignInAsync(identity, ct),
            MicrosoftIntent.LinkTenant => await LinkTenantAsync(corr, identity, ct),
            MicrosoftIntent.LinkAccount => await LinkAccountAsync(corr, identity, ct),
            _ => Refuse(MicrosoftRefusal.InvalidToken, path, "Microsoft callback - unknown intent {Intent}", corr.Intent),
        };
    }

    private async Task<IActionResult> SignInAsync(MicrosoftIdentity id, CancellationToken ct)
    {
        const string path = MicrosoftSignInPaths.SignInRefusal;
        var link = await _db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefaultAsync(l => l.MicrosoftTenantId == id.TenantId, ct);
        if (link is null) return Refuse(MicrosoftRefusal.MicrosoftNotLinked, path, "Microsoft sign-in - tid {Tid} is not linked", id.TenantId);
        var org = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == link.TenantId, ct);
        if (org is null || !org.IsActive) return Refuse(MicrosoftRefusal.TenantInactive, path, "Microsoft sign-in - org {Org} is missing or inactive", link.TenantId);

        var row = await FindByIdentityAsync(id.TenantId, id.ObjectId, ct);
        if (row is not null)
        {
            if (!row.IsActive || row.Role == UserRole.SuperAdmin) return Refuse(MicrosoftRefusal.NoOdipAccount, path, "Microsoft sign-in - user {User} is inactive or SuperAdmin", row.Id);
            if (row.TenantId != link.TenantId)
                return Refuse(MicrosoftRefusal.MicrosoftNotLinked, path, "Microsoft sign-in - user {User} belongs to org {Org}, the tid is linked to {Link}", row.Id, row.TenantId, link.TenantId);
            return await CompleteSignInAsync(row, ct);
        }

        if (string.IsNullOrWhiteSpace(id.Email)) return Refuse(MicrosoftRefusal.MicrosoftNoEmail, path, "Microsoft sign-in - the token carries no email");
        var email = EmailIdentity.Normalise(id.Email);
        if (PlaceholderEmail.Covers(email)) return Refuse(MicrosoftRefusal.MicrosoftCannotCreate, path, "Microsoft sign-in - placeholder address {Email}", email);
        // Never join an existing person by their address: the claim is controlled by the linked directory's admin, so a match is only ever a prompt to link from inside.
        if (await _db.Users.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(u => u.Email.ToLower() == email, ct))
            return Refuse(MicrosoftRefusal.MicrosoftLinkFromAccount, path, "Microsoft sign-in - an ODIP user already has {Email}", email);
        // A row is created only from an address its domain owner has verified (xms_edov), whatever the domain.
        if (!id.EmailDomainVerified) return Refuse(MicrosoftRefusal.MicrosoftCannotCreate, path, "Microsoft sign-in - the email domain of {Email} is not verified", email);

        var (first, last) = Names(id, email);
        var staged = await _staff.StageAsync(new CreateStaffDto
        {
            FirstName = first, LastName = last, Email = email, Role = link.DefaultRole, IsActive = true, AddressConfirmed = true,
        }, null, link.TenantId, ct);
        if (staged.User is not { } created)
            return Refuse(MicrosoftRefusal.MicrosoftCannotCreate, path, "Microsoft sign-in - the row for {Email} was refused: {Error}", email, staged.Error);
        created.TenantId = link.TenantId;
        created.MicrosoftTenantId = id.TenantId;
        created.MicrosoftObjectId = id.ObjectId;
        created.LastLoginAt = _clock.GetUtcNow().UtcDateTime;

        var admins = await _db.Users.IgnoreQueryFilters([TenantFilter.Name])
            .Where(u => u.TenantId == link.TenantId && u.IsActive && u.Role == UserRole.Admin).ToListAsync(ct);
        foreach (var admin in admins)
            await _raiser.RaiseAsync(NotificationEventType.StaffJoinedViaMicrosoft, "User", created.Id, new[] { admin.Id },
                new StaffJoinedViaMicrosoftPayload(admin.Email, created.Id, created.FullName, created.Email, created.Role.ToString()), ct);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg)
        {
            // Drops the staged user, outbox and bell rows: the request that lost the race raises nothing.
            _db.ChangeTracker.Clear();
            // The same person signing in twice at once trips the email index or the identity index, whichever Postgres checks first: either way the winner holds this (tid, oid).
            if (pg.ConstraintName is Odip.Domain.Entities.User.MicrosoftIdentityIndexName or EmailIndexName)
            {
                var winner = await FindByIdentityAsync(id.TenantId, id.ObjectId, ct);
                if (winner is { IsActive: true } && winner.Role != UserRole.SuperAdmin && winner.TenantId == link.TenantId)
                    return StartSession(winner);
                if (pg.ConstraintName == Odip.Domain.Entities.User.MicrosoftIdentityIndexName)
                    return Refuse(MicrosoftRefusal.MicrosoftLinkFromAccount, path, "Microsoft sign-in - lost the first-sign-in race for {Email}", email);
            }
            // The address was taken meanwhile; any other constraint (the username) is a fault to look at.
            _logger.LogWarning("Microsoft sign-in - unique violation {Constraint} creating {Email}", pg.ConstraintName, email);
            return Refuse(pg.ConstraintName == EmailIndexName ? MicrosoftRefusal.MicrosoftLinkFromAccount : MicrosoftRefusal.MicrosoftCannotCreate,
                path, "Microsoft sign-in - {Email} could not be saved", email);
        }
        return StartSession(created);
    }

    private const string EmailIndexName = "IX_Users_Email";

    private async Task<IActionResult> CompleteSignInAsync(User row, CancellationToken ct)
    {
        row.LastLoginAt = _clock.GetUtcNow().UtcDateTime;
        await _db.SaveChangesAsync(ct);
        return StartSession(row);
    }

    /// <summary>The ODIP session cookie, and the 12-hour absolute refresh cookie (refresh never re-issues it).</summary>
    private IActionResult StartSession(User row)
    {
        OdipSession.SetCookie(Response, OdipSession.Token(row, row.TenantId, _config));
        var issued = _clock.GetUtcNow();
        Response.Cookies.Append(RefreshCookie, _refresh.Protect(JsonSerializer.Serialize(new RefreshTicket(row.Id, row.MicrosoftTenantId!.Value, row.MicrosoftObjectId!.Value, issued))), new CookieOptions
        {
            HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = CookiePath, Expires = issued + RefreshLife,
        });
        if (_attemptKey is not null) _attempts.RecordSuccess(_attemptKey);
        return LocalRedirect(MicrosoftSignInPaths.SignInSuccess);
    }

    private async Task<IActionResult> LinkTenantAsync(Correlation corr, MicrosoftIdentity id, CancellationToken ct)
    {
        const string path = MicrosoftSignInPaths.LinkTenant;
        var admin = await ReStartedUserAsync(corr, ct);
        if (admin is null || admin.Role != UserRole.Admin) return Refuse(MicrosoftRefusal.MicrosoftSessionChanged, path, "Microsoft link-tenant - the starting admin is gone, inactive, moved or no longer Admin");
        var org = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == admin.TenantId, ct);
        if (org is null || !org.IsActive) return Refuse(MicrosoftRefusal.TenantInactive, path, "Microsoft link-tenant - org {Org} is inactive", admin.TenantId);

        var links = _db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]);
        if (await links.AnyAsync(l => l.TenantId == admin.TenantId, ct)) return Refuse(MicrosoftRefusal.MicrosoftOrgAlreadyLinked, path, "Microsoft link-tenant - org {Org} is already linked", admin.TenantId);
        if (await links.AnyAsync(l => l.MicrosoftTenantId == id.TenantId, ct)) return Refuse(MicrosoftRefusal.MicrosoftTenantTaken, path, "Microsoft link-tenant - tid {Tid} belongs to another org", id.TenantId);

        var now = _clock.GetUtcNow().UtcDateTime;
        var link = new MicrosoftTenantLink
        {
            Id = Guid.NewGuid(), TenantId = admin.TenantId, MicrosoftTenantId = id.TenantId, DefaultRole = corr.DefaultRole ?? UserRole.ReadOnly,
            LinkedByUserId = admin.Id, LinkedAt = now, UpdatedAt = now,
        };
        _db.MicrosoftTenantLinks.Add(link);
        var actor = ActorFor(admin);
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(MicrosoftTenantLink), link.Id, "Microsoft tenant", null, id.TenantId.ToString(), actor));

        // The admin who links the directory is the obvious first person in it: link their own row too, when this account is free.
        if (admin.MicrosoftObjectId is null
            && !await _db.Users.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(u => u.MicrosoftTenantId == id.TenantId && u.MicrosoftObjectId == id.ObjectId, ct))
        {
            admin.MicrosoftTenantId = id.TenantId;
            admin.MicrosoftObjectId = id.ObjectId;
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(Odip.Domain.Entities.User), admin.Id, "Microsoft account", null, id.ObjectId.ToString(), actor));
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg)
        {
            _db.ChangeTracker.Clear();
            return Refuse(pg.ConstraintName == MicrosoftTenantLink.OrganisationIndexName ? MicrosoftRefusal.MicrosoftOrgAlreadyLinked : MicrosoftRefusal.MicrosoftTenantTaken,
                path, "Microsoft link-tenant - unique violation {Constraint}", pg.ConstraintName);
        }
        return LocalRedirect(MicrosoftSignInPaths.WithOutcome(path, "linked"));
    }

    private async Task<IActionResult> LinkAccountAsync(Correlation corr, MicrosoftIdentity id, CancellationToken ct)
    {
        const string path = MicrosoftSignInPaths.LinkAccount;
        var user = await ReStartedUserAsync(corr, ct);
        if (user is null || user.Role == UserRole.SuperAdmin) return Refuse(MicrosoftRefusal.MicrosoftSessionChanged, path, "Microsoft link-account - the starting user is gone, inactive or moved");
        var link = await OrgLinks(user.TenantId).FirstOrDefaultAsync(ct);
        if (link is null) return Refuse(MicrosoftRefusal.MicrosoftNotLinked, path, "Microsoft link-account - org {Org} is not linked", user.TenantId);
        if (link.MicrosoftTenantId != id.TenantId) return Refuse(MicrosoftRefusal.MicrosoftWrongTenant, path, "Microsoft link-account - tid {Tid} is not the org's directory", id.TenantId);
        if (user.MicrosoftObjectId is not null) return Refuse(MicrosoftRefusal.MicrosoftAccountAlreadyLinked, path, "Microsoft link-account - user {User} already has an identity", user.Id);
        if (await FindByIdentityAsync(id.TenantId, id.ObjectId, ct) is not null) return Refuse(MicrosoftRefusal.MicrosoftAccountTaken, path, "Microsoft link-account - the account is on another user");

        user.MicrosoftTenantId = id.TenantId;
        user.MicrosoftObjectId = id.ObjectId;
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(Odip.Domain.Entities.User), user.Id, "Microsoft account", null, id.ObjectId.ToString(), ActorFor(user)));
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg)
        {
            _db.ChangeTracker.Clear();
            return Refuse(MicrosoftRefusal.MicrosoftAccountTaken, path, "Microsoft link-account - unique violation {Constraint}", pg.ConstraintName);
        }
        return LocalRedirect(MicrosoftSignInPaths.WithOutcome(path, "linked"));
    }

    /// <summary>The person who started a link, re-read now (the callback has no session): still active, still in the org they started in.</summary>
    private Task<User?> ReStartedUserAsync(Correlation corr, CancellationToken ct) =>
        _db.Users.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefaultAsync(u => u.Id == corr.UserId && u.TenantId == corr.OrgId && u.IsActive, ct);

    /// <summary>The audit row's actor, built the way <see cref="OdipSession.Token"/> builds the claims the audit reads.</summary>
    private static ClaimsPrincipal ActorFor(User u) => new(new ClaimsIdentity(new[]
    {
        new Claim(ClaimTypes.NameIdentifier, u.Id.ToString()), new Claim(ClaimTypes.Name, u.Username), new Claim("fullName", u.FullName),
    }, "microsoft-link"));

    // ── Refresh ──────────────────────────────────────────────────────────

    /// <summary>
    /// Mints a fresh 30-minute session while the 12-hour absolute refresh cookie holds. It never re-issues that cookie, so sign-in stays bounded to 12 hours.
    /// Everything the cookie vouched for is re-checked now, so removing the link, deactivating the person or unlinking their account ends it within one cycle.
    /// Failures are not counted: the cookie is sealed by Data Protection, so there is nothing to guess.
    /// </summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<IActionResult> Refresh(CancellationToken ct)
    {
        if (MicrosoftSignInConfig.From(_config) is null) return NotFound();

        var ticket = ReadRefresh(Request.Cookies[RefreshCookie]);
        var user = ticket is null ? null : await _db.Users.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefaultAsync(u => u.Id == ticket.UserId, ct);
        if (ticket is null || user is not { IsActive: true } || user.Role == UserRole.SuperAdmin
            || user.MicrosoftTenantId != ticket.MicrosoftTenantId || user.MicrosoftObjectId != ticket.MicrosoftObjectId
            || !await OrgLinks(user.TenantId).AnyAsync(l => l.MicrosoftTenantId == ticket.MicrosoftTenantId, ct))
            return EndRefresh();
        var org = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == user.TenantId && t.IsActive, ct);
        if (org is null) return EndRefresh();

        var token = OdipSession.Token(user, org.Id, _config);
        OdipSession.SetCookie(Response, token);
        return Ok(ApiResponse<AuthResponseDto>.Ok(new AuthResponseDto
        {
            Id = user.Id, Token = token, ExpiresAt = DateTime.UtcNow.AddMinutes(30), Username = user.Username, FullName = user.FullName,
            Role = user.Role.ToString(), TenantName = org.Name, TenantId = org.Id,
        }));
    }

    private IActionResult EndRefresh()
    {
        Response.Cookies.Delete(RefreshCookie, new CookieOptions { Path = CookiePath });
        return Unauthorized(ApiResponse<object>.Fail("Sign in again.", MicrosoftRefusal.MicrosoftSessionEnded));
    }

    private RefreshTicket? ReadRefresh(string? cookie)
    {
        if (string.IsNullOrEmpty(cookie)) return null;
        try
        {
            var ticket = JsonSerializer.Deserialize<RefreshTicket>(_refresh.Unprotect(cookie));
            return ticket is not null && _clock.GetUtcNow() - ticket.IssuedAt < RefreshLife ? ticket : null;
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException)
        {
            return null;
        }
    }

    // ── Config and management (normal session, normal tenant filter) ─────

    /// <summary>What the sign-in page needs to show the button: whether Microsoft sign-in is on, and where it starts.</summary>
    [HttpGet("/api/v1/auth/config")]
    [AllowAnonymous]
    public IActionResult Config()
    {
        var cfg = MicrosoftSignInConfig.From(_config);
        return Ok(ApiResponse<AuthConfigDto>.Ok(new AuthConfigDto(cfg is not null, cfg?.StartUrl(MicrosoftIntent.SignIn))));
    }

    [HttpGet("link")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetLink(CancellationToken ct)
    {
        var link = await _db.MicrosoftTenantLinks.FirstOrDefaultAsync(ct);
        if (link is null) return Ok(ApiResponse<MicrosoftTenantLinkDto?>.Ok(null));
        var by = await _db.Users.Where(u => u.Id == link.LinkedByUserId).Select(u => u.FirstName + " " + u.LastName).FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<MicrosoftTenantLinkDto?>.Ok(new MicrosoftTenantLinkDto(link.MicrosoftTenantId, link.DefaultRole.ToString(), by?.Trim(), link.LinkedAt, link.UpdatedAt)));
    }

    [HttpPut("link")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> PutLink([FromBody] UpdateMicrosoftLinkDto dto, CancellationToken ct)
    {
        if (!Enum.TryParse<UserRole>(dto.DefaultRole, true, out var role) || !Enum.IsDefined(role) || !GrantableRoles.Contains(role))
            return BadRequest(ApiResponse<object>.Fail("Choose Coordinator, Support Worker or Read only."));
        var link = await _db.MicrosoftTenantLinks.FirstOrDefaultAsync(ct);
        if (link is null) return NotFound(ApiResponse<object>.Fail("Microsoft sign-in is not set up for this organisation."));
        // shortcut: compares the whole-microsecond versions; a different client clock cannot matter because the value is the one a GET returned.
        if (dto.ExpectedUpdatedAt.Ticks - dto.ExpectedUpdatedAt.Ticks % 10 != link.UpdatedAt.Ticks - link.UpdatedAt.Ticks % 10)
            return Conflict(ApiResponse<object>.Fail("Someone else changed this. Reload and try again."));

        if (link.DefaultRole != role)
        {
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(MicrosoftTenantLink), link.Id, "Default role", link.DefaultRole.ToString(), role.ToString(), User));
            link.DefaultRole = role;
            link.UpdatedAt = _clock.GetUtcNow().UtcDateTime;
            await _db.SaveChangesAsync(ct);
        }
        var by = await _db.Users.Where(u => u.Id == link.LinkedByUserId).Select(u => u.FirstName + " " + u.LastName).FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<MicrosoftTenantLinkDto>.Ok(new MicrosoftTenantLinkDto(link.MicrosoftTenantId, link.DefaultRole.ToString(), by?.Trim(), link.LinkedAt, link.UpdatedAt)));
    }

    /// <summary>Removes only the link: people keep their Microsoft columns, so a relink to the same directory signs them straight back in.</summary>
    [HttpDelete("link")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> DeleteLink(CancellationToken ct)
    {
        var link = await _db.MicrosoftTenantLinks.FirstOrDefaultAsync(ct);
        if (link is null) return NotFound(ApiResponse<object>.Fail("Microsoft sign-in is not set up for this organisation."));
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(MicrosoftTenantLink), link.Id, "Microsoft tenant", link.MicrosoftTenantId.ToString(), null, User));
        _db.MicrosoftTenantLinks.Remove(link);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<object>.Ok(null, "Microsoft sign-in turned off."));
    }

    [HttpGet("account")]
    [Authorize]
    public async Task<IActionResult> GetAccount(CancellationToken ct)
    {
        var me = await CurrentUserAsync(ct);
        if (me is null) return Unauthorized(ApiResponse<object>.Fail("Sign in again."));
        return Ok(ApiResponse<MicrosoftAccountDto>.Ok(new MicrosoftAccountDto(await _db.MicrosoftTenantLinks.AnyAsync(ct), me.MicrosoftObjectId is not null)));
    }

    /// <summary>Unlinks the caller's own Microsoft account, but only if they have another way in (a Firebase account), so nobody locks themselves out.</summary>
    [HttpDelete("account")]
    [Authorize]
    public async Task<IActionResult> DeleteAccount(CancellationToken ct)
    {
        var me = await CurrentUserAsync(ct);
        if (me is null) return Unauthorized(ApiResponse<object>.Fail("Sign in again."));
        if (me.MicrosoftObjectId is null) return NotFound(ApiResponse<object>.Fail("No Microsoft account is linked."));
        if (!await _firebase.ExistsAsync(me.Email, ct))
            return Conflict(ApiResponse<object>.Fail("Microsoft is your only way to sign in. Ask an admin to set up a password first.", MicrosoftRefusal.MicrosoftOnlySignIn));

        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(Odip.Domain.Entities.User), me.Id, "Microsoft account", me.MicrosoftObjectId.ToString(), null, User));
        me.MicrosoftTenantId = null;
        me.MicrosoftObjectId = null;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<object>.Ok(null, "Microsoft account unlinked."));
    }

    private Task<User?> CurrentUserAsync(CancellationToken ct) =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? _db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) : Task.FromResult<User?>(null);

    // ── Helpers ──────────────────────────────────────────────────────────

    private IQueryable<MicrosoftTenantLink> OrgLinks(Guid orgId) =>
        _db.MicrosoftTenantLinks.IgnoreQueryFilters([TenantFilter.Name]).Where(l => l.TenantId == orgId);

    private Task<User?> FindByIdentityAsync(Guid tid, Guid oid, CancellationToken ct) =>
        _db.Users.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefaultAsync(u => u.MicrosoftTenantId == tid && u.MicrosoftObjectId == oid, ct);

    private Correlation? ReadCorrelation(string? cookie)
    {
        if (string.IsNullOrEmpty(cookie)) return null;
        try
        {
            var corr = JsonSerializer.Deserialize<Correlation>(_correlation.Unprotect(cookie));
            return corr is not null && _clock.GetUtcNow() - corr.IssuedAt <= CorrelationLife ? corr : null;
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException)
        {
            return null;
        }
    }

    private static string Random32() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    private static (string First, string Last) Names(MicrosoftIdentity id, string email)
    {
        var parts = (id.DisplayName ?? "").Split(' ', 2, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var first = !string.IsNullOrWhiteSpace(id.GivenName) ? id.GivenName.Trim() : parts.Length > 0 ? parts[0] : email.Split('@')[0];
        var last = !string.IsNullOrWhiteSpace(id.FamilyName) ? id.FamilyName.Trim() : parts.Length > 1 ? parts[1] : "";
        return (first, last);
    }

    /// <summary>
    /// Every refusal goes through here, so it is always counted (the same discipline as the exchange): a path that redirected directly would be a free retry.
    /// A locked-out address is told so, but a valid sign-in still wins (StartSession), exactly as in the exchange.
    /// </summary>
    private IActionResult Refuse(string code, string path, string logMessage, params object?[] logArgs)
    {
        if (_attemptKey is not null) _attempts.RecordFailure(_attemptKey);
        _logger.LogWarning(logMessage, logArgs);
        return LocalRedirect(MicrosoftSignInPaths.WithOutcome(path, _lockedOut ? MicrosoftRefusal.LockedOut : code));
    }

    /// <summary>For a refusal no guess can produce (the person pressed Cancel; Entra's keys could not be fetched): shown, not counted.</summary>
    private IActionResult RefuseUncounted(string code, string path, string logMessage, params object?[] logArgs)
    {
        _logger.LogWarning(logMessage, logArgs);
        return LocalRedirect(MicrosoftSignInPaths.WithOutcome(path, code));
    }

    private void BeginAttempt()
    {
        _attemptKey = ClientIp.LoginAttemptKey(HttpContext);
        if (_attemptKey is not null) _lockedOut = _attempts.IsLockedOut(_attemptKey, out _);
    }
}

public sealed record AuthConfigDto(bool Microsoft, string? MicrosoftStartUrl);
public sealed record MicrosoftTenantLinkDto(Guid MicrosoftTenantId, string DefaultRole, string? LinkedByName, DateTime LinkedAt, DateTime UpdatedAt);
public sealed record UpdateMicrosoftLinkDto(string? DefaultRole, DateTime ExpectedUpdatedAt);
public sealed record MicrosoftAccountDto(bool OrgLinked, bool AccountLinked);
